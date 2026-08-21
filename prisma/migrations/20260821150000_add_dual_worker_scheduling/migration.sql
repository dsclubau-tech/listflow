-- Add explicit worker roles without introducing a database enum that would
-- make older Prisma clients incompatible with heartbeat rows.
ALTER TABLE "WorkerHeartbeat"
ADD COLUMN "workerRole" TEXT NOT NULL DEFAULT 'legacy';

-- Coordinate periodic work across the unified and store-specific workers.
CREATE TABLE "WorkerSchedule" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedBy" TEXT,
    "claimedByName" TEXT,
    "claimExpiresAt" TIMESTAMP(3),
    "lastStartedAt" TIMESTAMP(3),
    "lastCompletedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerSchedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkerSchedule_storeId_taskKey_key"
ON "WorkerSchedule"("storeId", "taskKey");

CREATE INDEX "WorkerSchedule_nextRunAt_idx"
ON "WorkerSchedule"("nextRunAt");

CREATE INDEX "WorkerSchedule_claimExpiresAt_idx"
ON "WorkerSchedule"("claimExpiresAt");

ALTER TABLE "WorkerSchedule"
ADD CONSTRAINT "WorkerSchedule_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "Store"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- This is an internal server/worker coordination table. Keep it inaccessible
-- through the Supabase Data API even if public-schema exposure is enabled.
ALTER TABLE "WorkerSchedule" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "WorkerSchedule" FROM anon;
REVOKE ALL ON TABLE "WorkerSchedule" FROM authenticated;
