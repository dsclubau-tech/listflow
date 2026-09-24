import assert from "node:assert/strict";
import test from "node:test";
import {
  filterEbayCategorySuggestions,
  getSmallKitchenApplianceType,
  hasMismatchedApplianceCategory,
  selectSmallKitchenApplianceCategories,
} from "@/lib/ebay-category-selection";

const title = "Drew&cole 5 Minute Cleverchef 700w Non-stick Multicooker, Make Quick-meals";
const other = { categoryId: "20685", categoryName: "Home Appliances > Small Kitchen Appliances > Other Small Appliances" };
const pressure = { categoryId: "260311", categoryName: "Home Appliances > Small Kitchen Appliances > Pressure Cookers" };
const bags = { categoryId: "169291", categoryName: "Clothing, Shoes & Accessories > Women > Women's Bags & Handbags" };
const books = { categoryId: "261186", categoryName: "Books, Magazines > Books" };
const parts = { categoryId: "260155", categoryName: "Home Appliances > Small Kitchen Appliances > Small Kitchen Appliance Parts" };

test("Cleverchef stays a complete appliance despite unrelated eBay title suggestions", () => {
  assert.deepEqual(selectSmallKitchenApplianceCategories(title, [books, bags, parts, pressure, other]), [other]);
  assert.deepEqual(selectSmallKitchenApplianceCategories(title, [books, bags, parts, pressure]), []);
});

test("a known appliance subtype uses its matching leaf", () => {
  assert.deepEqual(selectSmallKitchenApplianceCategories("Electric Pressure Cooker", [other, pressure, parts]), [pressure]);
});

test("cookbooks and accessories mentioning appliances are not classified as appliances", () => {
  for (const accessory of ["Multicooker cookbook", "Replacement rice cooker lid", "Silicone mat for electric skillet", "Food processor spare parts"]) {
    assert.equal(getSmallKitchenApplianceType(accessory), null, accessory);
  }
  assert.equal(getSmallKitchenApplianceType("Electric Pressure Cooker", "Books > Cookbooks"), null);
});

test("non-book Amazon products never fall back to a discarded book suggestion", () => {
  assert.deepEqual(filterEbayCategorySuggestions([books], "Kitchen & Dining"), []);
  assert.deepEqual(filterEbayCategorySuggestions([books], "Books"), [books]);
  assert.deepEqual(filterEbayCategorySuggestions([books, other], "Kitchen & Dining"), [other]);
});

test("existing appliance drafts flag obvious wrong categories without rejecting valid alternatives", () => {
  for (const category of [bags, books, parts]) assert.equal(hasMismatchedApplianceCategory(title, category.categoryName), true);
  assert.equal(hasMismatchedApplianceCategory(title, other.categoryName), false);
  assert.equal(hasMismatchedApplianceCategory("Commercial Rice Cooker", "Business & Industrial > Restaurant Equipment"), false);
  assert.equal(hasMismatchedApplianceCategory("Multicooker cookbook", books.categoryName), false);
});
