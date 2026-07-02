export const DEFAULT_MPN = "Does not apply";
export const DEFAULT_MODEL = "Does not apply";
export const DEFAULT_BRAND = "Unbranded";
export const DEFAULT_PRODUCT_IDENTIFIER = "Does not apply";

const EBAY_ITEM_SPECIFIC_VALUE_MAX_LENGTH = 65;
export const EBAY_LISTING_ITEM_SPECIFIC_MAX_COUNT = 30;

const HIGH_PRIORITY_ITEM_SPECIFICS = [
  "Brand",
  "Type",
  "MPN",
  "Model",
  "Colour",
  "Color",
  "Size",
  "Material",
  "Item Length",
  "Item Width",
  "Item Height",
  "Item Weight",
  "Volume",
  "Capacity",
  "Features",
  "Compatible Brand",
  "Compatible Model",
  "Connectivity",
  "Power Source",
  "Voltage",
  "Wattage",
  "Number of Items",
  "Style",
  "Pattern",
  "Shape",
  "Finish",
  "Room",
  "Department",
] as const;

const LOW_VALUE_ITEM_SPECIFICS = new Set([
  "asin",
  "best sellers rank",
  "batteries",
  "batteries included",
  "batteries required",
  "country of origin",
  "customer reviews",
  "date first available",
  "ean",
  "gtin",
  "is discontinued by manufacturer",
  "isbn",
  "manufacturer",
  "upc",
]);

const PRODUCT_IDENTIFIER_SPECIFICS = new Set(["upc", "ean", "isbn", "gtin"]);
const PRODUCT_IDENTIFIER_UNAVAILABLE_VALUES = new Set([
  "does not apply",
  "n/a",
  "na",
  "none",
  "not applicable",
  "unknown",
]);

const ITEM_SPECIFIC_PRIORITY = new Map(
  HIGH_PRIORITY_ITEM_SPECIFICS.map((name, index) => [
    name.trim().toLowerCase(),
    index,
  ]),
);

export type ItemSpecificsRecord = Record<string, string>;

function hasItemSpecific(specifics: ItemSpecificsRecord, name: string) {
  const normalizedName = name.trim().toLowerCase();
  return Object.keys(specifics).some(
    (key) => key.trim().toLowerCase() === normalizedName
  );
}

function getItemSpecificValue(specifics: ItemSpecificsRecord, names: string[]) {
  const normalizedNames = new Set(names.map((name) => name.trim().toLowerCase()));

  for (const [key, value] of Object.entries(specifics)) {
    if (normalizedNames.has(key.trim().toLowerCase())) {
      return value;
    }
  }

  return null;
}

export function hasItemSpecificValue(value: unknown, name: string) {
  return hasItemSpecific(normalizeItemSpecifics(value), name);
}

export function readItemSpecificValue(value: unknown, names: string[]) {
  return getItemSpecificValue(normalizeItemSpecifics(value), names);
}

function normalizeMissingSpecificName(value: string) {
  return value
    .replace(/^the item specific\s+/i, "")
    .replace(/\s+is missing\.?$/i, "")
    .replace(/^add\s+/i, "")
    .replace(/\s+to this listing.*$/i, "")
    .replace(/[.:]+$/g, "")
    .trim();
}

