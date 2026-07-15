import "server-only";

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  buildFingerprint,
  mergeTags,
  normalizeError,
  sanitizeForLog,
  type LogEntry,
  type LogLevel,
  type LogRuntime,
  type LogScope,
  type LogSource,
} from "@/lib/logging";

export type {
  ClientLogPayload,
  LogEntry,
  LogLevel,
  LogRuntime,
  LogScope,
  LogSource,
  NormalizedError,
} from "@/lib/logging";

interface WriteLogOptions extends LogScope {
  level: LogLevel;
  context: string;
  message: string;
  data?: unknown;
  error?: unknown;
  timestamp?: string;
}

interface LoggerApi {
  child(scope: LogScope): LoggerApi;
  debug(context: string, message: string, data?: unknown, scope?: LogScope): LogEntry;
  info(context: string, message: string, data?: unknown, scope?: LogScope): LogEntry;
  warn(context: string, message: string, data?: unknown, scope?: LogScope): LogEntry;
  error(
    context: string,
    message: string,
    error?: unknown,
    data?: unknown,
    scope?: LogScope,
  ): LogEntry;
  captureException(
    context: string,
    error: unknown,
    message?: string,
    data?: unknown,
    scope?: LogScope,
  ): LogEntry;
  ebayResponse(
    context: string,
    message: string,
    rawXml: string,
    data?: unknown,
    scope?: LogScope,
  ): LogEntry;
}

const LOG_DIR = path.join(process.cwd(), "logs");
export const LOG_FILE_PATH = path.join(LOG_DIR, "listflow.log");

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function mergeScope(base: LogScope, next?: LogScope): LogScope {
  if (!next) {
    return base;
  }

  return {
    ...base,
    ...next,
    tags: mergeTags(base.tags, next.tags),
  };
}

function buildLogEntry(options: WriteLogOptions): LogEntry {
  const source = options.source ?? "server";
  const runtime = options.runtime ?? "node";
  const normalizedError = normalizeError(options.error);
  const environment =
    options.environment ??
    (process.env.VERCEL
      ? "vercel"
      : process.env.LISTFLOW_WORKER_NAME
        ? "worker-pc"
        : process.env.NODE_ENV || "local");

  return {
    id: randomUUID(),
    timestamp: options.timestamp ?? new Date().toISOString(),
    level: options.level,
    source,
    runtime,
    environment,
    context: options.context,
    message: options.message,
    fingerprint: buildFingerprint({
      level: options.level,
      source,
      context: options.context,
      message: options.message,
      pathname: options.pathname,
      error: normalizedError,
    }),
    requestId: options.requestId,
    traceId: options.traceId,
    pathname: options.pathname,
    route: options.route,
    method: options.method,
    statusCode: options.statusCode,
    durationMs: options.durationMs,
    userId: options.userId,
    storeId: options.storeId,
    workerId: options.workerId,
    workerName: options.workerName,
    jobType: options.jobType,
    jobId: options.jobId,
    productId: options.productId,
    variantId: options.variantId,
    ebayItemId: options.ebayItemId,
    asin: options.asin,
    tags: mergeTags(options.tags),
    data: options.data === undefined ? undefined : sanitizeForLog(options.data),
    error: normalizedError,
  };
}

