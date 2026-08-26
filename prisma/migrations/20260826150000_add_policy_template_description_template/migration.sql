ALTER TABLE "PolicyTemplate"
ADD COLUMN "descriptionTemplateId" TEXT;

CREATE INDEX "PolicyTemplate_descriptionTemplateId_idx"
ON "PolicyTemplate"("descriptionTemplateId");

ALTER TABLE "PolicyTemplate"
ADD CONSTRAINT "PolicyTemplate_descriptionTemplateId_fkey"
FOREIGN KEY ("descriptionTemplateId")
REFERENCES "DescriptionTemplate"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
