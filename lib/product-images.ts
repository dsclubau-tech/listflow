const AMAZON_IMAGE_SIZE_SUFFIX = /\._[^/.]+_\.(jpg|jpeg|png|webp|gif)$/i;
const BAD_IMAGE_URL_PATTERN =
  /play-button|spinner|loading|transparent|pixel|grey-pixel|sprite/i;

function extractFirstUrl(value: string) {
  const match = value.match(/https?:\/\/[^\s"'<>\\]+/i);
  return match?.[0] ?? "";
}

function stripAmazonImageSizeSuffix(pathname: string) {
  let next = pathname;
  let previous = "";

  while (next !== previous) {
    previous = next;
    next = next.replace(AMAZON_IMAGE_SIZE_SUFFIX, ".$1");
  }

  return next;
}

export function normalizeProductImageUrl(
  value: unknown,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const raw = (value ?? "")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .trim();
  const candidate = extractFirstUrl(raw);

  if (!candidate || BAD_IMAGE_URL_PATTERN.test(candidate)) {
    return null;
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    url.hash = "";
    url.search = "";

    if (/amazon|ssl-images/i.test(url.hostname)) {
      url.pathname = stripAmazonImageSizeSuffix(url.pathname);
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function dedupeProductImages(
  images: unknown[],
  maxImages = 12,
) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const image of images) {
    const normalized = normalizeProductImageUrl(image);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);

    if (result.length >= maxImages) {
      break;
    }
  }

  return result;
}
