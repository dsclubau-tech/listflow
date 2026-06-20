CREATE TYPE "EbayResearchJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');
CREATE TYPE "EbayResearchMode" AS ENUM ('ACTIVE', 'SOLD', 'BOTH');

CREATE TABLE "EbayResearchJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "status" "EbayResearchJobStatus" NOT NULL DEFAULT 'QUEUED',
    "mode" "EbayResearchMode" NOT NULL,
    "query" TEXT NOT NULL,
    "limit" INTEGER NOT NULL DEFAULT 50,
    "activeCount" INTEGER NOT NULL DEFAULT 0,
    "soldCount" INTEGER NOT NULL DEFAULT 0,
    "activeSummary" JSONB NOT NULL DEFAULT '{}',
    "soldSummary" JSONB NOT NULL DEFAULT '{}',
    "activeResults" JSONB NOT NULL DEFAULT '[]',
    "soldResults" JSONB NOT NULL DEFAULT '[]',
    "warningMessage" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "EbayResearchJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EbayResearchJob_storeId_status_idx" ON "EbayResearchJob"("storeId", "status");
CREATE INDEX "EbayResearchJob_storeId_createdAt_idx" ON "EbayResearchJob"("storeId", "createdAt");
CREATE INDEX "EbayResearchJob_createdAt_idx" ON "EbayResearchJob"("createdAt");

ALTER TABLE "EbayResearchJob"
ADD CONSTRAINT "EbayResearchJob_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "EbayResearchJob"
ADD CONSTRAINT "EbayResearchJob_storeId_fkey"
FOREIGN KEY ("storeId")
REFERENCES "Store"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
