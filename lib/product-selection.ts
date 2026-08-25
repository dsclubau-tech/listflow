export function getProductSelectionScopeKey(value: string | URLSearchParams) {
  const params =
    typeof value === "string"
      ? new URLSearchParams(value)
      : new URLSearchParams(value.toString());

  params.delete("page");
  params.delete("pageSize");
  params.delete("productId");
  params.sort();

  return params.toString();
}

export function hasEverySelected(selectedIds: string[], candidateIds: string[]) {
  if (candidateIds.length === 0) {
    return false;
  }

  const selected = new Set(selectedIds);
  return candidateIds.every((id) => selected.has(id));
}

export function setPageSelection(
  selectedIds: string[],
  pageIds: string[],
  selected: boolean,
) {
  const pageIdSet = new Set(pageIds);

  if (!selected) {
    return selectedIds.filter((id) => !pageIdSet.has(id));
  }

  return Array.from(new Set([...selectedIds, ...pageIds]));
}
