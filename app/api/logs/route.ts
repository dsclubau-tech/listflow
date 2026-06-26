import { NextResponse } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  createRequestLogger,
  readLogEntries,
  type LogEntry,
  type LogLevel,
  type LogRuntime,
  type LogSource,
} from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession } from "@/lib/store-session";

type StoreLogSession = {
  storeId: string;
  userId: string;
};

function serializeDbLog(entry: Awaited<ReturnType<typeof prisma.appLog.findMany>>[number]): LogEntry {
  return {
    id: entry.id,
    timestamp: entry.createdAt.toISOString(),
    level: entry.level as LogLevel,
    source: entry.source as LogSource,
    runtime: entry.runtime as LogRuntime,
    environment: entry.environment ?? undefined,
    context: entry.context,
    message: entry.message,
    fingerprint: entry.fingerprint,
    requestId: entry.requestId ?? undefined,
    traceId: entry.traceId ?? undefined,
    pathname: entry.pathname ?? undefined,
    route: entry.route ?? undefined,
    method: entry.method ?? undefined,
    statusCode: entry.statusCode ?? undefined,
    durationMs: entry.durationMs ?? undefined,
    userId: entry.userId ?? undefined,
    storeId: entry.storeId ?? undefined,
    workerId: entry.workerId ?? undefined,
    workerName: entry.workerName ?? undefined,
    jobType: entry.jobType ?? undefined,
    jobId: entry.jobId ?? undefined,
    productId: entry.productId ?? undefined,
    variantId: entry.variantId ?? undefined,
    ebayItemId: entry.ebayItemId ?? undefined,
    asin: entry.asin ?? undefined,
    tags: entry.tags.length > 0 ? entry.tags : undefined,
    data: entry.metadata,
    error: entry.errorMessage
      ? {
          name: entry.errorName ?? undefined,
          message: entry.errorMessage,
          stack: entry.stack ?? undefined,
        }
      : undefined,
  };
}

async function requireStoreSession(): Promise<
  | { ok: true; session: StoreLogSession }
  | { ok: false; response: Response }
> {
  const storeSession = await getCurrentStoreSession();

  if (!storeSession) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return {
    ok: true,
    session: {
      storeId: storeSession.storeId,
      userId: storeSession.storeId,
    },
  };
}

