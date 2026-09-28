import assert from "node:assert/strict";
import test from "node:test";
import { configureWorkerDatabaseProfile } from "./worker-database-profile";

test("the default worker database profile preserves DATABASE_URL", () => {
  const environment = { DATABASE_URL: "postgresql://development" };
  assert.equal(configureWorkerDatabaseProfile(environment), "default");
  assert.equal(environment.DATABASE_URL, "postgresql://development");
});

test("the deployed profile selects the explicit deployed database", () => {
  const environment: Record<string, string | undefined> = {
    DATABASE_URL: "postgresql://development",
    LISTFLOW_WORKER_DATABASE_PROFILE: "deployed",
    LISTFLOW_DEPLOYED_DATABASE_URL: "postgresql://production",
    LISTFLOW_DEPLOYED_DIRECT_URL: "postgresql://production-direct",
  };

  assert.equal(configureWorkerDatabaseProfile(environment), "deployed");
  assert.equal(environment.DATABASE_URL, "postgresql://production");
  assert.equal(environment.DIRECT_URL, "postgresql://production-direct");
  assert.equal(environment.LISTFLOW_SUPABASE_TRANSACTION_POOLER, "false");
});

test("the deployed profile fails before opening the wrong database", () => {
  assert.throws(
    () =>
      configureWorkerDatabaseProfile({
        DATABASE_URL: "postgresql://development",
        LISTFLOW_WORKER_DATABASE_PROFILE: "deployed",
      }),
    /deployed worker database URL is missing/,
  );
});


test("explicit deployed database never inherits another database's direct URL", () => {
  const environment: Record<string, string | undefined> = {
    LISTFLOW_WORKER_DATABASE_PROFILE: "deployed",
    LISTFLOW_DEPLOYED_DATABASE_URL: "postgresql://production",
    MIGRATION_SOURCE_DIRECT_URL: "postgresql://old-production",
    DIRECT_URL: "postgresql://development",
  };
  configureWorkerDatabaseProfile(environment);
  assert.equal(environment.DIRECT_URL, "postgresql://production");
});

test("legacy deployed configuration retains its paired direct URL", () => {
  const environment: Record<string, string | undefined> = {
    LISTFLOW_WORKER_DATABASE_PROFILE: "deployed",
    MIGRATION_SOURCE_DATABASE_URL: "postgresql://legacy-production",
    MIGRATION_SOURCE_DIRECT_URL: "postgresql://legacy-direct",
  };
  configureWorkerDatabaseProfile(environment);
  assert.equal(environment.DATABASE_URL, "postgresql://legacy-production");
  assert.equal(environment.DIRECT_URL, "postgresql://legacy-direct");
});
