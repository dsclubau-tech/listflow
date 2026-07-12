export const DEFAULT_AUTHENTICATED_PATH = "/products";

export const PRIVATE_APP_PATHS = [
  "/action-center",
  "/dashboard",
  "/drafts",
  "/ebay-import",
  "/ebay-research",
  "/history",
  "/price-tracker",
  "/products",
  "/settings",
] as const;

function matchesPathPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isPrivateAppPath(pathname: string) {
  return PRIVATE_APP_PATHS.some((prefix) => matchesPathPrefix(pathname, prefix));
}

export function getSafeCallbackPath(value: string | null | undefined) {
  const candidate = value?.trim();

  if (
    !candidate ||
    candidate.length > 2_048 ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return DEFAULT_AUTHENTICATED_PATH;
  }

  try {
    const baseUrl = new URL("https://listflow.local");
    const parsed = new URL(candidate, baseUrl);

    if (parsed.origin !== baseUrl.origin || parsed.pathname === "/login") {
      return DEFAULT_AUTHENTICATED_PATH;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_AUTHENTICATED_PATH;
  }
}
