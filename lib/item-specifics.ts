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
  "Manufacturer Part Number",
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

const BRAND_UNAVAILABLE_VALUES = new Set([
  "does not apply",
  "n/a",
  "na",
  "none",
  "not applicable",
  "unknown",
  "unbranded",
]);

const ITEM_SPECIFIC_PRIORITY = new Map(
  HIGH_PRIORITY_ITEM_SPECIFICS.map((name, index) => [
    name.trim().toLowerCase(),
    index,
  ]),
);

const NOISY_ITEM_SPECIFIC_VALUE_PATTERNS = [
  /\bfunction\s*\(/i,
  /\bvar\s+[_$a-z][\w$]*\s*=/i,
  /\bwindow\./i,
  /\bP\.namespace\b/i,
  /\bP\._namespace\b/i,
  /\bDetailPageProductOverview\b/i,
  /\bDetailPageProductOverviewTemplates\b/i,
  /\bguardFatal\b/i,
  /\bue\.(?:count|tag|log)\b/i,
  /<\/?(?:script|style)\b/i,
];

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

function isUnavailableBrandValue(value: string | null | undefined) {
  const normalized = normalizeSpecificValue(value ?? "");
  return !normalized || BRAND_UNAVAILABLE_VALUES.has(normalized);
}

export function inferBrandItemSpecific(input: {
  itemSpecifics?: unknown;
  brand?: string | null;
  allowedValues?: string[];
}) {
  const specifics = normalizeItemSpecifics(input.itemSpecifics);
  const candidates = [
    input.brand,
    readItemSpecificValue(specifics, ["Brand"]),
    readItemSpecificValue(specifics, ["Brand Name"]),
    readItemSpecificValue(specifics, ["Manufacturer"]),
    readItemSpecificValue(specifics, ["Maker"]),
  ];

  for (const candidate of candidates) {
    if (isUnavailableBrandValue(candidate)) {
      continue;
    }

    const matched = matchAllowedSpecificValue(candidate, input.allowedValues);
    if (matched && !isUnavailableBrandValue(matched)) {
      return matched;
    }
  }

  return null;
}

function normalizeDimensionValue(value: string) {
  return value
    .replace(/[×]/g, "x")
    .replace(/\s*x\s*/gi, " x ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSpecificValue(value: string) {
  return value
    .trim()
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function matchAllowedSpecificValue(
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

  // 1. Exact Match
  for (const value of allowedValues) {
    if (normalizeSpecificValue(value) === normalizedCandidate) {
      return value;
    }
  }

  // 2. Substring Match
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

  // 3. Smart Token-based Match
  const stopwords = new Set([
    "for",
    "fit",
    "fits",
    "compatible",
    "with",
    "to",
    "devices",
    "device",
    "models",
    "model",
    "the",
    "and",
    "charging",
    "replacement",
    "universal",
    "standard",
    "original",
    "generic",
  ]);

  const getCleanTokens = (str: string) => {
    return str
      .toLowerCase()
      .replace(/\+/g, " plus ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !stopwords.has(t));
  };

  const candidateTokens = getCleanTokens(normalizedCandidate);
  if (candidateTokens.length === 0) {
    return null;
  }

  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const value of allowedValues) {
    const allowedTokens = getCleanTokens(value);
    const intersection = candidateTokens.filter((t) => allowedTokens.includes(t));

    if (intersection.length > 0) {
      // Calculate basic intersection score
      let score = intersection.length * 10;

      // Deduct points for mismatch of version qualifiers (pro, max, plus) to avoid matching "Dyson TP02" to "Dyson TP04"
      const hasProDifference =
        (candidateTokens.includes("pro") && !allowedTokens.includes("pro")) ||
        (!candidateTokens.includes("pro") && allowedTokens.includes("pro"));
      if (hasProDifference) {
        score -= 4;
      }

      const hasPlusDifference =
        (candidateTokens.includes("plus") && !allowedTokens.includes("plus")) ||
        (!candidateTokens.includes("plus") && allowedTokens.includes("plus"));
      if (hasPlusDifference) {
        score -= 4;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = value;
      }
    }
  }

  if (bestScore > 0) {
    return bestMatch;
  }

  return null;
}

const GENERIC_TYPE_FALLBACK_VALUES = new Set([
  "does not apply",
  "n/a",
  "na",
  "none",
  "not applicable",
  "not specified",
  "other",
  "unknown",
]);

function findAllowedTypeInText(text: string, allowedValues?: string[]) {
  if (!allowedValues || allowedValues.length === 0) {
    return null;
  }

  const normalizedText = normalizeSpecificValue(
    text.replace(/[()[\]{}:;,.]+/g, " ")
  );
  if (!normalizedText) {
    return null;
  }

  for (const value of allowedValues) {
    const normalizedAllowed = normalizeSpecificValue(value);
    if (
      normalizedAllowed.length < 3 ||
      GENERIC_TYPE_FALLBACK_VALUES.has(normalizedAllowed)
    ) {
      continue;
    }

    if (normalizedText.includes(normalizedAllowed)) {
      return value;
    }
  }

  return null;
}

function findGenericAllowedTypeFallback(allowedValues?: string[]) {
  if (!allowedValues || allowedValues.length === 0) {
    return null;
  }

  return (
    allowedValues.find((value) => normalizeSpecificValue(value) === "other") ??
    null
  );
}

function findAllowedSetCountSize(text: string, allowedValues?: string[]) {
  if (!allowedValues || allowedValues.length === 0) {
    return null;
  }

  const countMatches = Array.from(
    text.matchAll(/\b(\d+)\s*(?:pcs?|pieces?|pack|packs|set)\b/gi),
  );

  if (countMatches.length === 0) {
    return null;
  }

  for (const match of countMatches) {
    const count = match[1];
    for (const allowed of allowedValues) {
      const normalizedAllowed = normalizeSpecificValue(allowed);
      if (
        normalizedAllowed.includes(count) &&
        /\b(?:pc|pcs|piece|pieces|pack|set)\b/i.test(normalizedAllowed)
      ) {
        return allowed;
      }
    }
  }

  return null;
}

function findNeutralAllowedSize(
  text: string,
  allowedValues?: string[],
) {
  if (!allowedValues || allowedValues.length === 0) {
    return null;
  }

  const lowerText = text.toLowerCase();
  const hasVariableSizeHint =
    /\b(?:twin|single|double|queen|king|small|medium|large|xl|extra\s+large|standard|travel)\b/i.test(
      lowerText,
    );
  if (hasVariableSizeHint) {
    return null;
  }

  const looksSingleSizeProduct =
    /\b(?:wedge\s+pillow|bed\s+wedge|orthopedic\s+pillow|cushion|foot\s+massager|massager|charger|adapter|controller|tile\s+cutter|dash\s+cam|camera|lens|phone\s+case|vacuum|mop|water\s+bottle|router|switch)\b/i.test(
      lowerText,
    );
  if (!looksSingleSizeProduct) {
    return null;
  }

  const neutralCandidates = [
    "One Size",
    "One Size Fits All",
    "Universal",
    "Standard",
    "Regular",
  ];

  for (const candidate of neutralCandidates) {
    const matched = matchAllowedSpecificValue(candidate, allowedValues);
    if (matched) {
      return matched;
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
    readItemSpecificValue(specifics, [
      "Form factor",
      "Form Factor",
      "FormFactor",
    ]),
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

  const patternCandidates: Array<{ values: string[]; patterns: RegExp[] }> = [
    {
      values: ["Telephoto"],
      patterns: [/\btelephoto\b/i],
    },
    {
      values: ["Wide Angle"],
      patterns: [/\bwide[-\s]?angle\b/i],
    },
    {
      values: ["Macro"],
      patterns: [/\bmacro\b/i],
    },
    {
      values: ["Fisheye"],
      patterns: [/\bfish[-\s]?eye\b/i],
    },
    {
      values: ["Zoom Lens"],
      patterns: [/\bzoom\s+lens\b/i],
    },
    {
      values: ["Prime Lens"],
      patterns: [/\bprime\s+lens\b/i, /\bfixed\s+focal\b/i],
    },
    {
      values: ["Camera Lens"],
      patterns: [/\bcamera\s+lens\b/i, /\blens\b/i],
    },
    {
      values: ["Charging Station", "Desktop Charger", "USB Charger", "Wall Charger", "Mains Charger", "Power Adapter", "Charger"],
      patterns: [
        /\bcharging\s+station\b/i,
        /\b(?:multi|[2-9]|1[0-9])[-\s]?port\b/i,
        /\bdesktop\b.*\bcharger\b/i,
        /\bcharger\b.*\bdesktop\b/i,
      ],
    },
    {
      values: ["USB-C Charger", "USB C Charger", "USB Wall Charger", "USB Charger", "Wall Charger", "Mains Charger", "Power Adapter", "Charger"],
      patterns: [
        /\busb[-\s]?c\b.*\bcharg(?:er|ing)\b/i,
        /\bcharg(?:er|ing)\b.*\busb[-\s]?c\b/i,
        /\bgan\b.*\bcharg(?:er|ing)\b/i,
        /\bcharg(?:er|ing)\b.*\bgan\b/i,
      ],
    },
    {
      values: ["Wireless Charger", "Charging Pad", "Charging Mat", "Charger"],
      patterns: [/\bwireless\b.*\bcharg(?:er|ing)\b/i, /\bcharg(?:er|ing)\b.*\bwireless\b/i],
    },
    {
      values: ["Car Charger", "Vehicle Charger", "Charger"],
      patterns: [/\bcar\b.*\bcharg(?:er|ing)\b/i, /\bvehicle\b.*\bcharg(?:er|ing)\b/i],
    },
    {
      values: ["Wall Charger", "Mains Charger", "Power Adapter", "USB Charger", "Charger"],
      patterns: [/\bwall\b.*\bcharg(?:er|ing)\b/i, /\bcharg(?:er|ing)\b/i, /\bpower\s+adapter\b/i],
    },
    {
      values: ["Foot Massager", "Foot Massage Machine", "Massager", "Massage Machine"],
      patterns: [
        /\bfoot\b.*\bmassag(?:er|ing|e)\b/i,
        /\bfeet\b.*\bmassag(?:er|ing|e)\b/i,
        /\bmassag(?:er|ing|e)\b.*\bfoot\b/i,
        /\bdeep\s+knead/i,
      ],
    },
    {
      values: ["Massage Machine", "Massager"],
      patterns: [/\bmassag(?:er|ing|e)\b/i],
    },
    {
      values: ["Stick Vacuum Cleaner", "Vacuum Cleaner", "Vacuum", "Cleaner"],
      patterns: [/\bstick\b.*\bvacuum\b/i, /\bvacuum\b/i],
    },
    {
      values: ["Steam Mop", "Mop", "Floor Cleaner", "Cleaner"],
      patterns: [/\bsteam[-\s]?mop\b/i, /\bmop\b/i],
    },
    {
      values: ["Water Bottle"],
      patterns: [/\bwater\s+bottle\b/i],
    },
    {
      values: [
        "Earbud (In Ear)",
        "Earbuds",
        "Earbud",
        "In-Ear Headphones",
        "In Ear",
        "Open-Ear Headphones",
        "Open Ear",
        "Clip-On Headphones",
        "Clip-On",
        "Headphones",
        "Headset",
        "Other",
      ],
      patterns: [
        /\bearbuds?\b/i,
        /\bearphones?\b/i,
        /\bopen[-\s]?ear\b/i,
        /\bclip[-\s]?on\b/i,
        /\bheadphones?\b/i,
        /\bheadsets?\b/i,
        /\bin[-\s]?ear\b/i,
        /\bon[-\s]?ear\b/i,
        /\bover[-\s]?ear\b/i,
      ],
    },
    {
      values: ["Bed Wedge Pillow", "Wedge Pillow", "Pillow", "Cushion"],
      patterns: [
        /\bbed\s+wedge\b/i,
        /\bwedge\s+pillow\b/i,
        /\borthopedic\b.*\bpillow\b/i,
        /\bpillow\b.*\bwedge\b/i,
      ],
    },
    {
      values: ["Pillow", "Cushion"],
      patterns: [/\bpillow\b/i, /\bcushion\b/i],
    },
    {
      values: ["Phone Case"],
      patterns: [/\bphone\s+case\b/i, /\b(?:iphone|galaxy|samsung)\b.*\bcase\b/i],
    },
    {
      values: ["Hair Clippers"],
      patterns: [/\bhair\s+clippers?\b/i],
    },
    {
      values: ["Tile Cutter"],
      patterns: [/\btile\s+cutter\b/i],
    },
    {
      values: ["Controller"],
      patterns: [/\bcontroller\b/i],
    },
  ];

  for (const candidate of patternCandidates) {
    if (!candidate.patterns.some((pattern) => pattern.test(text))) {
      continue;
    }

    // Tier 1: Exact Matches across all candidate values
    if (input.allowedValues && input.allowedValues.length > 0) {
      for (const value of candidate.values) {
        const normalizedCandidate = normalizeSpecificValue(value);
        const exactMatch = input.allowedValues.find(
          (allowed) => normalizeSpecificValue(allowed) === normalizedCandidate
        );
        if (exactMatch) {
          return exactMatch;
        }
      }

      // Tier 2: Substring Matches across all candidate values
      for (const value of candidate.values) {
        const normalizedCandidate = normalizeSpecificValue(value);
        const substringMatch = input.allowedValues.find((allowed) => {
          const normalizedAllowed = normalizeSpecificValue(allowed);
          return (
            normalizedAllowed.length >= 3 &&
            (normalizedCandidate.includes(normalizedAllowed) ||
              normalizedAllowed.includes(normalizedCandidate))
          );
        });
        if (substringMatch) {
          return substringMatch;
        }
      }
    }

    // Tier 3: Token-based Fallback Match
    for (const value of candidate.values) {
      const matched = matchAllowedSpecificValue(value, input.allowedValues);
      if (matched) {
        return matched;
      }
    }
  }

  const matchedAllowedTextValue = findAllowedTypeInText(text, input.allowedValues);
  if (matchedAllowedTextValue) {
    return matchedAllowedTextValue;
  }

  return findGenericAllowedTypeFallback(input.allowedValues);
}

export function inferSizeItemSpecific(input: {
  title?: string | null;
  categoryName?: string | null;
  itemSpecifics?: unknown;
  allowedValues?: string[];
}) {
  const specifics = normalizeItemSpecifics(input.itemSpecifics);
  const directCandidates = [
    readItemSpecificValue(specifics, ["Size", "Size Name", "Item Size", "Product Size"]),
    readItemSpecificValue(specifics, ["Style Name"]),
  ];

  for (const candidate of directCandidates) {
    const matched = matchAllowedSpecificValue(candidate, input.allowedValues);
    if (matched) {
      return matched;
    }
  }

  if (input.allowedValues && input.allowedValues.length > 0) {
    const variantSizeCandidate = readItemSpecificValue(specifics, [
      "Variant",
      "Variation",
      "Selected Size",
    ]);
    const matchedVariantSize = matchAllowedSpecificValue(
      variantSizeCandidate,
      input.allowedValues
    );
    if (matchedVariantSize) {
      return matchedVariantSize;
    }
  }

  const text = [
    input.title,
    input.categoryName,
    ...Object.entries(specifics).map(([key, value]) => `${key}: ${value}`),
  ]
    .filter(Boolean)
    .join(" ");

  const allowedPatternCandidates = [
    "Small",
    "Medium",
    "Large",
    "Extra Large",
    "XL",
    "Single",
    "Double",
    "Queen",
    "King",
    "Twin",
    "Full",
    "Standard",
    "Travel",
    "One Size",
  ];

  for (const candidate of allowedPatternCandidates) {
    if (new RegExp(`\\b${candidate.replace(/\s+/g, "\\s+")}\\b`, "i").test(text)) {
      const matched = matchAllowedSpecificValue(candidate, input.allowedValues);
      if (matched) {
        return matched;
      }
    }
  }

  if (input.allowedValues && input.allowedValues.length > 0) {
    const setCountSize = findAllowedSetCountSize(text, input.allowedValues);
    if (setCountSize) {
      return setCountSize;
    }

    for (const value of input.allowedValues) {
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (value.trim().length >= 3 && new RegExp(`\\b${escaped}\\b`, "i").test(text)) {
        return value;
      }
    }

    const neutralSize = findNeutralAllowedSize(text, input.allowedValues);
    if (neutralSize) {
      return neutralSize;
    }

    return null;
  }

  const dimensionCandidates = [
    readItemSpecificValue(specifics, [
      "Item Dimensions L x W x H",
      "Item Dimensions D x W x H",
      "Product Dimensions",
      "Dimensions",
    ]),
    text.match(
      /\b\d+(?:\.\d+)?\s*(?:cm|mm|m|in|inch|inches)\s*(?:x|by)\s*\d+(?:\.\d+)?\s*(?:cm|mm|m|in|inch|inches)?(?:\s*(?:x|by)\s*\d+(?:\.\d+)?\s*(?:cm|mm|m|in|inch|inches)?)?/i,
    )?.[0],
  ];

  for (const candidate of dimensionCandidates) {
    const normalized = normalizeDimensionValue(candidate ?? "");
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizeSpecificName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isUsefulItemSpecificCandidate(name: string, value: string) {
  const key = name.trim();
  const normalizedValue = value.trim().replace(/\s+/g, " ");

  if (!key || !normalizedValue) {
    return false;
  }

  if (key.length > 80 || normalizedValue.length > 1000) {
    return false;
  }

  if ((normalizedValue.match(/>/g)?.length ?? 0) >= 2) {
    return false;
  }

  if (
    NOISY_ITEM_SPECIFIC_VALUE_PATTERNS.some((pattern) =>
      pattern.test(normalizedValue)
    )
  ) {
    return false;
  }

  return true;
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
  const brand =
    inferBrandItemSpecific({ itemSpecifics: specifics }) || DEFAULT_BRAND;

  if (!hasItemSpecific(specifics, "Model")) {
    specifics.Model = model;
  }

  if (
    !hasItemSpecific(specifics, "Brand") ||
    isUnavailableBrandValue(getItemSpecificValue(specifics, ["Brand"]))
  ) {
    specifics.Brand = brand;
  }

  const sanitized: ItemSpecificsRecord = {};

  for (const [rawKey, rawValue] of Object.entries(specifics)) {
    const key = rawKey.trim();
    const value = rawValue.trim().replace(/\s+/g, " ");

    if (!key || !value) {
      continue;
    }

    if (!key.startsWith("_") && !isUsefulItemSpecificCandidate(key, value)) {
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
  requiredNames: string[] = [],
): ItemSpecificsRecord {
  const specifics = sanitizeEbayItemSpecifics(value);
  const requiredNameSet = new Set(
    requiredNames.map((name) => normalizeSpecificName(name)).filter(Boolean),
  );

  if (!hasItemSpecific(specifics, "Type")) {
    specifics.Type = defaultType || "Other";
  }

  const seen = new Set<string>();
  const entries = Object.entries(specifics)
    .map(([rawKey, rawValue], originalIndex) => ({
      key: rawKey.trim(),
      value: rawValue.trim(),
      required: requiredNameSet.has(normalizeSpecificName(rawKey)),
      originalIndex,
    }))
    .filter(({ key, value, required }) => {
      if (
        !key ||
        !value ||
        key.startsWith("_") ||
        (!required && isLowValueSpecificName(key))
      ) {
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
      if (a.required !== b.required) {
        return a.required ? -1 : 1;
      }

      const aPriority =
        ITEM_SPECIFIC_PRIORITY.get(normalizeSpecificName(a.key)) ?? 1000;
      const bPriority =
        ITEM_SPECIFIC_PRIORITY.get(normalizeSpecificName(b.key)) ?? 1000;

      return aPriority - bPriority || a.originalIndex - b.originalIndex;
    })
    .slice(0, Math.max(1, maxCount));

  return Object.fromEntries(entries.map(({ key, value }) => [key, value]));
}
