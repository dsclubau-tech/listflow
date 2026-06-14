CREATE TYPE "EbayImportJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "EbayImportJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storeNumber" INTEGER NOT NULL,
    "status" "EbayImportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "quantity" INTEGER NOT NULL,
    "requested" INTEGER NOT NULL DEFAULT 0,
    "activeListings" INTEGER NOT NULL DEFAULT 0,
    "alreadyImported" INTEGER NOT NULL DEFAULT 0,
    "remainingBeforeImport" INTEGER NOT NULL DEFAULT 0,
    "remainingAfterImport" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "rateLimited" BOOLEAN NOT NULL DEFAULT false,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "EbayImportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EbayImportJob_userId_status_idx" ON "EbayImportJob"("userId", "status");
CREATE INDEX "EbayImportJob_storeId_status_idx" ON "EbayImportJob"("storeId", "status");
CREATE INDEX "EbayImportJob_createdAt_idx" ON "EbayImportJob"("createdAt");

ALTER TABLE "EbayImportJob"
ADD CONSTRAINT "EbayImportJob_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "EbayImportJob"
ADD CONSTRAINT "EbayImportJob_storeId_fkey"
FOREIGN KEY ("storeId")
REFERENCES "Store"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
