-- CreateEnum
CREATE TYPE "VariantStatus" AS ENUM ('IN_STOCK', 'OUT_OF_STOCK');

-- CreateTable
CREATE TABLE "Variant" (
    "id" TEXT NOT NULL,
    "sku" TEXT,
    "title" TEXT NOT NULL,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "buyPrice" DECIMAL(10,2) NOT NULL,
    "feesPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feesFixed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "profitPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "profitFixed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellPrice" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "VariantStatus" NOT NULL DEFAULT 'IN_STOCK',
    "automation" TEXT,
    "includeShipping" BOOLEAN NOT NULL DEFAULT true,
    "allowMarketplace" BOOLEAN NOT NULL DEFAULT true,
    "roundCents" DOUBLE PRECISION,
    "itemSpecifics" JSONB NOT NULL DEFAULT '{}',
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Variant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Variant_productId_idx" ON "Variant"("productId");

-- AddForeignKey
ALTER TABLE "Variant"
ADD CONSTRAINT "Variant_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
