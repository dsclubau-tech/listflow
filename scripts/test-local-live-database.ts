import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { loadEnvConfig } from "@next/env";

type Result = { rows: Array<Record<string, unknown>> };
type Client = { query(sql: string, values?: unknown[]): Promise<Result>; release(): void };
type Pool = { connect(): Promise<Client>; end(): Promise<void> };

test("the real local database supports existing store credentials and recovery fields without writes", {
  skip: process.env.LISTFLOW_RUN_LIVE_READONLY_TESTS !== "1",
  timeout: 30_000,
}, async () => {
  loadEnvConfig(process.cwd(), true);
  const loginId = process.env.LISTFLOW_E2E_STORE_ID?.trim().toLowerCase();
  const password = process.env.LISTFLOW_E2E_STORE_PASSWORD;
  assert.ok(loginId && password, "Supply store credentials through runtime environment variables.");
  assert.ok(process.env.DATABASE_URL, "The local website needs DATABASE_URL.");

  const { Pool: PgPool } = createRequire(import.meta.url)("pg") as {
    Pool: new (options: Record<string, unknown>) => Pool;
  };
  const pool = new PgPool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000 });
  let client: Client | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    assert.equal((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only, "on");
    const stores = (await client.query('SELECT id, password, "isActive" FROM "Store" WHERE "loginId"=$1', [loginId])).rows;
    assert.equal(stores.length, 1, "The local connection must resolve the existing store.");
    assert.equal(stores[0].isActive, true, "The store must be active.");
    assert.equal(await bcrypt.compare(password, String(stores[0].password)), true, "Existing credentials must match without a password reset.");

    // Check compatibility with the actual schema, without claiming a job or changing a row.
    await client.query('SELECT "amazonBlockedUntil", "amazonCooldownSeconds", "consecutivePostcodeFailures" FROM "PriceCheckScheduleState" WHERE false');
    await client.query('SELECT "storeId", "resourceKey", "workerId", "expiresAt" FROM "JobLease" WHERE false');
    await client.query('SELECT "completedProductIds", checked, failed, status FROM "PriceCheckJob" WHERE false');
    await client.query('SELECT "claimToken", "nextAttemptAt", attempts, "remoteWriteStarted" FROM "PriceCheckJobItem" WHERE false');
    await client.query("ROLLBACK");
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    const code = (error as { code?: unknown })?.code;
    const safeCode = typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : "DATABASE_UNAVAILABLE";
    throw new Error("Read-only local database check failed (" + safeCode + ").");
  } finally {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
    await pool.end();
  }
});

test("real Supabase transactions serialize isolated recovery probes across connections", {
  skip: process.env.LISTFLOW_RUN_LIVE_READONLY_TESTS !== "1",
  timeout: 30_000,
}, async () => {
  loadEnvConfig(process.cwd(), true);
  assert.ok(process.env.DATABASE_URL, "The local website needs DATABASE_URL.");
  const { Pool: PgPool } = createRequire(import.meta.url)("pg") as {
    Pool: new (options: Record<string, unknown>) => Pool;
  };
  const pool = new PgPool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 10_000 });
  const clients: Client[] = [];
  // This random key cannot collide with a real store's recovery/claim lock.
  const resource = "listflow-recovery-test:" + randomUUID();
  try {
    for (let index = 0; index < 2; index++) {
      const client = await pool.connect();
      clients.push(client);
      await client.query("BEGIN READ ONLY");
      assert.equal((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only, "on");
    }
    const acquire = (client: Client) => client.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired", [resource]);
    assert.equal((await acquire(clients[0])).rows[0].acquired, true);
    assert.equal((await acquire(clients[1])).rows[0].acquired, false, "The second connection must not admit a parallel recovery probe.");

    await clients[0].query("ROLLBACK");
    assert.equal((await acquire(clients[1])).rows[0].acquired, true, "Releasing the first transaction must allow the next probe.");
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    const code = (error as { code?: unknown })?.code;
    const safeCode = typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : "DATABASE_UNAVAILABLE";
    throw new Error("Read-only recovery lock check failed (" + safeCode + ").");
  } finally {
    for (const client of clients) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
    await pool.end();
  }
});

test("Prisma can deserialize the production recovery lock in a real read-only transaction", {
  skip: process.env.LISTFLOW_RUN_LIVE_READONLY_TESTS !== "1",
  timeout: 30_000,
}, async () => {
  loadEnvConfig(process.cwd(), true);
  const { prisma } = await import("../lib/prisma");
  const { lockPriceCheckStore } = await import("../lib/amazon-delivery-cooldown");
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const mode = await tx.$queryRaw<Array<{ transaction_read_only: string }>>`SHOW transaction_read_only`;
      assert.equal(mode[0].transaction_read_only, "on");
      // Random test identity: never acquire a real store's lock or change its schedule state.
      await lockPriceCheckStore(tx, "adapter-regression:" + randomUUID());
    }, { timeout: 15_000 });
  } finally {
    await prisma.$disconnect();
  }
});
