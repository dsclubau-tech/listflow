export type PackageDimensions = {
  weightKg?: number;
  weightG?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  convertedUnits: string[];
};

type ParsedWeight = {
  totalGrams: number;
  convertedUnits: string[];
};

type ParsedDimensions = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  convertedUnits: string[];
};

const WEIGHT_KEYS = new Set([
  "item weight",
  "package weight",
  "weight",
  "shipping weight",
  "item package weight",
]);

const DIMENSION_KEYS = new Set([
  "product dimensions",
  "item dimensions",
  "dimensions",
  "package dimensions",
  "item dimensions l x w x h",
  "item dimensions d x w x h",
  "item dimensions lxwxh",
  "item dimensions  lxwxh",
  "item package dimensions l x w x h",
  "item package dimensions lxwxh",
]);

function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[×*]/g, "x")
    .replace(/\s+/g, " ")
    .replace(/\s*[:\-]\s*$/, "")
    .trim();
}

function round(value: number, decimals = 2) {
  const multiplier = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(round(value));
}

function isFinitePositive(value: number) {
  return Number.isFinite(value) && value > 0;
}

function parseNumericValue(value: string) {
  const normalized = value.replace(/,/g, "");
  const parsed = Number.parseFloat(normalized);
  return isFinitePositive(parsed) ? parsed : null;
}

export function parsePackageWeight(raw: string): ParsedWeight | null {
  const match = raw
    .replace(/\u00a0/g, " ")
    .match(/(\d+(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(kg|kilograms?|g|grams?|lb|lbs|pounds?|oz|ounces?)\b/i);

  if (!match) {
    return null;
  }

  const value = parseNumericValue(match[1]);
  if (value === null) {
    return null;
  }

  const unit = match[2].toLowerCase();
  const convertedUnits: string[] = [];
  let totalGrams: number;

  if (unit === "kg" || unit.startsWith("kilogram")) {
    totalGrams = value * 1000;
  } else if (unit === "g" || unit.startsWith("gram")) {
    totalGrams = value;
  } else if (unit === "oz" || unit.startsWith("ounce")) {
    totalGrams = value * 28.349523125;
    convertedUnits.push("oz");
  } else {
    totalGrams = value * 453.59237;
    convertedUnits.push("lb");
  }

  return {
    totalGrams: round(totalGrams, 3),
    convertedUnits,
  };
}

export function parsePackageDimensionValue(raw: string): ParsedDimensions | null {
  const normalized = raw.replace(/\u00a0/g, " ").replace(/[×*]/g, "x");
  const match = normalized.match(
    /(\d+(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:[ldwh]\s*)?(cm|centimetres?|centimeters?|mm|millimetres?|millimeters?|m|metres?|meters?|in|inch|inches|["”])?\s*(?:x|by)\s*(\d+(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:[ldwh]\s*)?(cm|centimetres?|centimeters?|mm|millimetres?|millimeters?|m|metres?|meters?|in|inch|inches|["”])?\s*(?:x|by)\s*(\d+(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*(?:[ldwh]\s*)?)\s*(cm|centimetres?|centimeters?|mm|millimetres?|millimeters?|m|metres?|meters?|in|inch|inches|["”])?\b/i,
  );

  if (!match) {
    return null;
  }

  const values = [match[1], match[3], match[5]].map(parseNumericValue);
  if (values.some((value) => value === null)) {
    return null;
  }

  const unit = (match[2] ?? match[4] ?? match[6] ?? "cm").toLowerCase();
  const convertedUnits: string[] = [];
  let multiplier = 1;

  if (unit === "mm" || unit.startsWith("millimet")) {
    multiplier = 0.1;
  } else if (unit === "m" || unit.startsWith("met")) {
    multiplier = 100;
  } else if (
    unit === "in" ||
    unit === "inch" ||
    unit === "inches" ||
    unit === "\"" ||
    unit === "”"
  ) {
    multiplier = 2.54;
    convertedUnits.push("in");
  }

  const [length, width, height] = values as [number, number, number];
  return {
    lengthCm: round(length * multiplier),
    widthCm: round(width * multiplier),
    heightCm: round(height * multiplier),
    convertedUnits,
  };
}

function parseInlineWeightFromDimensionValue(raw: string): ParsedWeight | null {
  const parts = raw
    .split(/[;|]/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts.slice(1)) {
    const weight = parsePackageWeight(part);
    if (weight) {
      return weight;
    }
  }

  return null;
}

export function extractPackageDimensions(
  itemSpecifics: Record<string, string>,
): PackageDimensions | null {
  const convertedUnits = new Set<string>();
  let weight: ParsedWeight | null = null;
  let dimensions: ParsedDimensions | null = null;

  for (const [rawKey, rawValue] of Object.entries(itemSpecifics)) {
    const key = normalizeKey(rawKey);
    const value = rawValue.trim();

    if (!value) {
      continue;
    }

    if (!weight && WEIGHT_KEYS.has(key)) {
      weight = parsePackageWeight(value);
      weight?.convertedUnits.forEach((unit) => convertedUnits.add(unit));
    }

    if (!dimensions && DIMENSION_KEYS.has(key)) {
      dimensions = parsePackageDimensionValue(value);
      dimensions?.convertedUnits.forEach((unit) => convertedUnits.add(unit));

      if (!weight) {
        weight = parseInlineWeightFromDimensionValue(value);
        weight?.convertedUnits.forEach((unit) => convertedUnits.add(unit));
      }
    }
  }

  if (!weight && !dimensions) {
    return null;
  }

  const result: PackageDimensions = {
    convertedUnits: Array.from(convertedUnits),
  };

  if (weight) {
    const totalGrams = Math.max(1, Math.ceil(weight.totalGrams));
    result.weightKg = Math.floor(totalGrams / 1000);
    result.weightG = totalGrams % 1000;
  }

  if (dimensions) {
    result.lengthCm = dimensions.lengthCm;
    result.widthCm = dimensions.widthCm;
    result.heightCm = dimensions.heightCm;
  }

  return result;
}

export function addPackageDimensionItemSpecifics(
  itemSpecifics: Record<string, string>,
  dimensions: PackageDimensions | null,
) {
  if (!dimensions) {
    return itemSpecifics;
  }

  const next = { ...itemSpecifics };

  if (dimensions.weightKg !== undefined) {
    next._WeightKg = formatNumber(dimensions.weightKg);
  }

  if (dimensions.weightG !== undefined) {
    next._WeightG = formatNumber(dimensions.weightG);
  }

  if (dimensions.lengthCm !== undefined) {
    next._LengthCm = formatNumber(dimensions.lengthCm);
  }

  if (dimensions.widthCm !== undefined) {
    next._WidthCm = formatNumber(dimensions.widthCm);
  }

  if (dimensions.heightCm !== undefined) {
    next._HeightCm = formatNumber(dimensions.heightCm);
  }

  return next;
}

export function applyPackageDimensionItemSpecifics(
  itemSpecifics: Record<string, string>,
) {
  const dimensions = extractPackageDimensions(itemSpecifics);
  return addPackageDimensionItemSpecifics(itemSpecifics, dimensions);
}

export function logConvertedPackageDimensionUnits(
  source: string,
  dimensions: PackageDimensions | null,
) {
  if (!dimensions || dimensions.convertedUnits.length === 0) {
    return;
  }

  console.info(
    `[${source}] Converted Amazon package units to eBay AU units: ${dimensions.convertedUnits.join(", ")}`,
  );
}
