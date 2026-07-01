import type { Product, Store } from "@/app/generated/prisma/client";
import {
  getEbayProductUpc,
  getListingItemSpecifics,
  normalizeItemSpecifics,
  type ItemSpecificsRecord,
} from "@/lib/item-specifics";

type ProductWithStore = Product & { store: Store };
type ProductSpecifics = ItemSpecificsRecord;

type AddItemOptions = {
  privateListing?: boolean;
  itemSpecificMaxCount?: number;
};

/**
 * Escapes XML special characters in text content.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getProductSpecifics(product: Product): ProductSpecifics | null {
  const specifics = normalizeItemSpecifics(product.itemSpecifics);
  if (Object.keys(specifics).length === 0) {
    return null;
  }

  return specifics;
}

function getValidatedPolicyIds(product: Product) {
  if (!product.shippingPolicyId) {
    throw new Error("Shipping Policy is required - please select one on the Product tab.");
  }
  if (!product.returnPolicyId) {
    throw new Error("Return Policy is required - please select one on the Product tab.");
  }
  if (!product.paymentPolicyId) {
    throw new Error("Payment Policy is required - please select one on the Product tab.");
  }

  return {
    shippingPolicyId: product.shippingPolicyId,
    returnPolicyId: product.returnPolicyId,
    paymentPolicyId: product.paymentPolicyId,
  };
}

function getValidatedPrice(product: Product, overrideStartPrice?: string | number): string {
  const price = overrideStartPrice ?? product.price;
  const numericPrice = Number(price);

  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    throw new Error("Price must be greater than 0 before sending the listing to eBay.");
  }

  return numericPrice.toFixed(2);
}

function getValidatedQuantity(product: Product): string {
  if (!Number.isInteger(product.quantity) || product.quantity < 1) {
    throw new Error("Quantity must be at least 1 before sending the listing to eBay.");
  }

  return product.quantity.toString();
}

function getValidatedCategoryId(product: Product): string {
  const categoryId = (product.category || "").trim();

  if (!categoryId) {
    throw new Error("Category is required - please enter a numeric eBay Category ID on the Product tab.");
  }

  if (!/^\d+$/.test(categoryId)) {
    throw new Error(
      `Invalid Category: "${categoryId}". eBay requires a numeric Category ID (e.g. 171114). Please update it on the Product tab.`
    );
  }

  return categoryId;
}

function getLocationMetadata(specifics: ProductSpecifics | null) {
  return {
    country: specifics?.["_Country"] || "AU",
    currency: specifics?.["_Currency"] || "AUD",
    site: specifics?.["_Site"] || "Australia",
    location: specifics?.["_Location"] || "Australia",
    postalCode: specifics?.["_PostalCode"] || "3000",
  };
}

function buildPictureDetailsXml(images: string[]): string {
  const pictureUrls = images
    .slice(0, 12)
    .map((url) => `      <PictureURL>${escapeXml(url)}</PictureURL>`)
    .join("\n");

  return `    <PictureDetails>\n${pictureUrls}\n    </PictureDetails>`;
}

function buildItemSpecificsXml(
  product: Product,
  specifics: ProductSpecifics | null,
  maxCount?: number,
): string {
  const defaultType = product.categoryName?.split(">").pop()?.trim() || "Other";
  const listingSpecifics = getListingItemSpecifics(
    specifics && Object.keys(specifics).length > 0 ? specifics : { Type: defaultType },
    defaultType,
    maxCount,
  );
  const nameValueLists = Object.entries(listingSpecifics)
    .map(
      ([key, value]) =>
        `      <NameValueList>\n        <Name>${escapeXml(key)}</Name>\n        <Value>${escapeXml(value)}</Value>\n      </NameValueList>`
    )
    .join("\n");

  return `    <ItemSpecifics>\n${nameValueLists}\n    </ItemSpecifics>`;
}

function buildProductListingDetailsXml(specifics: ProductSpecifics | null): string {
  const upc = getEbayProductUpc(specifics);

  return `    <ProductListingDetails>\n      <UPC>${escapeXml(upc)}</UPC>\n    </ProductListingDetails>`;
}

function buildSellerProfilesXml(product: Product): string {
  const { shippingPolicyId, returnPolicyId, paymentPolicyId } = getValidatedPolicyIds(product);

  return `    <SellerProfiles>\n      <SellerShippingProfile>\n        <ShippingProfileID>${shippingPolicyId}</ShippingProfileID>\n      </SellerShippingProfile>\n      <SellerReturnProfile>\n        <ReturnProfileID>${returnPolicyId}</ReturnProfileID>\n      </SellerReturnProfile>\n      <SellerPaymentProfile>\n        <PaymentProfileID>${paymentPolicyId}</PaymentProfileID>\n      </SellerPaymentProfile>\n    </SellerProfiles>`;
}

/**
 * Builds a valid eBay AddItem XML request body for the Trading API.
 * Throws if required business policy, pricing, quantity, or category data is missing.
 *
 * Location/country/currency/site are read from itemSpecifics using _-prefixed
 * internal keys set by InlineEditForm. These keys are NOT emitted as ItemSpecifics.
 */
