import {
  DEFAULT_BRAND,
  DEFAULT_MPN,
  inferBrandItemSpecific,
  inferSizeItemSpecific,
  inferTypeItemSpecific,
  inferVolumeItemSpecific,
  matchAllowedSpecificValue,
  normalizeItemSpecifics,
  readItemSpecificValue,
  type ItemSpecificsRecord,
} from "@/lib/item-specifics";

export type RequiredSpecificDefinition = {
  name: string;
  values?: string[];
  inputType?: string | null;
};

export type RequiredSpecificSource =
  | "user"
  | "amazon"
  | "title"
  | "category"
  | "ebay_allowed_default"
  | "missing";

export type RequiredSpecificDecision = {
  name: string;
  value: string | null;
  source: RequiredSpecificSource;
};

export type ResolveRequiredSpecificsInput = {
  title?: string | null;
  categoryName?: string | null;
  description?: string | null;
  brand?: string | null;
  itemSpecifics?: unknown;
  supplierDefaultItemSpecifics?: unknown;
  requiredItemSpecifics: RequiredSpecificDefinition[];
};

export type ResolveRequiredSpecificsResult = {
  itemSpecifics: ItemSpecificsRecord;
  addedItemSpecifics: ItemSpecificsRecord;
  missingItemSpecifics: string[];
  decisions: RequiredSpecificDecision[];
};

const BRAND_UNAVAILABLE_VALUES = new Set([
  "does not apply",
  "n/a",
  "na",
  "none",
  "not applicable",
  "unknown",
  "unbranded",
]);

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function stripHtml(value: string | null | undefined) {
  return (value ?? "").replace(/<[^>]+>/g, " ");
}

function isUnavailableBrandValue(value: string | null | undefined) {
  const normalized = normalizeName(value ?? "");
  return !normalized || BRAND_UNAVAILABLE_VALUES.has(normalized);
}

function isAllowedSpecificValue(
  value: string | null | undefined,
  required: RequiredSpecificDefinition,
) {
  if (!value?.trim()) {
    return false;
  }

  if (!required.values || required.values.length === 0) {
    return true;
  }

  return required.values.some(
    (allowed) => normalizeName(allowed) === normalizeName(value),
  );
}

function isAllowedUnbrandedFallback(
  value: string | null | undefined,
  required: RequiredSpecificDefinition,
) {
  return (
    normalizeName(required.name) === "brand" &&
    normalizeName(value ?? "") === normalizeName(DEFAULT_BRAND) &&
    isAllowedSpecificValue(value, required)
  );
}

function readSpecificValue(specifics: ItemSpecificsRecord, name: string) {
  return readItemSpecificValue(specifics, [name]);
}

function hasUsableSpecificValue(
  specifics: ItemSpecificsRecord,
  name: string,
) {
  const value = readSpecificValue(specifics, name);
  if (!value?.trim()) {
    return false;
  }

  return normalizeName(name) !== "brand" || !isUnavailableBrandValue(value);
}

function upsertSpecific(
  specifics: ItemSpecificsRecord,
  added: ItemSpecificsRecord,
  name: string,
  value: string | null | undefined,
) {
  const normalizedValue = value?.trim();
  if (!normalizedValue) {
    return false;
  }

  specifics[name] = normalizedValue;
  added[name] = normalizedValue;
  return true;
}

function mergeDefaults(
  specifics: ItemSpecificsRecord,
  defaults: unknown,
) {
  const defaultSpecifics = normalizeItemSpecifics(defaults);

  for (const [name, value] of Object.entries(defaultSpecifics)) {
    if (!hasUsableSpecificValue(specifics, name)) {
      specifics[name] = value;
    }
  }
}

function buildSourceText(input: ResolveRequiredSpecificsInput, specifics: ItemSpecificsRecord) {
  const specificText = Object.entries(specifics)
    .filter(([key]) => !key.startsWith("_"))
    .map(([key, value]) => `${key}: ${value}`)
    .join(" ");

  return {
    title: input.title ?? "",
    category: input.categoryName ?? "",
    description: stripHtml(input.description),
    specifics: specificText,
    all: [
      input.title,
      input.categoryName,
      stripHtml(input.description),
      specificText,
    ].filter(Boolean).join(" "),
  };
}

