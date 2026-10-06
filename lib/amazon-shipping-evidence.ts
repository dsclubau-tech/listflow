import type { AmazonPriceTrackingMode } from "./amazon-price-tracking";

export const SHIPPING_EVIDENCE_MAX_AGE_MS = 15 * 60_000;
const DAY = 86_400_000;
const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export type AmazonShippingEvidence = {
  version: 1;
  asin: string;
  mode: AmazonPriceTrackingMode;
  postcode: string;
  observedAt: string;
  source: string;
  arrivalText: string | null;
  dispatchText: string | null;
  arrivalEarliest: string | null;
  arrivalLatest: string | null;
  dispatchLatest: string | null;
  outcome: "VERIFIED" | "UNKNOWN";
  reason: string | null;
};
export type AmazonShippingStatus = {
  outcome: "WITHIN_LIMIT" | "OVER_LIMIT" | "UNKNOWN";
  maxShippingDays: number;
  arrivalDays: number | null;
  dispatchDays: number | null;
  observedAt: string | null;
  message: string;
};

function calendarDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"));
}
const iso = (day: number) => new Date(day).toISOString().slice(0, 10);
function validDate(year: number, month: number, day: number) {
  const value = Date.UTC(year, month, day);
  const parsed = new Date(value);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month && parsed.getUTCDate() === day ? value : null;
}
function addMonths(day: number, count: number) {
  const date = new Date(day);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count + 1, 0)).getUTCDate();
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, Math.min(date.getUTCDate(), last));
}
// A second promise must not be silently discarded after parsing the first one.
function hasTimingReference(text: string) {
  return /\b(?:today|tomorrow|days?|weeks?|months?|next\s+(?:day|week|month)|\d+\s*(?:days?|weeks?|months?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)|\d{1,2}\/\d{1,2})\b/i.test(text);
}
function relativeRange(text: string, today: number): [number, number] | null {
  const match = text.match(/\b(?:within|in|takes?|delivery|arrives?)\s+(\d+)(?:\s*(?:to|[-–—])\s*(\d+))?\s*(days?|weeks?|months?)\b/i);
  if (!match || /business|working/i.test(text)) return null;
  if (hasTimingReference(text.replace(match[0], ""))) return null;
  const start = Number(match[1]), end = Number(match[2] ?? match[1]);
  if (start > end || end > 730 || start < 0) return null;
  const offset = (n: number) => /month/i.test(match[3]) ? addMonths(today, n) : today + n * (/week/i.test(match[3]) ? 7 : 1) * DAY;
  return [offset(start), offset(end)];
}
function arrivalRange(text: string, today: number): [number, number] | null {
  if (/business|working|fastest|expedited|order within|with prime|join prime/i.test(text)) return null;
  if (/\b(?:today|tomorrow)\b/i.test(text)) {
    const promises = text.match(/\b(?:today|tomorrow)\b/gi) ?? [];
    if (promises.length !== 1 || hasTimingReference(text.replace(promises[0], ""))) return null;
    const offset = /tomorrow/i.test(promises[0]) ? DAY : 0;
    return [today + offset, today + offset];
  }
  const relative = relativeRange(text, today);
  if (relative) return relative;
  if (/\b\d+\s*(?:days?|weeks?|months?)\b/i.test(text)) return null;
  const clean = text.toLowerCase().replace(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b,?\s*/g, "").replace(/(\d)(?:st|nd|rd|th)\b/g, "$1");
  const normalized = clean.replace(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g, (_, day: string, month: string, year: string) => `${day} ${months[Number(month) - 1] ?? "invalid"} ${year}`);
  const monthPattern = months.map(month => `${month}|${month.slice(0, 3)}`).join("|");
  const pattern = new RegExp(`\\b(\\d{1,2})\\s+(${monthPattern})(?:,?\\s+(20\\d{2}))?\\b`, "g");
  const matches = [...normalized.matchAll(pattern)];
  if (matches.length === 0 || matches.length > 2) return null;
  if (hasTimingReference(normalized.replace(pattern, ""))) return null;
  if (matches.length === 2 && !/^\s*(?:[-–—]|to)\s*$/.test(normalized.slice(matches[0].index! + matches[0][0].length, matches[1].index))) return null;
  // Amazon also writes "2 - 5 March" with a shared month/year.
  const sharedStart = clean.match(/\b(\d{1,2})\s*[-–—]\s*\d{1,2}\s+[a-z]/);
  const dates = matches.map(match => ({ day: Number(match[1]), month: months.findIndex(month => month.startsWith(match[2])), year: match[3] ? Number(match[3]) : null }));
  if (sharedStart && dates.length === 1) dates.unshift({ ...dates[0], day: Number(sharedStart[1]) });
  const currentYear = new Date(today).getUTCFullYear();
  const explicitYear = dates.find(date => date.year !== null)?.year;
  let previous: number | null = null;
  const result: number[] = [];
  for (let index = 0; index < dates.length; index++) {
    const date = dates[index];
    let year = date.year ?? explicitYear ?? currentYear;
    // A shared end-year belongs to the following January in a December–January range.
    if (index === 0 && dates.length === 2 && dates[0].month > dates[1].month && !date.year && explicitYear) year--;
    let value = validDate(year, date.month, date.day);
    if (value === null) return null;
    if (!explicitYear && !date.year && value < (previous ?? today)) value = validDate(year + 1, date.month, date.day);
    if (value === null || value < today || (previous !== null && value < previous)) return null;
    result.push(value); previous = value;
  }
  return [result[0], result.at(-1)!];
}

