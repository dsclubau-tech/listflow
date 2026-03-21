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
  const tokenMap: Record<number, string> = {
    1: process.env.EBAY_STORE1_TOKEN || "",
    2: process.env.EBAY_STORE2_TOKEN || "",
    3: process.env.EBAY_STORE3_TOKEN || "",
  };

  return {
    token: tokenMap[storeNumber],
    appId: ebayConfig.appId,
    devId: ebayConfig.devId,
    certId: ebayConfig.certId,
  };
}

/**
 * Sends an AddItem XML request to the eBay Trading API and parses the response.
 */
export async function callEbayAddItem(
  xmlBody: string,
  storeNumber: 1 | 2 | 3
): Promise<{ success: boolean; itemId?: string; errorMessage?: string }> {
  const creds = getStoreCredentials(storeNumber);

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
      },
      body: xmlBody,
    });

    const xmlText = await response.text();

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
