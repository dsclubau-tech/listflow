import type { Browser, BrowserContext, Page } from "playwright-core";

// Match one existing Chrome profile in both diagnostic browser modes.
// This affects read-only probes only; production profile selection is unchanged.
export const DELIVERY_DIAGNOSTIC_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
export function withDeliveryDiagnosticProfile(browser: Browser): Browser {
  return new Proxy(browser, {
    get(target, property) {
      if (property === "newContext") return (options: Parameters<Browser["newContext"]>[0] = {}) =>
        target.newContext({ ...options, userAgent: DELIVERY_DIAGNOSTIC_USER_AGENT });
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
/** A read-only control: leave installed Chrome's headers and page setup intact. */
export function withDeliveryNativeProfile(browser: Browser, onUserAgent?: (value: string) => void): Browser {
  const bind = (target: object, property: string | symbol) => {
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  };
  const nativePage = (page: Page): Page => new Proxy(page, {
    get(target, property) {
      // The scraper normally installs these customizations. Omit them only in this control.
      if (property === "route" || property === "addInitScript") return async () => {};
      return bind(target, property);
    },
  });
  const nativeContext = (context: BrowserContext): BrowserContext => new Proxy(context, {
    get(target, property) {
      if (property === "newPage") return async () => {
        const page = await target.newPage();
        if (onUserAgent) {
          const actualUserAgent = await page.evaluate(() => navigator.userAgent);
          try { onUserAgent(actualUserAgent); } catch { /* Diagnostics do not change the control. */ }
        }
        return nativePage(page);
      };
      return bind(target, property);
    },
  });
  return new Proxy(browser, {
    get(target, property) {
      if (property === "newContext") return async (options: Parameters<Browser["newContext"]>[0] = {}) => {
        const nativeOptions = { ...options };
        delete nativeOptions.userAgent;
        return nativeContext(await target.newContext(nativeOptions));
      };
      return bind(target, property);
    },
  });
}