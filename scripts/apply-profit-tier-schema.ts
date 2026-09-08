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
    console.log("[SCHEMA] Applying additive DDL for ProfitTier minPrice, tierType, and nullable maxPrice...");

    await client.query(`
      ALTER TABLE "ProfitTier" ADD COLUMN IF NOT EXISTS "minPrice" DOUBLE PRECISION DEFAULT 0;
    `);

    await client.query(`
      ALTER TABLE "ProfitTier" ADD COLUMN IF NOT EXISTS "tierType" TEXT DEFAULT 'LOWER_THAN';
    `);

    await client.query(`
      ALTER TABLE "ProfitTier" ALTER COLUMN "maxPrice" DROP NOT NULL;
    `);

    await client.query(`
      GRANT SELECT, UPDATE, INSERT, DELETE ON TABLE "ProfitTier" TO listflow_app;
    `);

    console.log("[SCHEMA] Additive ProfitTier DDL applied successfully.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[SCHEMA_ERROR]", err);
  process.exit(1);
});
