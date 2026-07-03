export const DRAFT_ITEM_SPECIFICS_TAB_INDEX = 4;

export type RequiredItemSpecific = {
  name: string;
  values?: string[];
  inputType?: string | null;
};

export type DraftItemSpecificRow = {
  key: string;
  value: string;
};

export type DraftUploadResponseBody = {
  error?: string;
  missingItemSpecifics?: string[];
  requiredItemSpecifics?: RequiredItemSpecific[];
};

function normalizeSpecificName(name: string) {
  return name.trim().toLowerCase();
}

export function hasMissingItemSpecifics(
  body: Pick<DraftUploadResponseBody, "missingItemSpecifics">
) {
  return Boolean(body.missingItemSpecifics && body.missingItemSpecifics.length > 0);
}

export function mergeRequiredItemSpecifics(
  current: RequiredItemSpecific[],
  incoming: RequiredItemSpecific[] | undefined
) {
  if (!incoming || incoming.length === 0) {
    return current;
  }

  const merged = new Map<string, RequiredItemSpecific>();

  for (const specific of current) {
    merged.set(normalizeSpecificName(specific.name), specific);
  }

  for (const specific of incoming) {
    merged.set(normalizeSpecificName(specific.name), specific);
  }

  return Array.from(merged.values());
}

export function addMissingItemSpecificRows(
  current: DraftItemSpecificRow[],
  missingNames: string[]
) {
  if (missingNames.length === 0) {
    return current;
  }

  const existing = new Set(
    current.map((specific) => normalizeSpecificName(specific.key))
  );
  const additions = missingNames
    .map((name) => name.trim())
    .filter((name) => name && !existing.has(normalizeSpecificName(name)))
    .map((name) => ({ key: name, value: "" }));

  return additions.length > 0 ? [...additions, ...current] : current;
}
