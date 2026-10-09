import assert from "node:assert/strict";
import test from "node:test";
import { orderGroupKey, parseOrderNoteEdit } from "./order-notes";

test("order identity includes store and account and cannot collide across separators", () => {
  const identity = { storeId: "store", accountKey: "account", ebayOrderId: "order" };
  assert.equal(orderGroupKey(identity), orderGroupKey({ ...identity }));
  for (const change of [{ storeId: "other" }, { accountKey: "other" }, { ebayOrderId: "other" }]) {
    assert.notEqual(orderGroupKey(identity), orderGroupKey({ ...identity, ...change }));
  }
  assert.notEqual(orderGroupKey({ ...identity, accountKey: "a:b", ebayOrderId: "c" }),
    orderGroupKey({ ...identity, accountKey: "a", ebayOrderId: "b:c" }));
});

test("note updates preserve plain text and internal newlines, trim edges, and clear empty notes", () => {
  assert.deepEqual(parseOrderNoteEdit({ internalNote: "  Supplier order placed\nWait for tracking  " }),
    { internalNote: "Supplier order placed\nWait for tracking" });
  assert.deepEqual(parseOrderNoteEdit({ internalNote: "<script>alert('text')</script>" }),
    { internalNote: "<script>alert('text')</script>" });
  for (const internalNote of ["", "  \n ", null]) {
    assert.deepEqual(parseOrderNoteEdit({ internalNote }), { internalNote: null });
  }
  for (const body of [null, [], {}, { internalNote: 2 }, { internalNote: {} },
    { internalNote: "note", storeId: "other" }, { internalNote: "note", orderGroupKey: "other" },
    { status: "ORDERED" }]) assert.throws(() => parseOrderNoteEdit(body));
});
