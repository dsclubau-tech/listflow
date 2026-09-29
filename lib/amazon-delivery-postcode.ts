import { getSuburbsForAuPostcode } from "@/lib/ebay-location";

export const DEFAULT_AMAZON_DELIVERY_POSTCODE = "2217";

export function resolveAmazonDeliveryPostcode(value: unknown): string {
  if (value == null || value === "" || (typeof value === "string" && !value.trim())) {
    return DEFAULT_AMAZON_DELIVERY_POSTCODE;
  }
  if (typeof value !== "string") throw new Error("Amazon Delivery Postcode must be four digits.");
  const postcode = value.trim();
  if (!/^\d{4}$/.test(postcode) || !getSuburbsForAuPostcode(postcode)) {
    throw new Error("Amazon Delivery Postcode must be a valid four-digit Australian postcode.");
  }
  return postcode;
}
