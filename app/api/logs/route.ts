import { auth } from "@/auth";
import { NextResponse } from "next/server";
import {
  clearLogEntries,
  createRequestLogger,
  readLogEntries,
  type LogEntry,
} from "@/lib/logger";

async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if ((session.user as { role?: string }).role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden - admin only" }, { status: 403 }),
    };
  }
  return { ok: true, userId: session.user.id };
}

function matchesSearch(entry: LogEntry, search: string): boolean {
  const haystack = [
    entry.context,
    entry.message,
    entry.fingerprint,
    entry.requestId,
    entry.userId,
    entry.pathname,
    entry.method,
    entry.error?.name,
    entry.error?.message,
    entry.data ? JSON.stringify(entry.data) : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(search.toLowerCase());
}

export async function GET(request: Request) {
  const check = await requireAdmin();
  if (!check.ok) return check.response;

  const log = createRequestLogger(request, {
    userId: check.userId,
    tags: ["admin-logs"],
  });

  try {
    const url = new URL(request.url);
    const levelFilter = url.searchParams
      .get("level")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const sourceFilter = url.searchParams.get("source")?.trim();
    const contextFilter = url.searchParams.get("context")?.trim().toLowerCase();
    const requestIdFilter = url.searchParams.get("requestId")?.trim();
    const searchFilter = url.searchParams.get("search")?.trim();
    const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "200", 10);
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), 1000)
      : 200;

    let entries = readLogEntries().reverse();

    if (levelFilter && levelFilter.length > 0) {
      entries = entries.filter((entry) => levelFilter.includes(entry.level));
    }

    if (sourceFilter) {
      entries = entries.filter((entry) => entry.source === sourceFilter);
    }

    if (contextFilter) {
      entries = entries.filter((entry) =>
        entry.context.toLowerCase().includes(contextFilter),
      );
    }

    if (requestIdFilter) {
      entries = entries.filter((entry) => entry.requestId === requestIdFilter);
    }

    if (searchFilter) {
      entries = entries.filter((entry) => matchesSearch(entry, searchFilter));
    }

    return NextResponse.json(entries.slice(0, limit));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read logs";
    log.error("logs/GET", "Failed to read logs", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const check = await requireAdmin();
  if (!check.ok) return check.response;

  const log = createRequestLogger(request, {
    userId: check.userId,
    tags: ["admin-logs"],
  });

  try {
    clearLogEntries();
    log.warn("logs/DELETE", "Log file cleared");
    return NextResponse.json({ success: true, message: "Log file cleared" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to clear logs";
    log.error("logs/DELETE", "Failed to clear logs", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
