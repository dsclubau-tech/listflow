import type { Product, Store } from "@/app/generated/prisma/client";

type ProductWithStore = Product & { store: Store };

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

/**
 * Builds a valid eBay AddItem XML request body for the Trading API.
 * Throws if any business policy ID is missing.
 *
 * Location/country/currency/site are read from itemSpecifics using _-prefixed
 * internal keys set by InlineEditForm. These keys are NOT emitted as ItemSpecifics.
 */
export function buildAddItemXML(product: ProductWithStore): string {
  // Validate policy IDs before building XML
  if (!product.shippingPolicyId) {
    throw new Error("Shipping Policy is required — please select one on the Product tab.");
  }
  if (!product.returnPolicyId) {
    throw new Error("Return Policy is required — please select one on the Product tab.");
  }
  if (!product.paymentPolicyId) {
    throw new Error("Payment Policy is required — please select one on the Product tab.");
  }

  const conditionId = product.condition === "New" ? "1000" : "3000";

  // Read internal location metadata from itemSpecifics (set by InlineEditForm)
  const specifics = product.itemSpecifics as Record<string, string> | null;
  const country = specifics?.["_Country"] || "AU";
  const currency = specifics?.["_Currency"] || "AUD";
  const site = specifics?.["_Site"] || "Australia";
  const location = specifics?.["_Location"] || "Australia";
  const postalCode = specifics?.["_PostalCode"] || "3000";

  // Use product.category as the eBay CategoryID
  const categoryId = (product.category || "").trim();
  if (!categoryId) {
    throw new Error("Category is required — please enter a numeric eBay Category ID on the Product tab.");
  }

  // Ensure category is numeric
  if (!/^\d+$/.test(categoryId)) {
    throw new Error(`Invalid Category: "${categoryId}". eBay requires a numeric Category ID (e.g., 171114). Please update it on the Product tab.`);
  }

  // Build PictureURL tags (max 12)
  const pictureUrls = product.images
    .slice(0, 12)
    .map((url) => `      <PictureURL>${escapeXml(url)}</PictureURL>`)
    .join("\n");

  // Build ItemSpecifics tags — exclude _-prefixed internal metadata keys
  let itemSpecificsXml = "";
  if (specifics && typeof specifics === "object") {
    // Ensure "Type" is present (eBay often requires it)
    const normalizedSpecifics = { ...specifics };
    const hasType = Object.keys(normalizedSpecifics).some(k => k.toLowerCase() === "type");
    
    if (!hasType) {
      // Use the last part of categoryName (e.g., "Pressure Washers") or a default
      const defaultType = product.categoryName?.split(">").pop()?.trim() || "Other";
      normalizedSpecifics["Type"] = defaultType;
    }

    const entries = Object.entries(normalizedSpecifics).filter(
      ([key, value]) =>
        !key.startsWith("_") &&
        key.trim() !== "" &&
        value.trim() !== ""
    );
    if (entries.length > 0) {
      const nameValueLists = entries
        .map(
          ([key, value]) =>
            `      <NameValueList>\n        <Name>${escapeXml(key)}</Name>\n        <Value>${escapeXml(value)}</Value>\n      </NameValueList>`
        )
        .join("\n");
      itemSpecificsXml = `    <ItemSpecifics>\n${nameValueLists}\n    </ItemSpecifics>`;
    }
  } else {
    // No specifics at all? At least add Type
    const defaultType = product.categoryName?.split(">").pop()?.trim() || "Other";
    itemSpecificsXml = `    <ItemSpecifics>\n      <NameValueList>\n        <Name>Type</Name>\n        <Value>${escapeXml(defaultType)}</Value>\n      </NameValueList>\n    </ItemSpecifics>`;
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>
    <Title>${escapeXml(product.title)}</Title>
    <Description><![CDATA[${product.description}]]></Description>
    <PrimaryCategory>
      <CategoryID>${escapeXml(categoryId)}</CategoryID>
    </PrimaryCategory>
    <StartPrice>${product.price.toString()}</StartPrice>
    <CategoryMappingAllowed>true</CategoryMappingAllowed>
    <Country>${escapeXml(country)}</Country>
    <Currency>${escapeXml(currency)}</Currency>
    <DispatchTimeMax>3</DispatchTimeMax>
    <ListingDuration>GTC</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <Quantity>${product.quantity.toString()}</Quantity>
    <ConditionID>${conditionId}</ConditionID>
    <ProductListingDetails>
      <UPC>${escapeXml(specifics?.["UPC"] || specifics?.["EAN"] || "Does not apply")}</UPC>
    </ProductListingDetails>
    <PictureDetails>
${pictureUrls}
    </PictureDetails>
${itemSpecificsXml}
    <SellerProfiles>
      <SellerShippingProfile>
        <ShippingProfileID>${product.shippingPolicyId}</ShippingProfileID>
      </SellerShippingProfile>
      <SellerReturnProfile>
        <ReturnProfileID>${product.returnPolicyId}</ReturnProfileID>
      </SellerReturnProfile>
      <SellerPaymentProfile>
        <PaymentProfileID>${product.paymentPolicyId}</PaymentProfileID>
      </SellerPaymentProfile>
    </SellerProfiles>
    <Location>${escapeXml(location)}</Location>
    <PostalCode>${escapeXml(postalCode)}</PostalCode>
    <Site>${escapeXml(site)}</Site>
  </Item>
</AddItemRequest>`;
}