function inferBrand(input: ResolveRequiredSpecificsInput, specifics: ItemSpecificsRecord, values?: string[]) {
  const inferred = inferBrandItemSpecific({
    itemSpecifics: specifics,
    brand: input.brand,
    title: input.title,
    allowedValues: values,
  });

  if (inferred) {
    return { value: inferred, source: "amazon" as const };
  }

  const unbranded = matchAllowedSpecificValue(DEFAULT_BRAND, values);
  if (unbranded) {
    return { value: unbranded, source: "ebay_allowed_default" as const };
  }

  return { value: null, source: "missing" as const };
}

function inferPartNumber(specifics: ItemSpecificsRecord, aspectName: string) {
  const candidates = [
    aspectName,
    "Manufacturer Part Number",
    "Part Number",
    "Model Number",
    "Model name",
    "Model Name",
    "Item model number",
    "Model",
    "MPN",
  ];

  for (const candidate of candidates) {
    const value = readItemSpecificValue(specifics, [candidate]);
    if (value && normalizeName(value) !== normalizeName(DEFAULT_MPN)) {
      return value;
    }
  }

  return DEFAULT_MPN;
}

function inferSizeSource(
  value: string,
  values: string[] | undefined,
  text: ReturnType<typeof buildSourceText>,
): RequiredSpecificSource {
  const normalizedValue = normalizeName(value);
  if (values?.some((allowed) => normalizeName(allowed) === normalizedValue)) {
    if (
      ["one size", "one size fits all", "universal", "standard", "regular"].includes(
        normalizedValue,
      ) &&
      !new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(
        text.all,
      )
    ) {
      return "ebay_allowed_default";
    }
  }

  if (value && text.title.toLowerCase().includes(value.toLowerCase())) {
    return "title";
  }

  return "amazon";
}

function inferCompatibleBrand(
  input: ResolveRequiredSpecificsInput,
  specifics: ItemSpecificsRecord,
  allowedValues?: string[],
) {
  // Keep the raw Amazon brand for fallback matching. Passing allowedValues here
  // would discard brands that eBay only exposes as a "For [Brand]" option.
  const brandValue =
    inferBrandItemSpecific({
      itemSpecifics: specifics,
      brand: input.brand,
      title: input.title,
    }) ??
    readItemSpecificValue(specifics, ["Compatible Brand"]);

  const matched = matchAllowedSpecificValue(brandValue, allowedValues);

  if (matched && !isUnavailableBrandValue(matched)) {
    return { value: matched, source: "amazon" as const };
  }

  if (input.title && allowedValues && allowedValues.length > 0) {
    const titleText = normalizeName(
      input.title.replace(/[()[\]{};:,.]+/g, " "),
    );

    for (const value of allowedValues) {
      const normalizedValue = normalizeName(value).replace(
        /^(?:for|compatible with)\s+/,
        "",
      );

      if (
        normalizedValue.length >= 3 &&
        !isUnavailableBrandValue(value) &&
        titleText.includes(normalizedValue)
      ) {
        return { value, source: "title" as const };
      }
    }
  }

  if (brandValue && allowedValues && allowedValues.length > 0) {
    const forBrand = `for ${normalizeName(brandValue)}`;
    const prefixedBrand = allowedValues.find(
      (value) => normalizeName(value) === forBrand,
    );

    if (prefixedBrand && !isUnavailableBrandValue(prefixedBrand)) {
      return { value: prefixedBrand, source: "amazon" as const };
    }
  }

  const universal =
    allowedValues && allowedValues.length > 0
      ? matchAllowedSpecificValue("Universal", allowedValues)
      : null;
  if (universal) {
    return {
      value: universal,
      source: "ebay_allowed_default" as const,
    };
  }

  return { value: null, source: "missing" as const };
}

