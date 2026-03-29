"use client";

import {
  buildFingerprint,
  normalizeError,
  sanitizeForLog,
  type ClientLogPayload,
  type LogLevel,
} from "@/lib/logging";

interface ReportClientEventOptions {
  level?: Exclude<LogLevel, "EBAY_RESPONSE">;
  error?: unknown;
  data?: unknown;
  requestId?: string;
  tags?: string[];
}

const LOG_ENDPOINT = "/api/client-logs";
const DEDUPE_WINDOW_MS = 5000;
const recentEvents = new Map<string, number>();

function shouldSkipDuplicate(fingerprint: string): boolean {
  const now = Date.now();

  for (const [key, timestamp] of recentEvents) {
    if (now - timestamp > DEDUPE_WINDOW_MS) {
      recentEvents.delete(key);
    }
  }

  const lastSeen = recentEvents.get(fingerprint);
  if (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS) {
    return true;
  }

  recentEvents.set(fingerprint, now);
  return false;
}

async function sendClientLog(payload: ClientLogPayload): Promise<void> {
  const body = JSON.stringify(payload);

  if (navigator.sendBeacon) {
    const sent = navigator.sendBeacon(
      LOG_ENDPOINT,
      new Blob([body], { type: "application/json" }),
    );

    if (sent) {
      return;
    }
  }

  await fetch(LOG_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
    credentials: "same-origin",
  });
}

export async function reportClientEvent(
  context: string,
  message: string,
  options: ReportClientEventOptions = {},
): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  const error = normalizeError(options.error);
  const payload: ClientLogPayload = {
    level: options.level ?? (error ? "ERROR" : "INFO"),
    context,
    message,
    requestId: options.requestId,
    pathname: window.location.pathname,
    href: window.location.href,
    userAgent: navigator.userAgent,
    tags: options.tags,
    data: options.data === undefined ? undefined : sanitizeForLog(options.data),
    error,
  };

  const fingerprint = buildFingerprint({
    level: payload.level ?? "INFO",
    source: "client",
    context: payload.context,
    message: payload.message,
    pathname: payload.pathname,
    error: payload.error,
  });

  if (shouldSkipDuplicate(fingerprint)) {
    return;
  }

  try {
    await sendClientLog(payload);
  } catch {
    // Never throw from client logging.
  }
}

export function reportClientError(
  context: string,
  message: string,
  error?: unknown,
  data?: unknown,
  options: Omit<ReportClientEventOptions, "level" | "error" | "data"> = {},
): Promise<void> {
  return reportClientEvent(context, message, {
    ...options,
    level: "ERROR",
    error,
    data,
  });
}

export function reportClientWarning(
  context: string,
  message: string,
  data?: unknown,
  options: Omit<ReportClientEventOptions, "level" | "data"> = {},
): Promise<void> {
  return reportClientEvent(context, message, {
    ...options,
    level: "WARN",
    data,
  });
}
