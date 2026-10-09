import type { Browser, BrowserContext, Page, Route } from "playwright-core";
import { emptyDeliveryOffer } from "../fixtures/amazon-shipping-offers";

export function emptyDeliveryBrowser(browser: Browser, asin: string, change?: (html: string, navigation: number) => string, abortReload = false) {
  let context: BrowserContext;
  let navigations = 0;
  let resourceLoads = 0;
  const errors: string[] = [];
  const reloadTimeouts: number[] = [];
  const facade = { newContext: async (options: Parameters<Browser["newContext"]>[0]) => {
    context = await browser.newContext(options);
    context.on("page", page => {
      page.on("pageerror", error => errors.push(error.message));
      // Preserve the scraper filter while keeping every continued request offline.
      const route = page.route.bind(page), unroute = page.unroute.bind(page), reload = page.reload.bind(page);
      page.reload = options => { reloadTimeouts.push(options?.timeout ?? 0); return reload(options); };
      const handlers = new Map<unknown, (route: Route) => unknown>();
      page.route = (async (url: Parameters<Page["route"]>[0], handler: (route: Route) => unknown) => {
        const wrapped = (request: Route) => handler(new Proxy(request, { get(target, key) {
          if (key === "continue") return () => target.fallback();
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        }}));
        handlers.set(handler, wrapped);
        return route(url, wrapped);
      }) as Page["route"];
      page.unroute = (async (url: Parameters<Page["unroute"]>[0], handler?: unknown) =>
        unroute(url, handler ? handlers.get(handler) : undefined)) as Page["unroute"];
    });
    await context.route("**/*", async route => {
      const request = route.request();
      if (request.resourceType() === "document" && /^https:\/\/www.amazon.com.au\/dp\//.test(request.url())) {
        navigations++;
        if (abortReload && navigations > 1) { await route.abort(); return; }
        let html = emptyDeliveryOffer(asin, false);
        const loaded = emptyDeliveryOffer(asin, true).match(/<div id="deliveryBlockMessage">([\s\S]*?)<\/div>/)![1];
        const promise = JSON.stringify(loaded).replace(/"/g, '&quot;');
        html = html.replace("</body>", `<img src="https://fixture.test/delivery.png" onload="document.querySelector('#deliveryBlockMessage').textContent=${promise}"></body>`);
        if (change) html = change(html, navigations);
        await route.fulfill({ status: 200, contentType: "text/html", body: html });
      } else if (request.url() === "https://fixture.test/delivery.png") {
        resourceLoads++;
        await route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG1cAAAAASUVORK5CYII=", "base64") });
      } else {
        errors.push("Unexpected network request: " + request.url());
        await route.abort();
      }
    });
    return context;
  }} as unknown as Browser;
  return { browser: facade, state: () => ({ navigations, resourceLoads, errors, reloadTimeouts, pages: context.pages().length }) };
}
