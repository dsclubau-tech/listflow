import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAmazonShippingEvidence, evaluateAmazonShipping, readAmazonShippingEvidence } from './amazon-shipping-evidence';
import { extractAmazonShippingEvidenceFromHtml } from './amazon-shipping-extraction';
import { extractAmazonPriceSnapshot } from './amazon-price-snapshot';

const now = new Date('2026-10-04T01:00:00Z');
function parse(arrivalText: string | null, dispatchText: string | null = null, observedAt = now) {
  return parseAmazonShippingEvidence({asin:'B0CDHH9S87',mode:'REGULAR',postcode:'2217',observedAt,source:'fixture',arrivalText,dispatchText,associated:true});
}
test('screenshot arrival and six-to-seven-month dispatch exceed 25 days', () => {
  const evidence = parse('FREE delivery from Germany 2 March - 17 April, 2027. Details', 'Usually dispatched within 6 to 7 months');
  assert.equal(evidence.arrivalLatest, '2027-04-17');
  assert.equal(evidence.dispatchLatest, '2027-05-04');
  assert.equal(evaluateAmazonShipping(evidence,25,now).outcome,'OVER_LIMIT');
});
test('24/25/26 calendar-day boundaries', () => {
  for (const [date,days,outcome] of [['28 October',24,'WITHIN_LIMIT'],['29 October',25,'WITHIN_LIMIT'],['30 October',26,'OVER_LIMIT']] as const) {
    const result = evaluateAmazonShipping(parse(`FREE delivery ${date}`),25,now);
    assert.equal(result.arrivalDays,days); assert.equal(result.outcome,outcome);
  }
});
test('shared month, weekdays, year rollover, leap date, relative dates and weeks', () => {
  for (const [text,at,latest] of [
    ['FREE delivery Monday, 5 - 8 October',now,'2026-10-08'],
    ['FREE delivery 30 December - 2 January, 2027',new Date('2026-12-20T00:00:00Z'),'2027-01-02'],
    ['FREE delivery 30 December - 2 January',new Date('2026-12-20T00:00:00Z'),'2027-01-02'],
    ['FREE delivery 29 February 2028',new Date('2028-02-01T00:00:00Z'),'2028-02-29'],
    ['FREE delivery 08/10/2026',now,'2026-10-08'],
    ['FREE delivery tomorrow',now,'2026-10-05'],['FREE delivery today',now,'2026-10-04'],
    ['Delivery in 2 to 4 weeks',now,'2026-11-01'],
  ] as const) assert.equal(parse(text,null,at).arrivalLatest,latest,text);
});
test('calendar arithmetic survives midnight and DST and clamps month-end', () => {
  assert.equal(parse('delivery tomorrow',null,new Date('2026-10-03T15:30:00Z')).arrivalLatest,'2026-10-05');
  assert.equal(parse(null,'Usually dispatched within 1 month',new Date('2027-01-31T00:00:00Z')).dispatchLatest,'2027-02-28');
});
test('short dispatch alone, invalid or unsupported dates never pass', () => {
  for (const evidence of [parse(null,'Usually dispatched within 2 days'),parse('delivery 31 February 2027'),parse('Delivery in 2 business days'),parse('Delivery soon'),parse('Delivery tomorrow or 30 October'),parse('Delivery 5 October and 30 October'),parse('$9.95 delivery')]) {
    assert.equal(evaluateAmazonShipping(evidence,25,now).outcome,'UNKNOWN');
  }
  assert.equal(evaluateAmazonShipping(parse(null,'Usually dispatched within 6 to 7 months'),25,now).outcome,'OVER_LIMIT');
});
test('unassociated evidence, malformed persisted JSON and stale/future evidence cannot pass recovery', () => {
  const input = parse('Delivery tomorrow');
  assert.equal(readAmazonShippingEvidence({...input,arrivalLatest:'2026-02-31'}),null);
  assert.equal(readAmazonShippingEvidence({...input,mode:'USED'}),null);
  const detached = parseAmazonShippingEvidence({...input,observedAt:now,associated:false});
  assert.equal(evaluateAmazonShipping(detached,25,now).outcome,'UNKNOWN');
  assert.equal(evaluateAmazonShipping(input,25,new Date(now.getTime()+15*60_000+1),true).outcome,'UNKNOWN');
  assert.equal(evaluateAmazonShipping(input,25,new Date(now.getTime()-60_000),true).outcome,'UNKNOWN');
});
function selected(html:string) {
  const offer = extractAmazonPriceSnapshot(html,'B0CDHH9S87').priceChoices.regular;
  assert.ok(offer); return offer;
}
test('only primary product delivery is used; faster paid option is ignored', () => {
  const html='<div id="buybox"><span class="a-price"><span class="a-offscreen">$96.75</span></span><div id="deliveryBlockMessage">FREE delivery 30 October. Or fastest delivery tomorrow for $20</div><div id="availability">Usually dispatched within 6 to 7 months</div></div>';
  const evidence=extractAmazonShippingEvidenceFromHtml(html,selected(html),'2217',now);
  assert.equal(evidence.arrivalLatest,'2026-10-30');
  assert.equal(evaluateAmazonShipping(evidence,25,now).outcome,'OVER_LIMIT');
});
test('conflicting messages and recommendation promises remain unknown', () => {
  const html='<div id="buybox"><span class="a-price"><span class="a-offscreen">$20</span></span><div data-csa-c-delivery-time="a">delivery tomorrow</div><div data-csa-c-delivery-time="b">delivery 30 October</div></div>';
  assert.equal(extractAmazonShippingEvidenceFromHtml(html,selected(html),'2217',now).outcome,'UNKNOWN');
  const unrelated='<div id="buybox"><span class="a-price"><span class="a-offscreen">$20</span></span></div><div id="recommendations"><div id="deliveryBlockMessage">delivery tomorrow</div></div>';
  assert.equal(extractAmazonShippingEvidenceFromHtml(unrelated,selected(unrelated),'2217',now).outcome,'UNKNOWN');
});

test('conflicting timing in one message cannot establish arrival or dispatch', () => {
  for (const text of ['Delivery in 2 days or 6 weeks', 'Delivery in 2 days; estimated arrival 30 October', 'Delivery tomorrow or next week', 'Delivery in 2 days or six weeks', 'Delivery 5 October or next week']) {
    assert.equal(evaluateAmazonShipping(parse(text), 25, now).outcome, 'UNKNOWN', text);
  }
  for (const text of ['Usually dispatched within 2 days or 6 months', 'Usually dispatched within 2 days or six months']) {
    assert.equal(evaluateAmazonShipping(parse(null, text), 25, now).outcome, 'UNKNOWN', text);
  }
});
