import "server-only";

import { prisma } from "@/lib/prisma";

export type EbayRateLimitKind = "TRADING" | "BROWSE";

const DEFAULT_TRADING_INTERVAL_MS = Number(
  process.env.LISTFLOW_EBAY_TRADING_MIN_INTERVAL_MS ?? 2_500
);
const DEFAULT_BROWSE_INTERVAL_MS = Number(
  process.env.LISTFLOW_EBAY_BROWSE_MIN_INTERVAL_MS ?? 10_000
);
const DEFAULT_BACKOFF_MS = Number(
  process.env.LISTFLOW_EBAY_RATE_LIMIT_BACKOFF_MS ?? 5 * 60_000
);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function intervalFor(kind: EbayRateLimitKind) {
  return kind === "BROWSE" ? DEFAULT_BROWSE_INTERVAL_MS : DEFAULT_TRADING_INTERVAL_MS;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "Unknown eBay error");
}

export function isEbayRateLimitError(error: unknown) {
  const message = getErrorMessage(error);
  return /429|rate|limit|quota|throttl|too many/i.test(message);
}

export async function waitForEbayRateLimit(
  storeId: string,
  kind: EbayRateLimitKind
) {
  const intervalMs = intervalFor(kind);

  while (true) {
    const now = new Date();
    const bucket = await prisma.ebayRateLimitBucket.upsert({
      where: {
        storeId_apiKind: {
          storeId,
          apiKind: kind,
        },
      },
      create: {
        storeId,
        apiKind: kind,
        nextAllowedAt: now,
      },
      update: {
        apiKind: kind,
      },
    });

    const blockedUntil = bucket.blockedUntil;
    const mustWaitUntil =
      blockedUntil && blockedUntil.getTime() > now.getTime()
        ? blockedUntil
        : bucket.nextAllowedAt;

    if (mustWaitUntil.getTime() > now.getTime()) {
      await sleep(mustWaitUntil.getTime() - now.getTime());
      continue;
    }

    const reserved = await prisma.ebayRateLimitBucket.updateMany({
      where: {
        id: bucket.id,
        nextAllowedAt: { lte: now },
        OR: [{ blockedUntil: null }, { blockedUntil: { lte: now } }],
      },
      data: {
        nextAllowedAt: new Date(now.getTime() + intervalMs),
        blockedUntil: null,
        lastError: null,
      },
    });

    if (reserved.count > 0) {
      return;
    }

    await sleep(500);
  }
}

export async function recordEbayRateLimitBackoff(
  storeId: string,
  kind: EbayRateLimitKind,
  error: unknown,
  backoffMs = DEFAULT_BACKOFF_MS
) {
  const now = new Date();
  const blockedUntil = new Date(now.getTime() + backoffMs);

  await prisma.ebayRateLimitBucket.upsert({
    where: {
      storeId_apiKind: {
        storeId,
        apiKind: kind,
      },
    },
    create: {
      storeId,
      apiKind: kind,
      nextAllowedAt: blockedUntil,
      blockedUntil,
      lastError: getErrorMessage(error),
    },
    update: {
      nextAllowedAt: blockedUntil,
      blockedUntil,
      lastError: getErrorMessage(error),
    },
  });

  return blockedUntil;
}
