import assert from "node:assert/strict";
import test from "node:test";
import { XMLParser } from "fast-xml-parser";
import { parseInventorySnapshot, parseInventoryResponse, planInventory, executeInventory, type InventoryPlan, type InventorySnapshot } from "./ebay-inventory";
const skus = ["B09682CXNR", "B0CNCP33BQ", "B0CNCRBRM1"];
function snapshot(count = 3): InventorySnapshot { return { itemId: "305059787257", status: "Active", tracking: "ItemID", currency: "AUD", variation: true, entries: Array.from({ length: count }, (_, i) => ({ sku: skus[i] ?? "sku-" + i, price: 50 + i * 20, quantity: i + 1 })) }; }
function plan(count = 3): InventoryPlan { const s = snapshot(count); return planInventory({ storeId: "store", productId: "baboni", itemId: s.itemId, currency: "AUD", snapshot: s, variants: s.entries.map((e, i) => ({ id: "v" + i, sku: e.sku! })), requests: s.entries.map((_, i) => ({ variantId: "v" + i, price: 55 + i * 23 })) }); }
function harness(p = plan()) {
    let remote = snapshot(p.targets.length), writes = 0, reads = 0;
    const applied: string[] = [], saves: InventoryPlan[] = [];
    let failAfterApply = false, partial = false, readFails = false;
    let applyFails = false;
    const io = { read: async () => { reads++; if (readFails && writes)
            throw Error("read timeout"); return structuredClone(remote); }, save: async (p: InventoryPlan) => { saves.push(structuredClone(p)); }, assertCurrent: async () => { },
        apply: async (t: InventoryPlan["targets"][number]) => { if (applyFails)
            throw Error("DB unavailable"); applied.push(t.target.sku!); },
        write: async (xml: string) => {
            writes++;
            const rows = new XMLParser({ parseTagValue: false }).parse(xml).ReviseInventoryStatusRequest.InventoryStatus;
            const entries = Array.isArray(rows) ? rows : [rows];
            assert.ok(entries.length <= 4);
            entries.forEach((row, i) => { if (partial && i > 0)
                return; const e = remote.entries.find(e => e.sku === row.SKU)!; if (row.StartPrice !== undefined)
                e.price = Number(row.StartPrice); if (row.Quantity !== undefined)
                e.quantity = Number(row.Quantity); });
            if (failAfterApply)
                throw Error("timeout after write");
            if (partial)
                return { success: false, errors: [{ code: "219", severity: "Error", message: "Rejected", parameters: { SKU: entries[1].SKU }, system: false }] };
            return { success: true };
        } };
    return { p, io, applied, saves, count: () => ({ writes, reads }), remote: () => remote, setRemote: (s: InventorySnapshot) => { remote = s; }, partial: () => { partial = true; }, timeout: () => { failAfterApply = true; }, readFails: () => { readFails = true; }, dbFails: (b: boolean) => { applyFails = b; } };
}
test("GetItem preserves exact XML-sensitive and case-sensitive SKUs and available quantity", () => {
    const xml = '<GetItemResponse><Ack>Success</Ack><Item><ItemID>304997589004</ItemID><SellingStatus><ListingStatus>Active</ListingStatus></SellingStatus><InventoryTrackingMethod>SKU</InventoryTrackingMethod><Variations><Variation><SKU>a&amp;B</SKU><StartPrice currencyID="AUD">125.00</StartPrice><Quantity>7</Quantity><SellingStatus><QuantitySold>3</QuantitySold></SellingStatus></Variation></Variations></Item></GetItemResponse>';
    const s = parseInventorySnapshot(xml, "304997589004");
    assert.equal(s.variation, true);
    assert.equal(s.entries[0].sku, "a&B");
    assert.equal(s.entries[0].quantity, 4);
});
test("ended listing is a separate permanent rejection", () => {
    assert.throws(() => parseInventorySnapshot('<GetItemResponse><Ack>Success</Ack><Item><ItemID>307038451893</ItemID><SellingStatus><ListingStatus>Completed</ListingStatus></SellingStatus></Item></GetItemResponse>', "307038451893"), /listing has ended/);
});
test("one remaining eBay variation still needs exact mapping", () => {
    const s = snapshot(1);
    const input = { storeId: "store", productId: "p", itemId: s.itemId, currency: "AUD", snapshot: s, variants: [{ id: "v", sku: "wrong-parent-ASIN" }], requests: [{ variantId: "v", price: 52 }] };
    assert.throws(() => planInventory(input), /SKU no longer matches/);
    assert.equal(planInventory({ ...input, variants: [{ id: "v", sku: skus[0] }] }).targets[0].target.sku, skus[0]);
});
test("duplicate local or remote SKU, missing target and currency are rejected", () => {
    const p = plan();
    const input = { storeId: "store", productId: "p", itemId: p.itemId, currency: "AUD", snapshot: snapshot(), variants: skus.map((sku, i) => ({ id: "v" + i, sku })), requests: [{ variantId: "v0", price: 52 }] };
    assert.throws(() => planInventory({ ...input, currency: "USD" }), /currency/);
    assert.throws(() => planInventory({ ...input, variants: [{ id: "v0", sku: skus[0] }, { id: "v1", sku: skus[0] }] }), /duplicate/);
    const s = snapshot();
    s.entries[1].sku = skus[0];
    assert.throws(() => planInventory({ ...input, snapshot: s }), /duplicate/);
});
test("ordinary ItemID and SKU tracking remain compatible", () => {
    for (const tracking of ["ItemID", "SKU"]) {
        const s = { ...snapshot(1), variation: false, tracking, sku: "exact-item-sku" };
        const p = planInventory({ storeId: "s", productId: "p", itemId: s.itemId, currency: "AUD", snapshot: s, variants: [], requests: [{ quantity: 1 }] });
        assert.equal(p.targets[0].target.sku, tracking === "SKU" ? "exact-item-sku" : undefined);
    }
});
test("Baboni uses each variation price and preserves quantities on fee-only edits", async () => {
    const f = harness();
    const before = f.remote().entries.map(e => e.quantity);
    const r = await executeInventory(f.p, f.io);
    assert.equal(r.success, true);
    assert.deepEqual(f.remote().entries.map(e => e.price), [55, 78, 101]);
    assert.deepEqual(f.remote().entries.map(e => e.quantity), before);
});
test("more than four variations split by entries and preserve confirmed checkpoints", async () => {
    const f = harness(plan(9));
    assert.equal((await executeInventory(f.p, f.io)).success, true);
    assert.equal(f.count().writes, 3);
    assert.equal(f.applied.length, 9);
});
test("mixed response commits confirmed target and does not roll back it or resend rejected targets", async () => {
    const f = harness();
    f.partial();
    const r = await executeInventory(f.p, f.io);
    assert.equal(r.success, false);
    assert.equal(f.p.targets[0].state, "CONFIRMED");
    assert.equal(f.p.targets[1].state, "REJECTED");
    assert.equal(f.p.targets[2].state, "UNCERTAIN");
    assert.deepEqual(f.applied, [skus[0]]);
    await executeInventory(f.p, f.io);
    assert.equal(f.count().writes, 1);
});
test("timeout after application is confirmed by readback with no duplicate write", async () => {
    const f = harness();
    f.timeout();
    assert.equal((await executeInventory(f.p, f.io)).success, true);
    await executeInventory(f.p, f.io);
    assert.equal(f.count().writes, 1);
});
test("unknown outcome reconciles on restart without resending", async () => {
    const f = harness();
    f.readFails();
    assert.equal((await executeInventory(f.p, f.io)).outcomeUncertain, true);
    const remote = f.remote();
    const io = { ...f.io, read: async () => structuredClone(remote) };
    assert.equal((await executeInventory(f.p, io)).success, true);
    assert.equal(f.count().writes, 1);
});
test("remote success followed by DB failure reapplies confirmed values without another eBay write", async () => {
    const f = harness();
    f.dbFails(true);
    await assert.rejects(executeInventory(f.p, f.io), /DB unavailable/);
    f.dbFails(false);
    assert.equal((await executeInventory(f.p, f.io)).success, true);
    assert.equal(f.count().writes, 1);
});
test("concurrent seller change or sale requires review and makes no reset write", async () => {
    const f = harness();
    const s = f.remote();
    s.entries[0].price = 47;
    const r = await executeInventory(f.p, f.io);
    assert.equal(r.outcomeUncertain, true);
    assert.equal(f.count().writes, 0);
});
test("cancellation after first chunk preserves four confirmations", async () => {
    const f = harness(plan(6));
    let assertions = 0;
    await assert.rejects(executeInventory(f.p, { ...f.io, assertCurrent: async () => { if (++assertions === 3)
            throw Error("cancelled"); } }), /cancelled/);
    assert.equal(f.p.targets.filter(t => t.state === "CONFIRMED").length, 4);
    assert.equal(f.count().writes, 1);
});
test("automatic recovery permits one verified variation but not several", () => {
    const s = snapshot();
    const input = { storeId: "s", productId: "p", itemId: s.itemId, currency: "AUD", snapshot: s, variants: skus.map((sku, i) => ({ id: "v" + i, sku })), requests: [{ variantId: "v0", quantity: 1 }], automaticRecovery: true };
    assert.throws(() => planInventory(input), /These variations need verification/);
    assert.equal(planInventory({ ...input, snapshot: snapshot(1), variants: [{ id: "v0", sku: skus[0] }] }).targets.length, 1);
});
test("malformed response stays uncertain and structured errors retain codes and target parameters", () => {
    assert.equal(parseInventoryResponse("timeout").outcomeUncertain, true);
    const r = parseInventoryResponse('<ReviseInventoryStatusResponse><Ack>PartialFailure</Ack><Errors><ErrorCode>219</ErrorCode><SeverityCode>Error</SeverityCode><LongMessage>Bad SKU</LongMessage><ErrorClassification>RequestError</ErrorClassification><ErrorParameters ParamID="SKU"><Value>B0CNCP33BQ</Value></ErrorParameters></Errors></ReviseInventoryStatusResponse>');
    assert.equal(r.errors?.[0].parameters.SKU, "B0CNCP33BQ");
    assert.equal(r.errors?.[0].code, "219");
});
test("mixed listing and inventory edit checkpoints the listing first and reconciles timeout before any price request", async () => {
    const f = harness();
    let listingWrites = 0;
    f.p.listingStep = { state: "PENDING", xml: '<ReviseItemRequest><Item><ItemID>305059787257</ItemID><Title>Updated title</Title></Item></ReviseItemRequest>', patch: { title: "Updated title" } };
    const io = { ...f.io, listingWrite: async () => { listingWrites++; return { success: false, outcomeUncertain: true }; } };
    assert.equal((await executeInventory(f.p, io)).outcomeUncertain, true);
    assert.equal(f.count().writes, 0);
    const remote = f.remote();
    remote.listing = { Title: "Updated title" };
    f.setRemote(remote);
    assert.equal((await executeInventory(f.p, io)).success, true);
    assert.equal(listingWrites, 1);
    assert.equal(f.count().writes, 1);
});
test("mapping changes after a stock write cannot falsely confirm a whole-listing hold", async () => {
    const f = harness(plan(1));
    f.p.targets[0].desired = { quantity: 0 };
    const io = { ...f.io, write: async (xml: string) => { const r = await f.io.write(xml); const remote = f.remote(); remote.entries.push({ sku: "NEW-SKU", price: 91, quantity: 2 }); return r; } };
    const r = await executeInventory(f.p, io);
    assert.equal(r.success, false);
    assert.equal(r.outcomeUncertain, true);
});
test("confirmed listing step survives local failure without another listing write", async () => {
    const f = harness();
    let listingWrites = 0, fail = true, applies = 0;
    f.p.listingStep = { state: "PENDING", xml: '<ReviseItemRequest><Item><ItemID>305059787257</ItemID><Title>New title</Title></Item></ReviseItemRequest>', patch: { title: "New title" } };
    const io = { ...f.io, listingWrite: async () => { listingWrites++; f.remote().listing = { Title: "New title" }; return { success: true }; }, applyListing: async () => { if (fail)
            throw Error("local failure"); applies++; } };
    await assert.rejects(executeInventory(f.p, io), /local failure/);
    fail = false;
    assert.equal((await executeInventory(f.p, io)).success, true);
    await executeInventory(f.p, io);
    assert.equal(listingWrites, 1);
    assert.equal(applies, 1);
});

