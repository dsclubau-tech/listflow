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
