ALTER TABLE "EbayActionJob" ADD COLUMN "requestId" TEXT;

CREATE UNIQUE INDEX "EbayActionJob_storeId_requestId_key"
  ON "EbayActionJob"("storeId", "requestId");

CREATE TABLE "BulkEditJobItem" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "originalProductUpdatedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BulkEditJobItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BulkEditJobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "EbayActionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BulkEditJobItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BulkEditJobItem_jobId_productId_key"
  ON "BulkEditJobItem"("jobId", "productId");
CREATE INDEX "BulkEditJobItem_jobId_status_idx"
  ON "BulkEditJobItem"("jobId", "status");
CREATE INDEX "BulkEditJobItem_productId_idx"
  ON "BulkEditJobItem"("productId");
