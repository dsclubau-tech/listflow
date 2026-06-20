-- AlterEnum
ALTER TYPE "EbayResearchJobStatus" ADD VALUE IF NOT EXISTS 'PAUSING';
ALTER TYPE "EbayResearchJobStatus" ADD VALUE IF NOT EXISTS 'PAUSED';

-- CreateEnum
CREATE TYPE "EbayResearchBatchStatus" AS ENUM ('QUEUED', 'RUNNING', 'PAUSING', 'PAUSED', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "EbayResearchBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "status" "EbayResearchBatchStatus" NOT NULL DEFAULT 'QUEUED',
    "total" INTEGER NOT NULL DEFAULT 0,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "cooldownUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),

    CONSTRAINT "EbayResearchBatch_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "EbayResearchJob" ADD COLUMN "batchId" TEXT;

-- CreateIndex
CREATE INDEX "EbayResearchBatch_storeId_status_idx" ON "EbayResearchBatch"("storeId", "status");
CREATE INDEX "EbayResearchBatch_storeId_createdAt_idx" ON "EbayResearchBatch"("storeId", "createdAt");
CREATE INDEX "EbayResearchBatch_createdAt_idx" ON "EbayResearchBatch"("createdAt");
CREATE INDEX "EbayResearchJob_batchId_idx" ON "EbayResearchJob"("batchId");

-- AddForeignKey
ALTER TABLE "EbayResearchBatch" ADD CONSTRAINT "EbayResearchBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayResearchBatch" ADD CONSTRAINT "EbayResearchBatch_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayResearchJob" ADD CONSTRAINT "EbayResearchJob_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "EbayResearchBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
