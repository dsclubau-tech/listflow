import assert from "node:assert/strict";
import test from "node:test";
import { inventoryJobCounts, prepareInventoryJobRetry } from "./ebay-inventory-job-results";
test("retry five variation failures preserves 405 successes and the ended failure", () => {
    const ids = Array.from({ length: 411 }, (_, i) => "p" + i), errors = ids.slice(405).map((productId, i) => ({ productId, title: "Product", error: i === 5 ? "This eBay listing has ended." : "Variation SKU required" }));
    const result = prepareInventoryJobRetry({ completedProductIds: ids, succeeded: 405, failed: 6, errors }, ids.slice(405));
    assert.equal(result.ids.length, 5);
    assert.equal(result.succeeded, 405);
    assert.equal(result.failed, 1);
    assert.equal(result.completed.length, 406);
    assert.equal(result.succeeded + result.ids.length, 410);
});
test("deferred prices count products once and cannot enter a retry loop", () => {
 const deferred={productId:"p",title:"P",error:"Price update waiting for stock restoration.",awaitingRestoration:3,variationResults:[{state:"DEFERRED",target:{sku:"a"}},{state:"DEFERRED",target:{sku:"b"}}]};
 assert.deepEqual(inventoryJobCounts({failed:2,errors:[deferred,deferred,{productId:"failed",title:"F",error:"Rejected",retryEligible:false}]}),{verification:0,awaitingRestoration:1,failed:1,retryable:0});
 const result=prepareInventoryJobRetry({completedProductIds:["p"],succeeded:405,failed:1,errors:[deferred]},["p"]);assert.deepEqual(result.ids,[]);assert.equal(result.failed,1);
});
test("job display counts each product once and older response fields still work", () => {
    assert.deepEqual(inventoryJobCounts({ failed: 3, errors: [] }), { verification: 0, awaitingRestoration: 0, failed: 3, retryable: 3 });
    const error = { productId: "p", title: "P", error: "Unknown", outcomeUncertain: true };
    assert.deepEqual(inventoryJobCounts({ failed: 1, errors: [error, error] }), { verification: 1, awaitingRestoration: 0, failed: 0, retryable: 1 });
});
test("selected retry excludes unselected products and permanent mappings", () => {
    const errors = [{ productId: "a", title: "A", error: "Mapping missing", retryEligible: false }, { productId: "b", title: "B", error: "Temporary" }, { productId: "c", title: "C", error: "Unknown", outcomeUncertain: true }];
    const r = prepareInventoryJobRetry({ completedProductIds: ["a", "b", "c"], succeeded: 405, failed: 3, errors }, ["a", "b", "c"], ["a", "c"]);
    assert.deepEqual(r.ids, ["c"]);
    assert.equal(r.failed, 2);
});
