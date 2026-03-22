import fs from "fs";
import path from "path";

// ---------- Types ----------

export type LogLevel = "INFO" | "ERROR" | "EBAY_RESPONSE";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  data?: unknown;
}

// ---------- Setup ----------

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "listflow.log");

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

// ---------- Core write ----------

function writeEntry(entry: LogEntry): void {
  try {
    ensureLogDir();
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch {
    // Never throw from logger — log to stderr as fallback
    process.stderr.write(`[LOGGER ERROR] ${JSON.stringify(entry)}\n`);
  }
}

// ---------- Public API ----------

export const logger = {
  info(context: string, message: string, data?: unknown): void {
    writeEntry({
      timestamp: new Date().toISOString(),
      level: "INFO",
      context,
      message,
      data,
    });
  },

  error(context: string, message: string, error?: unknown, data?: unknown): void {
    let errorData: unknown = data;

    if (error instanceof Error) {
      errorData = {
        ...((data && typeof data === "object") ? data : {}),
        errorName: error.name,
        errorMessage: error.message,
        stack: error.stack,
      };
    } else if (error !== undefined) {
      errorData = {
        ...((data && typeof data === "object") ? data : {}),
        errorRaw: error,
      };
    }

    writeEntry({
      timestamp: new Date().toISOString(),
      level: "ERROR",
      context,
      message,
      data: errorData,
    });
  },

  ebayResponse(context: string, message: string, rawXml: string, data?: unknown): void {
    writeEntry({
      timestamp: new Date().toISOString(),
      level: "EBAY_RESPONSE",
      context,
      message,
      data: {
        ...((data && typeof data === "object") ? data : {}),
        rawXml,
      },
    });
  },
};

// ---------- Admin utilities ----------

export const LOG_FILE_PATH = LOG_FILE;
