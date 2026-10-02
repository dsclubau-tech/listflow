import type { Page } from "playwright-core";
import { load } from "cheerio";
import { extractAmazonPostcodeToken, parseAmazonPostcodeResponse } from "./amazon-direct-parse";
import { classifyAmazonImportPage, type AmazonImportPageQuality } from "./amazon-import-page";
import { hasExactAmazonDeliveryPostcode } from "./amazon-delivery-state";
import { PriceCheckFailure } from "./price-check-failures";

export type DeliveryTechnicalCode = "AMAZON_DELIVERY_HTTP_ERROR" | "AMAZON_DELIVERY_RESPONSE_UNRECOGNIZED" |
  "AMAZON_DELIVERY_POPUP_TIMEOUT" | "AMAZON_DELIVERY_POPUP_FAILED" | "AMAZON_DELIVERY_POSTCODE_UNVERIFIED" | "AMAZON_DELIVERY_PAGE_INVALID";
export type DeliveryFailureDetails = {
  technicalCode: DeliveryTechnicalCode;
  stage: string;
  requestedPostcode: string;
  httpStatus?: number;
  contentType?: string;
  pageClassification?: AmazonImportPageQuality["kind"];
  pageEvidence?: {
    documentTitle: string | null;
    productTitle: string | null;
    detectedAsin: string | null;
    hasAsinInput: boolean;
    hasBuyBox: boolean;
    deliveryText: string;
    htmlBytes: number;
  };
  observedDeliveryText?: string;
  browserError?: string;
  addressFailureCode?: DeliveryTechnicalCode;
  addressBrowserError?: string;
  freshContextUsed?: boolean;
};
export type DeliverySetupDiagnostic = Omit<DeliveryFailureDetails, "technicalCode"> & { technicalCode?: DeliveryTechnicalCode };
export class AmazonDeliveryFailure extends PriceCheckFailure {
  readonly details: DeliveryFailureDetails;
  constructor(message: string, details: DeliveryFailureDetails) {
    super("TECHNICAL_ERROR", message);
    this.name = "AmazonDeliveryFailure";
    this.details = details;
  }
  get permitsFreshContextRetry() {
    return !this.details.freshContextUsed && this.details.pageClassification !== "CHALLENGE" &&
      this.details.httpStatus !== 503 && this.details.httpStatus !== 429;
  }
}

export async function readAmazonDeliveryText(page: Page) {
  return page.evaluate(() => ["#glow-ingress-line1", "#glow-ingress-line2", "#nav-global-location-data-modal-action"]
    .map(selector => document.querySelector(selector)?.textContent ?? "").join(" ").replace(/\s+/g, " ").trim());
}

export async function assertAmazonDeliveryPage(page: Page, postcode: string,
  response?: { httpStatus?: number; contentType?: string }) {
  const html = await page.content();
  const quality = classifyAmazonImportPage(html);
  const failureEvidence = () => {
    const $ = load(html);
    const title = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 200) || null;
    return { documentTitle: title($("title").first().text()), productTitle: title($("#productTitle, #title h1").first().text()),
      detectedAsin: quality.asin, hasAsinInput: $("#ASIN, input[name='ASIN']").length > 0,
      hasBuyBox: $("#buybox, #desktop_buybox, #buybox_feature_div").length > 0,
      deliveryText: title($("#glow-ingress-line1, #glow-ingress-line2, #nav-global-location-data-modal-action").map((_, element) => $(element).text()).get().join(" ")) ?? "",
      htmlBytes: Buffer.byteLength(html, "utf8") };
  };
  if (response?.httpStatus && response.httpStatus >= 400) throw new AmazonDeliveryFailure(
    `Amazon product navigation returned HTTP ${response.httpStatus}; delivery setup could not be verified.`,
    { ...response, technicalCode: "AMAZON_DELIVERY_HTTP_ERROR", stage: "product-navigation", requestedPostcode: postcode,
      pageClassification: quality.kind, pageEvidence: failureEvidence() });
  if (quality.kind !== "PRODUCT") throw new AmazonDeliveryFailure(
    `Amazon returned a ${quality.kind.toLowerCase().replaceAll("_", " ")} page; delivery setup could not be verified.`,
    { ...response, technicalCode: "AMAZON_DELIVERY_PAGE_INVALID", stage: "page-classification", requestedPostcode: postcode,
      pageClassification: quality.kind, pageEvidence: failureEvidence() });
  return quality;
}

