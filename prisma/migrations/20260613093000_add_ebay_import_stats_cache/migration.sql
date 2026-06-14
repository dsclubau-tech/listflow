CREATE TABLE "EbayImportStatsCache" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "activeListings" INTEGER NOT NULL,
    "listingIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EbayImportStatsCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EbayImportStatsCache_storeId_key" ON "EbayImportStatsCache"("storeId");
CREATE INDEX "EbayImportStatsCache_fetchedAt_idx" ON "EbayImportStatsCache"("fetchedAt");

ALTER TABLE "EbayImportStatsCache"
ADD CONSTRAINT "EbayImportStatsCache_storeId_fkey"
FOREIGN KEY ("storeId")
REFERENCES "Store"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
