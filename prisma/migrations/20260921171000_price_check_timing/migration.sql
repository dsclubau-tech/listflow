-- Persist safe price-check timing summaries and the effective runtime controls.
ALTER TABLE "PriceCheckJob"
  ADD COLUMN "timingSummary" JSONB,
  ADD COLUMN "effectiveSettings" JSONB,
  ADD COLUMN "runtimeRevision" TEXT;
