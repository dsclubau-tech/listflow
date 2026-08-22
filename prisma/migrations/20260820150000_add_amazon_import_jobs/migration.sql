-- Railway-owned Amazon import jobs and capability-aware worker routing.
ALTER TYPE "AmazonPriceTrackingMode" ADD VALUE IF NOT EXISTS 'DEAL_PREFERRED';

CREATE TYPE "AmazonImportJobKind" AS ENUM ('NORMAL', 'ADVANCED', 'REGRAB');
CREATE TYPE "AmazonImportJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'READY', 'COMPLETED', 'FAILED', 'CANCELLED');

ALTER TABLE "WorkerHeartbeat"
ADD COLUMN "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "AmazonImportJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" "AmazonImportJobKind" NOT NULL,
    "status" "AmazonImportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "sourceUrl" TEXT NOT NULL,
    "asin" TEXT NOT NULL,
    "requestedPriceTrackingMode" "AmazonPriceTrackingMode",
    "result" JSONB,
    "productId" TEXT,
    "targetProductId" TEXT,
    "requestId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "workerId" TEXT,
    "workerName" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonImportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AmazonImportJob_storeId_status_nextAttemptAt_createdAt_idx"
ON "AmazonImportJob"("storeId", "status", "nextAttemptAt", "createdAt");
CREATE INDEX "AmazonImportJob_userId_storeId_createdAt_idx"
ON "AmazonImportJob"("userId", "storeId", "createdAt");
CREATE INDEX "AmazonImportJob_leaseExpiresAt_idx" ON "AmazonImportJob"("leaseExpiresAt");
CREATE INDEX "AmazonImportJob_expiresAt_idx" ON "AmazonImportJob"("expiresAt");
CREATE INDEX "AmazonImportJob_productId_idx" ON "AmazonImportJob"("productId");
CREATE INDEX "AmazonImportJob_targetProductId_idx" ON "AmazonImportJob"("targetProductId");

CREATE UNIQUE INDEX "AmazonImportJob_active_store_asin_key"
ON "AmazonImportJob"("storeId", "asin")
WHERE "kind" IN ('NORMAL', 'ADVANCED')
  AND "status" IN ('QUEUED', 'RUNNING', 'READY');

CREATE UNIQUE INDEX "AmazonImportJob_active_regrab_target_key"
ON "AmazonImportJob"("storeId", "targetProductId")
WHERE "kind" = 'REGRAB'
  AND "targetProductId" IS NOT NULL
  AND "status" IN ('QUEUED', 'RUNNING');

ALTER TABLE "AmazonImportJob"
ADD CONSTRAINT "AmazonImportJob_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AmazonImportJob"
ADD CONSTRAINT "AmazonImportJob_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AmazonImportJob" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "AmazonImportJob" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "AmazonImportJob" FROM authenticated;
  END IF;
END $$;
