CREATE TABLE "PolicyTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "shippingPolicyId" TEXT,
    "returnPolicyId" TEXT,
    "paymentPolicyId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PolicyTemplate_storeId_idx" ON "PolicyTemplate"("storeId");

ALTER TABLE "PolicyTemplate"
ADD CONSTRAINT "PolicyTemplate_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "Store"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
