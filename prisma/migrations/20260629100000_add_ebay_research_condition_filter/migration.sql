CREATE TYPE "EbayResearchConditionFilter" AS ENUM (
    'ANY',
    'NEW',
    'USED',
    'NEW_OTHER',
    'REFURBISHED',
    'PARTS_NOT_WORKING'
);

ALTER TABLE "EbayResearchJob"
ADD COLUMN "conditionFilter" "EbayResearchConditionFilter" NOT NULL DEFAULT 'ANY';
