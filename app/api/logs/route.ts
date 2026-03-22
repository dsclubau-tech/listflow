import { auth } from "@/auth";
import { NextResponse } from "next/server";
import fs from "fs";
import { LOG_FILE_PATH } from "@/lib/logger";
import type { LogEntry } from "@/lib/logger";

// Helper: check admin
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
      response: NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 }),
    };
  }
  return { ok: true, userId: session.user.id };
}

// GET /api/logs — return all log entries, newest first
export async function GET() {
  const check = await requireAdmin();
  if (!check.ok) return check.response;

  try {
    if (!fs.existsSync(LOG_FILE_PATH)) {
      return NextResponse.json([]);
    }

    const raw = fs.readFileSync(LOG_FILE_PATH, "utf8");
    const lines = raw
      .split("\n")
      .filter((l) => l.trim() !== "");

    const entries: LogEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as LogEntry);
      } catch {
        // Skip malformed lines
      }
    }

    // Newest first
    entries.reverse();

    return NextResponse.json(entries);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read logs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/logs — clear the log file
export async function DELETE() {
  const check = await requireAdmin();
  if (!check.ok) return check.response;

  try {
    if (fs.existsSync(LOG_FILE_PATH)) {
      fs.writeFileSync(LOG_FILE_PATH, "", "utf8");
    }
    return NextResponse.json({ success: true, message: "Log file cleared" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to clear logs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
