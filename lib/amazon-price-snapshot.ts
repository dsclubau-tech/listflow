import { load } from "cheerio";
import { extractLocalizedBuyboxPriceChoices } from "@/lib/amazon-buybox-price";
import { extractAmazonNewOfferStockLeft } from "@/lib/amazon-stock";

export function extractAmazonPriceSnapshot(html: string, asin: string) {
  const $ = load(html);
  return {
    stockLeft: extractAmazonNewOfferStockLeft($),
    priceChoices: extractLocalizedBuyboxPriceChoices($, asin),
  };
}
