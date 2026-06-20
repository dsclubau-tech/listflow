-- AlterTable
ALTER TABLE "EbayResearchJob" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "EbayResearchBatch" ADD COLUMN "expiresAt" TIMESTAMP(3);

UPDATE "EbayResearchJob"
SET "expiresAt" = COALESCE("completedAt", "updatedAt", "createdAt") + INTERVAL '2 hours'
WHERE "status" IN ('COMPLETED', 'PARTIAL', 'FAILED')
  AND "expiresAt" IS NULL;

UPDATE "EbayResearchBatch"
SET "expiresAt" = COALESCE("completedAt", "updatedAt", "createdAt") + INTERVAL '2 hours'
WHERE "status" IN ('COMPLETED', 'PARTIAL', 'FAILED')
  AND "expiresAt" IS NULL;

-- Upload logs are product-owned audit records inside ListFlow. If a product is
-- removed from ListFlow, keep deletion deterministic instead of leaving orphans.
ALTER TABLE "UploadLog" DROP CONSTRAINT "UploadLog_productId_fkey";
ALTER TABLE "UploadLog" ADD CONSTRAINT "UploadLog_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Store-scoped product lookup indexes for production filtering/searching.
CREATE INDEX "Product_storeId_status_idx" ON "Product"("storeId", "status");
CREATE INDEX "Product_storeId_asin_idx" ON "Product"("storeId", "asin");
CREATE INDEX "Product_storeId_ebayItemId_idx" ON "Product"("storeId", "ebayItemId");
CREATE INDEX "Product_storeId_createdAt_idx" ON "Product"("storeId", "createdAt");
CREATE INDEX "Product_storeId_updatedAt_idx" ON "Product"("storeId", "updatedAt");
CREATE INDEX "Product_createdById_idx" ON "Product"("createdById");

-- Store-scoped upload and research retention indexes.
CREATE INDEX "UploadLog_productId_idx" ON "UploadLog"("productId");
CREATE INDEX "UploadLog_storeId_createdAt_idx" ON "UploadLog"("storeId", "createdAt");
CREATE INDEX "UploadLog_userId_idx" ON "UploadLog"("userId");
CREATE INDEX "EbayResearchJob_storeId_expiresAt_idx" ON "EbayResearchJob"("storeId", "expiresAt");
CREATE INDEX "EbayResearchJob_expiresAt_idx" ON "EbayResearchJob"("expiresAt");
CREATE INDEX "EbayResearchBatch_storeId_expiresAt_idx" ON "EbayResearchBatch"("storeId", "expiresAt");
CREATE INDEX "EbayResearchBatch_expiresAt_idx" ON "EbayResearchBatch"("expiresAt");
