import assert from "node:assert/strict";
import test from "node:test";
import { getPolicyDescriptionTemplateId } from "./policy-template-description";

const templates = [
  { id: "policy-linked", descriptionTemplateId: "description-1" },
  { id: "policy-default", descriptionTemplateId: null },
];

test("returns the description template linked to a policy template", () => {
  assert.equal(
    getPolicyDescriptionTemplateId(templates, "policy-linked"),
    "description-1",
  );
});

test("returns null for default, missing, or cleared policy selections", () => {
  assert.equal(getPolicyDescriptionTemplateId(templates, "policy-default"), null);
  assert.equal(getPolicyDescriptionTemplateId(templates, "missing"), null);
  assert.equal(getPolicyDescriptionTemplateId(templates, ""), null);
});
