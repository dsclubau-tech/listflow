CREATE TYPE "PriceCheckFailureCode" AS ENUM (
  'AMAZON_OUT_OF_STOCK',
  'AMAZON_PRICE_UNAVAILABLE',
  'MISSING_BASELINE',
  'UNSAFE_PRICE_CHANGE',
  'TECHNICAL_ERROR'
);

ALTER TABLE "Product"
ADD COLUMN "priceCheckFailureCode" "PriceCheckFailureCode";

ALTER TABLE "PriceCheckJob"
ADD COLUMN "autoHoldActionJobId" TEXT,
ADD COLUMN "autoHoldQueued" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "SupplierSettings"
ADD COLUMN "autoHoldOnPriceCheckFailure" BOOLEAN NOT NULL DEFAULT true;
