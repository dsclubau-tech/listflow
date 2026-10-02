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
  assert.equal(location.origin, "https://listflow.local");
  assert.equal(location.pathname, "/login");
  assert.equal(location.searchParams.get("callbackUrl"), "/products?page=2");
});

test("auth config keeps localhost redirects on localhost", async () => {
  const result = await authorized({
    auth: null,
    request: { nextUrl: new URL("http://localhost:3000/products?page=2") },
  });

  assert.equal(result instanceof Response, true);
  const location = new URL((result as Response).headers.get("location") || "");
  assert.equal(location.origin, "http://localhost:3000");
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
  const location = new URL((result as Response).headers.get("location") || "");
  assert.equal(location.origin, "https://listflow.local");
  assert.equal(location.pathname, "/products");
});

test("local port 3001 stays local for signed-out and signed-in store redirects", async () => {
  const origin = "http://localhost:3001";
  const signedOut = await authorized({
    auth: null,
    request: { nextUrl: new URL(origin + "/products?page=2") },
  });
  const login = new URL((signedOut as Response).headers.get("location") || "");
  assert.equal(login.origin, origin);
  assert.equal(login.pathname, "/login");
  assert.equal(login.searchParams.get("callbackUrl"), "/products?page=2");

  const signedIn = await authorized({
    auth: { user: { storeId: "store-id" } },
    request: { nextUrl: new URL(origin + "/login") },
  });
  const destination = new URL((signedIn as Response).headers.get("location") || "");
  assert.equal(destination.origin, origin);
  assert.equal(destination.pathname, "/products");
});