test("GetItem accepts long safely escaped listing descriptions without losing inventory identity", () => {
    const description = "&lt;p&gt;safe &amp; ordinary&lt;/p&gt;".repeat(400);
    const xml = '<GetItemResponse><Ack>Success</Ack><Item><ItemID>304997589004</ItemID><Description>' + description + '</Description><SellingStatus><ListingStatus>Active</ListingStatus></SellingStatus><Variations><Variation><SKU>a&amp;B</SKU><StartPrice currencyID="AUD">209.00</StartPrice><Quantity>0</Quantity></Variation></Variations></Item></GetItemResponse>';
    const s = parseInventorySnapshot(xml, "304997589004");
    assert.equal(s.entries[0].sku, "a&B");
    assert.equal(s.entries[0].price, 209);
    assert.equal(s.entries[0].quantity, 0);
    assert.equal(s.listing?.Description, "<p>safe & ordinary</p>".repeat(400));
});
test("inventory XML rejects document entity declarations and oversized input", () => {
    const xml='<!DOCTYPE GetItemResponse [<!ENTITY x "expanded">]><GetItemResponse><Ack>Success</Ack></GetItemResponse>';
    assert.throws(() => parseInventorySnapshot(xml,"item"), /Unsupported eBay XML/);
    assert.equal(parseInventoryResponse(xml).outcomeUncertain,true);
    assert.throws(() => parseInventorySnapshot(" ".repeat(8*1024*1024+1),"item"), /Unsupported eBay XML/);
});
