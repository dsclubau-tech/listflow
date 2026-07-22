import { defineConfig } from "playwright/test";

const baseURL = process.env.LISTFLOW_E2E_BASE_URL || "http://127.0.0.1:3000";
const hasCredentials = Boolean(
  process.env.LISTFLOW_E2E_STORE_ID && process.env.LISTFLOW_E2E_STORE_PASSWORD,
);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer:
    hasCredentials && !process.env.LISTFLOW_E2E_BASE_URL
      ? {
          command: "npm run dev",
          url: baseURL,
          reuseExistingServer: true,
          timeout: 120_000,
        }
      : undefined,
});