export function parseMissingItemSpecificNames(message: string | null | undefined) {
  if (!message) {
    return [] as string[];
  }

  const names: string[] = [];
  const patterns = [
    /item specific\s+["']?([^"';.]+?)["']?\s+is missing/gi,
    /add\s+["']?([^"';.]+?)["']?\s+to this listing/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(message)) !== null) {
      const name = normalizeMissingSpecificName(match[1] ?? "");
      if (name) {
        names.push(name);
      }
    }
  }

  for (const part of message.split(";")) {
    const name = normalizeMissingSpecificName(part);
    if (
      name &&
      name.length <= 40 &&
      /^[A-Za-z][A-Za-z0-9 /&().-]*$/.test(name) &&
      !/\s/.test(name.trim()) &&
      /missing|add|;\s*$/i.test(message)
    ) {
      names.push(name);
    }
  }

  const seen = new Set<string>();
  return names.filter((name) => {
    const normalized = normalizeSpecificName(name);
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function formatNumber(value: string) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return Number.isInteger(parsed) ? String(parsed) : String(parsed).replace(/0+$/g, "").replace(/\.$/, "");
}

export function inferVolumeItemSpecific(...texts: Array<string | null | undefined>) {
  const text = texts.filter(Boolean).join(" ");

  const metricMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re)s?)\b/i);
  if (metricMatch) {
    return `${formatNumber(metricMatch[1])} ml`;
  }

  const litreMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(l|lit(?:er|re)s?)\b/i);
  if (litreMatch) {
    return `${formatNumber(litreMatch[1])} L`;
  }

  const ounceMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(?:fl\s*)?(oz|ounces?)\b/i);
  if (ounceMatch) {
    return `${formatNumber(ounceMatch[1])} oz`;
  }

  return null;
}

