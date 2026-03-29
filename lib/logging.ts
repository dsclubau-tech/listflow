export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "EBAY_RESPONSE";
export type LogSource = "server" | "client" | "proxy";
export type LogRuntime = "node" | "browser" | "edge";

export interface NormalizedError {
  name?: string;
  message: string;
  stack?: string;
  digest?: string;
  cause?: unknown;
  raw?: unknown;
}

export interface LogScope {
  source?: LogSource;
  runtime?: LogRuntime;
  requestId?: string;
  pathname?: string;
  method?: string;
  userId?: string;
  tags?: string[];
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: LogSource;
  runtime: LogRuntime;
  context: string;
  message: string;
  fingerprint: string;
  requestId?: string;
  pathname?: string;
  method?: string;
  userId?: string;
  tags?: string[];
  data?: unknown;
  error?: NormalizedError;
}

export interface ClientLogPayload {
  level?: Exclude<LogLevel, "EBAY_RESPONSE">;
  context: string;
  message: string;
  requestId?: string;
  pathname?: string;
  href?: string;
  userAgent?: string;
  tags?: string[];
  data?: unknown;
  error?: NormalizedError;
}

const MAX_DEPTH = 5;
const MAX_ARRAY_LENGTH = 25;
const MAX_OBJECT_KEYS = 40;
const MAX_STRING_LENGTH = 4000;

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_STRING_LENGTH)}...<truncated>`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function serializeForFingerprint(value: unknown): string {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hashString(input: string): string {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function mergeTags(...collections: Array<string[] | undefined>): string[] | undefined {
  const merged = collections
    .flatMap((collection) => collection ?? [])
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (merged.length === 0) {
    return undefined;
  }

  return [...new Set(merged)];
}

export function sanitizeForLog(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (value == null) {
    return value;
  }

  if (typeof value === "string") {
    return truncateString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "symbol") {
    return value.toString();
  }

  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof URL) {
    return value.toString();
  }

  if (value instanceof Error) {
    return normalizeError(value);
  }

  if (depth >= MAX_DEPTH) {
    return "[MaxDepthExceeded]";
  }

  if (Array.isArray(value)) {
    const sanitized = value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => sanitizeForLog(item, depth + 1, seen));

    if (value.length > MAX_ARRAY_LENGTH) {
      sanitized.push(`[+${value.length - MAX_ARRAY_LENGTH} more items]`);
    }

    return sanitized;
  }

  if (!isPlainObject(value)) {
    return String(value);
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  seen.add(value);

  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
  const sanitizedObject: Record<string, unknown> = {};

  for (const [key, entryValue] of entries) {
    sanitizedObject[key] = sanitizeForLog(entryValue, depth + 1, seen);
  }

  if (Object.keys(value).length > MAX_OBJECT_KEYS) {
    sanitizedObject.__truncatedKeys = Object.keys(value).length - MAX_OBJECT_KEYS;
  }

  return sanitizedObject;
}

export function normalizeError(error: unknown): NormalizedError | undefined {
  if (error == null) {
    return undefined;
  }

  if (
    isPlainObject(error) &&
    typeof error.message === "string" &&
    (error.name === undefined || typeof error.name === "string")
  ) {
    return {
      name: typeof error.name === "string" ? error.name : undefined,
      message: truncateString(error.message),
      stack: typeof error.stack === "string" ? truncateString(error.stack) : undefined,
      digest: typeof error.digest === "string" ? error.digest : undefined,
      cause: error.cause === undefined ? undefined : sanitizeForLog(error.cause),
      raw: error.raw === undefined ? undefined : sanitizeForLog(error.raw),
    };
  }

  if (error instanceof Error) {
    const digest = (error as { digest?: unknown }).digest;
    const cause = (error as Error & { cause?: unknown }).cause;

    return {
      name: error.name || "Error",
      message: truncateString(error.message || "Unknown error"),
      stack: typeof error.stack === "string" ? truncateString(error.stack) : undefined,
      digest: typeof digest === "string" ? digest : undefined,
      cause: cause === undefined ? undefined : sanitizeForLog(cause),
    };
  }

  if (typeof error === "string") {
    return {
      message: truncateString(error),
    };
  }

  return {
    message: "Non-Error throwable",
    raw: sanitizeForLog(error),
  };
}

export function buildFingerprint(input: {
  level: LogLevel;
  source: LogSource;
  context: string;
  message: string;
  pathname?: string;
  error?: NormalizedError;
}): string {
  const material = [
    input.level,
    input.source,
    input.context,
    input.message,
    input.pathname ?? "",
    input.error?.name ?? "",
    input.error?.message ?? "",
  ]
    .map((item) => serializeForFingerprint(item))
    .join("|");

  return `lf_${hashString(material)}`;
}
