import assert from "node:assert/strict";
import test from "node:test";
import {
  DATABASE_HEALTH_PATH,
  getMaintenanceHtml,
  getMaintenanceResponse,
  isApiPath,
  isMaintenanceBypassPath,
  isMaintenanceModeEnabled,
} from "./maintenance-mode";

test("maintenance mode accepts only explicit true-like values", () => {
  for (const value of ["1", "true", "TRUE", " yes ", "on"]) {
    assert.equal(isMaintenanceModeEnabled(value), true);
  }

  for (const value of [undefined, "", "0", "false", "off", "enabled"]) {
    assert.equal(isMaintenanceModeEnabled(value), false);
  }
});

test("database health is the only maintenance bypass path", () => {
  assert.equal(isMaintenanceBypassPath(DATABASE_HEALTH_PATH), true);
  assert.equal(isMaintenanceBypassPath("/api/health"), false);
  assert.equal(isMaintenanceBypassPath("/products"), false);
});

test("API path detection does not match regular pages", () => {
  assert.equal(isApiPath("/api"), true);
  assert.equal(isApiPath("/api/products"), true);
  assert.equal(isApiPath("/products"), false);
});

test("maintenance HTML is safe and contains a clear message", () => {
  const html = getMaintenanceHtml('unsafe<script id');
  assert.match(html, /ListFlow will be back shortly/);
  assert.match(html, /Request ID: unsafescriptid/);
  assert.doesNotMatch(html, /<script id/);
});

test("maintenance responses distinguish pages from APIs", async () => {
  const page = getMaintenanceResponse("/products", "page-request");
  assert.equal(page.status, 503);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(page.headers.get("retry-after"), "300");

  const api = getMaintenanceResponse("/api/products", "api-request");
  assert.equal(api.status, 503);
  assert.deepEqual(await api.json(), {
    error: "ListFlow is temporarily unavailable for scheduled maintenance.",
    requestId: "api-request",
  });
});
