import { isEbayHostedImageUrl } from "@/lib/ebay-image-urls";

const IS_PRODUCTION = process.env.EBAY_ENVIRONMENT === "production";
const EBAY_MEDIA_API_BASE_URL = IS_PRODUCTION
  ? "https://apim.ebay.com"
  : "https://apim.sandbox.ebay.com";
const CREATE_IMAGE_FROM_URL_PATH =
  "/commerce/media/v1_beta/image/create_image_from_url";
const DEFAULT_POLL_ATTEMPTS = 12;
const DEFAULT_POLL_DELAY_MS = 2_000;

type EbayMediaDependencies = {
  fetchImpl?: typeof fetch;
  getAccessToken?: (storeNumber: 1 | 2 | 3) => Promise<string>;
  waitForRateLimit?: () => Promise<void>;
  recordRateLimitBackoff?: (error: unknown) => Promise<unknown>;
  sleep?: (milliseconds: number) => Promise<void>;
  pollAttempts?: number;
  pollDelayMs?: number;
};

type EbayMediaJson = Record<string, unknown>;

function parseJson(text: string): EbayMediaJson | null {
  if (!text.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as EbayMediaJson)
      : null;
  } catch {
    return null;
  }
}

function nestedRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as EbayMediaJson)
    : null;
}

function getImageUrl(body: EbayMediaJson | null) {
  const image = nestedRecord(body?.image);
  const candidates = [body?.imageUrl, body?.imageURL, image?.imageUrl, image?.imageURL];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && isEbayHostedImageUrl(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getImageId(body: EbayMediaJson | null) {
  const image = nestedRecord(body?.image);
  const candidate = body?.imageId ?? image?.imageId;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}

function getProcessingStatus(body: EbayMediaJson | null) {
  const image = nestedRecord(body?.image);
  const candidate =
    body?.processStatus ?? body?.status ?? image?.processStatus ?? image?.status;
  return typeof candidate === "string" ? candidate.trim().toUpperCase() : "";
}

function formatMediaError(status: number, body: EbayMediaJson | null, text: string) {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  const messages = errors.flatMap((entry) => {
    const error = nestedRecord(entry);
    return [error?.longMessage, error?.message]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
  });
  const directMessage =
    typeof body?.message === "string" ? body.message.trim() : "";
  const detail = messages[0] || directMessage || text.trim().slice(0, 300);
  return detail
    ? `eBay Media API failed (${status}): ${detail}`
    : `eBay Media API failed (${status}).`;
}

function getImageResourceUrl(
  response: Response,
  body: EbayMediaJson | null,
) {
  const location = response.headers.get("location");
  if (location) {
    return new URL(location, EBAY_MEDIA_API_BASE_URL).toString();
  }

  const imageId = getImageId(body);
  return imageId
    ? `${EBAY_MEDIA_API_BASE_URL}/commerce/media/v1_beta/image/${encodeURIComponent(imageId)}`
    : null;
}

export async function createEbayImageFromUrl(
  input: {
    sourceUrl: string;
    storeId: string;
    storeNumber: 1 | 2 | 3;
  },
  dependencies: EbayMediaDependencies = {},
) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const getAccessToken =
    dependencies.getAccessToken ??
    (async (storeNumber: 1 | 2 | 3) =>
      (await import("@/lib/ebay")).getOAuthAccessToken(storeNumber));
  const waitForLimit =
    dependencies.waitForRateLimit ??
    (async () =>
      (await import("@/lib/ebay-rate-limit")).waitForEbayRateLimit(
        input.storeId,
        "MEDIA",
      ));
  const recordBackoff =
    dependencies.recordRateLimitBackoff ??
    (async (error: unknown) =>
      (await import("@/lib/ebay-rate-limit")).recordEbayRateLimitBackoff(
        input.storeId,
        "MEDIA",
        error,
      ));
  const sleep =
    dependencies.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const accessToken = await getAccessToken(input.storeNumber);

  await waitForLimit();
  const createResponse = await fetchImpl(
    `${EBAY_MEDIA_API_BASE_URL}${CREATE_IMAGE_FROM_URL_PATH}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ imageUrl: input.sourceUrl }),
    },
  );
  const createText = await createResponse.text();
  const createBody = parseJson(createText);

  if (createResponse.status === 429) {
    await recordBackoff(`HTTP ${createResponse.status}`);
  }
  if (!createResponse.ok) {
    throw new Error(
      formatMediaError(createResponse.status, createBody, createText),
    );
  }

  const immediateImageUrl = getImageUrl(createBody);
  if (immediateImageUrl) {
    return immediateImageUrl;
  }

  const resourceUrl = getImageResourceUrl(createResponse, createBody);
  if (!resourceUrl) {
    throw new Error("eBay Media API returned no image resource location.");
  }

  const attempts = Math.max(1, dependencies.pollAttempts ?? DEFAULT_POLL_ATTEMPTS);
  const pollDelayMs = Math.max(
    0,
    dependencies.pollDelayMs ?? DEFAULT_POLL_DELAY_MS,
  );

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1 || pollDelayMs > 0) {
      await sleep(pollDelayMs);
    }

    await waitForLimit();
    const response = await fetchImpl(resourceUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    const responseText = await response.text();
    const responseBody = parseJson(responseText);

    if (response.status === 429) {
      await recordBackoff(`HTTP ${response.status}`);
    }

    if (response.ok) {
      const imageUrl = getImageUrl(responseBody);
      if (imageUrl) {
        return imageUrl;
      }

      if (/FAILED|REJECTED|ERROR/.test(getProcessingStatus(responseBody))) {
        throw new Error("eBay could not process the image.");
      }
      continue;
    }

    if (response.status === 404 && attempt < attempts) {
      continue;
    }

    throw new Error(formatMediaError(response.status, responseBody, responseText));
  }

  throw new Error("eBay did not finish processing the image in time. Try the update again.");
}
