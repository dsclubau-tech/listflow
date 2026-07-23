export type SearchPlan = {
  primary: string;
  strict: string | null;
  broad: string | null;
  tokens: string[];
  strongTokens: string[];
  tokenSet: Set<string>;
};

type ScorableResearchResult = {
  title: string;
};

const ACCESSORY_ONLY_SIGNALS = [
  "anti slip",
  "case",
  "cover",
  "covers",
  "grip cap",
  "joystick cap",
  "parts only",
  "pouch",
  "protector",
  "protective",
  "protective cover",
  "repair",
  "replacement shell",
  "screen protector",
  "shockproof",
  "silicone",
  "skin",
  "sleeve",
  "spares",
  "stand case",
  "thumbstick cap",
];

const MATERIAL_MODIFIERS = [
  "aluminium",
  "aluminum",
  "ceramic",
  "copper",
  "enamel",
  "glass",
  "granite",
  "marble",
  "silicone",
  "stainless",
  "steel",
  "stone",
  "titanium",
];

export function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textIncludesPhrase(text: string, phrase: string) {
  return new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`).test(text);
}

function buildComparableTokenSet(text: string) {
  const tokens = text.split(" ").filter(Boolean);
  const tokenSet = new Set(tokens);

  for (const token of tokens) {
    if (
      /^\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)+(?:[a-z]+)?$/.test(token)
    ) {
      for (const part of token.match(/\d+(?:\.\d+)?/g) ?? []) {
        tokenSet.add(part);
      }
      continue;
    }

    const measurement = token.match(
      /^(\d+(?:\.\d+)?)(?:in|inch|hz|khz|mhz|ghz|mm|cm|kg|mah|w|p)$/,
    );
    if (measurement?.[1]) {
      tokenSet.add(measurement[1]);
    }
  }

  return tokenSet;
}

function tokenMatches(tokenSet: Set<string>, token: string) {
  if (tokenSet.has(token)) {
    return true;
  }

  if (token === "nonstick" && tokenSet.has("non") && tokenSet.has("stick")) {
    return true;
  }

  if ((token === "non" || token === "stick") && tokenSet.has("nonstick")) {
    return true;
  }

  if (token.endsWith("s") && token.length > 3 && tokenSet.has(token.slice(0, -1))) {
    return true;
  }

  if (token.length > 2 && tokenSet.has(`${token}s`)) {
    return true;
  }

  return false;
}

function getTokenWeight(token: string, plan: SearchPlan) {
  if (/\d/.test(token) && token.length >= 2) {
    return 4;
  }

  if (/^\d$/.test(token)) {
    return 2;
  }

  return plan.strongTokens.includes(token) ? 3 : 1;
}

function extractExplicitCounts(text: string) {
  return Array.from(
    text.matchAll(/\b(\d+)\s*(?:pcs?|pieces?|piece|packs?|sets?)\b/g),
    (match) => Number.parseInt(match[1] ?? "", 10),
  ).filter((count) => Number.isFinite(count) && count > 0);
}

function getExtraMaterialModifiers(title: string, plan: SearchPlan) {
  return MATERIAL_MODIFIERS.filter(
    (modifier) => textIncludesPhrase(title, modifier) && !plan.tokenSet.has(modifier),
  );
}

export function isAccessoryOnlyMismatch(title: string, plan: SearchPlan) {
  const normalizedTitle = normalizeSearchText(title);
  const normalizedQuery = normalizeSearchText(plan.primary);
  const titleHasAccessorySignal = ACCESSORY_ONLY_SIGNALS.some((signal) =>
    textIncludesPhrase(normalizedTitle, signal)
  );

  if (!titleHasAccessorySignal) {
    return false;
  }

  const queryRequestsAccessory = ACCESSORY_ONLY_SIGNALS.some((signal) =>
    textIncludesPhrase(normalizedQuery, signal)
  );

  return !queryRequestsAccessory;
}

export function buildSearchPlan(rawQuery: string): SearchPlan {
  const cleaned = rawQuery
    .replace(
      /\b(brand\s+new|free\s+(postage|shipping|delivery)|fast\s+(postage|shipping|delivery)|australia\s+stock|au\s+stock|local\s+stock|in\s+stock|buy\s+it\s+now|genuine|hot\s+sale)\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
  const primary = (cleaned || rawQuery).slice(0, 100).trim();
  const normalized = normalizeSearchText(primary);
  const weakTokens = new Set([
    "and",
    "the",
    "for",
    "with",
    "from",
    "new",
    "buy",
    "item",
    "product",
    "sale",
  ]);
  const rawTokens = normalized
    .split(" ")
    .filter(
      (token) => (token.length >= 2 || /^\d+$/.test(token)) && !weakTokens.has(token)
    );
  const tokens = Array.from(new Set(rawTokens));
  const strongTokens = tokens.filter(
    (token) => (/\d/.test(token) && token.length >= 2) || token.length >= 7
  );
  const strictTokens = [
    ...strongTokens.slice(0, 4),
    ...tokens.filter((token) => !strongTokens.includes(token)).slice(0, 2),
  ];
  const strict =
    strictTokens.length >= 2 ? strictTokens.join(" ").slice(0, 100) : null;

  const modelTokens = tokens.filter(
    (token) => /\d/.test(token) && token.length >= 2,
  );
  const tokenCounts = new Map<string, number>();
  for (const token of rawTokens) {
    tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
  }
  const firstToken = tokens[0] ?? "";
  const probableBrand =
    /^[a-z]{3,}$/i.test(firstToken) &&
    strongTokens.includes(firstToken) &&
    (tokenCounts.get(firstToken) ?? 0) === 1
      ? firstToken
      : null;
  const repeatedTextTokens = tokens.filter(
    (token) =>
      /^[a-z]{3,}$/i.test(token) &&
      (tokenCounts.get(token) ?? 0) > 1,
  );
  const strongTextTokens = strongTokens.filter(
    (token) => /^[a-z]{3,}$/i.test(token) && token !== probableBrand,
  );
  const fallbackTextTokens = tokens.filter(
    (token) =>
      /^[a-z]{3,}$/i.test(token) &&
      token !== probableBrand &&
      !["inch", "black", "white", "true", "active"].includes(token),
  );
  const descriptiveTokens = Array.from(
    new Set([
      ...repeatedTextTokens,
      ...strongTextTokens,
      ...fallbackTextTokens,
    ]),
  );

  let broadParts: string[];
  if (repeatedTextTokens.length > 0) {
    broadParts = [
      ...repeatedTextTokens.slice(0, 2),
      ...modelTokens.slice(0, 1),
      ...strongTextTokens.slice(0, 1),
    ];
  } else if (modelTokens.length >= 2) {
    broadParts = [
      ...modelTokens.slice(0, 2),
      ...descriptiveTokens.slice(0, 1),
    ];
  } else {
    broadParts = descriptiveTokens.slice(0, 3);
  }

  broadParts = Array.from(new Set(broadParts)).slice(0, 3);
  const broad =
    broadParts.length >= 2 ? broadParts.join(" ").slice(0, 100) : null;

  return {
    primary,
    strict: strict && strict !== primary ? strict : null,
    broad: broad && broad !== primary && broad !== strict ? broad : null,
    tokens,
    strongTokens,
    tokenSet: new Set(tokens),
  };
}

export function scoreResultMatch(result: ScorableResearchResult, plan: SearchPlan) {
  const title = normalizeSearchText(result.title);
  const titleTokenSet = buildComparableTokenSet(title);

  if (!title || plan.tokens.length === 0) {
    return 50;
  }

  if (isAccessoryOnlyMismatch(result.title, plan)) {
    return 0;
  }

  let matchedWeight = 0;
  let totalWeight = 0;
  const missingTokens: string[] = [];
  const missingStrongTokens: string[] = [];

  for (const token of plan.tokens) {
    const weight = getTokenWeight(token, plan);
    totalWeight += weight;

    if (tokenMatches(titleTokenSet, token)) {
      matchedWeight += weight;
    } else {
      missingTokens.push(token);
      if (plan.strongTokens.includes(token)) {
        missingStrongTokens.push(token);
      }
    }
  }

  let score = Math.round((matchedWeight / Math.max(1, totalWeight)) * 82);

  if (
    plan.strongTokens.length > 0 &&
    plan.strongTokens.every((token) => tokenMatches(titleTokenSet, token))
  ) {
    score += 12;
  }

  const primaryText = normalizeSearchText(plan.primary);
  if (primaryText && title.includes(primaryText)) {
    score += 6;
  }

  score -= missingStrongTokens.length * 6;
  score -= (missingTokens.length - missingStrongTokens.length) * 3;

  const queryCounts = extractExplicitCounts(normalizeSearchText(plan.primary));
  const titleCounts = extractExplicitCounts(title);
  const extraTitleCounts = titleCounts.filter((count) => !queryCounts.includes(count));

  if (extraTitleCounts.length > 0) {
    score -= queryCounts.length > 0 ? 28 : 16;
  }

  const extraMaterialModifiers = getExtraMaterialModifiers(title, plan);
  score -= Math.min(24, extraMaterialModifiers.length * 12);

  if (missingStrongTokens.length > 0) {
    score = Math.min(score, 85 - missingStrongTokens.length * 5);
  } else if (missingTokens.length > 0) {
    score = Math.min(score, 94);
  }

  if (extraMaterialModifiers.length > 0) {
    score = Math.min(score, 88);
  }

  if (extraTitleCounts.length > 0) {
    score = Math.min(score, queryCounts.length > 0 ? 76 : 86);
  }

  return Math.max(0, Math.min(100, score));
}

export function scoreEbayResearchResultForQuery(title: string, query: string) {
  return scoreResultMatch({ title }, buildSearchPlan(query));
}
