import assert from "node:assert/strict";
import test from "node:test";
import { loadMockedModule } from "../tests/helpers/mocked-module";

async function runPermissionFixture(deniedError: unknown, blockedTable = "public.subscriptions", allowDeniedRead = false) {
  const queries: string[] = [], errors: unknown[] = [];
  let ended = false;
  let finish!: (code: number) => void;
  const done = new Promise<number>(resolve => { finish = resolve; });
  class Client {
    async connect() {}
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("current_user")) return { rows: [{ current_user: "listflow_app" }] };
      if (sql.includes("public.") || sql.includes("auth.users")) {
        if (sql.includes(blockedTable)) {
          if (allowDeniedRead) return { rows: [] };
          throw deniedError;
        }
        throw { code: "42501", message: "denied" };
      }
      return { rows: [{ count: 0 }] };
    }
    async end() { ended = true; }
  }
  await loadMockedModule("scripts/test-db-role-boundary.ts", {
    "dotenv/config": {},
    "node:fs": { default: { existsSync: () => true, readFileSync: () => 'LISTFLOW_APP_DIRECT_URL="postgres://synthetic-unused"' } },
    pg: { Client },
  }, {
    process: { env: {}, cwd: () => process.cwd(), exit: (code: number) => finish(code) },
    console: { log: (message: string) => { if (message.includes("ALL SECURITY BOUNDARY ASSERTIONS PASSED")) finish(0); },
      error: (_prefix: string, error: unknown) => errors.push(error) },
  });
  return { code: await done, queries, errors, ended };
}
for (const table of ["public.subscriptions", "public.stores", "auth.users"]) {
  test(`real permission script accepts only PostgreSQL denied access on ${table}`, async () => {
    const result = await runPermissionFixture({ code: "42501", message: "permission denied" }, table);
    assert.equal(result.code, 0);
    assert.equal(result.ended, true);
    assert.equal(result.queries.length, 7);
  });
  for (const error of [{ code: "08006", message: "connection lost" }, { code: 42501 }, null]) {
    test(`real permission script fails ${table} check on unrelated error ${JSON.stringify(error)}`, async () => {
      const result = await runPermissionFixture(error, table);
      assert.equal(result.code, 1);
      assert.match(String(result.errors[0]), /Expected 42501/);
    });
  }
}
test("real permission script rejects unexpected successful access", async () => {
  const result = await runPermissionFixture(null, "public.subscriptions", true);
  assert.equal(result.code, 1);
  assert.match(String(result.errors[0]), /SECURITY VIOLATION/);
});
