// Pure, browser-free helpers for the eBay sold-comps scrape. Kept out of
// `ebay-research.ts` (which is `server-only`) so they can be unit-tested.

export type SoldPageState =
  | "ok"
  | "empty"
  | "blocked"
  | "unsupported"
  | "auth";

export function parsePriceText(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return 0;
  }

  const normalized = value.replace(/,/g, "");
  const numbers = normalized.match(/\d+(?:\.\d{1,2})?/g);

  if (!numbers || numbers.length === 0) {
    return 0;
  }

  // Price ranges ("$10.00 to $18.00", common on multi-variation listings) —
  // use the midpoint rather than the low end so the sample is not dragged down.
  if (numbers.length >= 2 && /\bto\b/i.test(normalized)) {
    const low = Number(numbers[0]);
    const high = Number(numbers[1]);

    if (Number.isFinite(low) && Number.isFinite(high) && high >= low) {
      return (low + high) / 2;
    }
  }

  return Number(numbers[0]);
}

export function medianOf(sortedPrices: number[]): number | null {
  if (sortedPrices.length === 0) {
    return null;
  }

  const mid = Math.floor(sortedPrices.length / 2);

  return sortedPrices.length % 2 === 1
    ? sortedPrices[mid]
    : (sortedPrices[mid - 1] + sortedPrices[mid]) / 2;
}

// Drop the top/bottom 10% before taking the market-centre median so a single
// mispriced bundle or typo listing cannot skew the "typical price" number.
export function trimPriceOutliers(sortedPrices: number[]): number[] {
  if (sortedPrices.length < 10) {
    return sortedPrices;
  }

  const cut = Math.floor(sortedPrices.length * 0.1);
  return sortedPrices.slice(cut, sortedPrices.length - cut);
}

// Distinguish "eBay genuinely has no sold comps" (accept) from "eBay blocked us
// or changed its layout" (retry / surface an error) so blocks never masquerade
// as empty results.
export function classifySoldPageState(input: {
  url: string;
  title: string;
  legacyCards: number;
  newLayoutCards: number;
  hasZeroResultsMarker: boolean;
}): SoldPageState {
  const haystack = `${input.url} ${input.title}`.toLowerCase();

  // eBay now gates sold/completed listings behind sign-in. A sign-in redirect
  // will never resolve on retry, so flag it separately to fail fast.
  if (/signin|sign in or register|sgfl=srch/.test(haystack)) {
    return "auth";
  }

  if (
    /splashui|captcha|verify|are you a human|error page|access denied/.test(
      haystack,
    )
  ) {
    return "blocked";
  }

  if (input.legacyCards > 0) {
    return "ok";
  }

  if (input.newLayoutCards > 0) {
    return "unsupported";
  }

  if (input.hasZeroResultsMarker) {
    return "empty";
  }

  return "blocked";
}