/** One address request and one bounded popup recovery; the caller owns fresh-context retry. */
export async function applyAmazonDeliveryPostcode(page: Page, postcode: string,
  onDiagnostic?: (details: DeliverySetupDiagnostic) => void): Promise<boolean> {
  const report = (details: DeliverySetupDiagnostic) => { try { onDiagnostic?.({ ...details }); } catch { /* Diagnostics cannot change the setup outcome. */ } };
  const quality = await assertAmazonDeliveryPage(page, postcode);
  const observedDeliveryText = await readAmazonDeliveryText(page);
  if (hasExactAmazonDeliveryPostcode(observedDeliveryText, postcode)) return true;
  const details: DeliveryFailureDetails = { technicalCode: "AMAZON_DELIVERY_RESPONSE_UNRECOGNIZED",
    stage: "address-change", requestedPostcode: postcode, pageClassification: quality.kind, observedDeliveryText };
  try {
    const html = await page.content();
    const token = extractAmazonPostcodeToken(load(html), html);
    const response = await page.evaluate(async ({ pc, csrfToken }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const body = new URLSearchParams({ locationType: "LOCATION_INPUT", zipCode: pc,
          storeContext: "pc", deviceType: "web", pageType: "Detail", actionSource: "glow" });
        if (csrfToken) body.set("anti-csrftoken-a2z", csrfToken);
        const result = await fetch("/gp/delivery/ajax/address-change.html", { method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest", ...(csrfToken ? { "anti-csrftoken-a2z": csrfToken } : {}) },
          body: body.toString(), signal: controller.signal });
        return { success: result.ok, status: result.status, contentType: result.headers.get("content-type") ?? "",
          responseText: result.ok ? await result.text() : "" };
      } finally { clearTimeout(timer); }
    }, { pc: postcode, csrfToken: token });
    details.httpStatus = response.status;
    details.contentType = response.contentType;
    if (response.success && parseAmazonPostcodeResponse(response.responseText, postcode)) {
      report({ ...details, technicalCode: undefined, stage: "address-request-accepted" });
      return true;
    }
    if (!response.success) details.technicalCode = "AMAZON_DELIVERY_HTTP_ERROR";
    report(details);
  } catch (error) {
    details.browserError = error instanceof Error ? error.message.slice(0, 300) : "Address-change request failed";
    report(details);
  }
  // Error pages must never be treated as an interactive product popup.
  try { await assertAmazonDeliveryPage(page, postcode); }
  catch (error) {
    if (error instanceof AmazonDeliveryFailure) throw new AmazonDeliveryFailure(error.message,
      { ...details, ...error.details, httpStatus: details.httpStatus, contentType: details.contentType });
    throw error;
  }
  let popupStage = "popup-inspection";
  try {
    const input = page.locator("#GLUXZipUpdateInput");
    if (!(await input.isVisible())) {
      const location = page.locator("#nav-global-location-popover-link");
      popupStage = "location-control";
      await location.waitFor({ state: "visible", timeout: 3000 });
      popupStage = "location-click";
      await location.click({ timeout: 5000 });
      popupStage = "popup-input";
      await input.waitFor({ state: "visible", timeout: 5000 });
    }
    popupStage = "popup-apply";
    await input.fill(postcode, { timeout: 5000 });
    await page.locator('#GLUXZipUpdate input[type="submit"], #GLUXZipUpdate .a-button-input, #GLUXZipUpdate .a-button').first().click({ timeout: 5000 });
    await page.waitForTimeout(2000);
    const cities = page.locator("#GLUXCityList select, #GLUXCityPopover select").first();
    if (await cities.isVisible()) {
      await cities.selectOption({ index: 1 }, { timeout: 5000 });
      await page.waitForTimeout(1000);
    }
    const done = page.locator('[name="glowDoneButton"], #GLUXConfirmClose, .a-popover-footer .a-button-primary').first();
    if (await done.isVisible()) await done.click({ timeout: 5000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 });
    report({ ...details, stage: "popup-applied" });
    return true;
  } catch (error) {
    const popupError = error instanceof Error ? error.message.slice(0, 300) : "Popup recovery failed";
    throw new AmazonDeliveryFailure(`Amazon delivery setup unavailable for postcode ${postcode}: ${details.httpStatus && details.httpStatus >= 400
      ? `HTTP ${details.httpStatus}; ` : ""}popup recovery failed.`,
    { ...details, addressFailureCode: details.technicalCode, addressBrowserError: details.browserError,
      technicalCode: details.httpStatus === 503 || details.httpStatus === 429
        ? "AMAZON_DELIVERY_HTTP_ERROR" : /timeout|timed out/i.test(popupError) ? "AMAZON_DELIVERY_POPUP_TIMEOUT" : "AMAZON_DELIVERY_POPUP_FAILED",
      stage: popupStage, browserError: popupError });
  }
}
