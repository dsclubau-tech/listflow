export function getAddProductUrlValidationError(url: string) {
  const trimmed = url.trim();

  if (!trimmed) {
    return "Please enter a URL";
  }

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    const isAmazonAu =
      parsed.protocol === "https:" &&
      (hostname === "amazon.com.au" || hostname.endsWith(".amazon.com.au"));

    return isAmazonAu
      ? null
      : "Only Amazon AU (amazon.com.au) URLs are supported";
  } catch {
    return "Only Amazon AU (amazon.com.au) URLs are supported";
  }
}
