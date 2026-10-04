import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { CookieOptions } from "@supabase/ssr";
import { loadMockedModule } from "../tests/helpers/mocked-module";

type CookieAdapter = { getAll(): { name: string; value: string }[];
  setAll(values: { name: string; value: string; options?: CookieOptions }[]): void };
async function fixture(result: unknown, thrown = false, configured = true, rotate = false) {
  let calls = 0;
  const request = new NextRequest("http://listflow.test/products", { headers: { cookie: "session=old; other=keep" } });
  const implementation = await loadMockedModule<typeof import("./supabase/middleware")>("lib/supabase/middleware.ts", {
    "@supabase/ssr": { createServerClient: (_url: string, _key: string, options: { cookies: CookieAdapter }) => {
      calls++;
      assert.equal(options.cookies.getAll().find(cookie => cookie.name === "session")?.value, "old");
      return { auth: { getUser: async () => {
        if (rotate) options.cookies.setAll([{ name: "session", value: "rotated", options: { httpOnly: true, path: "/", sameSite: "lax" } }]);
        if (thrown) throw result;
        return result;
      } } };
    } },
  }, { process: { env: configured ? { NEXT_PUBLIC_AA_SUPABASE_URL: "http://supabase.test", NEXT_PUBLIC_AA_SUPABASE_ANON_KEY: "fake-key" } : {} } });
  return { request, calls: () => calls, run: () => implementation.updateSession(request) };
}

test("real session lookup returns the user and propagates rotated cookies", async () => {
  const user = { id: "user-1" };
  const f = await fixture({ data: { user }, error: null }, false, true, true);
  const result = await f.run();
  assert.equal(result.user, user);
  assert.equal(result.isRaceCondition, false);
  assert.equal(f.request.cookies.get("session")?.value, "rotated");
  assert.equal(result.response.cookies.get("session")?.value, "rotated");
  assert.equal(result.response.cookies.get("session")?.httpOnly, true);
  assert.equal(f.request.cookies.get("other")?.value, "keep");
});
test("real session with missing configuration does not create a client", async () => {
  const f = await fixture(null, false, false);
  const result = await f.run();
  assert.equal(result.user, null);
  assert.equal(result.isRaceCondition, false);
  assert.equal(f.calls(), 0);
});
for (const error of [
  { code: "refresh_token_already_used", message: "race" },
  { message: "refresh_token_already_used" },
  { message: "Token has already been used" },
  "Token has already been used",
]) {
  for (const thrown of [false, true]) {
    test(`real session recognizes ${thrown ? "thrown" : "returned"} race: ${JSON.stringify(error)}`, async () => {
      const f = await fixture(thrown ? error : { data: { user: null }, error }, thrown);
      const result = await f.run();
      assert.equal(result.user, null);
      assert.equal(result.isRaceCondition, true);
      assert.equal(result.response.headers.get("set-cookie"), null);
      assert.equal(f.request.cookies.get("session")?.value, "old");
    });
  }
}
for (const error of [{ code: "expired", message: "invalid token" }, null, 12, { message: 12, code: {} }]) {
  test(`real session safely handles an ordinary thrown failure: ${JSON.stringify(error)}`, async () => {
    const f = await fixture(error, true);
    const result = await f.run();
    assert.equal(result.user, null);
    assert.equal(result.isRaceCondition, false);
    assert.equal(result.response.headers.get("set-cookie"), null);
  });
}
test("real session rejects a returned expired session without deleting cookies", async () => {
  const f = await fixture({ data: { user: null }, error: { message: "expired", code: "session_expired" } });
  const result = await f.run();
  assert.equal(result.user, null);
  assert.equal(result.isRaceCondition, false);
  assert.equal(result.response.headers.get("set-cookie"), null);
});
