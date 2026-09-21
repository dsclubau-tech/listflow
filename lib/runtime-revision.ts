import { execFileSync } from "node:child_process";

let cachedRevision: string | null = null;

export function getRuntimeRevision() {
  if (cachedRevision) return cachedRevision;

  const environmentRevision =
    process.env.LISTFLOW_REVISION?.trim() ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.RAILWAY_GIT_COMMIT_SHA?.trim();
  if (environmentRevision) {
    cachedRevision = environmentRevision;
    return cachedRevision;
  }

  try {
    cachedRevision = execFileSync(
      process.platform === "win32" ? "git.exe" : "git",
      ["rev-parse", "HEAD"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    cachedRevision = "unknown";
  }

  return cachedRevision;
}
