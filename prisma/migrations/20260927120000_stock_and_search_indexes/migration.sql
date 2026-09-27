CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Product_id_trgm_idx" ON "Product" USING GIN ("id" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Product_asin_trgm_idx" ON "Product" USING GIN ("asin" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Product_ebayItemId_trgm_idx" ON "Product" USING GIN ("ebayItemId" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Product_internalNote_trgm_idx" ON "Product" USING GIN ("internalNote" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Variant_id_trgm_idx" ON "Variant" USING GIN ("id" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Product_Brand_trgm_idx" ON "Product" USING GIN (("itemSpecifics" ->> 'Brand') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Product_brand_trgm_idx" ON "Product" USING GIN (("itemSpecifics" ->> 'brand') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Variant_Brand_trgm_idx" ON "Variant" USING GIN (("itemSpecifics" ->> 'Brand') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Variant_brand_trgm_idx" ON "Variant" USING GIN (("itemSpecifics" ->> 'brand') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Product_id_lower_idx" ON "Product" (lower("id"));

CREATE INDEX IF NOT EXISTS "Product_asin_lower_idx" ON "Product" (lower("asin"));

CREATE INDEX IF NOT EXISTS "Product_ebayItemId_lower_idx" ON "Product" (lower("ebayItemId"));

CREATE INDEX IF NOT EXISTS "Variant_id_lower_idx" ON "Variant" (lower("id"));

CREATE INDEX IF NOT EXISTS "Variant_sku_lower_idx" ON "Variant" (lower("sku"));

CREATE INDEX IF NOT EXISTS "Product_store_status_stock_idx" ON "Product" ("storeId", "status", "amazonStockLeft");
