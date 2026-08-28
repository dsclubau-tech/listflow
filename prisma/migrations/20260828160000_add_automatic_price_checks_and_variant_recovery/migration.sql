-- CreateEnum
CREATE TYPE "PriceCheckJobTrigger" AS ENUM ('MANUAL', 'AUTOMATIC');

-- AlterEnum
ALTER TYPE "PriceCheckFailureCode" ADD VALUE 'AMAZON_VARIANT_SELECTION_REQUIRED';

-- AlterTable
ALTER TABLE "PriceCheckJob" ADD COLUMN "trigger" "PriceCheckJobTrigger" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "Store" ADD COLUMN "autoCheckEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "autoCheckStartedBy" TEXT,
ADD COLUMN "autoCheckStartedAt" TIMESTAMP(3);
