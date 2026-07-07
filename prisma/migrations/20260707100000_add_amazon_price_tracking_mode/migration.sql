DO $$
BEGIN
  CREATE TYPE "AmazonPriceTrackingMode" AS ENUM ('REGULAR', 'DEAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "amazonPriceTrackingMode" "AmazonPriceTrackingMode" NOT NULL DEFAULT 'REGULAR';

ALTER TABLE "PriceHistory"
ADD COLUMN IF NOT EXISTS "amazonPriceTrackingMode" "AmazonPriceTrackingMode" NOT NULL DEFAULT 'REGULAR';

CREATE INDEX IF NOT EXISTS "Product_storeId_amazonPriceTrackingMode_idx"
ON "Product"("storeId", "amazonPriceTrackingMode");
