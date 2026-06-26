-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "workerName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ONLINE',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkerHeartbeat_storeId_workerId_key" ON "WorkerHeartbeat"("storeId", "workerId");

-- CreateIndex
CREATE INDEX "WorkerHeartbeat_storeId_lastSeenAt_idx" ON "WorkerHeartbeat"("storeId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "WorkerHeartbeat_lastSeenAt_idx" ON "WorkerHeartbeat"("lastSeenAt");

-- AddForeignKey
ALTER TABLE "WorkerHeartbeat" ADD CONSTRAINT "WorkerHeartbeat_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
