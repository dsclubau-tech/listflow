-- Add toggle for including additional profit on already uploaded/existing products
ALTER TABLE "SupplierSettings"
ADD COLUMN "applyAdditionalProfitToExisting" BOOLEAN NOT NULL DEFAULT false;
