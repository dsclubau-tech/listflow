-- Store-scoped login credentials and operational isolation.
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "loginId" TEXT;
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "password" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Store_loginId_key" ON "Store"("loginId");

ALTER TABLE "PriceCheckJob" ADD COLUMN IF NOT EXISTS "storeId" TEXT;
ALTER TABLE "PriceCheckJob" ADD COLUMN IF NOT EXISTS "dismissedAt" TIMESTAMP(3);

ALTER TABLE "EbayImportJob" ADD COLUMN IF NOT EXISTS "dismissedAt" TIMESTAMP(3);

ALTER TABLE "DescriptionTemplate" ADD COLUMN IF NOT EXISTS "storeId" TEXT;
ALTER TABLE "KeywordBlacklist" ADD COLUMN IF NOT EXISTS "storeId" TEXT;
ALTER TABLE "SupplierSettings" ADD COLUMN IF NOT EXISTS "storeId" TEXT;

DROP INDEX IF EXISTS "SupplierSettings_supplierName_key";
CREATE UNIQUE INDEX IF NOT EXISTS "SupplierSettings_storeId_supplierName_key" ON "SupplierSettings"("storeId", "supplierName");

CREATE INDEX IF NOT EXISTS "PriceCheckJob_storeId_status_idx" ON "PriceCheckJob"("storeId", "status");
CREATE INDEX IF NOT EXISTS "PriceCheckJob_dismissedAt_idx" ON "PriceCheckJob"("dismissedAt");
CREATE INDEX IF NOT EXISTS "EbayImportJob_dismissedAt_idx" ON "EbayImportJob"("dismissedAt");
CREATE INDEX IF NOT EXISTS "DescriptionTemplate_storeId_idx" ON "DescriptionTemplate"("storeId");
CREATE INDEX IF NOT EXISTS "KeywordBlacklist_storeId_idx" ON "KeywordBlacklist"("storeId");
CREATE INDEX IF NOT EXISTS "SupplierSettings_storeId_idx" ON "SupplierSettings"("storeId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PriceCheckJob_storeId_fkey'
  ) THEN
    ALTER TABLE "PriceCheckJob"
      ADD CONSTRAINT "PriceCheckJob_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DescriptionTemplate_storeId_fkey'
  ) THEN
    ALTER TABLE "DescriptionTemplate"
      ADD CONSTRAINT "DescriptionTemplate_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'KeywordBlacklist_storeId_fkey'
  ) THEN
    ALTER TABLE "KeywordBlacklist"
      ADD CONSTRAINT "KeywordBlacklist_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SupplierSettings_storeId_fkey'
  ) THEN
    ALTER TABLE "SupplierSettings"
      ADD CONSTRAINT "SupplierSettings_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Deterministic dev/store credentials. Runtime seed keeps these hashes fresh.
UPDATE "Store"
SET "loginId" = 'store-' || regexp_replace(lower("name"), '[^0-9]+', '', 'g')
WHERE "loginId" IS NULL
  AND "name" ~* 'store[[:space:]]*[0-9]+';

UPDATE "Store"
SET "password" = '$2b$12$jqbM9Exr0uTb13rs.u4N6.K25u1sKX5fo4ByVk4I6CJWBQzWKzxNu'
WHERE "password" IS NULL
  AND "loginId" IS NOT NULL;

INSERT INTO "DescriptionTemplate" (
  "id",
  "storeId",
  "name",
  "content",
  "isDefault",
  "createdAt",
  "updatedAt"
)
SELECT
  store."id" || '-' || template."id",
  store."id",
  template."name",
  template."content",
  template."isDefault",
  NOW(),
  NOW()
FROM "Store" store
JOIN "DescriptionTemplate" template ON template."storeId" IS NULL
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "KeywordBlacklist" (
  "id",
  "storeId",
  "keyword",
  "removeFromTitle",
  "removeFromDescription",
  "createdAt"
)
SELECT
  store."id" || '-' || keyword."id",
  store."id",
  keyword."keyword",
  keyword."removeFromTitle",
  keyword."removeFromDescription",
  NOW()
FROM "Store" store
JOIN "KeywordBlacklist" keyword ON keyword."storeId" IS NULL
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "SupplierSettings" (
  "id",
  "storeId",
  "supplierName",
  "defaultQuantity",
  "defaultCountry",
  "defaultZipcode",
  "defaultShippingMethod",
  "defaultTemplateId",
  "defaultShippingPolicyId",
  "defaultPaymentPolicyId",
  "defaultReturnPolicyId",
  "ebayFeePercent",
  "fixedFeeAmount",
  "additionalProfitPercent",
  "additionalProfitFixed",
  "minimumProfit",
  "capitalizeTitle",
  "autofillBrand",
  "allowVeroKeywords",
  "privateListing",
  "defaultWeightUnit",
  "automaticSkuFilling",
  "minProductQuantity",
  "maxShippingDays",
  "primeOnly",
  "priceTrackingEnabled",
  "priceCheckHour",
  "scrapePostcode",
  "storeNumber",
  "defaultItemSpecifics",
  "createdAt",
  "updatedAt"
)
SELECT
  store."id" || '-supplier-' || regexp_replace(lower(settings."supplierName"), '[^a-z0-9]+', '-', 'g'),
  store."id",
  settings."supplierName",
  settings."defaultQuantity",
  settings."defaultCountry",
  settings."defaultZipcode",
  settings."defaultShippingMethod",
  settings."defaultTemplateId",
  settings."defaultShippingPolicyId",
  settings."defaultPaymentPolicyId",
  settings."defaultReturnPolicyId",
  settings."ebayFeePercent",
  settings."fixedFeeAmount",
  settings."additionalProfitPercent",
  settings."additionalProfitFixed",
  settings."minimumProfit",
  settings."capitalizeTitle",
  settings."autofillBrand",
  settings."allowVeroKeywords",
  settings."privateListing",
  settings."defaultWeightUnit",
  settings."automaticSkuFilling",
  settings."minProductQuantity",
  settings."maxShippingDays",
  settings."primeOnly",
  settings."priceTrackingEnabled",
  settings."priceCheckHour",
  settings."scrapePostcode",
  CASE
    WHEN store."name" ~ '[0-9]+' THEN CAST(regexp_replace(store."name", '[^0-9]+', '', 'g') AS INTEGER)
    ELSE settings."storeNumber"
  END,
  settings."defaultItemSpecifics",
  NOW(),
  NOW()
FROM "Store" store
JOIN "SupplierSettings" settings ON settings."storeId" IS NULL
ON CONFLICT ("storeId", "supplierName") DO NOTHING;

-- Backfill old price jobs when their product snapshot clearly belongs to one store.
UPDATE "PriceCheckJob" job
SET "storeId" = inferred."storeId"
FROM (
  SELECT
    job_inner."id",
    MIN(product."storeId") AS "storeId",
    COUNT(DISTINCT product."storeId") AS store_count
  FROM "PriceCheckJob" job_inner
  JOIN "Product" product ON product."id" = ANY(job_inner."productIds")
  WHERE job_inner."storeId" IS NULL
  GROUP BY job_inner."id"
) inferred
WHERE job."id" = inferred."id"
  AND inferred.store_count = 1;
