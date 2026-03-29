import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { createRequestLogger, writeLog, type ClientLogPayload } from "@/lib/logger";

function isClientLogPayload(value: unknown): value is ClientLogPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<ClientLogPayload>;
  return (
    typeof payload.context === "string" &&
    typeof payload.message === "string"
  );
}

export async function POST(request: Request) {
  const session = await auth().catch(() => null);
  const log = createRequestLogger(request, {
    userId: session?.user?.id,
    tags: ["client-log-ingest"],
  });

  let body: unknown;

  try {
    body = await request.json();
  } catch (error) {
    log.error("client-logs/POST", "Invalid client log payload", error);
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!isClientLogPayload(body)) {
    log.warn("client-logs/POST", "Rejected malformed client log payload");
    return NextResponse.json({ error: "Invalid client log payload" }, { status: 400 });
  }

  const payload = body;
  const entry = writeLog({
    level: payload.level ?? "ERROR",
    source: "client",
    runtime: "browser",
    context: payload.context,
    message: payload.message,
    requestId: payload.requestId,
    pathname: payload.pathname,
    userId: session?.user?.id,
    tags: payload.tags,
    data: {
      ...(payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
        ? payload.data
        : payload.data === undefined
          ? {}
          : { payload: payload.data }),
      href: payload.href,
      userAgent: payload.userAgent,
    },
    error: payload.error,
  });

  return NextResponse.json({ success: true, id: entry.id });
}
