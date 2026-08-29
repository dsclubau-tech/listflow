-- AlterTable
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "quantitySold" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Product_storeId_quantitySold_idx" ON "Product"("storeId", "quantitySold");
