ALTER TABLE "PriceCheckJob" ADD COLUMN "schedulerVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Store" ADD COLUMN "priceCheckItemSchedulerEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkerHeartbeat" ADD COLUMN "revision" TEXT;

CREATE TABLE "PriceCheckJobItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "workerId" TEXT,
    "workerName" TEXT,
    "claimToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "remoteWriteStarted" BOOLEAN NOT NULL DEFAULT false,
    "checked" INTEGER NOT NULL DEFAULT 0,
    "changed" INTEGER NOT NULL DEFAULT 0,
    "pendingReview" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceCheckJobItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PriceCheckJobItem_jobId_productId_key" ON "PriceCheckJobItem"("jobId", "productId");
CREATE INDEX "PriceCheckJobItem_storeId_status_nextAttemptAt_idx" ON "PriceCheckJobItem"("storeId", "status", "nextAttemptAt");
CREATE INDEX "PriceCheckJobItem_jobId_status_idx" ON "PriceCheckJobItem"("jobId", "status");
CREATE INDEX "PriceCheckJobItem_leaseExpiresAt_idx" ON "PriceCheckJobItem"("leaseExpiresAt");
ALTER TABLE "PriceCheckJobItem" ADD CONSTRAINT "PriceCheckJobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PriceCheckJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PriceCheckScheduleState" (
    "storeId" TEXT NOT NULL,
    "manualStreak" INTEGER NOT NULL DEFAULT 0,
    "consecutivePostcodeFailures" INTEGER NOT NULL DEFAULT 0,
    "amazonBlockedUntil" TIMESTAMP(3),
    "amazonCooldownSeconds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceCheckScheduleState_pkey" PRIMARY KEY ("storeId")
);
ALTER TABLE "PriceCheckScheduleState" ADD CONSTRAINT "PriceCheckScheduleState_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Item claims and scheduling state are internal to the application/worker.
ALTER TABLE "PriceCheckJobItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceCheckScheduleState" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "PriceCheckJobItem" FROM anon;
    REVOKE ALL ON TABLE "PriceCheckScheduleState" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "PriceCheckJobItem" FROM authenticated;
    REVOKE ALL ON TABLE "PriceCheckScheduleState" FROM authenticated;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'listflow_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."PriceCheckJobItem" TO listflow_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."PriceCheckScheduleState" TO listflow_app';
    EXECUTE 'CREATE POLICY "PriceCheckJobItem_app" ON public."PriceCheckJobItem" TO listflow_app USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "PriceCheckScheduleState_app" ON public."PriceCheckScheduleState" TO listflow_app USING (true) WITH CHECK (true)';
  END IF;
END
$$;