function inferCompatibleModel(
  input: ResolveRequiredSpecificsInput,
  specifics: ItemSpecificsRecord,
  allowedValues: string[] | undefined,
  text: ReturnType<typeof buildSourceText>,
) {
  const directCandidates = [
    readItemSpecificValue(specifics, [
      "Compatible Model",
      "Compatible Models",
      "Compatible Devices",
      "Fits Model",
      "Fit Type",
    ]),
    readItemSpecificValue(specifics, [
      "Model",
      "Model Number",
      "Item Model Number",
      "Model Name",
    ]),
  ];

  for (const candidate of directCandidates) {
    if (!candidate) {
      continue;
    }
    if (!allowedValues || allowedValues.length === 0) {
      return { value: candidate, source: "amazon" as const };
    }
    const matched = matchAllowedSpecificValue(candidate, allowedValues);
    if (matched) {
      return { value: matched, source: "amazon" as const };
    }
  }

  // Try building a "For [Brand] [Model]" pattern from brand and model
  const productBrand = input.brand?.trim();
  const productModel = readItemSpecificValue(specifics, [
    "Model",
    "Model Number",
    "Item Model Number",
    "Model Name",
  ]);
  if (productBrand && productModel && allowedValues && allowedValues.length > 0) {
    const forPattern = `For ${productBrand} ${productModel}`;
    const matched = matchAllowedSpecificValue(forPattern, allowedValues);
    if (matched) {
      return { value: matched, source: "amazon" as const };
    }
  }

  if (allowedValues && allowedValues.length > 0) {
    const searchText = [text.title, text.category, text.specifics]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/[()[\]{};:,.]+/g, " ");

    for (const value of allowedValues) {
      const normalizedValue = value
        .trim()
        .toLowerCase()
        .replace(/^(?:for|compatible with|fits)\s+/, "");

      if (
        normalizedValue.length >= 3 &&
        searchText.includes(normalizedValue)
      ) {
        return { value, source: "title" as const };
      }
    }

    const universal = matchAllowedSpecificValue("Universal", allowedValues);
    if (universal) {
      return {
        value: universal,
        source: "ebay_allowed_default" as const,
      };
    }

    const doesNotApply =
      matchAllowedSpecificValue("Does Not Apply", allowedValues) ??
      matchAllowedSpecificValue("Not Applicable", allowedValues);
    if (doesNotApply) {
      return {
        value: doesNotApply,
        source: "ebay_allowed_default" as const,
      };
    }
  }

  return { value: null, source: "missing" as const };
}

function inferModel(
  input: ResolveRequiredSpecificsInput,
  specifics: ItemSpecificsRecord,
  allowedValues: string[] | undefined,
  text: ReturnType<typeof buildSourceText>,
) {
  const directCandidates = [
    readItemSpecificValue(specifics, [
      "Model",
      "Model Number",
      "Item Model Number",
      "Model Name",
      "Item Part Number",
      "Part Number",
    ]),
  ];

  for (const candidate of directCandidates) {
    if (!candidate) {
      continue;
    }

    if (!allowedValues || allowedValues.length === 0) {
      return { value: candidate, source: "amazon" as const };
    }

    const matched = matchAllowedSpecificValue(candidate, allowedValues);
    if (matched) {
      return { value: matched, source: "amazon" as const };
    }
  }

  if (allowedValues && allowedValues.length > 0) {
    const searchText = [text.title, text.category, text.specifics]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/[()[]{};:,.]+/g, " ");

    for (const value of allowedValues) {
      if (
        value.trim().length >= 3 &&
        searchText.includes(value.toLowerCase())
      ) {
        return { value, source: "title" as const };
      }
    }
  }

  return { value: null, source: "missing" as const };
}

function inferRequiredSpecific(
  input: ResolveRequiredSpecificsInput,
  specifics: ItemSpecificsRecord,
  required: RequiredSpecificDefinition,
) {
  const aspectName = required.name;
  const normalized = normalizeName(aspectName);
  const text = buildSourceText(input, specifics);

  if (normalized === "brand") {
    return inferBrand(input, specifics, required.values);
  }

  if (normalized === "type") {
    const value = inferTypeItemSpecific({
      title: input.title,
      categoryName: input.categoryName,
      itemSpecifics: specifics,
      allowedValues: required.values,
    });

    return {
      value,
      source: value
        ? text.title.toLowerCase().includes(value.toLowerCase())
          ? "title"
          : "category"
        : "missing",
    } as const;
  }

  if (normalized === "size" || normalized === "item size") {
    const value = inferSizeItemSpecific({
      title: input.title,
      categoryName: input.categoryName,
      itemSpecifics: specifics,
      allowedValues: required.values,
    });

    return {
      value,
      source: value ? inferSizeSource(value, required.values, text) : "missing",
    } as const;
  }

  if (normalized === "volume" || normalized === "capacity") {
    const value = inferVolumeItemSpecific(
      input.title,
      input.categoryName,
      input.description,
      text.specifics,
    );
    return { value, source: value ? "amazon" : "missing" } as const;
  }

  if (normalized === "mpn" || normalized === "manufacturer part number") {
    return {
      value: inferPartNumber(specifics, aspectName),
      source: "amazon",
    } as const;
  }

  if (normalized === "compatible brand") {
    return inferCompatibleBrand(input, specifics, required.values);
  }

  if (normalized === "model") {
    return inferModel(input, specifics, required.values, text);
  }

  if (normalized === "compatible model") {
    return inferCompatibleModel(input, specifics, required.values, text);
  }

  // Generic fallback: try to match any allowed value from Amazon data or title/description
  return inferGenericAspect(specifics, required.values, text);
}

