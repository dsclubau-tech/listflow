import { auth } from "@/auth";
import { AmazonImportJobKind } from "@/app/generated/prisma/enums";
import { NextResponse } from "next/server";
import { extractAmazonAsinFromValue } from "@/lib/amazon-direct-scraper";
import {
  createAmazonImportJob,
  getAmazonImportJobForUser,
  serializeAmazonImportJob,
} from "@/lib/amazon-import-jobs";
import { isAmazonPriceTrackingMode } from "@/lib/amazon-price-tracking";
import { createRequestLogger } from "@/lib/logger";
import {
  findExistingAmazonProduct,
  getDuplicateAmazonProductBody,
} from "@/lib/product-duplicate";
import { prisma } from "@/lib/prisma";
import {
  getCurrentStoreSession,
  getInternalUserId,
} from "@/lib/store-session";
import { assertWorkerOnlineForStore } from "@/lib/worker-heartbeat";

export const maxDuration = 15;

function resolveImportMode(value: unknown) {
  if (value === "advanced") return AmazonImportJobKind.ADVANCED;
  if (value === "regrab") return AmazonImportJobKind.REGRAB;
  return AmazonImportJobKind.NORMAL;
}

async function getAuthorizedContext(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {},
  );
  return { session, storeSession, log };
}

export async function POST(request: Request) {
  const { session, storeSession, log } = await getAuthorizedContext(request);

  if (!session?.user || !storeSession) {
    log.warn("scrape/route", "Unauthorized Amazon import attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch (error) {
    log.error("scrape/route", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json(
      { error: "Enter a valid Amazon Australia product URL." },
      { status: 400 },
    );
  }

  if (
    parsedUrl.protocol !== "https:" ||
    !["amazon.com.au", "www.amazon.com.au"].includes(
      parsedUrl.hostname.toLowerCase(),
    )
  ) {
    return NextResponse.json(
      { error: "Only Amazon AU URLs are supported" },
      { status: 400 },
    );
  }

  const requestedAsin = extractAmazonAsinFromValue(url);
  if (!requestedAsin) {
    return NextResponse.json(
      { error: "The Amazon URL does not contain a valid product ASIN." },
      { status: 400 },
    );
  }

  const mode = resolveImportMode(body.mode);
  const allowExistingProduct = mode === AmazonImportJobKind.REGRAB;
  const priceTrackingMode = isAmazonPriceTrackingMode(
    body.amazonPriceTrackingMode,
  )
    ? body.amazonPriceTrackingMode
    : undefined;

  if (!allowExistingProduct) {
    const existingProduct = await findExistingAmazonProduct(
      storeSession.storeId,
      requestedAsin,
      prisma,
    );
    if (existingProduct) {
      return NextResponse.json(getDuplicateAmazonProductBody(existingProduct), {
        status: 409,
      });
    }
  }

  try {
    await assertWorkerOnlineForStore(storeSession.storeId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "ListFlow Worker is offline.";
    log.error("scrape/route", "Amazon import worker unavailable", error, {
      requestedAsin,
    });
    return NextResponse.json(
      { error: message, code: "WORKER_OFFLINE" },
      { status: 503 },
    );
  }

  const userId = await getInternalUserId();
  const job = await createAmazonImportJob({
    userId,
    storeId: storeSession.storeId,
    url,
    asin: requestedAsin,
    kind: mode,
    priceTrackingMode,
  });

  log.info("scrape/route", "Amazon import queued for Railway worker", {
    jobId: job.id,
    requestedAsin,
    mode,
  });

  return NextResponse.json(
    { job: serializeAmazonImportJob(job) },
    { status: 202 },
  );
}

export async function GET(request: Request) {
  const { session, storeSession, log } = await getAuthorizedContext(request);

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobId = new URL(request.url).searchParams.get("jobId")?.trim();
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const userId = await getInternalUserId();
  const job = await getAmazonImportJobForUser(
    jobId,
    userId,
    storeSession.storeId,
  );
  if (!job) {
    log.warn("scrape/route", "Amazon import job not found", { jobId });
    return NextResponse.json({ error: "Import job not found" }, { status: 404 });
  }

  return NextResponse.json({ job: serializeAmazonImportJob(job) });
}
