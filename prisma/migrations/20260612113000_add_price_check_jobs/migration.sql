-- CreateEnum
CREATE TYPE "PriceCheckJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PriceCheckJobScope" AS ENUM ('SELECTED', 'ALL');

-- CreateTable
CREATE TABLE "PriceCheckJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "PriceCheckJobScope" NOT NULL,
    "status" "PriceCheckJobStatus" NOT NULL DEFAULT 'QUEUED',
    "productIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "total" INTEGER NOT NULL DEFAULT 0,
    "checked" INTEGER NOT NULL DEFAULT 0,
    "changed" INTEGER NOT NULL DEFAULT 0,
    "pendingReview" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PriceCheckJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceCheckJob_userId_status_idx" ON "PriceCheckJob"("userId", "status");

-- CreateIndex
CREATE INDEX "PriceCheckJob_createdAt_idx" ON "PriceCheckJob"("createdAt");

-- AddForeignKey
ALTER TABLE "PriceCheckJob"
ADD CONSTRAINT "PriceCheckJob_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
