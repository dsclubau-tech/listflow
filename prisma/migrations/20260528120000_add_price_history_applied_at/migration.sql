-- AlterTable
ALTER TABLE "PriceHistory"
ADD COLUMN "appliedAt" TIMESTAMP(3);

-- Existing history rows were already processed by the old auto-revise flow.
UPDATE "PriceHistory"
SET "appliedAt" = "createdAt";
