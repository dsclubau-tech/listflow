const SKU_MAX_LENGTH = 50;

function normalizeSku(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, "") ?? "";
  return normalized ? normalized.slice(0, SKU_MAX_LENGTH) : null;
}

export function getAutomaticSku(input: {
  asin?: string | null;
  automaticSkuFilling?: boolean | null;
}) {
  if (input.automaticSkuFilling === false) {
    return null;
  }

  return normalizeSku(input.asin?.toUpperCase());
}

export function getEbayCustomLabel(input: {
  variantSku?: string | null;
  asin?: string | null;
  automaticSkuFilling?: boolean | null;
}) {
  return (
    normalizeSku(input.variantSku) ??
    getAutomaticSku({
      asin: input.asin,
      automaticSkuFilling: input.automaticSkuFilling,
    })
  );
}

