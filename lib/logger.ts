import "server-only";

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
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

  return {
    id: randomUUID(),
    timestamp: options.timestamp ?? new Date().toISOString(),
    level: options.level,
    source,
    runtime,
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
    pathname: options.pathname,
    method: options.method,
    userId: options.userId,
    tags: mergeTags(options.tags),
    data: options.data === undefined ? undefined : sanitizeForLog(options.data),
    error: normalizedError,
  };
}

function persistEntry(entry: LogEntry): void {
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE_PATH, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    process.stderr.write(`[LOGGER ERROR] ${JSON.stringify(entry)}\n`);
  }
}

function isLogLevel(value: unknown): value is LogLevel {
  return (
    value === "DEBUG" ||
    value === "INFO" ||
    value === "WARN" ||
    value === "ERROR" ||
    value === "EBAY_RESPONSE"
  );
}

function isLogSource(value: unknown): value is LogSource {
  return value === "server" || value === "client" || value === "proxy";
}

function isLogRuntime(value: unknown): value is LogRuntime {
  return value === "node" || value === "browser" || value === "edge";
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
    pathname: typeof raw.pathname === "string" ? raw.pathname : undefined,
    method: typeof raw.method === "string" ? raw.method : undefined,
    userId: typeof raw.userId === "string" ? raw.userId : undefined,
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
      const payload =
        data && typeof data === "object" && !Array.isArray(data)
          ? { ...data, rawXml }
          : { rawXml, data };

      return log("EBAY_RESPONSE", context, message, payload, nextScope);
    },
  };
}

export function createRequestLogger(request: Request, scope: LogScope = {}): LoggerApi {
  const url = new URL(request.url);

  return createLogger({
    source: scope.source ?? "server",
    runtime: scope.runtime ?? "node",
    requestId: scope.requestId ?? request.headers.get("x-request-id") ?? undefined,
    pathname: scope.pathname ?? url.pathname,
    method: scope.method ?? request.method,
    userId: scope.userId,
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
