import { expect, test } from "playwright/test";

const storeId = process.env.LISTFLOW_E2E_STORE_ID;
const password = process.env.LISTFLOW_E2E_STORE_PASSWORD;
const enabled = process.env.LISTFLOW_RUN_LOCAL_LOGIN_TEST === "1";

// Authentication requests contain credentials: never retain a trace or video.
test.use({ trace: "off", video: "off", screenshot: "off" });

test.describe("Local store sign-in against the configured database", () => {
  test.skip(!enabled, "Opt in with LISTFLOW_RUN_LOCAL_LOGIN_TEST=1 and runtime credentials.");

  test("existing credentials open Products locally and survive a reload", async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    expect(storeId, "Supply LISTFLOW_E2E_STORE_ID without committing credentials.").toBeTruthy();
    expect(password, "Supply LISTFLOW_E2E_STORE_PASSWORD without committing credentials.").toBeTruthy();
    const origin = new URL(baseURL!).origin;
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(origin).hostname);

    await page.goto("/login");
    await page.getByLabel("Email Address or Store ID", { exact: true }).fill(storeId!);
    await page.getByLabel("Password", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await page.waitForURL(origin + "/products", { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Products", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(storeId + "$", "i") })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Products", exact: true })).toBeVisible();
    expect(new URL(page.url()).origin).toBe(origin);
    expect(new URL(page.url()).pathname).toBe("/products");
  });
});
