import assert from "node:assert/strict";
import test from "node:test";
import { getAmazonShippingDisplay, getProductShippingPresentation, getAmazonShippingDisplayMessage } from "./amazon-shipping-display";
import { parseAmazonShippingEvidence, SHIPPING_EVIDENCE_MAX_AGE_MS } from "./amazon-shipping-evidence";
import { resolveCurrentHoldReason } from "./current-hold-reason";

const at = new Date("2026-10-06T07:21:57Z");
const product = { asin:"B0DFL96H43",amazonPriceTrackingMode:"REGULAR",lastPriceCheck:at,holdLastObservationId:"accepted" };
const observation = {
  id:"accepted",requestedAsin:product.asin,selectedAsin:product.asin,identityOutcome:"MATCH",buyBoxOutcome:"AVAILABLE",
  postcodeVerified:true,verifiedPostcode:"2217",isSuccessful:true,eligibleOffer:true,priceMode:"REGULAR",
  price:"67.95",regularPrice:"67.95",dealPrice:null,stockLeft:4,observedAt:at,
  shippingEvidence:parseAmazonShippingEvidence({asin:product.asin,mode:"REGULAR",postcode:"2217",observedAt:at,
    source:"selected-buybox:primary-delivery",arrivalText:"FREE delivery 15 October",associated:true}),
};
const settings={maxShippingDays:25,scrapePostcode:"2217"};
test("accepted shipping remains quiet at zero, fifteen minutes and one millisecond past expiry",()=>{
  for(const age of [0,SHIPPING_EVIDENCE_MAX_AGE_MS,SHIPPING_EVIDENCE_MAX_AGE_MS+1]) {
    const result=getProductShippingPresentation(product,[observation],settings,new Date(at.getTime()+age));
    assert.deepEqual(result.amazonShippingDisplay,{state:"QUIET",message:null});
    assert.equal(result.amazonShippingStatus?.outcome,age>SHIPPING_EVIDENCE_MAX_AGE_MS?"UNKNOWN":"WITHIN_LIMIT");
  }
});
test("verified upload evidence is visible before the first committed tracking observation",()=>{
  const uploaded={...product,lastPriceCheck:null,holdLastObservationId:null};
  const result=getProductShippingPresentation(uploaded,[observation],settings,at);
  assert.equal(result.amazonShippingDisplay?.state,"QUIET");
  assert.equal(result.amazonShippingStatus?.outcome,"UNKNOWN"); // It cannot authorize recovery.
  assert.equal(uploaded.lastPriceCheck,null);assert.equal(uploaded.holdLastObservationId,null);
});
test("latest failed, unknown or context-mismatched attempt cannot be hidden by an older success",()=>{
  const later=new Date(at.getTime()+1000);
  for(const update of [
    {isSuccessful:false},{eligibleOffer:false},{shippingEvidence:null},
    {shippingEvidence:{...observation.shippingEvidence,outcome:"UNKNOWN",arrivalEarliest:null,arrivalLatest:null,observedAt:later.toISOString()}},
    {requestedAsin:"B0FPKSQ4WW"},{selectedAsin:"B0FPKSQ4WW"},{verifiedPostcode:"3000"},
  ]) {
    const recent={...observation,id:"newer",observedAt:later,...update};
    assert.equal(getAmazonShippingDisplay(product,[observation,recent],"2217",25,later).state,"UNVERIFIED");
  }
});
test("ASIN, postcode, preference and limit changes re-evaluate display evidence",()=>{
  assert.equal(getAmazonShippingDisplay({...product,asin:"B0FPKSQ4WW"},[observation],"2217",25,at).state,"UNVERIFIED");
  assert.equal(getAmazonShippingDisplay(product,[observation],"3000",25,at).state,"UNVERIFIED");
  const deal={...observation,priceMode:"DEAL",shippingEvidence:{...observation.shippingEvidence,mode:"DEAL"}};
  assert.equal(getAmazonShippingDisplay(product,[deal],"2217",25,at).state,"UNVERIFIED");
  assert.equal(getAmazonShippingDisplay({...product,amazonPriceTrackingMode:"DEAL"},[deal],"2217",25,at).state,"QUIET");
  assert.equal(getAmazonShippingDisplay({...product,amazonPriceTrackingMode:"DEAL"},[{...observation,dealPrice:"59"}],"2217",25,at).state,"UNVERIFIED");
  assert.equal(getAmazonShippingDisplay({...product,amazonPriceTrackingMode:"DEAL"},[observation],"2217",25,at).state,"QUIET");
  assert.equal(getAmazonShippingDisplay(product,[observation],"2217",8,at).state,"OVER_LIMIT");
});
test("malformed, unverified, unavailable and inconsistent observations remain visible",()=>{
  for(const update of [{price:0},{price:"NaN"},{price:null},{stockLeft:0},{postcodeVerified:false},
    {identityOutcome:"MISMATCH"},{buyBoxOutcome:"UNKNOWN"},{shippingEvidence:{version:99}},
    {shippingEvidence:{...observation.shippingEvidence,observedAt:new Date(at.getTime()+1).toISOString()}},
    {shippingEvidence:{...observation.shippingEvidence,arrivalLatest:"2026-02-31"}},
  ]) assert.equal(getAmazonShippingDisplay(product,[{...observation,...update}],"2217",25,at).state,"UNVERIFIED");
  assert.equal(getAmazonShippingDisplay(product,[],"2217",25,at).state,"UNVERIFIED");
});
test("stale delay describes the last result while expired recovery requires fresh verification",()=>{
  const now=new Date(at.getTime()+SHIPPING_EVIDENCE_MAX_AGE_MS+1);
  const result=getProductShippingPresentation(product,[observation],{...settings,maxShippingDays:8},now);
  assert.equal(result.amazonShippingDisplay?.state,"OVER_LIMIT");
  assert.match(result.amazonShippingDisplay!.message!,/last verified.*Recheck/);
  const reason=resolveCurrentHoldReason({status:"ON_HOLD",holdOrigin:"PRICE_CHECK_FAILURE",savedQuantity:0,minimumProductQuantity:2,
    asin:product.asin,lastPriceCheck:at,latestObservation:observation,amazonShippingStatus:result.amazonShippingStatus});
  assert.match(reason.currentHoldReason!,/Fresh delivery verification is required before stock can be restored/);
});
test("display messages preserve older responses and keep valid new results quiet",()=>{
  const unknown=getProductShippingPresentation(product,[],settings,at).amazonShippingStatus;
  assert.equal(getAmazonShippingDisplayMessage(undefined,unknown),unknown!.message);
  assert.equal(getAmazonShippingDisplayMessage({state:"QUIET",message:null},unknown),null);
  assert.match(getAmazonShippingDisplayMessage({state:"UNVERIFIED",message:"Actual failure"},undefined)! ,/Actual failure/);
});
