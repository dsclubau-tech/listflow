-- Rename additional profit columns to default upload profit and drop applyAdditionalProfitToExisting
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'SupplierSettings' AND column_name = 'additionalProfitPercent'
  ) THEN
    ALTER TABLE "SupplierSettings" RENAME COLUMN "additionalProfitPercent" TO "defaultUploadProfitPercent";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'SupplierSettings' AND column_name = 'additionalProfitFixed'
  ) THEN
    ALTER TABLE "SupplierSettings" RENAME COLUMN "additionalProfitFixed" TO "defaultUploadProfitFixed";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'SupplierSettings' AND column_name = 'applyAdditionalProfitToExisting'
  ) THEN
    ALTER TABLE "SupplierSettings" DROP COLUMN "applyAdditionalProfitToExisting";
  END IF;
END $$;
