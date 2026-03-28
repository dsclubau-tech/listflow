/**
 * eBay API configuration — single source of truth for all eBay endpoints.
 * Import from `@/lib/ebay` in any API route that needs to call eBay.
 *
 * Reads EBAY_ENVIRONMENT from env:
 *   "production" → api.ebay.com
 *   anything else → api.sandbox.ebay.com
 */

import { XMLParser } from "fast-xml-parser";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

const isProduction = process.env.EBAY_ENVIRONMENT === "production";

export const EBAY_API_BASE_URL = isProduction
  ? "https://api.ebay.com"
  : "https://api.sandbox.ebay.com";

export const EBAY_API_ENDPOINT = `${EBAY_API_BASE_URL}/ws/api.dll`;

export const ebayConfig = {
  baseUrl: EBAY_API_BASE_URL,
  appId: process.env.EBAY_APP_ID || "",
  devId: process.env.EBAY_DEV_ID || "",
  certId: process.env.EBAY_CERT_ID || "",
  environment: isProduction ? "production" : "sandbox",
} as const;

/**
 * Gets the static eBay token for a specific store from environment variables.
 */
export function getEbayToken(storeName: string): string {
  if (storeName === "Store 1") return process.env.EBAY_STORE1_TOKEN || "";
  if (storeName === "Store 2") return process.env.EBAY_STORE2_TOKEN || "";
  if (storeName === "Store 3") return process.env.EBAY_STORE3_TOKEN || "";
  return "";
}

/**
 * Maps a database store ID (CUID) to a store number (1, 2, or 3).
 * Fetches the store name from the database and extracts the number.
 */
export async function getStoreNumber(storeId: string): Promise<1 | 2 | 3> {
  const store = await prisma.store.findUnique({ where: { id: storeId } });

  if (!store) {
    throw new Error(`Store not found: ${storeId}`);
  }

  if (store.name === "Store 1") return 1;
  if (store.name === "Store 2") return 2;
  if (store.name === "Store 3") return 3;

  throw new Error(`Unknown store name: ${store.name}`);
}

/**
 * Returns the credentials object for a given store number.
 */
export function getStoreCredentials(storeNumber: 1 | 2 | 3) {
  const refreshTokenMap: Record<number, string> = {
    1: process.env.EBAY_STORE1_TOKEN || "",
    2: process.env.EBAY_STORE2_TOKEN || "",
    3: process.env.EBAY_STORE3_TOKEN || "",
  };

  return {
    refreshToken: refreshTokenMap[storeNumber],
    appId: ebayConfig.appId,
    devId: ebayConfig.devId,
    certId: ebayConfig.certId,
  };
}

/**
 * Exchanges an OAuth Refresh Token for a short-lived Access Token.
 * Uses the eBay Identity API with client_credentials or refresh_token grant.
 */
