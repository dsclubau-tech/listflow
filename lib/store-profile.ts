export const MAX_STORE_DISPLAY_NAME_LENGTH = 80;

export type StoreNameValidationResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

export function validateStoreDisplayName(
  value: unknown,
): StoreNameValidationResult {
  if (typeof value !== "string") {
    return { ok: false, error: "Store name is required." };
  }

  const name = value.trim().replace(/\s+/g, " ");

  if (!name) {
    return { ok: false, error: "Store name is required." };
  }

  if (name.length > MAX_STORE_DISPLAY_NAME_LENGTH) {
    return {
      ok: false,
      error: `Store name must be ${MAX_STORE_DISPLAY_NAME_LENGTH} characters or fewer.`,
    };
  }

  return { ok: true, name };
}

export function normalizeEbayStoreNumber(
  value: unknown,
): 1 | 2 | 3 | null {
  const parsed = Number(value);
  return parsed === 1 || parsed === 2 || parsed === 3 ? parsed : null;
}

export function resolveLegacyEbayStoreNumber(input: {
  loginId?: string | null;
  name?: string | null;
}) {
  const loginMatch = input.loginId
    ?.trim()
    .match(/^store[-_ ]?([123])$/i);
  if (loginMatch) {
    return Number(loginMatch[1]) as 1 | 2 | 3;
  }

  const nameMatch = input.name?.trim().match(/^store\s+([123])$/i);
  return nameMatch ? (Number(nameMatch[1]) as 1 | 2 | 3) : null;
}

export function resolveEbayStoreNumber(input: {
  configuredStoreNumber?: unknown;
  loginId?: string | null;
  name?: string | null;
}) {
  return (
    normalizeEbayStoreNumber(input.configuredStoreNumber) ??
    resolveLegacyEbayStoreNumber(input)
  );
}