function splitFilter(value: string | null) {
  return value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function matchesSearch(entry: LogEntry, search: string): boolean {
  const haystack = [
    entry.context,
    entry.message,
    entry.fingerprint,
    entry.requestId,
    entry.traceId,
    entry.userId,
    entry.storeId,
    entry.workerId,
    entry.workerName,
    entry.jobType,
    entry.jobId,
    entry.productId,
    entry.variantId,
    entry.ebayItemId,
    entry.asin,
    entry.pathname,
    entry.route,
    entry.method,
    entry.error?.name,
    entry.error?.message,
    entry.tags?.join(" "),
    entry.data ? JSON.stringify(entry.data) : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(search.toLowerCase());
}

function applyFileFallbackFilters(entries: LogEntry[], request: Request, storeId: string) {
  const url = new URL(request.url);
  const levelFilter = splitFilter(url.searchParams.get("level"));
  const sourceFilter = splitFilter(url.searchParams.get("source"));
  const contextFilter = url.searchParams.get("context")?.trim().toLowerCase();
  const requestIdFilter = url.searchParams.get("requestId")?.trim();
  const jobIdFilter = url.searchParams.get("jobId")?.trim();
  const productIdFilter = url.searchParams.get("productId")?.trim();
  const ebayItemIdFilter = url.searchParams.get("ebayItemId")?.trim();
  const fingerprintFilter = url.searchParams.get("fingerprint")?.trim();
  const searchFilter = url.searchParams.get("search")?.trim();
  const since = parseDate(url.searchParams.get("since"));

  return entries
    .filter((entry) => entry.storeId === storeId)
    .filter((entry) => !since || new Date(entry.timestamp) >= since)
    .filter((entry) => !levelFilter?.length || levelFilter.includes(entry.level))
    .filter((entry) => !sourceFilter?.length || sourceFilter.includes(entry.source))
    .filter(
      (entry) =>
        !contextFilter || entry.context.toLowerCase().includes(contextFilter),
    )
    .filter((entry) => !requestIdFilter || entry.requestId === requestIdFilter)
    .filter((entry) => !jobIdFilter || entry.jobId === jobIdFilter)
    .filter((entry) => !productIdFilter || entry.productId === productIdFilter)
    .filter((entry) => !ebayItemIdFilter || entry.ebayItemId === ebayItemIdFilter)
    .filter((entry) => !fingerprintFilter || entry.fingerprint === fingerprintFilter)
    .filter((entry) => !searchFilter || matchesSearch(entry, searchFilter));
}

export async function GET(request: Request) {
  const check = await requireStoreSession();
  if (!check.ok) return check.response;

  const log = createRequestLogger(request, {
    userId: check.session.userId,
    storeId: check.session.storeId,
    tags: ["diagnostics"],
  });

  try {
    const url = new URL(request.url);
    const levelFilter = splitFilter(url.searchParams.get("level"));
    const sourceFilter = splitFilter(url.searchParams.get("source"));
    const contextFilter = url.searchParams.get("context")?.trim();
    const requestIdFilter = url.searchParams.get("requestId")?.trim();
    const jobIdFilter = url.searchParams.get("jobId")?.trim();
    const productIdFilter = url.searchParams.get("productId")?.trim();
    const ebayItemIdFilter = url.searchParams.get("ebayItemId")?.trim();
    const asinFilter = url.searchParams.get("asin")?.trim();
    const fingerprintFilter = url.searchParams.get("fingerprint")?.trim();
    const searchFilter = url.searchParams.get("search")?.trim();
    const since = parseDate(url.searchParams.get("since"));
    const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "200", 10);
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), 1000)
      : 200;

    const where: Prisma.AppLogWhereInput = {
      storeId: check.session.storeId,
    };

    if (since) where.createdAt = { gte: since };
    if (levelFilter?.length) where.level = { in: levelFilter };
    if (sourceFilter?.length) where.source = { in: sourceFilter };
    if (contextFilter) {
      where.context = { contains: contextFilter, mode: "insensitive" };
    }
    if (requestIdFilter) where.requestId = requestIdFilter;
    if (jobIdFilter) where.jobId = jobIdFilter;
    if (productIdFilter) where.productId = productIdFilter;
    if (ebayItemIdFilter) where.ebayItemId = ebayItemIdFilter;
    if (asinFilter) where.asin = asinFilter;
    if (fingerprintFilter) where.fingerprint = fingerprintFilter;

    const fetchLimit = searchFilter ? Math.min(Math.max(limit * 5, 500), 5000) : limit;
    let entries = (
      await prisma.appLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: fetchLimit,
      })
    ).map(serializeDbLog);

    if (searchFilter) {
      entries = entries.filter((entry) => matchesSearch(entry, searchFilter));
    }

    return NextResponse.json({
      storage: "database",
      entries: entries.slice(0, limit),
    });
  } catch (error) {
    log.error("logs/GET", "Failed to read database logs; using file fallback", error);

    const url = new URL(request.url);
    const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "200", 10);
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), 1000)
      : 200;
    const entries = applyFileFallbackFilters(
      readLogEntries().reverse(),
      request,
      check.session.storeId,
    ).slice(0, limit);

    return NextResponse.json({
      storage: "file-fallback",
      entries,
      warning: "Database logs were unavailable; showing local file logs.",
    });
  }
}

export async function DELETE(request: Request) {
  const check = await requireStoreSession();
  if (!check.ok) return check.response;

  const log = createRequestLogger(request, {
    userId: check.session.userId,
    storeId: check.session.storeId,
    tags: ["diagnostics"],
  });

  try {
    const result = await prisma.appLog.deleteMany({
      where: { storeId: check.session.storeId },
    });
    log.warn("logs/DELETE", "Store diagnostics logs cleared", {
      deleted: result.count,
    });
    return NextResponse.json({ success: true, deleted: result.count });
  } catch (error) {
    log.error("logs/DELETE", "Failed to clear store diagnostics logs", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to clear logs" },
      { status: 500 },
    );
  }
}
