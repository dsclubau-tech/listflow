import {
  type PackageDimensions,
  fillMissingPackageDimensionItemSpecifics,
} from "@/lib/amazon-package-dimensions";

type EbayNode = Record<string, unknown>;

function isNode(value: unknown): value is EbayNode {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function readText(node: EbayNode, name: string) {
  const value = firstValue(node[name]);
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function readNonNegativeNumber(node: EbayNode, name: string) {
  const value = Number(readText(node, name));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function readPositiveNumber(node: EbayNode, name: string) {
  const value = readNonNegativeNumber(node, name);
  return value !== null && value > 0 ? value : null;
}

function round(value: number, decimals = 2) {
  const multiplier = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function getShippingPackageNode(source: unknown): EbayNode | null {
  if (!isNode(source)) {
    return null;
  }

  const direct = firstValue(source.ShippingPackageDetails);
  if (isNode(direct)) {
    return direct;
  }

  return "PackageLength" in source ||
    "PackageWidth" in source ||
    "PackageDepth" in source ||
    "WeightMajor" in source ||
    "WeightMinor" in source
    ? source
    : null;
}

/**
 * Converts an eBay Trading API ShippingPackageDetails object to ListFlow's
 * internal metric package fields. The result is safe to store inside
 * Product.itemSpecifics because all values are hidden by their `_` prefix.
 */
export function extractEbayPackageDimensions(source: unknown): PackageDimensions | null {
  const details = getShippingPackageNode(source);
  if (!details) {
    return null;
  }

  const measurementUnit = readText(details, "MeasurementUnit").toLowerCase();
  const isEnglish = measurementUnit === "english";
  const convertedUnits: string[] = [];
  const result: PackageDimensions = { convertedUnits };

  const weightMajor = readNonNegativeNumber(details, "WeightMajor");
  const weightMinor = readNonNegativeNumber(details, "WeightMinor");
  if ((weightMajor ?? 0) > 0 || (weightMinor ?? 0) > 0) {
    const totalGrams = isEnglish
      ? (weightMajor ?? 0) * 453.59237 + (weightMinor ?? 0) * 28.349523125
      : (weightMajor ?? 0) * 1000 + (weightMinor ?? 0);
    const roundedGrams = Math.max(1, Math.ceil(totalGrams));
    result.weightKg = Math.floor(roundedGrams / 1000);
    result.weightG = roundedGrams % 1000;

    if (isEnglish) {
      convertedUnits.push("lb", "oz");
    }
  }

  const length = readPositiveNumber(details, "PackageLength");
  const width = readPositiveNumber(details, "PackageWidth");
  const height = readPositiveNumber(details, "PackageDepth");
  if (length !== null && width !== null && height !== null) {
    const multiplier = isEnglish ? 2.54 : 1;
    result.lengthCm = round(length * multiplier);
    result.widthCm = round(width * multiplier);
    result.heightCm = round(height * multiplier);

    if (isEnglish) {
      convertedUnits.push("in");
    }
  }

  return result.weightKg !== undefined || result.lengthCm !== undefined
    ? result
    : null;
}

export function fillMissingEbayPackageItemSpecifics(
  itemSpecifics: Record<string, string>,
  source: unknown,
) {
  return fillMissingPackageDimensionItemSpecifics(
    itemSpecifics,
    extractEbayPackageDimensions(source),
  );
}