export function buildAddItemXML(
  product: ProductWithStore,
  overrideStartPrice?: string | number,
  options: AddItemOptions = {},
): string {
  const specifics = getProductSpecifics(product);
  const { country, currency, site, location, postalCode } = getLocationMetadata(specifics);
  const categoryId = getValidatedCategoryId(product);
  const startPrice = getValidatedPrice(product, overrideStartPrice);
  const quantity = getValidatedQuantity(product);
  const conditionId = product.condition === "New" ? "1000" : "3000";
  const pictureDetailsXml = buildPictureDetailsXml(product.images);
  const itemSpecificsXml = buildItemSpecificsXml(
    product,
    specifics,
    options.itemSpecificMaxCount,
  );
  const productListingDetailsXml = buildProductListingDetailsXml(specifics);
  const sellerProfilesXml = buildSellerProfilesXml(product);

  return `<?xml version="1.0" encoding="utf-8"?>
<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>
    <Title>${escapeXml(product.title.slice(0, 80))}</Title>
    <Description><![CDATA[${product.description}]]></Description>
    <PrimaryCategory>
      <CategoryID>${escapeXml(categoryId)}</CategoryID>
    </PrimaryCategory>
    <StartPrice>${startPrice}</StartPrice>
    <CategoryMappingAllowed>true</CategoryMappingAllowed>
    <Country>${escapeXml(country)}</Country>
    <Currency>${escapeXml(currency)}</Currency>
    <DispatchTimeMax>3</DispatchTimeMax>
    <ListingDuration>GTC</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <PrivateListing>${options.privateListing ? "true" : "false"}</PrivateListing>
    <Quantity>${quantity}</Quantity>
    <ConditionID>${conditionId}</ConditionID>
${productListingDetailsXml}
${pictureDetailsXml}
${itemSpecificsXml}
${sellerProfilesXml}
    <Location>${escapeXml(location)}</Location>
    <PostalCode>${escapeXml(postalCode)}</PostalCode>
    <Site>${escapeXml(site)}</Site>
  </Item>
</AddItemRequest>`;
}

/**
 * Builds a valid eBay EndItem XML request body for the Trading API.
 * EndingReason "NotAvailable" = seller chose to end the listing early.
 */
export function buildEndItemXML(ebayItemId: string, reason = "NotAvailable"): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<EndItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <ItemID>${escapeXml(ebayItemId)}</ItemID>
  <EndingReason>${escapeXml(reason)}</EndingReason>
</EndItemRequest>`;
}

/**
 * Builds a GetSellerList request for active listings.
 *
 * GTC listings keep their original StartTime, but their EndTime stays in the
 * near future as eBay renews them. Querying the next 120 days catches active
 * listings without walking historic start-date windows.
 */
export function buildGetSellerListXML(page: number): string {
  const now = new Date();
  const endTimeTo = new Date(now);
  endTimeTo.setDate(endTimeTo.getDate() + 120);

  const outputSelectors = [
    "PaginationResult",
    "HasMoreItems",
    "ReturnedItemCountActual",
    "ItemID",
    "Title",
    "Description",
    "PrimaryCategory",
    "StartPrice",
    "Quantity",
    "QuantityAvailable",
    "ConditionID",
    "ConditionDisplayName",
    "PictureDetails",
    "ItemSpecifics",
    "SKU",
    "SellingStatus",
    "Variations",
    "ListingType",
    "SellerProfiles",
    "EndTime",
  ]
    .map((selector) => `  <OutputSelector>${selector}</OutputSelector>`)
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<GetSellerListRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <GranularityLevel>Fine</GranularityLevel>
  <EndTimeFrom>${now.toISOString()}</EndTimeFrom>
  <EndTimeTo>${endTimeTo.toISOString()}</EndTimeTo>
  <IncludeVariations>true</IncludeVariations>
  <Pagination>
    <EntriesPerPage>200</EntriesPerPage>
    <PageNumber>${Math.max(1, Math.floor(page))}</PageNumber>
  </Pagination>
  <DetailLevel>ReturnAll</DetailLevel>
${outputSelectors}
</GetSellerListRequest>`;
}

