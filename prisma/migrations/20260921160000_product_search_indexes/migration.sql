CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Product_title_trgm_idx"
  ON "Product" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Product_fullTitle_trgm_idx"
  ON "Product" USING GIN ("fullTitle" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Variant_sku_trgm_idx"
  ON "Variant" USING GIN ("sku" gin_trgm_ops);
