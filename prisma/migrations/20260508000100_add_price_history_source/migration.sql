-- CreateEnum
CREATE TYPE "PriceCheckSource" AS ENUM ('LIVE', 'SIMULATED');

-- AlterTable
ALTER TABLE "PriceHistory"
ADD COLUMN "source" "PriceCheckSource" NOT NULL DEFAULT 'LIVE';
