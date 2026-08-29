import type { Browser } from "playwright-core";

type BrowserLaunchOptions = {
  headless?: boolean;
};

function isEnabled(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}

type BrowserRuntimeEnvironment = Record<string, string | undefined>;

export function getScraperBrowserRuntime(
  environment: BrowserRuntimeEnvironment = process.env as BrowserRuntimeEnvironment
) {
  if (isEnabled(environment.LISTFLOW_USE_LOCAL_PLAYWRIGHT)) {
    return "local" as const;
  }

  if (isEnabled(environment.LISTFLOW_USE_SERVERLESS_CHROMIUM)) {
    return "serverless" as const;
  }

  return environment.VERCEL ||
    environment.AWS_LAMBDA_FUNCTION_NAME ||
    environment.NETLIFY
    ? ("serverless" as const)
    : ("local" as const);
}

function shouldUseServerlessChromium() {
  return getScraperBrowserRuntime() === "serverless";
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
  return chromium.launch({
    headless,
    args: [
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-translate",
      "--metrics-recording-only",
      "--no-first-run",
      "--js-flags=--max-old-space-size=128",
    ],
  });
}

export function getBrowserLaunchUserMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();

  if (
    lower.includes("executable doesn't exist") ||
    lower.includes("playwright install") ||
    (lower.includes("@sparticuz/chromium") &&
      lower.includes("bin") &&
      lower.includes("does not exist"))
  ) {
    return "The browser executable was not found. Please run 'npx playwright install chromium' on the worker host or configure the browser runtime.";
  }

  if (
    lower.includes("browsertype.launch") ||
    lower.includes("target page, context or browser has been closed") ||
    lower.includes("browser has been closed") ||
    lower.includes("browser.newcontext") ||
    lower.includes("browser.newpage") ||
    lower.includes("target closed") ||
    lower.includes("protocol error")
  ) {
    return "The browser closed or crashed during the price check. The worker will retry automatically on the next run.";
  }

  return null;
}
