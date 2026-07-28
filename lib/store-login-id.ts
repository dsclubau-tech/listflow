export const STORE_LOGIN_ID_WHITESPACE_ERROR =
  "Store ID cannot contain spaces.";

export function hasStoreLoginIdWhitespace(value: unknown): boolean {
  return typeof value === "string" && /\s/.test(value);
}