export async function getOAuthAccessToken(storeNumber: 1 | 2 | 3): Promise<string> {
  const creds = getStoreCredentials(storeNumber);

  if (!creds.refreshToken) {
    throw new Error(`No refresh token configured for Store ${storeNumber}`);
  }
  if (!creds.appId || !creds.certId) {
    throw new Error("EBAY_APP_ID or EBAY_CERT_ID not set in environment");
  }

  // Basic auth = base64(appId:certId)
  const basicAuth = Buffer.from(`${creds.appId}:${creds.certId}`).toString("base64");

  const oauthBase = isProduction
    ? "https://api.ebay.com"
    : "https://api.sandbox.ebay.com";

  const response = await fetch(`${oauthBase}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: creds.refreshToken,
      scope: [
        "https://api.ebay.com/oauth/api_scope",
        "https://api.ebay.com/oauth/api_scope/sell.marketing.readonly",
        "https://api.ebay.com/oauth/api_scope/sell.marketing",
        "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
        "https://api.ebay.com/oauth/api_scope/sell.inventory",
        "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
        "https://api.ebay.com/oauth/api_scope/sell.account",
        "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
        "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
      ].join(" "),
    }).toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("ebay/getOAuthAccessToken", `Token exchange failed (HTTP ${response.status})`, undefined, {
      storeNumber,
      status: response.status,
      responseBody: text,
    });
    throw new Error(`eBay OAuth token exchange failed (${response.status}): ${text}`);
  }

  const data = await response.json() as { access_token?: string; error_description?: string };

  if (!data.access_token) {
    logger.error("ebay/getOAuthAccessToken", "Token exchange returned no access_token", undefined, {
      storeNumber,
      responseData: data,
    });
    throw new Error(`eBay OAuth returned no access_token: ${data.error_description ?? JSON.stringify(data)}`);
  }

  logger.info("ebay/getOAuthAccessToken", "Token exchange succeeded", { storeNumber });

  return data.access_token;
}

/**
 * Sends an AddItem XML request to the eBay Trading API and parses the response.
 */
export async function callEbayAddItem(
  xmlBody: string,
  storeNumber: 1 | 2 | 3
): Promise<{ success: boolean; itemId?: string; errorMessage?: string }> {
  const creds = getStoreCredentials(storeNumber);

  // Exchange refresh token for a short-lived OAuth access token
  let accessToken: string;
  try {
    accessToken = await getOAuthAccessToken(storeNumber);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed";
    return { success: false, errorMessage: message };
  }

  try {
    const response = await fetch(EBAY_API_ENDPOINT, {
      method: "POST",
      headers: {
        "X-EBAY-API-SITEID": "15",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "X-EBAY-API-CALL-NAME": "AddItem",
        "X-EBAY-API-APP-NAME": creds.appId,
        "X-EBAY-API-DEV-NAME": creds.devId,
        "X-EBAY-API-CERT-NAME": creds.certId,
        "Content-Type": "text/xml",
        "X-EBAY-API-IAF-TOKEN": accessToken,
        Authorization: `Bearer ${accessToken}`,
      },
      body: xmlBody,
    });

    const xmlText = await response.text();

    logger.ebayResponse("ebay/callEbayAddItem", "Raw eBay AddItem response received", xmlText, {
      storeNumber,
      httpStatus: response.status,
    });

    const parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
    });
    const parsed = parser.parse(xmlText);

    const addItemResponse = parsed.AddItemResponse;
    if (!addItemResponse) {
      return {
        success: false,
        errorMessage: "Invalid response from eBay API",
      };
    }

    const ack = addItemResponse.Ack;

    if (ack === "Success" || ack === "Warning") {
      const itemId = addItemResponse.ItemID?.toString();
      return { success: true, itemId };
    }

    // Extract error message
    const errors = addItemResponse.Errors;
    let errorMessage = "Unknown eBay error";

    if (errors) {
      if (Array.isArray(errors)) {
        errorMessage = errors.map((e: { ShortMessage?: string }) => e.ShortMessage || "Unknown error").join("; ");
      } else {
        errorMessage = errors.ShortMessage || errors.LongMessage || "Unknown error";
      }
    }

    return { success: false, errorMessage };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, errorMessage: message };
  }
}

/**
 * Sends an EndItem XML request to the eBay Trading API to end an active listing.
 */
export async function callEbayEndItem(
  xmlBody: string,
  storeNumber: 1 | 2 | 3
): Promise<{ success: boolean; errorMessage?: string }> {
  const creds = getStoreCredentials(storeNumber);

  let accessToken: string;
  try {
    accessToken = await getOAuthAccessToken(storeNumber);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed";
    return { success: false, errorMessage: message };
  }

  try {
    const response = await fetch(EBAY_API_ENDPOINT, {
      method: "POST",
      headers: {
        "X-EBAY-API-SITEID": "15",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "X-EBAY-API-CALL-NAME": "EndItem",
        "X-EBAY-API-APP-NAME": creds.appId,
        "X-EBAY-API-DEV-NAME": creds.devId,
        "X-EBAY-API-CERT-NAME": creds.certId,
        "Content-Type": "text/xml",
        "X-EBAY-API-IAF-TOKEN": accessToken,
        Authorization: `Bearer ${accessToken}`,
      },
      body: xmlBody,
    });

    const xmlText = await response.text();

    logger.ebayResponse("ebay/callEbayEndItem", "Raw eBay EndItem response received", xmlText, {
      storeNumber,
      httpStatus: response.status,
    });

    const parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
    });
    const parsed = parser.parse(xmlText);

    const endItemResponse = parsed.EndItemResponse;
    if (!endItemResponse) {
      return { success: false, errorMessage: "Invalid response from eBay API" };
    }

    const ack = endItemResponse.Ack;

    if (ack === "Success" || ack === "Warning") {
      return { success: true };
    }

    // Extract error message
    const errors = endItemResponse.Errors;
    let errorMessage = "Unknown eBay error";

    if (errors) {
      if (Array.isArray(errors)) {
        errorMessage = errors.map((e: { ShortMessage?: string }) => e.ShortMessage || "Unknown error").join("; ");
      } else {
        errorMessage = errors.ShortMessage || errors.LongMessage || "Unknown error";
      }
    }

    return { success: false, errorMessage };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, errorMessage: message };
  }
}

/**
 * Sends a ReviseItem XML request to the eBay Trading API to update a live listing.
 */
export async function callEbayReviseItem(
  xmlBody: string,
  storeNumber: 1 | 2 | 3
): Promise<{ success: boolean; errorMessage?: string }> {
  const creds = getStoreCredentials(storeNumber);

  let accessToken: string;
  try {
    accessToken = await getOAuthAccessToken(storeNumber);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed";
    return { success: false, errorMessage: message };
  }

  try {
    const response = await fetch(EBAY_API_ENDPOINT, {
      method: "POST",
      headers: {
        "X-EBAY-API-SITEID": "15",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "X-EBAY-API-CALL-NAME": "ReviseItem",
        "X-EBAY-API-APP-NAME": creds.appId,
        "X-EBAY-API-DEV-NAME": creds.devId,
        "X-EBAY-API-CERT-NAME": creds.certId,
        "Content-Type": "text/xml",
        "X-EBAY-API-IAF-TOKEN": accessToken,
        Authorization: `Bearer ${accessToken}`,
      },
      body: xmlBody,
    });

    const xmlText = await response.text();

    logger.ebayResponse("ebay/callEbayReviseItem", "Raw eBay ReviseItem response received", xmlText, {
      storeNumber,
      httpStatus: response.status,
    });

    const parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
    });
    const parsed = parser.parse(xmlText);

    const reviseItemResponse = parsed.ReviseItemResponse;
    if (!reviseItemResponse) {
      return { success: false, errorMessage: "Invalid response from eBay API" };
    }

    const ack = reviseItemResponse.Ack;

    if (ack === "Success" || ack === "Warning") {
      return { success: true };
    }

    const errors = reviseItemResponse.Errors;
    let errorMessage = "Unknown eBay error";

    if (errors) {
      if (Array.isArray(errors)) {
        errorMessage = errors.map((e: { ShortMessage?: string }) => e.ShortMessage || "Unknown error").join("; ");
      } else {
        errorMessage = errors.ShortMessage || errors.LongMessage || "Unknown error";
      }
    }

    return { success: false, errorMessage };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, errorMessage: message };
  }
}

/**
 * Fetches the seller's Business Policies (shipping, returns, payment) from eBay.
 */
export async function getEbayBusinessPolicies(storeNumber: 1 | 2 | 3): Promise<{
  shipping: Array<{ profileId: string; profileName: string }>;
  returns: Array<{ profileId: string; profileName: string }>;
  payment: Array<{ profileId: string; profileName: string }>;
}> {
  const creds = getStoreCredentials(storeNumber);
  const accessToken = await getOAuthAccessToken(storeNumber);

  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetUserPreferencesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ShowSellerProfilePreferences>true</ShowSellerProfilePreferences>
</GetUserPreferencesRequest>`;

  const response = await fetch(EBAY_API_ENDPOINT, {
    method: "POST",
    headers: {
      "X-EBAY-API-SITEID": "15",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
      "X-EBAY-API-CALL-NAME": "GetUserPreferences",
      "X-EBAY-API-APP-NAME": creds.appId,
      "X-EBAY-API-DEV-NAME": creds.devId,
      "X-EBAY-API-CERT-NAME": creds.certId,
      "Content-Type": "text/xml",
      "X-EBAY-API-IAF-TOKEN": accessToken,
      Authorization: `Bearer ${accessToken}`,
    },
    body: xmlBody,
  });

  const xmlText = await response.text();

  logger.ebayResponse("ebay/getEbayBusinessPolicies", "GetUserPreferences response", xmlText, {
    storeNumber,
    httpStatus: response.status,
  });

  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
  });
  const parsed = parser.parse(xmlText);

  const prefs = parsed.GetUserPreferencesResponse;
  if (!prefs) {
    throw new Error("Invalid GetUserPreferences response from eBay");
  }

  const shipping: Array<{ profileId: string; profileName: string }> = [];
  const returns: Array<{ profileId: string; profileName: string }> = [];
  const payment: Array<{ profileId: string; profileName: string }> = [];

  const sellerProfilePrefs = prefs.SellerProfilePreferences;
  if (!sellerProfilePrefs) {
    return { shipping, returns, payment };
  }

  let profiles = sellerProfilePrefs.SupportedSellerProfiles?.SupportedSellerProfile;
  if (!profiles) {
    return { shipping, returns, payment };
  }

  // Ensure it's always an array
  if (!Array.isArray(profiles)) {
    profiles = [profiles];
  }

  for (const profile of profiles) {
    const entry = {
      profileId: String(profile.ProfileID ?? ""),
      profileName: String(profile.ProfileName ?? ""),
    };

    const profileType = String(profile.ProfileType ?? "");

    if (profileType === "SHIPPING") {
      shipping.push(entry);
    } else if (profileType === "RETURN_POLICY") {
      returns.push(entry);
    } else if (profileType === "PAYMENT") {
      payment.push(entry);
    }
  }

  return { shipping, returns, payment };
}