export function buildGetSellerListIdsXML(page: number): string {
  const now = new Date();
  const endTimeTo = new Date(now);
  endTimeTo.setDate(endTimeTo.getDate() + 120);

  const outputSelectors = [
    "PaginationResult",
    "HasMoreItems",
    "ReturnedItemCountActual",
    "ItemID",
    "ListingType",
  ]
    .map((selector) => `  <OutputSelector>${selector}</OutputSelector>`)
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<GetSellerListRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <GranularityLevel>Fine</GranularityLevel>
  <EndTimeFrom>${now.toISOString()}</EndTimeFrom>
  <EndTimeTo>${endTimeTo.toISOString()}</EndTimeTo>
  <Pagination>
    <EntriesPerPage>200</EntriesPerPage>
    <PageNumber>${Math.max(1, Math.floor(page))}</PageNumber>
  </Pagination>
  <DetailLevel>ReturnSummary</DetailLevel>
${outputSelectors}
</GetSellerListRequest>`;
}

export function buildGetItemXML(itemId: string): string {
  const outputSelectors = [
    "ItemID",
    "Title",
    "Description",
    "PrimaryCategory",
    "StartPrice",
    "Quantity",
    "QuantityAvailable",
    "ConditionID",
    "ConditionDisplayName",
    "PictureDetails",
    "ItemSpecifics",
    "SKU",
    "SellingStatus",
    "Variations",
    "ListingType",
    "SellerProfiles",
    "EndTime",
  ]
    .map((selector) => `  <OutputSelector>${selector}</OutputSelector>`)
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <ItemID>${escapeXml(itemId)}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
  <IncludeItemSpecifics>true</IncludeItemSpecifics>
  <IncludeVariations>true</IncludeVariations>
${outputSelectors}
</GetItemRequest>`;
}

/**
 * Builds a valid eBay ReviseItem XML request body to update editable live-listing fields.
 *
 * When `overrideStartPrice` is provided it takes precedence over `product.price`.
 * This is used by the price-check apply flow and the revise route to ensure
 * the eBay listing always reflects the primary variant's calculated sell price
 * rather than the potentially stale `product.price` field.
 */
export function buildReviseItemXML(
  product: ProductWithStore,
  overrideStartPrice?: string | number,
): string {
  if (!product.ebayItemId) {
    throw new Error("Product has not been uploaded to eBay yet.");
  }

  const specifics = getProductSpecifics(product);
  const { location, postalCode } = getLocationMetadata(specifics);
  const quantity = getValidatedQuantity(product);
  const sellerProfilesXml = buildSellerProfilesXml(product);

  // Use the override price (from the primary variant's sellPrice) when available,
  // otherwise fall back to product.price for backwards compatibility.
  let startPrice: string;
  if (overrideStartPrice !== undefined) {
    const numeric = Number(overrideStartPrice);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new Error("Override start price must be greater than 0.");
    }
    startPrice = numeric.toFixed(2);
  } else {
    startPrice = getValidatedPrice(product);
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>
    <ItemID>${escapeXml(product.ebayItemId)}</ItemID>
    <Title>${escapeXml(product.title.slice(0, 80))}</Title>
    <Description><![CDATA[${product.description}]]></Description>
    <StartPrice>${startPrice}</StartPrice>
    <Quantity>${quantity}</Quantity>
${sellerProfilesXml}
    <Location>${escapeXml(location)}</Location>
    <PostalCode>${escapeXml(postalCode)}</PostalCode>
  </Item>
</ReviseItemRequest>`;
}

export function buildReviseQuantityXML(ebayItemId: string, quantity: number): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>
    <ItemID>${escapeXml(ebayItemId)}</ItemID>
    <Quantity>${quantity}</Quantity>
  </Item>
</ReviseItemRequest>`;
}
