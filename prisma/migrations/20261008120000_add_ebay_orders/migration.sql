CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'ORDERED', 'SHIPPED', 'DELIVERED', 'CANCELED');

CREATE TABLE "EbayOrderLine" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "accountKey" TEXT NOT NULL,
  "ebayOrderId" TEXT NOT NULL,
  "lineItemId" TEXT NOT NULL,
  "ebayItemId" TEXT,
  "ebayVariationId" TEXT,
  "sku" TEXT,
  "title" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "sellTotal" DECIMAL(12,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "orderCreatedAt" TIMESTAMP(3) NOT NULL,
  "orderModifiedAt" TIMESTAMP(3) NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "productId" TEXT,
  "variantId" TEXT,
  "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
  "estimatedArrival" VARCHAR(10),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EbayOrderLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EbayOrderLine_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "EbayOrderLine_sellTotal_check" CHECK ("sellTotal" >= 0)
);
CREATE UNIQUE INDEX "EbayOrderLine_storeId_accountKey_ebayOrderId_lineItemId_key" ON "EbayOrderLine"("storeId", "accountKey", "ebayOrderId", "lineItemId");
CREATE INDEX "EbayOrderLine_storeId_orderCreatedAt_id_idx" ON "EbayOrderLine"("storeId", "orderCreatedAt", "id");
CREATE INDEX "EbayOrderLine_storeId_accountKey_ebayItemId_idx" ON "EbayOrderLine"("storeId", "accountKey", "ebayItemId");
CREATE INDEX "EbayOrderLine_productId_idx" ON "EbayOrderLine"("productId");
CREATE INDEX "EbayOrderLine_variantId_idx" ON "EbayOrderLine"("variantId");
ALTER TABLE "EbayOrderLine" ADD CONSTRAINT "EbayOrderLine_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayOrderLine" ADD CONSTRAINT "EbayOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EbayOrderLine" ADD CONSTRAINT "EbayOrderLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EbayOrderSyncState" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "accountKey" TEXT NOT NULL,
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSyncedTo" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastError" TEXT,
  "claimToken" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EbayOrderSyncState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EbayOrderSyncState_storeId_accountKey_key" ON "EbayOrderSyncState"("storeId", "accountKey");
ALTER TABLE "EbayOrderSyncState" ADD CONSTRAINT "EbayOrderSyncState_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- These tables are served through authenticated Listflow routes, never the public Data API.
ALTER TABLE "EbayOrderLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EbayOrderSyncState" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "EbayOrderLine", "EbayOrderSyncState" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "EbayOrderLine", "EbayOrderSyncState" FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'listflow_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "EbayOrderLine", "EbayOrderSyncState" TO listflow_app;
    CREATE POLICY "EbayOrderLine_app" ON "EbayOrderLine" TO listflow_app USING (true) WITH CHECK (true);
    CREATE POLICY "EbayOrderSyncState_app" ON "EbayOrderSyncState" TO listflow_app USING (true) WITH CHECK (true);
  END IF;
END
$$;
