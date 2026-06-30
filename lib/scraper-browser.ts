import type { Browser } from "playwright-core";

type BrowserLaunchOptions = {
  headless?: boolean;
};

function isEnabled(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}

function shouldUseServerlessChromium() {
  if (isEnabled(process.env.LISTFLOW_USE_LOCAL_PLAYWRIGHT)) {
    return false;
  }

  if (isEnabled(process.env.LISTFLOW_USE_SERVERLESS_CHROMIUM)) {
    return true;
  }

  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.NETLIFY
  );
}

export async function launchScraperBrowser(
  options: BrowserLaunchOptions = {}
): Promise<Browser> {
  const headless = options.headless ?? true;

  if (shouldUseServerlessChromium()) {
    const [{ chromium }, chromiumPackage] = await Promise.all([
      import("playwright-core"),
      import("@sparticuz/chromium"),
    ]);
    const serverlessChromium = chromiumPackage.default;
    serverlessChromium.setGraphicsMode = false;
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      (await serverlessChromium.executablePath());
    const args = Array.from(
      new Set([...serverlessChromium.args, "--disable-dev-shm-usage"])
    );

    return chromium.launch({
      args,
      executablePath,
      headless,
    });
  }

  const { chromium } = await import("playwright");
  return chromium.launch({ headless });
}

export function getBrowserLaunchUserMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();

  if (
    lower.includes("executable doesn't exist") ||
    lower.includes("playwright install") ||
    lower.includes("chromium_headless_shell") ||
    (lower.includes("@sparticuz/chromium") &&
      lower.includes("bin") &&
      lower.includes("does not exist")) ||
    lower.includes("browserType.launch".toLowerCase())
  ) {
    return "Could not start the browser needed to import this Amazon product. Redeploy ListFlow with the browser runtime fix, then try again.";
  }

  return null;
}
