import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

export const WORKER_LOG_MAX_BYTES = 5 * 1024 * 1024;
export const WORKER_LOG_BACKUPS = 3;

// One writer per file: the controller owns console logs; each worker owns its
// structured event log. Do not use this for files shared by multiple processes.
export function createRotatingWorkerLog(filePath: string, options: {
  maxBytes?: number;
  backups?: number;
  onError?: (error: unknown) => void;
} = {}) {
  const maxBytes = Math.max(256, options.maxBytes ?? WORKER_LOG_MAX_BYTES);
  const backups = Math.max(1, Math.min(10, options.backups ?? WORKER_LOG_BACKUPS));
  let retryAt = 0;
  return {
    write(text: string) {
      if (Date.now() < retryAt) return false;
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        let data = Buffer.from(text, "utf8");
        if (data.length > maxBytes) {
          const marker = Buffer.from("\n[LOG RECORD TRUNCATED]\n");
          data = Buffer.concat([data.subarray(0, maxBytes - marker.length), marker]);
        }
        let size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
        if (size > maxBytes) {
          // Migrate an old unbounded log without reading it all into memory.
          const fd = fs.openSync(filePath, "r");
          const tail = Buffer.alloc(maxBytes);
          let bytes: number;
          try { bytes = fs.readSync(fd, tail, 0, maxBytes, size - maxBytes); }
          finally { fs.closeSync(fd); }
          const boundary = tail.indexOf(10);
          const retained = boundary < 0 ? Buffer.from("[Previous oversized log omitted]\n") : tail.subarray(boundary + 1, bytes);
          fs.writeFileSync(filePath, retained);
          size = retained.length;
        }
        if (size > 0 && size + data.length > maxBytes) {
          fs.rmSync(`${filePath}.${backups}`, { force: true });
          for (let index = backups - 1; index >= 1; index--) {
            if (fs.existsSync(`${filePath}.${index}`)) fs.renameSync(`${filePath}.${index}`, `${filePath}.${index + 1}`);
          }
          fs.renameSync(filePath, `${filePath}.1`);
        }
        fs.appendFileSync(filePath, data);
        return true;
      } catch (error) {
        // Disk errors must not kill a worker or create an unbounded retry queue.
        retryAt = Date.now() + 30_000;
        try { options.onError?.(error); } catch { /* Logging cannot be fatal. */ }
        return false;
      }
    },
  };
}

// Buffer complete lines so credentials split across stdout chunks are redacted
// as one value. Discard oversized lines instead of emitting unsafe fragments.
export function createWorkerLineCapture(emit: (line: string) => void, maxCharacters = 128 * 1024) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let dropping = false;
  function consume(text: string) {
    for (const piece of text.split(/(?<=\n)/)) {
      const ended = piece.endsWith("\n");
      if (!dropping) {
        pending += piece;
        if (pending.length > maxCharacters) {
          pending = "";
          dropping = true;
          emit("[Oversized console line omitted]\n");
        } else if (ended) {
          emit(pending);
          pending = "";
        }
      }
      if (ended) dropping = false;
    }
  }
  return {
    write(chunk: Buffer) { consume(decoder.write(chunk)); },
    end() {
      consume(decoder.end());
      if (pending && !dropping) emit(`${pending}\n`);
      pending = "";
    },
  };
}
