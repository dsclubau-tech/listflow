-- AlterTable
ALTER TABLE "Product"
ADD COLUMN "amazonPrice" DECIMAL(10, 2),
ADD COLUMN "lastPriceCheck" TIMESTAMP(3),
ADD COLUMN "priceCheckError" TEXT;

-- AlterTable
ALTER TABLE "SupplierSettings"
ADD COLUMN "priceCheckHour" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN "priceTrackingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "previousPrice" DECIMAL(10, 2) NOT NULL,
    "newPrice" DECIMAL(10, 2) NOT NULL,
    "previousSellPrice" DECIMAL(10, 2) NOT NULL,
    "newSellPrice" DECIMAL(10, 2) NOT NULL,
    "changePercent" DOUBLE PRECISION NOT NULL,
    "ebayRevised" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceHistory_productId_idx" ON "PriceHistory"("productId");

-- CreateIndex
CREATE INDEX "PriceHistory_variantId_idx" ON "PriceHistory"("variantId");

-- CreateIndex
CREATE INDEX "PriceHistory_createdAt_idx" ON "PriceHistory"("createdAt");

-- AddForeignKey
ALTER TABLE "PriceHistory"
ADD CONSTRAINT "PriceHistory_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory"
ADD CONSTRAINT "PriceHistory_variantId_fkey"
FOREIGN KEY ("variantId") REFERENCES "Variant"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
