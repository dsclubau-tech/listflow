import assert from "node:assert/strict";
import test from "node:test";
import { buildReviseInventoryStatusXML } from "./ebay-xml";
test("DeLonghi one remaining variation includes its exact SKU", () => {
    const xml = buildReviseInventoryStatusXML([{ ebayItemId: "304997589004", sku: "B07G5B97VD", startPrice: 125 } as Parameters<typeof buildReviseInventoryStatusXML>[0][number]]);
    assert.match(xml, new RegExp("<SKU>B07G5B97VD</SKU>"));
});
test("Baboni sends three distinct variation prices and quantities", () => {
    const xml = buildReviseInventoryStatusXML([
        { ebayItemId: "305059787257", sku: "B09682CXNR", startPrice: 51, quantity: 0 },
        { ebayItemId: "305059787257", sku: "B0CNCP33BQ", startPrice: 73, quantity: 2 },
        { ebayItemId: "305059787257", sku: "B0CNCRBRM1", startPrice: 99, quantity: 3 }
    ] as Parameters<typeof buildReviseInventoryStatusXML>[0]);
    for (const sku of ["B09682CXNR", "B0CNCP33BQ", "B0CNCRBRM1"])
        assert.ok(xml.includes("<SKU>" + sku + "</SKU>"));
    assert.match(xml, new RegExp("<StartPrice>73.00</StartPrice>"));
});
