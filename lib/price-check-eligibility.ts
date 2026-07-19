export const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

export type PriceCheckIneligibilityReason =
  | "not-imported"
  | "missing-asin"
  | "missing-variants";

type PriceCheckCandidate = {
  id?: string | null;
  status?: string | null;
  asin?: string | null;
  _count?: {
    variants?: number | null;
  } | null;
  variants?: unknown[] | null;
};

export type PriceCheckEligibility = {
  eligible: boolean;
  reason: PriceCheckIneligibilityReason | null;
  message: string | null;
};

export type SelectedPriceCheckSummary<T extends PriceCheckCandidate> = {
  selectedProducts: T[];
  eligibleProducts: T[];
  ineligibleProducts: T[];
  eligibleIds: string[];
  selectedCount: number;
  eligibleCount: number;
  ineligibleCount: number;
  reasonCounts: Record<PriceCheckIneligibilityReason, number>;
  message: string;
};

export function normalizeAsin(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return normalized || null;
}

export function isValidAsin(value: unknown) {
  const normalized = normalizeAsin(value);
  return Boolean(normalized && ASIN_PATTERN.test(normalized));
}

export function getPriceCheckVariantCount(product: PriceCheckCandidate) {
  if (typeof product._count?.variants === "number") {
    return product._count.variants;
  }

  if (Array.isArray(product.variants)) {
    return product.variants.length;
  }

  return 0;
}

export function getPriceCheckPrerequisiteIssue(
  product: PriceCheckCandidate,
): Extract<PriceCheckIneligibilityReason, "missing-asin" | "missing-variants"> | null {
  if (!isValidAsin(product.asin)) {
    return "missing-asin";
  }

  return getPriceCheckVariantCount(product) <= 0 ? "missing-variants" : null;
}

export function getPriceCheckEligibility(
  product: PriceCheckCandidate
): PriceCheckEligibility {
  if (product.status !== "IMPORTED") {
    return {
      eligible: false,
      reason: "not-imported",
      message: "Selected product cannot be price checked because it is not imported.",
    };
  }

  const prerequisiteIssue = getPriceCheckPrerequisiteIssue(product);

  if (prerequisiteIssue === "missing-asin") {
    return {
      eligible: false,
      reason: "missing-asin",
      message:
        "Selected product cannot be price checked because its Amazon ASIN is missing or invalid.",
    };
  }

  if (prerequisiteIssue === "missing-variants") {
    return {
      eligible: false,
      reason: "missing-variants",
      message: "Selected product cannot be price checked because it has no variants.",
    };
  }

  return {
    eligible: true,
    reason: null,
    message: null,
  };
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatReasonCounts(
  reasonCounts: Record<PriceCheckIneligibilityReason, number>
) {
  const parts = [
    reasonCounts["missing-asin"] > 0
      ? pluralize(reasonCounts["missing-asin"], "missing ASIN", "missing ASINs")
      : null,
    reasonCounts["missing-variants"] > 0
      ? pluralize(
          reasonCounts["missing-variants"],
          "missing variant",
          "missing variants"
        )
      : null,
    reasonCounts["not-imported"] > 0
      ? pluralize(reasonCounts["not-imported"], "not imported product")
      : null,
  ].filter(Boolean);

  return parts.join(", ");
}

export function getSelectedPriceCheckSummary<T extends PriceCheckCandidate>(
  products: T[],
  selectedIds: string[]
): SelectedPriceCheckSummary<T> {
  const productsById = new Map(
    products
      .filter((product): product is T & { id: string } => Boolean(product.id))
      .map((product) => [product.id, product])
  );
  const selectedProducts: T[] = [];

  for (const id of selectedIds) {
    const product = productsById.get(id);

    if (product) {
      selectedProducts.push(product);
    }
  }
  const eligibleProducts: T[] = [];
  const ineligibleProducts: T[] = [];
  const reasonCounts: Record<PriceCheckIneligibilityReason, number> = {
    "not-imported": 0,
    "missing-asin": 0,
    "missing-variants": 0,
  };

  for (const product of selectedProducts) {
    const eligibility = getPriceCheckEligibility(product);

    if (eligibility.eligible) {
      eligibleProducts.push(product);
    } else {
      ineligibleProducts.push(product);
      if (eligibility.reason) {
        reasonCounts[eligibility.reason] += 1;
      }
    }
  }

  const selectedCount = selectedProducts.length;
  const eligibleCount = eligibleProducts.length;
  const ineligibleCount = ineligibleProducts.length;
  const reasonText = formatReasonCounts(reasonCounts);
  let message = "Select at least one product first.";

  if (selectedCount === 1 && ineligibleCount === 1) {
    message =
      getPriceCheckEligibility(selectedProducts[0]).message ??
      "Selected product cannot be price checked.";
  } else if (selectedCount > 0 && eligibleCount === 0) {
    message = reasonText
      ? `None of the selected products can be price checked: ${reasonText}.`
      : "None of the selected products can be price checked.";
  } else if (eligibleCount > 0 && ineligibleCount > 0) {
    message = reasonText
      ? `Checking ${pluralize(
          eligibleCount,
          "selected product"
        )}. Skipping ${ineligibleCount}: ${reasonText}.`
      : `Checking ${pluralize(
          eligibleCount,
          "selected product"
        )}. Skipping ${ineligibleCount}.`;
  } else if (eligibleCount > 0) {
    message = `Checking ${pluralize(eligibleCount, "selected product")}.`;
  }

  return {
    selectedProducts,
    eligibleProducts,
    ineligibleProducts,
    eligibleIds: eligibleProducts
      .map((product) => product.id)
      .filter((id): id is string => Boolean(id)),
    selectedCount,
    eligibleCount,
    ineligibleCount,
    reasonCounts,
    message,
  };
}
