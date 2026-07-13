import assert from "node:assert/strict";
import test from "node:test";
import { getSafeResearchLoadErrorMessage } from "./page-load-errors";

test("research page errors never expose raw database or service messages", () => {
  assert.equal(
    getSafeResearchLoadErrorMessage(
      new Error("Invalid prisma.researchJob.findMany invocation: database host"),
    ),
    "Research is temporarily unavailable. Refresh and try again.",
  );
});