function normalizeSpecificValue(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function matchAllowedSpecificValue(
  candidate: string | null | undefined,
  allowedValues?: string[]
) {
  const normalizedCandidate = normalizeSpecificValue(candidate ?? "");
  if (!normalizedCandidate) {
    return null;
  }

  if (!allowedValues || allowedValues.length === 0) {
    return candidate?.trim() || null;
  }

  for (const value of allowedValues) {
    if (normalizeSpecificValue(value) === normalizedCandidate) {
      return value;
    }
  }

  for (const value of allowedValues) {
    const normalizedAllowed = normalizeSpecificValue(value);
    if (
      normalizedAllowed.length >= 3 &&
      (normalizedCandidate.includes(normalizedAllowed) ||
        normalizedAllowed.includes(normalizedCandidate))
    ) {
      return value;
    }
  }

  return null;
}

export function inferTypeItemSpecific(input: {
  title?: string | null;
  categoryName?: string | null;
  itemSpecifics?: unknown;
  allowedValues?: string[];
}) {
  const specifics = normalizeItemSpecifics(input.itemSpecifics);
  const directCandidates = [
    readItemSpecificValue(specifics, ["Type", "Product Type", "Item Type"]),
    readItemSpecificValue(specifics, ["Lens Type", "Lens"]),
    readItemSpecificValue(specifics, ["Style"]),
  ];

  for (const candidate of directCandidates) {
    const matched = matchAllowedSpecificValue(candidate, input.allowedValues);
    if (matched) {
      return matched;
    }
  }

  const text = [
    input.title,
    input.categoryName,
    ...Object.entries(specifics).map(([key, value]) => `${key}: ${value}`),
  ]
    .filter(Boolean)
    .join(" ");

  const patternCandidates: Array<{ value: string; patterns: RegExp[] }> = [
    {
      value: "Telephoto",
      patterns: [/\btelephoto\b/i],
    },
    {
      value: "Wide Angle",
      patterns: [/\bwide[-\s]?angle\b/i],
    },
    {
      value: "Macro",
      patterns: [/\bmacro\b/i],
    },
    {
      value: "Fisheye",
      patterns: [/\bfish[-\s]?eye\b/i],
    },
    {
      value: "Zoom Lens",
      patterns: [/\bzoom\s+lens\b/i],
    },
    {
      value: "Prime Lens",
      patterns: [/\bprime\s+lens\b/i, /\bfixed\s+focal\b/i],
    },
    {
      value: "Camera Lens",
      patterns: [/\bcamera\s+lens\b/i, /\blens\b/i],
    },
    {
      value: "Water Bottle",
      patterns: [/\bwater\s+bottle\b/i],
    },
    {
      value: "Phone Case",
      patterns: [/\bphone\s+case\b/i, /\b(?:iphone|galaxy|samsung)\b.*\bcase\b/i],
    },
    {
      value: "Hair Clippers",
      patterns: [/\bhair\s+clippers?\b/i],
    },
    {
      value: "Tile Cutter",
      patterns: [/\btile\s+cutter\b/i],
    },
    {
      value: "Controller",
      patterns: [/\bcontroller\b/i],
    },
  ];

  for (const candidate of patternCandidates) {
    if (!candidate.patterns.some((pattern) => pattern.test(text))) {
      continue;
    }

    const matched = matchAllowedSpecificValue(candidate.value, input.allowedValues);
    if (matched) {
      return matched;
    }
  }

  return null;
}

function normalizeSpecificName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function isLowValueSpecificName(name: string) {
  return LOW_VALUE_ITEM_SPECIFICS.has(normalizeSpecificName(name));
}

function isProductIdentifierSpecificName(name: string) {
  return PRODUCT_IDENTIFIER_SPECIFICS.has(normalizeSpecificName(name));
}

function getNumericIdentifierCandidates(value: string) {
  const splitCandidates = value
    .split(/[^0-9]+/)
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const compactWholeValue = value.replace(/\D/g, "");

  return Array.from(
    new Set([...splitCandidates, compactWholeValue].filter(Boolean)),
  );
}

function getIsbnIdentifierCandidates(value: string) {
  const splitCandidates = value
    .split(/[^0-9Xx]+/)
    .map((candidate) => candidate.trim().toUpperCase())
    .filter(Boolean);
  const compactWholeValue = value.replace(/[^0-9Xx]/g, "").toUpperCase();

  return Array.from(
    new Set([...splitCandidates, compactWholeValue].filter(Boolean)),
  );
}

function isValidProductIdentifierCandidate(
  normalizedName: string,
  candidate: string,
) {
  if (normalizedName === "upc") {
    return /^\d{12}$/.test(candidate);
  }

  if (normalizedName === "ean") {
    return /^\d{8}$/.test(candidate) || /^\d{13}$/.test(candidate);
  }

  if (normalizedName === "isbn") {
    return /^\d{9}[\dX]$/.test(candidate) || /^\d{13}$/.test(candidate);
  }

  return /^\d{8}$/.test(candidate) ||
    /^\d{12}$/.test(candidate) ||
    /^\d{13}$/.test(candidate) ||
    /^\d{14}$/.test(candidate);
}

function normalizeProductIdentifierValue(name: string, value: string) {
  const normalizedName = normalizeSpecificName(name);
  if (!PRODUCT_IDENTIFIER_SPECIFICS.has(normalizedName)) {
    return null;
  }

  const normalizedValue = value.trim().replace(/\s+/g, " ");
  if (
    PRODUCT_IDENTIFIER_UNAVAILABLE_VALUES.has(normalizedValue.toLowerCase())
  ) {
    return DEFAULT_PRODUCT_IDENTIFIER;
  }

  const candidates = normalizedName === "isbn"
    ? getIsbnIdentifierCandidates(normalizedValue)
    : getNumericIdentifierCandidates(normalizedValue);
  const validCandidate = candidates.find((candidate) =>
    isValidProductIdentifierCandidate(normalizedName, candidate)
  );

  return validCandidate ?? DEFAULT_PRODUCT_IDENTIFIER;
}

function truncateItemSpecificValue(value: string) {
  if (value.length <= EBAY_ITEM_SPECIFIC_VALUE_MAX_LENGTH) {
    return value;
  }

  const hardLimit = value.slice(0, EBAY_ITEM_SPECIFIC_VALUE_MAX_LENGTH).trim();
  const lastSeparator = Math.max(
    hardLimit.lastIndexOf(","),
    hardLimit.lastIndexOf(";"),
    hardLimit.lastIndexOf("/")
  );

  if (lastSeparator >= 20) {
    return hardLimit.slice(0, lastSeparator).trim();
  }

  const lastSpace = hardLimit.lastIndexOf(" ");
  if (lastSpace >= 20) {
    return hardLimit.slice(0, lastSpace).trim();
  }

  return hardLimit;
}

export function normalizeItemSpecifics(value: unknown): ItemSpecificsRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const specifics: ItemSpecificsRecord = {};

  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.trim();
    if (!normalizedKey || rawValue === null || rawValue === undefined) {
      continue;
    }

    const normalizedValue =
      typeof rawValue === "string" ? rawValue.trim() : String(rawValue).trim();
    if (!normalizedValue) {
      continue;
    }

    specifics[normalizedKey] = normalizedValue;
  }

  return specifics;
}

