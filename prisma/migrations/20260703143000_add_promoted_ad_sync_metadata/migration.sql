DO $$
BEGIN
  CREATE TYPE "PromotedAdStatus" AS ENUM ('UNKNOWN', 'PROMOTED', 'NOT_PROMOTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "PromotedAdRateStrategy" AS ENUM ('UNKNOWN', 'FIXED', 'DYNAMIC');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "promotedAdStatus" "PromotedAdStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN IF NOT EXISTS "promotedAdCampaignId" TEXT,
ADD COLUMN IF NOT EXISTS "promotedAdCampaignName" TEXT,
ADD COLUMN IF NOT EXISTS "promotedAdRateStrategy" "PromotedAdRateStrategy" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN IF NOT EXISTS "promotedAdSyncedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Product_storeId_promotedAdStatus_idx"
ON "Product"("storeId", "promotedAdStatus");

CREATE INDEX IF NOT EXISTS "Product_storeId_promotedAdPercent_idx"
ON "Product"("storeId", "promotedAdPercent");
