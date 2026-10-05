import assert from "node:assert/strict";
import test from "node:test";
import { findCurrentProductUploadJob, getUploadOutcomeSummary, readUploadProgressJob, readUploadShippingConfirmation } from "./upload-shipping-presentation";
const confirmation = { sourceJobId: "old", productId: "draft", nonce: "nonce", message: "Unknown" };
const pending = { id: "old", status: "FAILED", productIds: ["draft"], total: 1, processed: 1, succeeded: 0, failed: 1,
  errors: [{ productId: "draft", error: "Unknown", shippingConfirmation: confirmation }] };
test("only complete structured confirmation for the matching product is a decision", () => {
  assert.deepEqual(readUploadShippingConfirmation(confirmation, "draft"), confirmation);
  for (const value of [null, "Unknown", {message:"Unknown"}, {...confirmation,nonce:""}, {...confirmation,message:42}])
    assert.equal(readUploadShippingConfirmation(value, "draft"), null);
  assert.equal(readUploadShippingConfirmation(confirmation, "other"), null);
});
test("summaries separate genuine failures and count each pending product once", () => {
  assert.deepEqual(getUploadOutcomeSummary({...pending,failed:2,errors:[...pending.errors,...pending.errors,{productId:"other",error:"Failure"}]}),
    {awaitingDecision:1,failed:1});
  assert.deepEqual(getUploadOutcomeSummary({failed:2}), {awaitingDecision:0,failed:2});
});
test("active attempts replace older confirmations; persisted decisions can be restored", () => {
  const active={...pending,id:"new",status:"QUEUED",errors:[],failed:0};
  assert.equal(findCurrentProductUploadJob([pending,active],"draft"),active);
  assert.equal(findCurrentProductUploadJob([pending],"draft"),pending);
  assert.equal(findCurrentProductUploadJob([pending],"other"),null);
});
test("decision response progress must have a valid shape", () => {
  assert.deepEqual(readUploadProgressJob(pending),pending);
  for(const value of [null,{}, {...pending,total:"1"},{...pending,productIds:[42]}, {...pending,failed:-1}])
    assert.equal(readUploadProgressJob(value),null);
});
