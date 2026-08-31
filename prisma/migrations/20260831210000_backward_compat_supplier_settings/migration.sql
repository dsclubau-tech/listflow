-- Ensure both new defaultUploadProfit and legacy additionalProfit columns exist for backward compatibility with worker processes
ALTER TABLE "SupplierSettings" ADD COLUMN IF NOT EXISTS "defaultUploadProfitPercent" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "SupplierSettings" ADD COLUMN IF NOT EXISTS "defaultUploadProfitFixed" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "SupplierSettings" ADD COLUMN IF NOT EXISTS "additionalProfitPercent" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "SupplierSettings" ADD COLUMN IF NOT EXISTS "additionalProfitFixed" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "SupplierSettings" ADD COLUMN IF NOT EXISTS "applyAdditionalProfitToExisting" BOOLEAN DEFAULT false;

-- Sync legacy values from default upload profit or vice-versa
UPDATE "SupplierSettings"
SET "additionalProfitPercent" = COALESCE("defaultUploadProfitPercent", "additionalProfitPercent", 0),
    "additionalProfitFixed" = COALESCE("defaultUploadProfitFixed", "additionalProfitFixed", 0),
    "defaultUploadProfitPercent" = COALESCE("defaultUploadProfitPercent", "additionalProfitPercent", 0),
    "defaultUploadProfitFixed" = COALESCE("defaultUploadProfitFixed", "additionalProfitFixed", 0);
