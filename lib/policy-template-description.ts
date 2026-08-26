export type PolicyTemplateDescriptionLink = {
  id: string;
  descriptionTemplateId: string | null;
};

export function getPolicyDescriptionTemplateId(
  templates: PolicyTemplateDescriptionLink[],
  policyTemplateId: string,
) {
  if (!policyTemplateId) {
    return null;
  }

  return (
    templates.find((template) => template.id === policyTemplateId)
      ?.descriptionTemplateId ?? null
  );
}
