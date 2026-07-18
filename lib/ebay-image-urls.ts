import {
  MAX_EBAY_PICTURES,
  dedupeProductImages,
  normalizeProductImageUrl,
} from "@/lib/product-images";

type PublicImageEnvironment = Partial<
  Record<
  | "LISTFLOW_PUBLIC_IMAGE_BASE_URL"
  | "VERCEL_PROJECT_PRODUCTION_URL"
  | "NEXTAUTH_URL",
  string | undefined
  >
>;

type PrepareEbayPictureUrlsInput = {
  images: unknown[];
  publicImageBaseUrl?: string | null;
  stageExternalImage: (sourceUrl: string) => Promise<string>;
};

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }

  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    normalized.endsWith(".local") ||
    isPrivateIpv4(normalized)
  );
}

function normalizePublicImageBaseUrl(value: string | undefined | null) {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`;

  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "https:" || isPrivateHostname(url.hostname)) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

export function getConfiguredPublicImageBaseUrl(
  environment: PublicImageEnvironment = process.env as PublicImageEnvironment,
) {
  return (
    normalizePublicImageBaseUrl(environment.LISTFLOW_PUBLIC_IMAGE_BASE_URL) ??
    normalizePublicImageBaseUrl(environment.VERCEL_PROJECT_PRODUCTION_URL) ??
    normalizePublicImageBaseUrl(environment.NEXTAUTH_URL)
  );
}

export function buildPublicUploadedImageUrl(
  imageId: string,
  environment: PublicImageEnvironment = process.env as PublicImageEnvironment,
) {
  const baseUrl = getConfiguredPublicImageBaseUrl(environment);
  if (!baseUrl) {
    throw new Error(
      "Image uploads require LISTFLOW_PUBLIC_IMAGE_BASE_URL to be a public HTTPS URL.",
    );
  }

  return new URL(`/api/images/${encodeURIComponent(imageId)}`, baseUrl).toString();
}

export function isEbayHostedImageUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (hostname === "ebayimg.com" || hostname.endsWith(".ebayimg.com"))
    );
  } catch {
    return false;
  }
}

export function rewriteListflowUploadedImageUrl(
  value: string,
  publicImageBaseUrl: string | null | undefined,
) {
  const normalized = normalizeProductImageUrl(value);
  if (!normalized) {
    return null;
  }

  const source = new URL(normalized);
  if (!/^\/api\/images\/[^/]+\/?$/i.test(source.pathname)) {
    return source.toString();
  }

  const baseUrl = normalizePublicImageBaseUrl(publicImageBaseUrl);
  if (!baseUrl) {
    throw new Error(
      "ListFlow-hosted images require LISTFLOW_PUBLIC_IMAGE_BASE_URL to be a public HTTPS URL.",
    );
  }

  return new URL(source.pathname, baseUrl).toString();
}

export async function prepareEbayPictureUrls(
  input: PrepareEbayPictureUrlsInput,
) {
  const sourceImages = dedupeProductImages(
    input.images,
    Number.MAX_SAFE_INTEGER,
  );

  if (sourceImages.length === 0) {
    throw new Error("At least one valid image URL is required before updating eBay.");
  }

  if (sourceImages.length > MAX_EBAY_PICTURES) {
    throw new Error(
      `eBay supports up to ${MAX_EBAY_PICTURES} listing images. Remove ${sourceImages.length - MAX_EBAY_PICTURES} image(s) before updating.`,
    );
  }

  const prepared: string[] = [];

  for (let index = 0; index < sourceImages.length; index += 1) {
    const source = rewriteListflowUploadedImageUrl(
      sourceImages[index],
      input.publicImageBaseUrl,
    );
    if (!source) {
      throw new Error(`Image ${index + 1} is not a valid direct image URL.`);
    }

    const parsed = new URL(source);
    if (parsed.protocol !== "https:" || isPrivateHostname(parsed.hostname)) {
      throw new Error(
        `Image ${index + 1} (${parsed.hostname}) must be available from a public HTTPS URL.`,
      );
    }

    if (isEbayHostedImageUrl(source)) {
      prepared.push(source);
      continue;
    }

    try {
      const staged = await input.stageExternalImage(source);
      if (!isEbayHostedImageUrl(staged)) {
        throw new Error("eBay did not return an eBay-hosted image URL");
      }
      prepared.push(staged);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown staging error";
      throw new Error(
        `Image ${index + 1} (${parsed.hostname}) could not be copied to eBay: ${message}`,
      );
    }
  }

  return dedupeProductImages(prepared, MAX_EBAY_PICTURES);
}
