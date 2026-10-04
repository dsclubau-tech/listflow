import { expect, test as base } from "playwright/test";
import { build } from "esbuild";

const origin = "http://listflow.test";
const query = "Sony headphones";
const favorite = { id: "favorite / &1", query, createdAt: "2026-01-01T00:00:00Z" };
const bundle = build({
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import EbayResearchClient from "./components/EbayResearchClient";
    createRoot(document.getElementById("root")).render(
      <React.StrictMode><EbayResearchClient initialJobs={[]} initialBatches={[]} initialFavorites={[]} /></React.StrictMode>
    );
  ` },
  bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic",
}).then(result => result.outputFiles[0].text);

type FavoriteFixture = {
  saved: typeof favorite[];
  requests: { method: string; body: unknown; url: string }[];
  outcome: "success" | "rejected" | "network-error";
  waitForMutation: (() => Promise<void>) | null;
};
const test = base.extend<{ favoriteFixture: FavoriteFixture }>({
  favoriteFixture: async ({ page }, provide) => {
    const state: FavoriteFixture = { saved: [], requests: [], outcome: "success", waitForMutation: null };
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const html = `<html><body><div id="root"></div><script>${await bundle}</script></body></html>`;
    await page.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.url() === `${origin}/favorites-test` && request.isNavigationRequest()) {
        await route.fulfill({ contentType: "text/html", body: html });
      } else if (url.origin === origin && url.pathname === "/api/ebay-research/favorites") {
        const method = request.method();
        const body: unknown = method === "POST" ? request.postDataJSON() : null;
        state.requests.push({ method, body, url: request.url() });
        if (method === "GET") {
          await route.fulfill({ json: { favorites: state.saved } });
          return;
        }
        await state.waitForMutation?.();
        if (state.outcome === "network-error") { await route.abort("failed"); return; }
        if (state.outcome === "rejected") {
          await route.fulfill({ status: 500, json: { error: "Favorite update failed" } });
          return;
        }
        if (method === "DELETE") {
          expect(url.searchParams.get("id")).toBe(favorite.id);
          state.saved = [];
          await route.fulfill({ json: { success: true } });
        } else {
          expect(body).toEqual({ query, action: "toggle" });
          const isFavorite = state.saved.length === 0;
          state.saved = isFavorite ? [favorite] : [];
          await route.fulfill({ json: { isFavorite, ...(isFavorite ? { favorite } : {}) } });
        }
      } else await route.abort("blockedbyclient");
    });
    await page.goto(`${origin}/favorites-test`);
    await expect(page.getByLabel("Product name")).toBeVisible();
    await provide(state);
    expect(errors).toEqual([]);
  },
});

test("favorite toggle adds and removes the trimmed query with the existing requests", async ({ page, favoriteFixture }) => {
  await page.getByLabel("Product name").fill(`  ${query}  `);
  await page.getByTitle("Save query to favorites", { exact: true }).click();
  await expect.poll(() => favoriteFixture.saved.length).toBe(1);
  await expect(page.getByTitle("Remove query from favorites", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Favorite Searches/ }).click();
  await expect(page.getByText(query, { exact: true })).toBeVisible();
  await expect(page.getByTitle("Remove from favorites", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Single Search", exact: true }).click();
  await page.getByTitle("Remove query from favorites", { exact: true }).click();
  await expect.poll(() => favoriteFixture.saved.length).toBe(0);
  await expect(page.getByTitle("Save query to favorites", { exact: true })).toBeVisible();
  expect(favoriteFixture.requests.map(request => request.method)).toEqual(["POST", "POST"]);
});

test("favorite deletion preserves the encoded ID request and clears the row", async ({ page, favoriteFixture }) => {
  await page.getByLabel("Product name").fill(query);
  await page.getByTitle("Save query to favorites", { exact: true }).click();
  await expect.poll(() => favoriteFixture.saved.length).toBe(1);
  await page.getByRole("button", { name: /Favorite Searches/ }).click();
  await page.getByTitle("Remove from favorites", { exact: true }).click();
  await expect(page.getByText("No favorite searches yet", { exact: true })).toBeVisible();
  await expect.poll(() => favoriteFixture.requests.some(request => request.method === "DELETE")).toBe(true);
  expect(favoriteFixture.requests.find(request => request.method === "DELETE")?.url).toBe(
    `${origin}/api/ebay-research/favorites?id=${encodeURIComponent(favorite.id)}`,
  );
});

for (const outcome of ["rejected", "network-error"] as const) {
  test(`failed favorite addition (${outcome}) refreshes server state and allows another attempt`, async ({ page, favoriteFixture }) => {
    favoriteFixture.outcome = outcome;
    await page.getByLabel("Product name").fill(query);
    await page.getByTitle("Save query to favorites", { exact: true }).click();
    await expect.poll(() => favoriteFixture.requests.filter(request => request.method === "GET").length).toBe(1);
    await expect(page.getByTitle("Save query to favorites", { exact: true })).toBeVisible();
    await expect(page.getByText(outcome === "rejected" ? "Favorite update failed" : "Failed to fetch", { exact: true })).toBeVisible();
    favoriteFixture.outcome = "success";
    await page.getByTitle("Save query to favorites", { exact: true }).click();
    await expect.poll(() => favoriteFixture.saved.length).toBe(1);
    await expect(page.getByTitle("Remove query from favorites", { exact: true })).toBeVisible();
  });
}

test("failed favorite removal restores the saved favorite from the server", async ({ page, favoriteFixture }) => {
  await page.getByLabel("Product name").fill(query);
  await page.getByTitle("Save query to favorites", { exact: true }).click();
  await expect.poll(() => favoriteFixture.saved.length).toBe(1);
  favoriteFixture.outcome = "rejected";
  await page.getByRole("button", { name: /Favorite Searches/ }).click();
  await page.getByTitle("Remove from favorites", { exact: true }).click();
  await expect(page.getByText("Favorite update failed", { exact: true })).toBeVisible();
  await expect(page.getByText(query, { exact: true })).toBeVisible();
  await expect(page.getByTitle("Remove from favorites", { exact: true })).toHaveCount(1);
  expect(favoriteFixture.saved).toEqual([favorite]);
});

test("favorite addition remains optimistic while the request is pending and reconciles to one row", async ({ page, favoriteFixture }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  favoriteFixture.waitForMutation = () => pending;
  try {
    await page.getByLabel("Product name").fill(query);
    await page.getByTitle("Save query to favorites", { exact: true }).click();
    await expect.poll(() => favoriteFixture.requests.length).toBe(1);
    await expect(page.getByTitle("Remove query from favorites", { exact: true })).toBeVisible();
    expect(favoriteFixture.saved).toEqual([]);
    await page.getByRole("button", { name: /Favorite Searches/ }).click();
    await expect(page.getByText(query, { exact: true })).toBeVisible();
    release();
    await expect.poll(() => favoriteFixture.saved.length).toBe(1);
    await expect(page.getByTitle("Remove from favorites", { exact: true })).toHaveCount(1);
  } finally { release(); }
});
