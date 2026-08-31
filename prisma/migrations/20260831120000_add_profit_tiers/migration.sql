-- CreateTable
CREATE TABLE IF NOT EXISTS "ProfitTier" (
    "id" TEXT NOT NULL,
    "supplierSettingsId" TEXT NOT NULL,
    "maxPrice" DOUBLE PRECISION NOT NULL,
    "profitPercent" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ProfitTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProfitTier_supplierSettingsId_idx" ON "ProfitTier"("supplierSettingsId");

-- AddForeignKey
ALTER TABLE "ProfitTier" DROP CONSTRAINT IF EXISTS "ProfitTier_supplierSettingsId_fkey";
ALTER TABLE "ProfitTier" ADD CONSTRAINT "ProfitTier_supplierSettingsId_fkey" FOREIGN KEY ("supplierSettingsId") REFERENCES "SupplierSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
