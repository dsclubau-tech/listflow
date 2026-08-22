-- Persist user-facing progress and route a failed specialist attempt to the
-- unified worker without changing the existing Amazon import queue contract.
ALTER TABLE "AmazonImportJob"
ADD COLUMN "errorStatus" INTEGER,
ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'QUEUED',
ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "requiredWorkerRole" TEXT;
