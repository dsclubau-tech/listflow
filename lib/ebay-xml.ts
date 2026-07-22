import type { Product, Store } from "@/app/generated/prisma/client";
import {
  getEbayProductUpc,
  getListingItemSpecifics,
  normalizeItemSpecifics,
  type ItemSpecificsRecord,
} from "@/lib/item-specifics";
import {
  parsePackageDimensionValue,
  parsePackageWeight,
} from "@/lib/amazon-package-dimensions";
import { resolveEbayLocationMetadata } from "@/lib/ebay-location";
import {
  MAX_EBAY_PICTURES,
  dedupeProductImages,
} from "@/lib/product-images";
import { toEbayListingTitle } from "@/lib/product-title";

type ProductWithStore = Product & { store: Store };
type ProductSpecifics = ItemSpecificsRecord;

type AddItemOptions = {
  privateListing?: boolean;
  itemSpecificMaxCount?: number;
  customLabel?: string | null;
  requiredItemSpecificNames?: string[];
};

type ReviseItemOptions = {
  quantityOverride?: number;
  customLabel?: string | null;
  includeSku?: boolean;
  includeShippingPackage?: boolean;
  includeTitle?: boolean;
  includeDescription?: boolean;
  includeStartPrice?: boolean;
  includeDispatchTimeMax?: boolean;
  includeQuantity?: boolean;
  includeSellerProfiles?: boolean;
  includeLocation?: boolean;
  includeItemSpecifics?: boolean;
  includePictures?: boolean;
};

export type ReviseInventoryStatusInput = {
  startPrice?: string | number;
  quantity?: number;
};

export type ReviseInventoryStatusItemInput = ReviseInventoryStatusInput & {
  ebayItemId: string;
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

function getValidatedQuantity(product: Product, overrideQuantity?: number): string {
  if (overrideQuantity !== undefined) {
    if (!Number.isInteger(overrideQuantity) || overrideQuantity < 0) {
      throw new Error("Quantity override must be a whole number of at least 0.");
    }

    return overrideQuantity.toString();
  }

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
  const metadata = resolveEbayLocationMetadata({
    country: specifics?.["_Country"],
    currency: specifics?.["_Currency"],
    site: specifics?.["_Site"],
    location: specifics?.["_Location"],
    postalCode: specifics?.["_PostalCode"],
  });

  return {
    country: metadata.country,
    currency: metadata.currency,
    site: metadata.site,
    location: metadata.location,
    postalCode: metadata.postalCode,
  };
}

function getDispatchTimeMax(specifics: ProductSpecifics | null) {
  const rawValue = specifics?.["_DispatchTimeMax"];
  const parsed = rawValue ? Number.parseInt(rawValue, 10) : 3;

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 30) {
    return "3";
  }

  return String(parsed);
}

function buildPictureDetailsXml(images: string[]): string {
  const normalizedImages = dedupeProductImages(images, Number.MAX_SAFE_INTEGER);
  if (normalizedImages.length > MAX_EBAY_PICTURES) {
    throw new Error(
      `eBay supports up to ${MAX_EBAY_PICTURES} listing images.`,
    );
  }

  const pictureUrls = normalizedImages
    .map((url) => `      <PictureURL>${escapeXml(url)}</PictureURL>`)
    .join("\n");

  if (!pictureUrls) {
    throw new Error("At least one valid image URL is required before sending the listing to eBay.");
  }

  return `    <PictureDetails>\n${pictureUrls}\n    </PictureDetails>`;
}