/**
 * Calls the eBay Taxonomy REST API to find suggested categories for a product title.
 * Uses the modern /commerce/taxonomy/v1 endpoint instead of the legacy Trading API
 * (which returns 503 from Akamai CDN).
 *
 * category_tree_id 15 = eBay Australia.
 * Returns up to 5 suggestions. Never throws — returns an empty array on failure.
 */
export async function getEbaySuggestedCategories(
  title: string,
  storeNumber: 1 | 2 | 3
): Promise<Array<{ categoryId: string; categoryName: string }>> {
  try {
    // Truncate long titles at a word boundary (max 80 chars)
    let query = title.trim();
    if (query.length > 80) {
      const shortened = query.slice(0, 80);
      const lastSpace = shortened.lastIndexOf(" ");
      query = lastSpace > 20 ? shortened.slice(0, lastSpace) : shortened;
    }

    const accessToken = await getOAuthAccessToken(storeNumber);

    // eBay Australia category_tree_id = 15
    const taxonomyUrl = `${EBAY_API_BASE_URL}/commerce/taxonomy/v1/category_tree/15/get_category_suggestions?q=${encodeURIComponent(query)}`;

    const response = await fetch(taxonomyUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    const responseText = await response.text();

    logger.info("ebay/getEbaySuggestedCategories", "Taxonomy API response received", {
      storeNumber,
      httpStatus: response.status,
      queryLength: query.length,
      titleQuery: query.slice(0, 60),
    });

    if (!response.ok) {
      logger.error("ebay/getEbaySuggestedCategories", `Taxonomy API returned HTTP ${response.status}`, undefined, {
        storeNumber,
        responseBody: responseText.slice(0, 500),
      });
      return [];
    }

    const data = JSON.parse(responseText) as {
      categorySuggestions?: Array<{
        category: { categoryId: string; categoryName: string };
        categoryTreeNodeAncestors?: Array<{ categoryName: string }>;
      }>;
    };

    if (!data.categorySuggestions || data.categorySuggestions.length === 0) {
      logger.info("ebay/getEbaySuggestedCategories", "No category suggestions returned", {
        storeNumber,
        query: query.slice(0, 60),
      });
      return [];
    }

    // Map and deduplicate categories
    const seen = new Set<string>();
    const mapped: Array<{ categoryId: string; categoryName: string }> = [];

    for (const suggestion of data.categorySuggestions) {
      const id = suggestion.category.categoryId;
      if (seen.has(id)) continue;
      seen.add(id);

      // Build a full path like "Electronics > Tablets & eReaders"
      const ancestors = suggestion.categoryTreeNodeAncestors || [];
      const pathParts = ancestors.map((a) => a.categoryName).reverse();
      pathParts.push(suggestion.category.categoryName);
      const fullPath = pathParts.length > 1 ? pathParts.join(" > ") : suggestion.category.categoryName;

      mapped.push({
        categoryId: id,
        categoryName: fullPath,
      });

      if (mapped.length >= 5) break;
    }

    logger.info("ebay/getEbaySuggestedCategories", "Category suggestions mapped", {
      storeNumber,
      count: mapped.length,
      topCategory: mapped[0]?.categoryName,
    });

    return mapped;
  } catch (err) {
    logger.error("ebay/getEbaySuggestedCategories", "Failed to get suggested categories", err, {
      storeNumber,
      title: title.slice(0, 60),
    });
    return [];
  }
}
