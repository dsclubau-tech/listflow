-- Add durable per-product price-check outcomes and safe aggregate telemetry.
CREATE TYPE "PriceCheckProductOutcome" AS ENUM (
  'FRESH',
  'UNAVAILABLE',
  'TECHNICAL_ERROR',
  'NEEDS_VERIFICATION',
  'SKIPPED'
);

ALTER TABLE "PriceCheckJob"
  ADD COLUMN "unchanged" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "fresh" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "unavailable" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "technicalErrors" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "needsVerification" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "listingUpdateFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "retryAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "classificationAvailable" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "PriceCheckJobProductResult" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productAsin" TEXT,
  "productTitle" TEXT,
  "outcome" "PriceCheckProductOutcome" NOT NULL,
  "failureCode" "PriceCheckFailureCode",
  "message" TEXT,
  "listingUpdateFailed" BOOLEAN NOT NULL DEFAULT false,
  "retryAttempts" INTEGER NOT NULL DEFAULT 0,
  "durationMs" INTEGER,
  "checkedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceCheckJobProductResult_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PriceCheckJobProductResult_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "PriceCheckJob"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PriceCheckJobProductResult_jobId_productId_key"
  ON "PriceCheckJobProductResult"("jobId", "productId");
CREATE INDEX "PriceCheckJobProductResult_jobId_outcome_idx"
  ON "PriceCheckJobProductResult"("jobId", "outcome");
CREATE INDEX "PriceCheckJobProductResult_productId_idx"
  ON "PriceCheckJobProductResult"("productId");