export function parseAmazonShippingEvidence(input: {
  asin: string; mode: AmazonPriceTrackingMode; postcode: string; observedAt: Date;
  source: string; arrivalText?: string | null; dispatchText?: string | null; associated: boolean;
}): AmazonShippingEvidence {
  const today = calendarDate(input.observedAt);
  const arrivalText = input.arrivalText?.trim().slice(0, 1000) || null;
  const dispatchText = input.dispatchText?.trim().slice(0, 1000) || null;
  const arrival = input.associated && arrivalText ? arrivalRange(arrivalText, today) : null;
  const dispatch = input.associated && dispatchText ? relativeRange(dispatchText, today) : null;
  return {
    version: 1, asin: input.asin, mode: input.mode, postcode: input.postcode,
    observedAt: input.observedAt.toISOString(), source: input.source, arrivalText, dispatchText,
    arrivalEarliest: arrival ? iso(arrival[0]) : null, arrivalLatest: arrival ? iso(arrival[1]) : null,
    dispatchLatest: dispatch ? iso(dispatch[1]) : null,
    outcome: input.associated && arrival ? "VERIFIED" : "UNKNOWN",
    reason: !input.associated ? "Delivery information could not be associated with the selected offer." : !arrival ? "Amazon arrival time could not be verified." : null,
  };
}

const nullableString = (value: unknown) => value === null || typeof value === "string";
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return validDate(year, month - 1, day) !== null;
}
export function readAmazonShippingEvidence(value: unknown): AmazonShippingEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.version !== 1 || typeof row.asin !== "string" || !/^[A-Z0-9]{10}$/.test(row.asin) ||
      (row.mode !== "REGULAR" && row.mode !== "DEAL") || typeof row.postcode !== "string" ||
      !/^\d{4}$/.test(row.postcode) || typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt)) ||
      typeof row.source !== "string" || (row.outcome !== "VERIFIED" && row.outcome !== "UNKNOWN") ||
      ![row.arrivalText, row.dispatchText, row.reason].every(nullableString) ||
      ![row.arrivalEarliest, row.arrivalLatest, row.dispatchLatest].every(date => date === null || isCalendarDate(date)) ||
      (row.outcome === "VERIFIED" && (!row.arrivalEarliest || !row.arrivalLatest)) ||
      (typeof row.arrivalEarliest === "string" && typeof row.arrivalLatest === "string" && row.arrivalEarliest > row.arrivalLatest)) return null;
  return row as AmazonShippingEvidence;
}

export function evaluateAmazonShipping(value: unknown, maximum: number, now = new Date(), requireFresh = false): AmazonShippingStatus {
  const maxShippingDays = Number.isInteger(maximum) && maximum > 0 ? maximum : 25;
  const evidence = readAmazonShippingEvidence(value);
  const observedAt = evidence?.observedAt ?? null;
  const unknown = (): AmazonShippingStatus => ({ outcome: "UNKNOWN", maxShippingDays, arrivalDays: null, dispatchDays: null, observedAt, message: "Amazon delivery time is unverified. Retry the shipping check." });
  if (!evidence) return unknown();
  const age = now.getTime() - Date.parse(evidence.observedAt);
  if (age < -5000) return unknown();
  if (requireFresh && age > SHIPPING_EVIDENCE_MAX_AGE_MS) return { ...unknown(), message: "Fresh delivery verification is required before stock can be restored." };
  const today = calendarDate(new Date(evidence.observedAt));
  const days = (date: string | null) => date ? Math.round((Date.parse(date) - today) / DAY) : null;
  const arrivalDays = days(evidence.arrivalLatest), dispatchDays = days(evidence.dispatchLatest);
  if ((arrivalDays !== null && arrivalDays < 0) || (dispatchDays !== null && dispatchDays < 0)) return unknown();
  const over = (arrivalDays !== null && arrivalDays > maxShippingDays) || (dispatchDays !== null && dispatchDays > maxShippingDays);
  return { outcome: over ? "OVER_LIMIT" : evidence.outcome === "VERIFIED" ? "WITHIN_LIMIT" : "UNKNOWN",
    maxShippingDays, arrivalDays, dispatchDays, observedAt,
    message: over ? `Amazon delivery exceeds your ${maxShippingDays}-day limit.` : evidence.outcome === "VERIFIED" ? `Amazon delivery is within your ${maxShippingDays}-day limit.` : unknown().message };
}

export function getCommittedShippingEvidence(product: {
  asin?: string | null; amazonPriceTrackingMode?: string; lastPriceCheck?: Date | null; holdLastObservationId?: string | null;
}, observation: {
  id: string; requestedAsin?: string | null; selectedAsin?: string | null; identityOutcome?: string | null;
  buyBoxOutcome?: string | null; postcodeVerified: boolean; verifiedPostcode?: string | null;
  isSuccessful?: boolean; priceMode?: string | null; observedAt: Date; shippingEvidence?: unknown;
} | null | undefined, postcode: string): AmazonShippingEvidence | null {
  const evidence = readAmazonShippingEvidence(observation?.shippingEvidence);
  if (!observation || !evidence || observation.id !== product.holdLastObservationId ||
    observation.observedAt.getTime() !== product.lastPriceCheck?.getTime() || observation.isSuccessful !== true ||
    observation.requestedAsin !== product.asin || observation.selectedAsin !== product.asin || evidence.asin !== product.asin ||
    observation.identityOutcome !== 'MATCH' || observation.buyBoxOutcome !== 'AVAILABLE' || !observation.postcodeVerified ||
    observation.verifiedPostcode !== postcode || evidence.postcode !== postcode || evidence.mode !== observation.priceMode ||
    Date.parse(evidence.observedAt) !== observation.observedAt.getTime() ||
    (product.amazonPriceTrackingMode === 'REGULAR' && evidence.mode !== 'REGULAR')) return null;
  return evidence;
}
