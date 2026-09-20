import type { Browser, BrowserContext } from "playwright-core";

export type AmazonDeliveryStorageState = Awaited<
  ReturnType<BrowserContext["storageState"]>
>;

export type AmazonDeliveryStateSession = {
  readonly postcode: string;
  browser: Browser | null;
  userAgent: string | null;
  storageState: AmazonDeliveryStorageState | null;
  disabled: boolean;
  disabledReason: string | null;
};

export function createAmazonDeliveryStateSession(
  postcode: string,
): AmazonDeliveryStateSession {
  return {
    postcode: postcode.trim(),
    browser: null,
    userAgent: null,
    storageState: null,
    disabled: false,
    disabledReason: null,
  };
}

export function hasExactAmazonDeliveryPostcode(
  deliveryText: string | null | undefined,
  postcode: string,
) {
  const expected = postcode.trim();
  if (!deliveryText || !expected) return false;

  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\D)${escaped}(?=\\D|$)`).test(deliveryText);
}

export function canReuseAmazonDeliveryState(
  session: AmazonDeliveryStateSession,
  browser: Browser,
  postcode: string,
) {
  return Boolean(
    !session.disabled &&
      session.postcode === postcode.trim() &&
      session.browser === browser &&
      session.userAgent &&
      session.storageState,
  );
}

export function seedAmazonDeliveryState(
  session: AmazonDeliveryStateSession,
  input: {
    browser: Browser;
    userAgent: string;
    storageState: AmazonDeliveryStorageState;
  },
) {
  if (session.disabled) return false;
  session.browser = input.browser;
  session.userAgent = input.userAgent;
  session.storageState = input.storageState;
  return true;
}

export function resetAmazonDeliveryState(
  session: AmazonDeliveryStateSession,
  options?: { disable?: boolean; reason?: string },
) {
  session.browser = null;
  session.userAgent = null;
  session.storageState = null;
  if (options?.disable) {
    session.disabled = true;
    session.disabledReason = options.reason ?? "Delivery-state reuse was disabled.";
  }
}
