import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

process.env.DATABASE_URL ??=
  "postgresql://listflow:test@127.0.0.1:5432/listflow_test";

const moduleWithLoad = Module as unknown as {
  _load: (
    request: string,
    parent?: unknown,
    isMain?: boolean,
  ) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;

moduleWithLoad._load = function loadWithServerOnlyShim(
  this: unknown,
  request: string,
  parent?: unknown,
  isMain?: boolean,
) {
  if (request === "server-only") {
    return {};
  }

  return originalModuleLoad.call(this, request, parent, isMain);
};

test("normalizeResearchQuery trims surrounding and collapsed whitespace", async () => {
  const { normalizeResearchQuery } = await import(
    "./favorite-research-queries"
  );
  assert.equal(
    normalizeResearchQuery("  Sony   WH-1000XM5   headphones  "),
    "Sony WH-1000XM5 headphones"
  );
  assert.equal(normalizeResearchQuery(""), "");
  assert.equal(normalizeResearchQuery("   "), "");
});

test("MAX_FAVORITE_RESEARCH_QUERIES is 100", async () => {
  const { MAX_FAVORITE_RESEARCH_QUERIES } = await import(
    "./favorite-research-queries"
  );
  assert.equal(MAX_FAVORITE_RESEARCH_QUERIES, 100);
});
