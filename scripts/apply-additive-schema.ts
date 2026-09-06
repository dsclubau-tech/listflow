import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("[SCHEMA] Applying additive DDL for ownerUserId and EntitlementSnapshot...");

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "ownerUserId" TEXT;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Store_ownerUserId_idx" ON "Store"("ownerUserId");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "EntitlementSnapshot" (
      "userId" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "allowedStores" INTEGER NOT NULL DEFAULT 0,
      "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "EntitlementSnapshot_pkey" PRIMARY KEY ("userId")
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "EntitlementSnapshot_checkedAt_idx" ON "EntitlementSnapshot"("checkedAt");
  `);

  // Ensure listflow_app has full permissions on new table and column
  await prisma.$executeRawUnsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."EntitlementSnapshot" TO listflow_app;
  `);

  console.log("[SCHEMA] Additive DDL applied successfully.");
}

main()
  .catch((err) => {
    console.error("[SCHEMA_ERROR]", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
