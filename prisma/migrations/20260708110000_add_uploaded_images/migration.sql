CREATE TABLE IF NOT EXISTS "UploadedImage" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadedImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UploadedImage_storeId_createdAt_idx" ON "UploadedImage"("storeId", "createdAt");
CREATE INDEX IF NOT EXISTS "UploadedImage_createdById_idx" ON "UploadedImage"("createdById");
