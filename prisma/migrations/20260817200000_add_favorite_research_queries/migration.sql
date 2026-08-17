CREATE TABLE "FavoriteResearchQuery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoriteResearchQuery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FavoriteResearchQuery_storeId_query_key" ON "FavoriteResearchQuery"("storeId", "query");
CREATE INDEX "FavoriteResearchQuery_storeId_createdAt_idx" ON "FavoriteResearchQuery"("storeId", "createdAt");

ALTER TABLE "FavoriteResearchQuery"
ADD CONSTRAINT "FavoriteResearchQuery_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "FavoriteResearchQuery"
ADD CONSTRAINT "FavoriteResearchQuery_storeId_fkey"
FOREIGN KEY ("storeId")
REFERENCES "Store"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
