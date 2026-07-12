import assert from "node:assert/strict";
import test from "node:test";
import { authConfig } from "../auth.config";

type AuthorizedCallback = (input: {
  auth: { user?: { storeId?: string } } | null;
  request: { nextUrl: URL };
}) => boolean | Response | Promise<boolean | Response>;

const authorized = authConfig.callbacks?.authorized as unknown as AuthorizedCallback;

test("auth config redirects signed-out private pages to login with a local callback", async () => {
  const result = await authorized({
    auth: null,
    request: { nextUrl: new URL("https://listflow.local/products?page=2") },
  });

  assert.equal(result instanceof Response, true);
  const location = new URL((result as Response).headers.get("location") || "");
  assert.equal(location.pathname, "/login");
  assert.equal(location.searchParams.get("callbackUrl"), "/products?page=2");
});

test("auth config leaves login public and sends signed-in stores to products", async () => {
  assert.equal(
    await authorized({
      auth: null,
      request: { nextUrl: new URL("https://listflow.local/login") },
    }),
    true
  );

  const result = await authorized({
    auth: { user: { storeId: "store-id" } },
    request: { nextUrl: new URL("https://listflow.local/login") },
  });

  assert.equal(result instanceof Response, true);
  assert.equal(
    new URL((result as Response).headers.get("location") || "").pathname,
    "/products"
  );
});
