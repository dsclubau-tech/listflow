CREATE TYPE "ProductHoldOrigin" AS ENUM (
  'MANUAL',
  'PRICE_CHECK_OUT_OF_STOCK',
  'PRICE_CHECK_PRICE_UNAVAILABLE',
  'PRICE_CHECK_IDENTITY',
  'PRICE_CHECK_UNSAFE_PRICE',
  'LOW_STOCK',
  'UNKNOWN'
);

ALTER TYPE "PriceCheckFailureCode" ADD VALUE IF NOT EXISTS 'AMAZON_BUYBOX_UNAVAILABLE';

CREATE TYPE "AmazonAvailability" AS ENUM ('IN_STOCK', 'OUT_OF_STOCK', 'UNKNOWN');
CREATE TYPE "PriceHistoryStatus" AS ENUM ('PENDING', 'APPLIED', 'FAILED', 'SUPERSEDED', 'DISMISSED');
CREATE TYPE "ListingOperationStage" AS ENUM ('PREPARED', 'PRICE_SYNC', 'QUANTITY_SYNC', 'RECONCILIATION', 'COMPLETED', 'FAILED', 'SUPERSEDED');

ALTER TABLE "Product"
  ADD COLUMN "holdOrigin" "ProductHoldOrigin",
  ADD COLUMN "holdGeneration" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "holdSavedQuantity" INTEGER,
  ADD COLUMN "holdSavedVariantQuantities" JSONB,
  ADD COLUMN "holdSourceJobId" TEXT,
  ADD COLUMN "holdLastObservationId" TEXT,
  ADD COLUMN "amazonAvailability" "AmazonAvailability" NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE "PriceHistory"
  ADD COLUMN "status" "PriceHistoryStatus" NOT NULL DEFAULT 'PENDING';

UPDATE "Product"
SET "holdOrigin" = CASE
  WHEN "holdReason" ILIKE 'Automatic hold after failed price check:%'
    AND "priceCheckFailureCode" = 'AMAZON_OUT_OF_STOCK'::"PriceCheckFailureCode"
    THEN 'PRICE_CHECK_OUT_OF_STOCK'::"ProductHoldOrigin"
  WHEN "holdReason" ILIKE 'Automatic hold after failed price check:%'
    AND "priceCheckFailureCode" IN (
      'AMAZON_ASIN_REDIRECT'::"PriceCheckFailureCode",
      'AMAZON_VARIANT_SELECTION_REQUIRED'::"PriceCheckFailureCode"
    )
    THEN 'PRICE_CHECK_IDENTITY'::"ProductHoldOrigin"
  WHEN "holdReason" ILIKE 'Automatic hold after failed price check:%'
    THEN 'PRICE_CHECK_PRICE_UNAVAILABLE'::"ProductHoldOrigin"
  WHEN "holdReason" ILIKE 'Low Amazon stock%'
    THEN 'LOW_STOCK'::"ProductHoldOrigin"
  WHEN "status" = 'ON_HOLD'::"ProductStatus"
    THEN 'UNKNOWN'::"ProductHoldOrigin"
  ELSE NULL
END
WHERE "status" = 'ON_HOLD'::"ProductStatus";

UPDATE "PriceHistory"
SET "status" = CASE
  WHEN "errorMessage" IS NOT NULL THEN 'FAILED'::"PriceHistoryStatus"
  WHEN "appliedAt" IS NOT NULL AND "ebayRevised" = true THEN 'APPLIED'::"PriceHistoryStatus"
  WHEN "appliedAt" IS NOT NULL THEN 'SUPERSEDED'::"PriceHistoryStatus"
  ELSE 'PENDING'::"PriceHistoryStatus"
END;

CREATE TABLE "AmazonPriceObservation" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "requestedAsin" TEXT,
  "selectedAsin" TEXT,
  "identityOutcome" TEXT,
  "buyBoxOutcome" TEXT,
  "acceptedPriceSource" TEXT,
  "availability" "AmazonAvailability" NOT NULL DEFAULT 'UNKNOWN',
  "stockLeft" INTEGER,
  "verifiedPostcode" TEXT,
  "postcodeVerified" BOOLEAN NOT NULL DEFAULT false,
  "eligibleOffer" BOOLEAN NOT NULL DEFAULT false,
  "seller" TEXT,
  "price" DECIMAL(10,2),
  "regularPrice" DECIMAL(10,2),
  "dealPrice" DECIMAL(10,2),
  "priceMode" "AmazonPriceTrackingMode",
  "failureCode" "PriceCheckFailureCode",
  "message" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isSuccessful" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "AmazonPriceObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonPriceObservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AmazonPriceObservation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AmazonPriceObservation_productId_observedAt_idx" ON "AmazonPriceObservation"("productId", "observedAt");
CREATE INDEX "AmazonPriceObservation_storeId_observedAt_idx" ON "AmazonPriceObservation"("storeId", "observedAt");
CREATE INDEX "AmazonPriceObservation_storeId_availability_idx" ON "AmazonPriceObservation"("storeId", "availability");

CREATE TABLE "ListingOperation" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "jobId" TEXT,
  "requestKey" TEXT NOT NULL,
  "stage" "ListingOperationStage" NOT NULL DEFAULT 'PREPARED',
  "holdGeneration" INTEGER,
  "expectedProductUpdatedAt" TIMESTAMP(3),
  "targetPrices" JSONB NOT NULL DEFAULT '{}',
  "targetQuantities" JSONB NOT NULL DEFAULT '{}',
  "preparedPayload" JSONB NOT NULL DEFAULT '{}',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "nextAttemptAt" TIMESTAMP(3),
  "ebayConfirmedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ListingOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ListingOperation_requestKey_key" UNIQUE ("requestKey"),
  CONSTRAINT "ListingOperation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ListingOperation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ListingOperation_storeId_stage_nextAttemptAt_idx" ON "ListingOperation"("storeId", "stage", "nextAttemptAt");
CREATE INDEX "ListingOperation_productId_createdAt_idx" ON "ListingOperation"("productId", "createdAt");
CREATE INDEX "ListingOperation_jobId_idx" ON "ListingOperation"("jobId");
