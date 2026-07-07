import assert from "node:assert/strict";
import test from "node:test";
import {
  EBAY_TITLE_MAX_LENGTH,
  getTemplateProductTitle,
  toEbayListingTitle,
} from "@/lib/product-title";

test("toEbayListingTitle caps long titles at eBay length", () => {
  const fullTitle =
    "ZipString Aracna Glow-in-The-Dark Webshooter - Superhero String Launcher Toy for Kids, Teens & Adults - Patented, Reloading, Durable & Viral Web Shooting Action Toy";
  const listingTitle = toEbayListingTitle(fullTitle);

  assert.equal(listingTitle.length <= EBAY_TITLE_MAX_LENGTH, true);
  assert.equal(fullTitle.includes(listingTitle), true);
});

test("getTemplateProductTitle prefers fullTitle and falls back to title", () => {
  assert.equal(
    getTemplateProductTitle({
      title: "ZipString Aracna Glow-in-The-Dark Webshooter",
      fullTitle:
        "ZipString Aracna Glow-in-The-Dark Webshooter - Superhero String Launcher Toy for Kids",
    }),
    "ZipString Aracna Glow-in-The-Dark Webshooter - Superhero String Launcher Toy for Kids"
  );

  assert.equal(
    getTemplateProductTitle({
      title: "Short eBay title",
      fullTitle: null,
    }),
    "Short eBay title"
  );
});