async function persistEntryToDatabase(entry: LogEntry): Promise<void> {
  if (process.env.LISTFLOW_DISABLE_DB_LOGS === "true") {
    return;
  }

  if (
    entry.level === "EBAY_RESPONSE" &&
    process.env.LISTFLOW_PERSIST_EBAY_RESPONSE_DB_LOGS !== "true"
  ) {
    return;
  }

  try {
    const { prisma } = await import("@/lib/prisma");
    const metadata = sanitizeForLog({
      data: entry.data,
      errorCause: entry.error?.cause,
      errorRaw: entry.error?.raw,
    }) as Prisma.InputJsonValue;

    await prisma.appLog.create({
      data: {
        id: entry.id,
        createdAt: new Date(entry.timestamp),
        level: entry.level,
        source: entry.source,
        runtime: entry.runtime,
        environment: entry.environment,
        context: entry.context,
        message: entry.message,
        fingerprint: entry.fingerprint,
        requestId: entry.requestId,
        traceId: entry.traceId,
        pathname: entry.pathname,
        route: entry.route ?? entry.pathname,
        method: entry.method,
        statusCode: entry.statusCode,
        durationMs: entry.durationMs,
        userId: entry.userId,
        storeId: entry.storeId,
        workerId: entry.workerId,
        workerName: entry.workerName,
        jobType: entry.jobType,
        jobId: entry.jobId,
        productId: entry.productId,
        variantId: entry.variantId,
        ebayItemId: entry.ebayItemId,
        asin: entry.asin,
        errorName: entry.error?.name,
        errorMessage: entry.error?.message,
        stack: entry.error?.stack,
        tags: entry.tags ?? [],
        metadata,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[LOGGER DB ERROR] ${message}\n`);
  }
}

function persistEntry(entry: LogEntry): void {
  try {
    ensureLogDir();
    void fs.promises
      .appendFile(LOG_FILE_PATH, `${JSON.stringify(entry)}\n`, "utf8")
      .catch(() => {
        process.stderr.write(`[LOGGER ERROR] ${JSON.stringify(entry)}\n`);
      });
  } catch {
    process.stderr.write(`[LOGGER ERROR] ${JSON.stringify(entry)}\n`);
  }

  void persistEntryToDatabase(entry);
}

function isLogLevel(value: unknown): value is LogLevel {
  return (
    value === "DEBUG" ||
    value === "INFO" ||
    value === "WARN" ||
    value === "ERROR" ||
    value === "CRITICAL" ||
    value === "EBAY_RESPONSE"
  );
}

function isLogSource(value: unknown): value is LogSource {
  return (
    value === "server" ||
    value === "client" ||
    value === "proxy" ||
    value === "worker"
  );
}

function isLogRuntime(value: unknown): value is LogRuntime {
  return (
    value === "node" ||
    value === "browser" ||
    value === "edge" ||
    value === "worker"
  );
}

function coerceLogEntry(value: unknown): LogEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<LogEntry>;
  const level = isLogLevel(raw.level) ? raw.level : "INFO";
  const source = isLogSource(raw.source) ? raw.source : "server";
  const runtime = isLogRuntime(raw.runtime) ? raw.runtime : "node";
  const context = typeof raw.context === "string" ? raw.context : "unknown";
  const message = typeof raw.message === "string" ? raw.message : "Unknown log entry";
  const error = normalizeError(raw.error);

  return {
    id: typeof raw.id === "string" ? raw.id : randomUUID(),
    timestamp:
      typeof raw.timestamp === "string" ? raw.timestamp : new Date().toISOString(),
    level,
    source,
    runtime,
    environment: typeof raw.environment === "string" ? raw.environment : undefined,
    context,
    message,
    fingerprint:
      typeof raw.fingerprint === "string"
        ? raw.fingerprint
        : buildFingerprint({
            level,
            source,
            context,
            message,
            pathname: typeof raw.pathname === "string" ? raw.pathname : undefined,
            error,
        }),
    requestId: typeof raw.requestId === "string" ? raw.requestId : undefined,
    traceId: typeof raw.traceId === "string" ? raw.traceId : undefined,
    pathname: typeof raw.pathname === "string" ? raw.pathname : undefined,
    route: typeof raw.route === "string" ? raw.route : undefined,
    method: typeof raw.method === "string" ? raw.method : undefined,
    statusCode: typeof raw.statusCode === "number" ? raw.statusCode : undefined,
    durationMs: typeof raw.durationMs === "number" ? raw.durationMs : undefined,
    userId: typeof raw.userId === "string" ? raw.userId : undefined,
    storeId: typeof raw.storeId === "string" ? raw.storeId : undefined,
    workerId: typeof raw.workerId === "string" ? raw.workerId : undefined,
    workerName: typeof raw.workerName === "string" ? raw.workerName : undefined,
    jobType: typeof raw.jobType === "string" ? raw.jobType : undefined,
    jobId: typeof raw.jobId === "string" ? raw.jobId : undefined,
    productId: typeof raw.productId === "string" ? raw.productId : undefined,
    variantId: typeof raw.variantId === "string" ? raw.variantId : undefined,
    ebayItemId: typeof raw.ebayItemId === "string" ? raw.ebayItemId : undefined,
    asin: typeof raw.asin === "string" ? raw.asin : undefined,
    tags:
      Array.isArray(raw.tags) && raw.tags.every((tag) => typeof tag === "string")
        ? raw.tags
        : undefined,
    data: raw.data,
    error,
  };
}

export function writeLog(options: WriteLogOptions): LogEntry {
  const entry = buildLogEntry(options);
  persistEntry(entry);
  return entry;
}

function createLogger(scope: LogScope = {}): LoggerApi {
  const log = (
    level: LogLevel,
    context: string,
    message: string,
    data?: unknown,
    nextScope?: LogScope,
    error?: unknown,
  ): LogEntry => {
    const mergedScope = mergeScope(scope, nextScope);

    return writeLog({
      ...mergedScope,
      level,
      context,
      message,
      data,
      error,
    });
  };

  return {
    child(nextScope) {
      return createLogger(mergeScope(scope, nextScope));
    },
    debug(context, message, data, nextScope) {
      return log("DEBUG", context, message, data, nextScope);
    },
    info(context, message, data, nextScope) {
      return log("INFO", context, message, data, nextScope);
    },
    warn(context, message, data, nextScope) {
      return log("WARN", context, message, data, nextScope);
    },
    error(context, message, error, data, nextScope) {
      return log("ERROR", context, message, data, nextScope, error);
    },
    captureException(context, error, message = "Unhandled exception", data, nextScope) {
      return log("ERROR", context, message, data, nextScope, error);
    },
    ebayResponse(context, message, rawXml, data, nextScope) {
      const includeRawXml = process.env.LISTFLOW_LOG_EBAY_XML === "true";
      const xmlMetadata = {
        rawXmlLength: rawXml.length,
        rawXmlLogged: includeRawXml,
        ...(includeRawXml ? { rawXml } : {}),
      };
      const payload =
        data && typeof data === "object" && !Array.isArray(data)
          ? { ...data, ...xmlMetadata }
          : { ...xmlMetadata, data };

      return log("EBAY_RESPONSE", context, message, payload, nextScope);
    },
  };
}

export function createRequestLogger(request: Request, scope: LogScope = {}): LoggerApi {
  const url = new URL(request.url);

  return createLogger({
    source: scope.source ?? "server",
    runtime: scope.runtime ?? "node",
    environment: scope.environment,
    requestId: scope.requestId ?? request.headers.get("x-request-id") ?? undefined,
    traceId: scope.traceId,
    pathname: scope.pathname ?? url.pathname,
    route: scope.route ?? url.pathname,
    method: scope.method ?? request.method,
    statusCode: scope.statusCode,
    durationMs: scope.durationMs,
    userId: scope.userId,
    storeId: scope.storeId,
    workerId: scope.workerId,
    workerName: scope.workerName,
    jobType: scope.jobType,
    jobId: scope.jobId,
    productId: scope.productId,
    variantId: scope.variantId,
    ebayItemId: scope.ebayItemId,
    asin: scope.asin,
    tags: scope.tags,
  });
}

export function readLogEntries(): LogEntry[] {
  if (!fs.existsSync(LOG_FILE_PATH)) {
    return [];
  }

  const raw = fs.readFileSync(LOG_FILE_PATH, "utf8");

  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      try {
        return coerceLogEntry(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter((entry): entry is LogEntry => entry !== null);
}

export function clearLogEntries(): void {
  ensureLogDir();
  fs.writeFileSync(LOG_FILE_PATH, "", "utf8");
}

export const logger = createLogger();
