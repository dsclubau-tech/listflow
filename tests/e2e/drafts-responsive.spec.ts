import { expect, test, type Page } from "playwright/test";

const storeId = process.env.LISTFLOW_E2E_STORE_ID;
const password = process.env.LISTFLOW_E2E_STORE_PASSWORD;
const hasCredentials = Boolean(storeId && password);

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Store ID").fill(storeId!);
  await page.getByLabel("Password").fill(password!);
  await Promise.all([
    page.waitForURL(/\/drafts|\/action-center|\/products/),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
}

async function openDrafts(page: Page, jobs: unknown[] = []) {
  await page.route("**/api/upload/jobs/current", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jobs }),
    }),
  );
  await signIn(page);
  await page.goto("/drafts");
  await expect(page.getByRole("heading", { name: "Drafts" })).toBeVisible();
  await expect(page.locator("tbody tr[aria-expanded]").first()).toBeVisible();
}

test.describe("responsive Drafts workspace", () => {
  test.skip(!hasCredentials, "Set LISTFLOW_E2E_STORE_ID and LISTFLOW_E2E_STORE_PASSWORD to run authenticated UI tests.");

  for (const viewport of [
    { width: 768, height: 900, expectedDisplay: "grid" },
    { width: 1024, height: 900, expectedDisplay: "grid" },
    { width: 1440, height: 1000, expectedDisplay: "table-row" },
  ]) {
    test(`uses the correct draft layout at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openDrafts(page);

      const row = page.locator("tbody tr[aria-expanded]").first();
      await expect(row).toHaveCSS("display", viewport.expectedDisplay);
      const mainFits = await page.locator("main").evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      );
      expect(mainFits).toBe(true);

      if (viewport.width < 1280) {
        await expect(page.getByRole("button", { name: "More" }).first()).toBeVisible();
        await page.getByRole("button", { name: "More" }).first().click();
        await expect(page.getByRole("menu")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toBeHidden();
      }
    });
  }

  test("opens the responsive editor and selection tray", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await openDrafts(page);

    const row = page.locator("tbody tr[aria-expanded]").first();
    await row.press("Enter");
    await expect(page.getByRole("navigation", { name: "Draft editor sections" })).toBeVisible();

    await row.getByRole("checkbox").check();
    await expect(page.getByText("1 product(s) selected")).toBeVisible();
    await expect(page.getByRole("button", { name: "Queue Selected" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete Selected" })).toBeVisible();
  });

  test("keeps the upload dialog accessible and keyboard dismissible", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await openDrafts(page);

    await page.getByRole("button", { name: "Normal Upload" }).click();
    const dialog = page.getByRole("dialog", { name: "Normal Upload" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder("https://www.amazon.com.au/dp/...")).toBeFocused();
    const cancelBox = await dialog.getByRole("button", { name: "Cancel" }).boundingBox();
    const importBox = await dialog.getByRole("button", { name: "Import Product" }).boundingBox();
    const closeBox = await dialog.getByRole("button", { name: "Close upload dialog" }).boundingBox();
    const dialogBox = await dialog.boundingBox();

    expect(cancelBox).not.toBeNull();
    expect(importBox).not.toBeNull();
    expect(closeBox).not.toBeNull();
    expect(dialogBox).not.toBeNull();
    expect(cancelBox!.x).toBeLessThan(importBox!.x);
    expect(dialogBox!.x + dialogBox!.width - (closeBox!.x + closeBox!.width)).toBeLessThanOrEqual(20);
    expect(closeBox!.y - dialogBox!.y).toBeLessThanOrEqual(20);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("restores persisted eBay upload progress", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await openDrafts(page, [
      {
        id: "responsive-progress-job",
        type: "UPLOAD_LISTING",
        status: "RUNNING",
        productIds: [],
        completedProductIds: [],
        total: 4,
        processed: 2,
        succeeded: 2,
        failed: 0,
        errors: [],
        queuePosition: null,
      },
    ]);

    await expect(page.getByText("Uploading to eBay", { exact: true })).toBeVisible();
    await expect(page.getByText("2/4 processed, 2 succeeded, 0 failed.")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Uploading to eBay" })).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
  });
});
