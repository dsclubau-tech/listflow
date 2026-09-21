-- Remove the additive price-check outcome and timing schema after the code rollback.
DROP TABLE IF EXISTS "PriceCheckJobProductResult";

ALTER TABLE "PriceCheckJob"
  DROP COLUMN IF EXISTS "timingSummary",
  DROP COLUMN IF EXISTS "effectiveSettings",
  DROP COLUMN IF EXISTS "runtimeRevision",
  DROP COLUMN IF EXISTS "unchanged",
  DROP COLUMN IF EXISTS "fresh",
  DROP COLUMN IF EXISTS "unavailable",
  DROP COLUMN IF EXISTS "technicalErrors",
  DROP COLUMN IF EXISTS "needsVerification",
  DROP COLUMN IF EXISTS "listingUpdateFailures",
  DROP COLUMN IF EXISTS "retryAttempts",
  DROP COLUMN IF EXISTS "classificationAvailable";

DROP TYPE IF EXISTS "PriceCheckProductOutcome";
