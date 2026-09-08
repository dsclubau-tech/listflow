import "dotenv/config";
import { Client } from "pg";

async function main() {
  const connectionString =
    process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("Missing TARGET_DATABASE_URL or DATABASE_URL");
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    console.log("[SCHEMA] Applying additive DDL for profileLockEnabled and autoLockMinutes using admin connection...");

    await client.query(`
      ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "profileLockEnabled" BOOLEAN NOT NULL DEFAULT TRUE;
    `);

    await client.query(`
      ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "autoLockMinutes" INTEGER DEFAULT 0;
    `);

    // Ensure listflow_app has permissions on these columns
    await client.query(`
      GRANT SELECT, UPDATE, INSERT ON TABLE "Store" TO listflow_app;
    `);

    console.log("[SCHEMA] Additive Profile Lock DDL applied successfully.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[SCHEMA_ERROR]", err);
  process.exit(1);
});
