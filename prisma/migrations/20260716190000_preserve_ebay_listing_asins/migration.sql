CREATE TABLE "EbayListingAsin" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "ebayItemId" TEXT NOT NULL,
    "asin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EbayListingAsin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EbayListingAsin_storeId_ebayItemId_key"
ON "EbayListingAsin"("storeId", "ebayItemId");

CREATE INDEX "EbayListingAsin_storeId_asin_idx"
ON "EbayListingAsin"("storeId", "asin");

ALTER TABLE "EbayListingAsin"
ADD CONSTRAINT "EbayListingAsin_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "EbayListingAsin" (
    "id",
    "storeId",
    "ebayItemId",
    "asin",
    "createdAt",
    "updatedAt"
)
SELECT
    'backfill-' || md5("storeId" || ':' || "ebayItemId"),
    "storeId",
    "ebayItemId",
    upper(trim("asin")),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Product"
WHERE "ebayItemId" IS NOT NULL
  AND trim("ebayItemId") <> ''
  AND "asin" IS NOT NULL
  AND trim("asin") <> ''
ON CONFLICT ("storeId", "ebayItemId") DO UPDATE
SET "asin" = EXCLUDED."asin", "updatedAt" = CURRENT_TIMESTAMP;
