CREATE TABLE "AppLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "runtime" TEXT NOT NULL,
    "environment" TEXT,
    "context" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "requestId" TEXT,
    "traceId" TEXT,
    "pathname" TEXT,
    "route" TEXT,
    "method" TEXT,
    "statusCode" INTEGER,
    "durationMs" INTEGER,
    "userId" TEXT,
    "storeId" TEXT,
    "workerId" TEXT,
    "workerName" TEXT,
    "jobType" TEXT,
    "jobId" TEXT,
    "productId" TEXT,
    "variantId" TEXT,
    "ebayItemId" TEXT,
    "asin" TEXT,
    "errorName" TEXT,
    "errorMessage" TEXT,
    "stack" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "AppLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AppLog_createdAt_idx" ON "AppLog"("createdAt");
CREATE INDEX "AppLog_storeId_createdAt_idx" ON "AppLog"("storeId", "createdAt");
CREATE INDEX "AppLog_level_createdAt_idx" ON "AppLog"("level", "createdAt");
CREATE INDEX "AppLog_source_createdAt_idx" ON "AppLog"("source", "createdAt");
CREATE INDEX "AppLog_context_idx" ON "AppLog"("context");
CREATE INDEX "AppLog_fingerprint_idx" ON "AppLog"("fingerprint");
CREATE INDEX "AppLog_requestId_idx" ON "AppLog"("requestId");
CREATE INDEX "AppLog_jobId_createdAt_idx" ON "AppLog"("jobId", "createdAt");
CREATE INDEX "AppLog_productId_createdAt_idx" ON "AppLog"("productId", "createdAt");
CREATE INDEX "AppLog_ebayItemId_createdAt_idx" ON "AppLog"("ebayItemId", "createdAt");
CREATE INDEX "AppLog_workerId_createdAt_idx" ON "AppLog"("workerId", "createdAt");

ALTER TABLE "AppLog" ADD CONSTRAINT "AppLog_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