function buildItemSpecificsXml(
  product: Product,
  specifics: ProductSpecifics | null,
  maxCount?: number,
  requiredItemSpecificNames: string[] = [],
): string {
  const defaultType = product.categoryName?.split(">").pop()?.trim() || "Other";
  const listingSpecifics = getListingItemSpecifics(
    specifics && Object.keys(specifics).length > 0 ? specifics : { Type: defaultType },
    defaultType,
    maxCount,
    requiredItemSpecificNames,
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

function buildSkuXml(customLabel: string | null | undefined): string {
  const sku = customLabel?.trim();

  return sku ? `    <SKU>${escapeXml(sku.slice(0, 50))}</SKU>` : "";
}

function readNonNegativeNumber(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Number.isInteger(parsed) ? String(parsed) : String(parsed);
}

function readPositiveNumber(value: string | undefined): string | null {
  const parsed = readNonNegativeNumber(value);
  if (parsed === null || Number(parsed) <= 0) {
    return null;
  }

  return parsed;
}

function readRoundedPositiveWholeNumber(value: string | undefined): string | null {
  const parsed = readPositiveNumber(value);
  if (parsed === null) {
    return null;
  }

  return String(Math.ceil(Number(parsed)));
}

function readPackageWeight(specifics: ProductSpecifics | null) {
  const hiddenKg = readNonNegativeNumber(specifics?.["_WeightKg"]);
  const hiddenG = readNonNegativeNumber(specifics?.["_WeightG"]);
  if (hiddenKg !== null || hiddenG !== null) {
    return {
      kg: hiddenKg ?? "0",
      g: hiddenG ?? "0",
    };
  }

  const publicWeight = specifics?.["Item Weight"];
  const parsed = publicWeight ? parsePackageWeight(publicWeight) : null;
  if (!parsed) {
    return null;
  }

  const totalGrams = Math.max(1, Math.ceil(parsed.totalGrams));
  return {
    kg: String(Math.floor(totalGrams / 1000)),
    g: String(totalGrams % 1000),
  };
}

function readPackageDimensions(specifics: ProductSpecifics | null) {
  const hiddenLength = readRoundedPositiveWholeNumber(specifics?.["_LengthCm"]);
  const hiddenWidth = readRoundedPositiveWholeNumber(specifics?.["_WidthCm"]);
  const hiddenHeight = readRoundedPositiveWholeNumber(specifics?.["_HeightCm"]);
  if (hiddenLength || hiddenWidth || hiddenHeight) {
    return {
      length: hiddenLength,
      width: hiddenWidth,
      height: hiddenHeight,
    };
  }

  const publicLength = specifics?.["Item Length"];
  const publicWidth = specifics?.["Item Width"];
  const publicHeight = specifics?.["Item Height"];
  if (!publicLength || !publicWidth || !publicHeight) {
    return null;
  }

  const parsed = parsePackageDimensionValue(
    `${publicLength} x ${publicWidth} x ${publicHeight}`,
  );
  if (!parsed) {
    return null;
  }

  return {
    length: String(Math.ceil(parsed.lengthCm)),
    width: String(Math.ceil(parsed.widthCm)),
    height: String(Math.ceil(parsed.heightCm)),
  };
}

export function buildShippingPackageDetailsXml(
  specifics: ProductSpecifics | null,
): string {
  const weight = readPackageWeight(specifics);
  const dimensions = readPackageDimensions(specifics);

  const rows = [
    "      <MeasurementUnit>Metric</MeasurementUnit>",
    weight
      ? `      <WeightMajor>${escapeXml(weight.kg)}</WeightMajor>`
      : "",
    weight
      ? `      <WeightMinor>${escapeXml(weight.g)}</WeightMinor>`
      : "",
    dimensions?.height
      ? `      <PackageDepth>${escapeXml(dimensions.height)}</PackageDepth>`
      : "",
    dimensions?.length
      ? `      <PackageLength>${escapeXml(dimensions.length)}</PackageLength>`
      : "",
    dimensions?.width
      ? `      <PackageWidth>${escapeXml(dimensions.width)}</PackageWidth>`
      : "",
  ].filter(Boolean);

  if (!weight && !dimensions) {
    return "";
  }

  return `    <ShippingPackageDetails>\n${rows.join("\n")}\n      <ShippingPackage>PackageThickEnvelope</ShippingPackage>\n    </ShippingPackageDetails>`;
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
  const dispatchTimeMax = getDispatchTimeMax(specifics);
  const categoryId = getValidatedCategoryId(product);
  const startPrice = getValidatedPrice(product, overrideStartPrice);
  const quantity = getValidatedQuantity(product);
  const conditionId = product.condition === "New" ? "1000" : "3000";
  const pictureDetailsXml = buildPictureDetailsXml(product.images);
  const itemSpecificsXml = buildItemSpecificsXml(
    product,
    specifics,
    options.itemSpecificMaxCount,
    options.requiredItemSpecificNames,
  );
  const productListingDetailsXml = buildProductListingDetailsXml(specifics);
  const sellerProfilesXml = buildSellerProfilesXml(product);
  const skuXml = buildSkuXml(options.customLabel);
  const shippingPackageDetailsXml = buildShippingPackageDetailsXml(specifics);

  return `<?xml version="1.0" encoding="utf-8"?>
<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>
    <Title>${escapeXml(toEbayListingTitle(product.title))}</Title>
    <Description><![CDATA[${product.description}]]></Description>
    <PrimaryCategory>
      <CategoryID>${escapeXml(categoryId)}</CategoryID>
    </PrimaryCategory>
    <StartPrice>${startPrice}</StartPrice>
    <CategoryMappingAllowed>true</CategoryMappingAllowed>
    <Country>${escapeXml(country)}</Country>
    <Currency>${escapeXml(currency)}</Currency>
    <DispatchTimeMax>${dispatchTimeMax}</DispatchTimeMax>
    <ListingDuration>GTC</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <PrivateListing>${options.privateListing ? "true" : "false"}</PrivateListing>
${skuXml}
    <Quantity>${quantity}</Quantity>
    <ConditionID>${conditionId}</ConditionID>
${productListingDetailsXml}
${pictureDetailsXml}
${itemSpecificsXml}
${shippingPackageDetailsXml}
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
    "ListingDetails",
    "StartTime",
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
    "SKU",
    "Variations",
    "ListingDetails",
    "StartTime",
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
    "ListingDetails",
    "StartTime",
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
  options: ReviseItemOptions = {},
): string {
  if (!product.ebayItemId) {
    throw new Error("Product has not been uploaded to eBay yet.");
  }

  const specifics = getProductSpecifics(product);
  const { location, postalCode } = getLocationMetadata(specifics);
  const dispatchTimeMax = getDispatchTimeMax(specifics);
  const includeTitle = options.includeTitle ?? true;
  const includeSku = options.includeSku ?? false;
  const includeDescription = options.includeDescription ?? true;
  const includeStartPrice = options.includeStartPrice ?? true;
  const includeDispatchTimeMax = options.includeDispatchTimeMax ?? true;
  const includeQuantity = options.includeQuantity ?? true;
  const includeSellerProfiles = options.includeSellerProfiles ?? true;
  const includeLocation = options.includeLocation ?? true;
  const includeItemSpecifics = options.includeItemSpecifics ?? false;
  const includePictures = options.includePictures ?? false;
  const includeShippingPackage = options.includeShippingPackage ?? false;
  const quantity = includeQuantity
    ? getValidatedQuantity(product, options.quantityOverride)
    : null;
  const sellerProfilesXml = includeSellerProfiles ? buildSellerProfilesXml(product) : "";
  const itemSpecificsXml = includeItemSpecifics
    ? buildItemSpecificsXml(product, specifics)
    : "";
  const pictureDetailsXml = includePictures
    ? buildPictureDetailsXml(product.images)
    : "";
  const skuXml = includeSku ? buildSkuXml(options.customLabel) : "";
  const shippingPackageDetailsXml = includeShippingPackage
    ? buildShippingPackageDetailsXml(specifics)
    : "";

  // Use the override price (from the primary variant's sellPrice) when available,
  // otherwise fall back to product.price for backwards compatibility.
  let startPrice: string | null = null;
  if (includeStartPrice && overrideStartPrice !== undefined) {
    const numeric = Number(overrideStartPrice);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new Error("Override start price must be greater than 0.");
    }
    startPrice = numeric.toFixed(2);
  } else if (includeStartPrice) {
    startPrice = getValidatedPrice(product);
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>
    <ItemID>${escapeXml(product.ebayItemId)}</ItemID>
${skuXml}
${includeTitle ? `    <Title>${escapeXml(toEbayListingTitle(product.title))}</Title>` : ""}
${includeDescription ? `    <Description><![CDATA[${product.description}]]></Description>` : ""}
${startPrice ? `    <StartPrice>${startPrice}</StartPrice>` : ""}
${includeDispatchTimeMax ? `    <DispatchTimeMax>${dispatchTimeMax}</DispatchTimeMax>` : ""}
${quantity !== null ? `    <Quantity>${quantity}</Quantity>` : ""}
${sellerProfilesXml}
${includeLocation ? `    <Location>${escapeXml(location)}</Location>
    <PostalCode>${escapeXml(postalCode)}</PostalCode>` : ""}
${pictureDetailsXml}
${itemSpecificsXml}
${shippingPackageDetailsXml}
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

function buildInventoryStatusXml(input: ReviseInventoryStatusItemInput): string {
  const ebayItemId = input.ebayItemId.trim();
  if (!ebayItemId) {
    throw new Error("Inventory revise item ID is required.");
  }

  const numericStartPrice =
    input.startPrice === undefined ? null : Number(input.startPrice);
  if (
    numericStartPrice !== null &&
    (!Number.isFinite(numericStartPrice) || numericStartPrice <= 0)
  ) {
    throw new Error("Inventory revise price must be greater than 0.");
  }

  const startPrice = numericStartPrice === null ? null : numericStartPrice.toFixed(2);

  if (
    input.quantity !== undefined &&
    (!Number.isInteger(input.quantity) || input.quantity < 0)
  ) {
    throw new Error("Inventory revise quantity must be a whole number of 0 or greater.");
  }

  const quantity = input.quantity === undefined ? null : input.quantity.toString();

  if (startPrice === null && quantity === null) {
    throw new Error("Inventory revise requires a price or quantity.");
  }

  return `  <InventoryStatus>
    <ItemID>${escapeXml(ebayItemId)}</ItemID>
${startPrice ? `    <StartPrice>${startPrice}</StartPrice>` : ""}
${quantity !== null ? `    <Quantity>${quantity}</Quantity>` : ""}
  </InventoryStatus>`;
}

export function buildReviseInventoryStatusXML(
  ebayItemId: string,
  input: ReviseInventoryStatusInput,
): string;
export function buildReviseInventoryStatusXML(
  items: ReviseInventoryStatusItemInput[],
): string;
export function buildReviseInventoryStatusXML(
  ebayItemIdOrItems: string | ReviseInventoryStatusItemInput[],
  input?: ReviseInventoryStatusInput,
): string {
  const items = Array.isArray(ebayItemIdOrItems)
    ? ebayItemIdOrItems
    : [{ ebayItemId: ebayItemIdOrItems, ...(input ?? {}) }];

  if (items.length === 0) {
    throw new Error("Inventory revise requires at least one item.");
  }

  if (items.length > 4) {
    throw new Error("Inventory revise supports up to 4 items per call.");
  }

  const inventoryStatusXml = items.map(buildInventoryStatusXml).join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
${inventoryStatusXml}
</ReviseInventoryStatusRequest>`;
}
