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

test.describe("Products selection and Action Center ownership", () => {
  test.skip(
    !hasCredentials,
    "Set LISTFLOW_E2E_STORE_ID and LISTFLOW_E2E_STORE_PASSWORD to run authenticated UI tests.",
  );

  test("promotes a page selection to all filtered listings", async ({ page }) => {
    await signIn(page);
    await page.goto("/products?pageSize=25");

    const pageCheckbox = page.getByRole("checkbox", {
      name: "Select all listings on this page",
    });

    await pageCheckbox.check();
    const selectAllListings = page.getByRole("button", {
      name: /Select all \d+ listings/,
    });
    test.skip(
      (await selectAllListings.count()) === 0,
      "The authenticated store needs more than one page of products.",
    );

    const label = await selectAllListings.innerText();
    const totalCount = Number(label.match(/\d+/)?.[0] ?? 0);
    const selectionSummary = page
      .getByText("25 selected", { exact: true })
      .locator("..");
    await expect(selectionSummary).toBeVisible();
    await expect(
      selectionSummary.getByRole("button", {
        name: `Select all ${totalCount} listings`,
      }),
    ).toBeVisible();
    await selectAllListings.click();
    await expect(page.getByText(`All ${totalCount} selected`, { exact: true })).toBeVisible();
    await expect(
      page.getByText(`${totalCount} product(s) selected`, { exact: true }),
    ).toBeVisible();
  });

  test("shows worker ownership state for current jobs", async ({ page }) => {
    await signIn(page);
    await page.goto("/action-center");
    await page.getByRole("button", { name: "Jobs", exact: true }).click();

    const noCurrentJobs = page.getByText("No current or paused jobs.");
    test.skip(
      await noCurrentJobs.isVisible(),
      "The authenticated store needs at least one current or paused job.",
    );

    await expect(
      page.getByText(
        /Worker: .+|Waiting for worker|No active worker|Worker assignment pending/,
      ).first(),
    ).toBeVisible();
  });
});
