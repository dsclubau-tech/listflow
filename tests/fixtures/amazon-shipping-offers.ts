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

export const shippingIncidentProducts = [
  { asin: "B0F9XQQ1GC", price: 89, title: "Sven's Island cream" },
  { asin: "B09RGJY54D", price: 97.99, title: "Manuka Doctor honey" },
  { asin: "B07FGW3YQT", price: 72.87, title: "New Zealand Honey Co honey" },
  { asin: "B00D3VZ5FI", price: 85, title: "NatureBee pollen" },
  { asin: "B0B5T85N8K", price: 119.45, title: "OMRON HEM7144T1" },
] as const;

// Minimal October 8 capture structures. Removing embedded styles when sanitizing
// the OMRON fixture would conceal the dispatch-wrapper defect.
export function shippingIncidentOffer(asin: string, arrival = "Saturday, 10 October", dispatch = "Usually dispatched within 2 to 3 days") {
  const product = shippingIncidentProducts.find(product => product.asin === asin);
  if (!product) throw new Error("Unknown shipping incident fixture");
  const price = `<span class="a-price"><span class="a-offscreen">$${product.price.toFixed(2)}</span></span>`;
  if (asin === "B0B5T85N8K") return `<input id="ASIN" value="${asin}"><div id="desktop_buybox"><div id="buybox">
    ${price}${deliveryBlock(arrival === "Saturday, 10 October" ? "FREE delivery 14 - 15 October. Details" : `FREE delivery ${arrival}`, "")}
    <div id="availabilityInsideBuyBox_feature_div"><style>.availabilityMoreDetailsIcon { width: 12px; }</style>
      <div id="availability">${dispatch}</div></div><input id="add-to-cart-button">
    </div></div>`;
  return `<input id="ASIN" value="${asin}"><div id="desktop_buybox"><div id="buybox"><div id="buyBoxAccordion">
    <div id="newAccordionRow_0">One-time purchase ${price}
      <div id="deliveryBlockSmallMessage"><div id="mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_MEDIUM">FREE delivery ${arrival}</div></div>
      ${deliveryBlock(`FREE delivery ${arrival}. Order within 1 hr 10 mins`, "")}
      <div id="availability">In stock</div><input id="add-to-cart-button">
    </div>
    <div id="snsAccordionRowMiddle">Subscribe &amp; Save <span class="a-price"><span class="a-offscreen">$${(product.price * 0.9).toFixed(2)}</span></span>
      ${deliveryBlock(`FREE delivery ${arrival}`, "")}</div>
    </div></div></div>`;
}

// Sanitized import buy boxes from the October 9 empty-delivery audits.
export const emptyDeliveryProducts = [
  { asin: "B0FQ2JCQBR", price: 182.76, arrival: "Sunday, 18 October 2026", days: 9 },
  { asin: "B0GDYFMWYJ", price: 172.53, arrival: "Monday, 19 October 2026", days: 10 },
] as const;
export function emptyDeliveryOffer(asin: string, loaded: boolean) {
  const product = emptyDeliveryProducts.find(product => product.asin === asin);
  if (!product) throw new Error("Unknown empty delivery fixture");
  const message = loaded ? `FREE International delivery ${product.arrival}. Details ${asin === "B0GDYFMWYJ" ? "Or fastest delivery Thursday, 15 October 2026. Order within 12 hrs 37 mins. Details" : ""}` : " ";
  return `<html><head><title>Fixture import product</title></head><body>
    <input id="ASIN" value="${asin}"><h1 id="productTitle">Fixture import product</h1>
    <div id="glow-ingress-line2">Kogarah 2217</div>
    <div id="buybox"><div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">$${product.price.toFixed(2)}</span></span></div>
    <div id="deliveryBlockMessage">${message}</div><div id="availability">In stock</div>
    <button id="add-to-cart-button">Add to cart</button><div>Shipper / Seller Amazon UK</div></div>
    </body></html>`;
}
