-- Track how many times a research job has been picked up for execution so the
-- worker can stop retrying a job that keeps getting interrupted (poison pill).
ALTER TABLE "EbayResearchJob"
ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