export function ensureMpnItemSpecifics(value: unknown): ItemSpecificsRecord {
  const specifics = normalizeItemSpecifics(value);

  if (!hasItemSpecific(specifics, "MPN")) {
    specifics.MPN = DEFAULT_MPN;
  }

  return specifics;
}

export function sanitizeEbayItemSpecifics(value: unknown): ItemSpecificsRecord {
  const specifics = ensureMpnItemSpecifics(value);
  const model =
    getItemSpecificValue(specifics, ["Model", "Model Number", "Item Model Number"]) ||
    DEFAULT_MODEL;

  if (!hasItemSpecific(specifics, "Model")) {
    specifics.Model = model;
  }

  if (!hasItemSpecific(specifics, "Brand")) {
    specifics.Brand = DEFAULT_BRAND;
  }

  const sanitized: ItemSpecificsRecord = {};

  for (const [rawKey, rawValue] of Object.entries(specifics)) {
    const key = rawKey.trim();
    const value = rawValue.trim().replace(/\s+/g, " ");

    if (!key || !value) {
      continue;
    }

    const productIdentifierValue = isProductIdentifierSpecificName(key)
      ? normalizeProductIdentifierValue(key, value)
      : null;

    sanitized[key] = key.startsWith("_")
      ? value
      : productIdentifierValue ?? truncateItemSpecificValue(value);
  }

  return sanitized;
}

export function getEbayProductUpc(value: unknown): string {
  const specifics = sanitizeEbayItemSpecifics(value);
  const upc = getItemSpecificValue(specifics, ["UPC"]);

  if (
    upc &&
    upc !== DEFAULT_PRODUCT_IDENTIFIER &&
    isValidProductIdentifierCandidate("upc", upc)
  ) {
    return upc;
  }

  return DEFAULT_PRODUCT_IDENTIFIER;
}

export function getListingItemSpecifics(
  value: unknown,
  defaultType: string,
  maxCount = EBAY_LISTING_ITEM_SPECIFIC_MAX_COUNT,
): ItemSpecificsRecord {
  const specifics = sanitizeEbayItemSpecifics(value);

  if (!hasItemSpecific(specifics, "Type")) {
    specifics.Type = defaultType || "Other";
  }

  const seen = new Set<string>();
  const entries = Object.entries(specifics)
    .map(([rawKey, rawValue], originalIndex) => ({
      key: rawKey.trim(),
      value: rawValue.trim(),
      originalIndex,
    }))
    .filter(({ key, value }) => {
      if (!key || !value || key.startsWith("_") || isLowValueSpecificName(key)) {
        return false;
      }

      const normalizedName = normalizeSpecificName(key);
      if (seen.has(normalizedName)) {
        return false;
      }

      seen.add(normalizedName);
      return true;
    })
    .sort((a, b) => {
      const aPriority =
        ITEM_SPECIFIC_PRIORITY.get(normalizeSpecificName(a.key)) ?? 1000;
      const bPriority =
        ITEM_SPECIFIC_PRIORITY.get(normalizeSpecificName(b.key)) ?? 1000;

      return aPriority - bPriority || a.originalIndex - b.originalIndex;
    })
    .slice(0, Math.max(1, maxCount));

  return Object.fromEntries(entries.map(({ key, value }) => [key, value]));
}
