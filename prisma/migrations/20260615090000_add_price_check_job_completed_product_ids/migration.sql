ALTER TABLE "PriceCheckJob"
ADD COLUMN "completedProductIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
