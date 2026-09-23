import assert from "node:assert/strict";
import test from "node:test";
import { orderPriceCheckJobs, canClaimProduct } from "./price-check-scheduling-policy";

test("a two-product manual check precedes a running 345-product automatic scan", () => {
  const automatic = [{ trigger: "AUTOMATIC" as const,
    products: Array.from({ length: 345 }, (_, i) => `auto-${i}`) }];
  const manual = [{ trigger: "MANUAL" as const, products: ["mova-1", "mova-2"] }];
  assert.equal(orderPriceCheckJobs(manual, automatic, 0)[0], manual[0]);
  assert.equal(canClaimProduct("mova-1", new Set(["mova-1"])), false);
  assert.equal(canClaimProduct("mova-2", new Set(["mova-1"])), true);
});

test("automatic work receives a turn after ten consecutive manual claims", () => {
  const automatic = [{ trigger: "AUTOMATIC" as const }];
  const manual = [{ trigger: "MANUAL" as const }];
  assert.equal(orderPriceCheckJobs(manual, automatic, 9)[0], manual[0]);
  assert.equal(orderPriceCheckJobs(manual, automatic, 10)[0], automatic[0]);
  assert.equal(orderPriceCheckJobs(manual, [], 10)[0], manual[0]);
});
