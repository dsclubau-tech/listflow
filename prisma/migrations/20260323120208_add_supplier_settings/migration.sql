-- CreateTable
CREATE TABLE "SupplierSettings" (
    "id" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL DEFAULT 'Amazon AU',
    "defaultQuantity" INTEGER NOT NULL DEFAULT 1,
    "defaultCountry" TEXT NOT NULL DEFAULT 'Australia',
    "defaultZipcode" TEXT NOT NULL DEFAULT '3170',
    "defaultShippingMethod" TEXT NOT NULL DEFAULT 'Cheapest with tracking',
    "defaultTemplateId" TEXT,
    "defaultShippingPolicyId" TEXT,
    "defaultPaymentPolicyId" TEXT,
    "defaultReturnPolicyId" TEXT,
    "ebayFeePercent" DOUBLE PRECISION NOT NULL DEFAULT 13.0,
    "fixedFeeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0.33,
    "additionalProfitPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "additionalProfitFixed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minimumProfit" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "capitalizeTitle" BOOLEAN NOT NULL DEFAULT false,
    "autofillBrand" BOOLEAN NOT NULL DEFAULT true,
    "allowVeroKeywords" BOOLEAN NOT NULL DEFAULT false,
    "privateListing" BOOLEAN NOT NULL DEFAULT false,
    "defaultWeightUnit" TEXT NOT NULL DEFAULT 'Kg',
    "automaticSkuFilling" BOOLEAN NOT NULL DEFAULT true,
    "minProductQuantity" INTEGER NOT NULL DEFAULT 2,
    "maxShippingDays" INTEGER NOT NULL DEFAULT 25,
    "primeOnly" BOOLEAN NOT NULL DEFAULT true,
    "storeNumber" INTEGER NOT NULL DEFAULT 1,
    "defaultItemSpecifics" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierSettings_supplierName_key" ON "SupplierSettings"("supplierName");
