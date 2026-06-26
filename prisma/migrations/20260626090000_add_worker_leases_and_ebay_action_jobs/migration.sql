-- Add eBay action jobs, worker job leases, and shared eBay rate-limit buckets.
CREATE TYPE "EbayActionJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TYPE "EbayActionJobType" AS ENUM ('HOLD', 'RESUME', 'END');

CREATE TABLE "EbayActionJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "type" "EbayActionJobType" NOT NULL,
    "status" "EbayActionJobStatus" NOT NULL DEFAULT 'QUEUED',
    "productIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "completedProductIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "EbayActionJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobLease" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "resourceKey" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "workerName" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLease_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EbayRateLimitBucket" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "apiKind" TEXT NOT NULL,
    "nextAllowedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EbayRateLimitBucket_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EbayActionJob_userId_status_idx" ON "EbayActionJob"("userId", "status");
CREATE INDEX "EbayActionJob_storeId_status_idx" ON "EbayActionJob"("storeId", "status");
CREATE INDEX "EbayActionJob_storeId_createdAt_idx" ON "EbayActionJob"("storeId", "createdAt");
CREATE INDEX "EbayActionJob_dismissedAt_idx" ON "EbayActionJob"("dismissedAt");

CREATE UNIQUE INDEX "JobLease_storeId_resourceKey_key" ON "JobLease"("storeId", "resourceKey");
CREATE INDEX "JobLease_storeId_jobType_jobId_idx" ON "JobLease"("storeId", "jobType", "jobId");
CREATE INDEX "JobLease_storeId_workerId_idx" ON "JobLease"("storeId", "workerId");
CREATE INDEX "JobLease_expiresAt_idx" ON "JobLease"("expiresAt");

CREATE UNIQUE INDEX "EbayRateLimitBucket_storeId_apiKind_key" ON "EbayRateLimitBucket"("storeId", "apiKind");
CREATE INDEX "EbayRateLimitBucket_storeId_nextAllowedAt_idx" ON "EbayRateLimitBucket"("storeId", "nextAllowedAt");
CREATE INDEX "EbayRateLimitBucket_blockedUntil_idx" ON "EbayRateLimitBucket"("blockedUntil");

ALTER TABLE "EbayActionJob" ADD CONSTRAINT "EbayActionJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayActionJob" ADD CONSTRAINT "EbayActionJob_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobLease" ADD CONSTRAINT "JobLease_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayRateLimitBucket" ADD CONSTRAINT "EbayRateLimitBucket_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
