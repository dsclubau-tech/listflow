import { expect, test as base } from "playwright/test";
import { build } from "esbuild";

const origin = "http://listflow.test";
const currentStoreId = "current-store";
const unlockedStoreId = "unlocked / &=";
const lockedStoreId = "locked-store";
const cookieName = "listflow_active_store_id";

const bundle = build({
  stdin: {
    resolveDir: process.cwd(), loader: "tsx",
    contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import StoreSwitcherModal from "./components/StoreSwitcherModal";
      const stores = [
        { id: ${JSON.stringify(currentStoreId)}, name: "Current Store", loginId: "current", rank: 1 },
        { id: ${JSON.stringify(unlockedStoreId)}, name: "Unlocked Store", loginId: "unlocked", rank: 2, hasPassword: false },
        { id: ${JSON.stringify(lockedStoreId)}, name: "Locked Store", loginId: "locked", rank: 3, hasPassword: true, profileLockEnabled: true },
        { id: "lock-disabled", name: "Lock Disabled Store", loginId: "disabled", rank: 4, hasPassword: true, profileLockEnabled: false },
      ];
      function Harness() {
        const [isOpen, setIsOpen] = useState(true);
        const [revision, setRevision] = useState(0);
        return <>
          <button onClick={() => setIsOpen(true)}>Open modal</button>
          <button onClick={() => setIsOpen(false)}>Close from parent</button>
          <button onClick={() => setRevision(value => value + 1)}>Rerender parent</button>
          <output data-testid="parent-revision">{revision}</output>
          <StoreSwitcherModal isOpen={isOpen} onClose={() => setIsOpen(false)}
            stores={stores.map(store => ({ ...store }))} currentStoreId=${JSON.stringify(currentStoreId)} />
        </>;
      }
      createRoot(document.getElementById("root")).render(<React.StrictMode><Harness /></React.StrictMode>);
    `,
  },
  bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic",
}).then(result => result.outputFiles[0].text);

type BrowserFixture = {
  navigationCookies: string[];
  unlockRequests: { method: string; body: unknown }[];
  unlockOutcome: "success" | "rejected" | "network-error";
  waitForUnlock: (() => Promise<void>) | null;
};

const test = base.extend<{ browserFixture: BrowserFixture }>({
  browserFixture: async ({ page, context }, provide) => {
    const state: BrowserFixture = {
      navigationCookies: [], unlockRequests: [], unlockOutcome: "success", waitForUnlock: null,
    };
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await context.addCookies([{ name: cookieName, value: currentStoreId, url: origin, sameSite: "Lax" }]);
    const html = `<html><body><div id="root"></div><script>${await bundle}</script></body></html>`;
    await page.route("**/*", async route => {
      const request = route.request();
      if (request.url() === `${origin}/store-switcher` && request.isNavigationRequest()) {
        state.navigationCookies.push(request.headers().cookie || "");
        await route.fulfill({ contentType: "text/html", body: html });
      } else if (request.url() === `${origin}/api/stores/profile-lock/unlock`) {
        state.unlockRequests.push({ method: request.method(), body: request.postDataJSON() });
        await state.waitForUnlock?.();
        if (state.unlockOutcome === "network-error") await route.abort("failed");
        else await route.fulfill({
          status: state.unlockOutcome === "success" ? 200 : 401,
          json: state.unlockOutcome === "success" ? { ok: true } : { error: "Incorrect password. Please try again." },
        });
      } else await route.abort("blockedbyclient");
    });
    await page.goto(`${origin}/store-switcher`);
    await expect(page.getByText("Store Profile Switcher", { exact: true })).toBeVisible();
    await provide(state);
    expect(pageErrors).toEqual([]);
  },
});

test("unlocked selection writes the encoded cookie before reloading", async ({ page, context, browserFixture }) => {
  const before = Date.now() / 1000;
  await page.getByRole("button", { name: /Unlocked Store/ }).click();
  await expect.poll(() => browserFixture.navigationCookies.length).toBe(2);
  expect(browserFixture.navigationCookies[1]).toContain(`${cookieName}=${encodeURIComponent(unlockedStoreId)}`);
  const cookie = (await context.cookies(origin)).find(item => item.name === cookieName);
  expect(cookie).toMatchObject({ value: encodeURIComponent(unlockedStoreId), path: "/", sameSite: "Lax", httpOnly: false, secure: false });
  expect(cookie!.expires).toBeGreaterThanOrEqual(before + 365 * 24 * 60 * 60 - 2);
  expect(cookie!.expires).toBeLessThanOrEqual(Date.now() / 1000 + 365 * 24 * 60 * 60 + 2);
  expect(browserFixture.unlockRequests).toEqual([]);
});

test("the current store closes the modal without switching", async ({ page, context, browserFixture }) => {
  await page.getByRole("button", { name: /Current Store/ }).click();
  await expect(page.getByText("Store Profile Switcher", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open modal", exact: true }).click();
  await expect(page.getByText("Store Profile Switcher", { exact: true })).toBeVisible();
  expect(browserFixture.navigationCookies).toHaveLength(1);
  expect((await context.cookies(origin)).find(item => item.name === cookieName)?.value).toBe(currentStoreId);
});

test("a protected store switches only after successful password verification", async ({ page, context, browserFixture }) => {
  let releaseUnlock: () => void;
  const pendingUnlock = new Promise<void>(resolve => { releaseUnlock = resolve; });
  browserFixture.waitForUnlock = () => pendingUnlock;
  try {
    await page.getByRole("button", { name: /Locked Store.*Password Locked/ }).click();
    await expect(page.getByLabel("Store Password", { exact: true })).toBeFocused();
    await page.getByLabel("Store Password", { exact: true }).fill("test-password");
    await page.getByRole("button", { name: "Unlock & Switch", exact: true }).click();
    await expect.poll(() => browserFixture.unlockRequests.length).toBe(1);
    expect(browserFixture.unlockRequests[0]).toEqual({ method: "POST", body: { storeId: lockedStoreId, password: "test-password" } });
    expect(browserFixture.navigationCookies).toHaveLength(1);
    expect((await context.cookies(origin)).find(item => item.name === cookieName)?.value).toBe(currentStoreId);
    releaseUnlock!();
    await expect.poll(() => browserFixture.navigationCookies.length).toBe(2);
    expect(browserFixture.navigationCookies[1]).toContain(`${cookieName}=${lockedStoreId}`);
  } finally { releaseUnlock!(); }
});

for (const outcome of ["empty", "rejected", "network-error"] as const) {
  test(`${outcome} password attempt does not switch stores`, async ({ page, context, browserFixture }) => {
    browserFixture.unlockOutcome = outcome === "network-error" ? "network-error" : "rejected";
    await page.getByRole("button", { name: /Locked Store.*Password Locked/ }).click();
    if (outcome !== "empty") await page.getByLabel("Store Password", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "Unlock & Switch", exact: true }).click();
    const error = outcome === "empty" ? "Please enter the store password."
      : outcome === "rejected" ? "Incorrect password. Please try again."
      : "Failed to verify password. Please try again.";
    await expect(page.getByText(error, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Unlock & Switch", exact: true })).toBeEnabled();
    expect(browserFixture.unlockRequests).toHaveLength(outcome === "empty" ? 0 : 1);
    expect(browserFixture.navigationCookies).toHaveLength(1);
    expect((await context.cookies(origin)).find(item => item.name === cookieName)?.value).toBe(currentStoreId);
  });
}

test("closing and reopening clears the password, challenge, and error", async ({ page, context, browserFixture }) => {
  browserFixture.unlockOutcome = "rejected";
  await page.getByRole("button", { name: /Locked Store.*Password Locked/ }).click();
  await page.getByLabel("Store Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Unlock & Switch", exact: true }).click();
  await expect(page.getByText("Incorrect password. Please try again.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close from parent", exact: true }).click();
  await expect(page.getByLabel("Store Password", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open modal", exact: true }).click();
  await expect(page.getByText("Store Profile Switcher", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Locked Store.*Password Locked/ }).click();
  await expect(page.getByLabel("Store Password", { exact: true })).toHaveValue("");
  await expect(page.getByText("Incorrect password. Please try again.", { exact: true })).toHaveCount(0);
  expect(browserFixture.navigationCookies).toHaveLength(1);
  expect((await context.cookies(origin)).find(item => item.name === cookieName)?.value).toBe(currentStoreId);
});

test("parent rerenders retain the entered password and challenge", async ({ page, browserFixture }) => {
  await page.getByRole("button", { name: /Locked Store.*Password Locked/ }).click();
  await page.getByLabel("Store Password", { exact: true }).fill("unsaved-password");
  await page.getByRole("button", { name: "Rerender parent", exact: true }).click();
  await expect(page.getByTestId("parent-revision")).toHaveText("1");
  await expect(page.getByRole("heading", { name: "Unlock Locked Store", exact: true })).toBeVisible();
  await expect(page.getByLabel("Store Password", { exact: true })).toHaveValue("unsaved-password");
  expect(browserFixture.unlockRequests).toEqual([]);
  expect(browserFixture.navigationCookies).toHaveLength(1);
});

test("closing clears the add-store view without changing the active store", async ({ page, context, browserFixture }) => {
  await page.getByRole("button", { name: /Add Store/ }).click();
  await expect(page.getByRole("heading", { name: "Connect a New Store", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Rerender parent", exact: true }).click();
  await expect(page.getByTestId("parent-revision")).toHaveText("1");
  await expect(page.getByRole("heading", { name: "Connect a New Store", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close from parent", exact: true }).click();
  await page.getByRole("button", { name: "Open modal", exact: true }).click();
  await expect(page.getByText("Store Profile Switcher", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect a New Store", exact: true })).toHaveCount(0);
  expect(browserFixture.navigationCookies).toHaveLength(1);
  expect((await context.cookies(origin)).find(item => item.name === cookieName)?.value).toBe(currentStoreId);
});

test("Escape returns from the challenge, then closes the modal", async ({ page, browserFixture }) => {
  await page.getByRole("button", { name: /Locked Store.*Password Locked/ }).click();
  await expect(page.getByLabel("Store Password", { exact: true })).toBeFocused();
  await page.getByLabel("Store Password", { exact: true }).fill("unsaved-password");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Store Profile Switcher", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Store Profile Switcher", { exact: true })).toHaveCount(0);
  expect(browserFixture.navigationCookies).toHaveLength(1);
});

test("a disabled profile lock still allows direct switching", async ({ page, browserFixture }) => {
  await page.getByRole("button", { name: /Lock Disabled Store/ }).click();
  await expect.poll(() => browserFixture.navigationCookies.length).toBe(2);
  expect(browserFixture.navigationCookies[1]).toContain(`${cookieName}=lock-disabled`);
  expect(browserFixture.unlockRequests).toEqual([]);
});

test("closing clears the switching indicator when the user cancels reload", async ({ page, context, browserFixture }) => {
  await page.evaluate(() => {
    window.addEventListener("beforeunload", event => { event.preventDefault(); event.returnValue = ""; });
  });
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: /Unlocked Store/ }).click();
  await expect(page.getByText("Switching...", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close from parent", exact: true }).click();
  await page.getByRole("button", { name: "Open modal", exact: true }).click();
  await expect(page.getByRole("button", { name: /Unlocked Store/ })).toBeEnabled();
  await expect(page.getByText("Switching...", { exact: true })).toHaveCount(0);
  expect(browserFixture.navigationCookies).toHaveLength(1);
  expect((await context.cookies(origin)).find(item => item.name === cookieName)?.value).toBe(encodeURIComponent(unlockedStoreId));
});