function inferGenericAspect(
  specifics: ItemSpecificsRecord,
  allowedValues: string[] | undefined,
  text: ReturnType<typeof buildSourceText>,
) {
  if (!allowedValues || allowedValues.length === 0) {
    return { value: null, source: "missing" as const };
  }

  // 1. Check if any Amazon item specific value matches an allowed value
  for (const [, specificValue] of Object.entries(specifics)) {
    if (!specificValue?.trim()) {
      continue;
    }
    const matched = matchAllowedSpecificValue(specificValue, allowedValues);
    if (matched) {
      return { value: matched, source: "amazon" as const };
    }
  }

  // 2. Scan title + category + description for any allowed value substring
  const searchText = text.all.toLowerCase().replace(/[()[\]{};:,.]+/g, " ");
  for (const value of allowedValues) {
    const normalizedValue = value.trim().toLowerCase();
    if (normalizedValue.length >= 3 && searchText.includes(normalizedValue)) {
      return { value, source: "title" as const };
    }
  }

  return { value: null, source: "missing" as const };
}

export function resolveRequiredItemSpecifics(
  input: ResolveRequiredSpecificsInput,
): ResolveRequiredSpecificsResult {
  const specifics = normalizeItemSpecifics(input.itemSpecifics);
  const addedItemSpecifics: ItemSpecificsRecord = {};
  const decisions: RequiredSpecificDecision[] = [];

  mergeDefaults(specifics, input.supplierDefaultItemSpecifics);

  for (const required of input.requiredItemSpecifics) {
    const hasValue = hasUsableSpecificValue(specifics, required.name);
    const existingValue = readSpecificValue(specifics, required.name);
    let isValueAllowed = true;

    if (hasValue && existingValue) {
      isValueAllowed = isAllowedSpecificValue(existingValue, required);
    }

    if (hasValue && isValueAllowed) {
      decisions.push({
        name: required.name,
        value: existingValue,
        source: "user",
      });
      continue;
    }

    // Try to map existing invalid value to allowed values
    let mappedValue: string | null = null;
    if (hasValue && existingValue && required.values && required.values.length > 0) {
      mappedValue = matchAllowedSpecificValue(existingValue, required.values);
    }

    if (mappedValue) {
      upsertSpecific(specifics, addedItemSpecifics, required.name, mappedValue);
      decisions.push({
        name: required.name,
        value: mappedValue,
        source: "amazon",
      });
      continue;
    }

    // Run full inference
    const inferred = inferRequiredSpecific(input, specifics, required);
    if (inferred.value) {
      upsertSpecific(specifics, addedItemSpecifics, required.name, inferred.value);
    }

    decisions.push({
      name: required.name,
      value: inferred.value,
      source: inferred.value ? inferred.source : "missing",
    });
  }

  const missingItemSpecifics = input.requiredItemSpecifics
    .filter((required) => {
      const val = readSpecificValue(specifics, required.name);
      if (!val?.trim()) {
        return true;
      }

      if (normalizeName(required.name) === "brand" && isUnavailableBrandValue(val)) {
        return !isAllowedUnbrandedFallback(val, required);
      }

      return !isAllowedSpecificValue(val, required);
    })
    .map((required) => required.name);

  return {
    itemSpecifics: specifics,
    addedItemSpecifics,
    missingItemSpecifics,
    decisions,
  };
}
