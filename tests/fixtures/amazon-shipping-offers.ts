// Synthetic markup based on the supplied screenshot and redacted audit captures.
export function deliveryBlock(primary = "FREE delivery Saturday, 10 October", faster = "Or fastest delivery Thursday, 8 October", size = "LARGE") {
  return `<div id="deliveryBlockMessage"><div id="mir-layout-DELIVERY_BLOCK">
    <div id="mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_${size}"><span data-csa-c-delivery-time="primary">${primary}</span></div>
    <div id="mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_${size}"><span data-csa-c-delivery-time="secondary">${faster}</span></div>
  </div></div>`;
}
export function normalShippingOffer(primary?: string, faster?: string, size?: string) {
  return `<input id="ASIN" value="B0FPQNVHG8"><div id="desktop_buybox"><div id="buybox">
    <span class="a-price"><span class="a-offscreen">$137.73</span></span>
    ${deliveryBlock(primary, faster, size)}<div id="availability">In stock</div><input id="add-to-cart-button">
  </div></div>`;
}
export function accordionShippingOffers(includeDeal = true) {
  return `<input id="ASIN" value="B0FPQNVHG8"><div id="buybox"><div id="buyBoxAccordion">
    ${includeDeal ? `<div id="primeSavingsUpsellAccordionRow" data-csa-c-buying-option-type="PRIME_SAVINGS_UPSELL">
      Deal price <span class="a-price"><span class="a-offscreen">$119.99</span></span>
      ${deliveryBlock("FREE delivery 6 October", "Or fastest delivery tomorrow")}</div>` : ""}
    <div id="newAccordionRow_1" data-csa-c-buying-option-type="NEW">Regular Price
      <span class="a-price"><span class="a-offscreen">$149.99</span></span>
      ${deliveryBlock()}<input id="add-to-cart-button">
    </div></div></div>`;
}

// Sanitized structure from the Cuisinart New/Used audit, including nested price nodes.
export function newAndUsedShippingOffers(includeUsed = true) {
  const price = (amount: string, type: string) => `<div data-csa-c-buying-option-type="${type}"><span data-csa-c-buying-option-type="${type}"><span class="a-price"><span class="a-offscreen">$${amount}</span></span></span></div>`;
  return `<input id="ASIN" value="B0FPKSQ4WW"><div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">$209.00</span></span></div>
    <div id="desktop_buybox"><div id="buybox"><div id="buyBoxAccordion">
    <div id="newAccordionRow_0">Buy New ${price("209.00", "NEW")}${deliveryBlock("FREE delivery Sunday, 11 October", undefined, "MEDIUM")}<input id="add-to-cart-button"></div>
    ${includeUsed ? `<div id="usedAccordionRow">Used – Very Good ${price("192.28", "USED")}${deliveryBlock("FREE delivery Thursday, 15 October")}</div>` : ""}
    </div></div></div>`;
}
