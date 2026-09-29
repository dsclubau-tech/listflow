import type { Browser } from "playwright-core";
import { createAmazonDeliveryStateSession, type AmazonDeliveryStateSession } from "@/lib/amazon-delivery-state";
import { launchScraperBrowser } from "@/lib/scraper-browser";

const MAX_STATES = 4;
const STATE_TTL_MS = 10 * 60_000;
const BROWSER_IDLE_MS = 2 * 60_000;
type StateEntry = { state: AmazonDeliveryStateSession; usedAt: number };
const states = new Map<string, StateEntry>();
let browser: Browser | null = null;
let launch: Promise<Browser> | null = null;
let leases = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

export async function closeImportBrowser() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  states.clear();
  const current = browser;
  browser = null;
  if (current) await current.close().catch(() => {});
}

export async function acquireImportBrowser(
  storeId: string,
  postcode: string,
  launchBrowser: () => Promise<Browser> = launchScraperBrowser,
) {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (browser && !browser.isConnected()) await closeImportBrowser();
  launch ??= browser ? Promise.resolve(browser) : launchBrowser();
  try {
    browser = await launch;
  } finally {
    launch = null;
  }
  const now = Date.now();
  for (const [key, value] of states) {
    if (now - value.usedAt >= STATE_TTL_MS || (value.state.browser && value.state.browser !== browser)) states.delete(key);
  }
  const key = `${storeId}:${postcode}`;
  for (const storedKey of states.keys()) {
    if (storedKey.startsWith(`${storeId}:`) && storedKey !== key) states.delete(storedKey);
  }
  const previous = states.get(key);
  states.delete(key);
  const state = previous?.state ?? createAmazonDeliveryStateSession(postcode);
  states.set(key, { state, usedAt: now });
  while (states.size > MAX_STATES) states.delete(states.keys().next().value!);
  leases += 1;
  let released = false;
  return {
    browser,
    deliveryState: state,
    async release(discard = false) {
      if (released) return;
      released = true;
      leases = Math.max(0, leases - 1);
      if (discard) {
        await closeImportBrowser();
      } else if (leases === 0) {
        idleTimer = setTimeout(() => { void closeImportBrowser(); }, BROWSER_IDLE_MS);
        idleTimer.unref?.();
      }
    },
  };
}
