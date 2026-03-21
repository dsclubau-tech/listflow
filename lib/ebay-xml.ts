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
 */
export function buildAddItemXML(product: ProductWithStore, token: string): string {
  const conditionId = product.condition === "New" ? "1000" : "3000";

  // Build PictureURL tags (max 12)
  const pictureUrls = product.images
    .slice(0, 12)
    .map((url) => `      <PictureURL>${escapeXml(url)}</PictureURL>`)
    .join("\n");

  // Build ItemSpecifics tags from JSON object
  const specifics = product.itemSpecifics as Record<string, string> | null;
  let itemSpecificsXml = "";
  if (specifics && typeof specifics === "object") {
    const entries = Object.entries(specifics).filter(
      ([key, value]) => key.trim() !== "" && value.trim() !== ""
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
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${token}</eBayAuthToken>
  </RequesterCredentials>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>
    <Title>${escapeXml(product.title)}</Title>
    <Description><![CDATA[${product.description}]]></Description>
    <PrimaryCategory>
      <CategoryID>58058</CategoryID>
    </PrimaryCategory>
    <StartPrice>${product.price.toString()}</StartPrice>
    <CategoryMappingAllowed>true</CategoryMappingAllowed>
    <Country>AU</Country>
    <Currency>AUD</Currency>
    <DispatchTimeMax>3</DispatchTimeMax>
    <ListingDuration>GTC</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <Quantity>${product.quantity.toString()}</Quantity>
    <ConditionID>${conditionId}</ConditionID>
    <PictureDetails>
${pictureUrls}
    </PictureDetails>
${itemSpecificsXml}
    <ReturnPolicy>
      <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>
      <RefundOption>MoneyBack</RefundOption>
      <ReturnsWithinOption>Days_30</ReturnsWithinOption>
      <ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption>
    </ReturnPolicy>
    <ShippingDetails>
      <ShippingType>Flat</ShippingType>
      <ShippingServiceOptions>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>AU_Regular</ShippingService>
        <ShippingServiceCost>0.00</ShippingServiceCost>
      </ShippingServiceOptions>
    </ShippingDetails>
    <Site>Australia</Site>
  </Item>
</AddItemRequest>`;
}
