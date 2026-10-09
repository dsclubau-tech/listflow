CREATE TABLE "EbayOrderNote" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "accountKey" TEXT NOT NULL,
  "ebayOrderId" TEXT NOT NULL,
  "internalNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EbayOrderNote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EbayOrderNote_storeId_accountKey_ebayOrderId_key" ON "EbayOrderNote"("storeId", "accountKey", "ebayOrderId");
ALTER TABLE "EbayOrderNote" ADD CONSTRAINT "EbayOrderNote_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EbayOrderNote" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "EbayOrderNote" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "EbayOrderNote" FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'listflow_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "EbayOrderNote" TO listflow_app;
    CREATE POLICY "EbayOrderNote_app" ON "EbayOrderNote" TO listflow_app USING (true) WITH CHECK (true);
  END IF;
END
$$;
