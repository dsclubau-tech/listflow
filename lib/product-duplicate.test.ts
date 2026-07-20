import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { ProductStatus } from "@/app/generated/prisma/enums";

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

test("duplicate Amazon product responses identify Drafts and uploaded products", async () => {
  const {
    getDuplicateAmazonProductBody,
    getExistingAmazonProductLocation,
  } = await import("@/lib/product-duplicate");
  const base = {
    id: "product-1",
    title: "Monitor",
    ebayItemId: null,
    asin: "B0TEST1234",
    updatedAt: new Date("2026-07-20T00:00:00Z"),
  };

  assert.equal(getExistingAmazonProductLocation(ProductStatus.DRAFT), "drafts");
  assert.equal(getExistingAmazonProductLocation(ProductStatus.FAILED), "drafts");
  assert.equal(getExistingAmazonProductLocation(ProductStatus.IMPORTED), "products");
  assert.equal(getExistingAmazonProductLocation(ProductStatus.ON_HOLD), "products");
  assert.match(
    getDuplicateAmazonProductBody({ ...base, status: ProductStatus.DRAFT }).error,
    /already in Drafts/i,
  );
  assert.match(
    getDuplicateAmazonProductBody({
      ...base,
      status: ProductStatus.IMPORTED,
      ebayItemId: "123",
    }).error,
    /already uploaded/i,
  );
});

test("duplicate lookup normalizes ASIN and prefers an uploaded match", async () => {
  const { findExistingAmazonProduct } = await import("@/lib/product-duplicate");
  let receivedWhere: unknown;
  const updatedAt = new Date("2026-07-20T00:00:00Z");
  const client = {
    product: {
      findMany: async (input: { where: unknown }) => {
        receivedWhere = input.where;
        return [
          {
            id: "draft",
            title: "Draft",
            status: ProductStatus.DRAFT,
            ebayItemId: null,
            asin: "B0TEST1234",
            updatedAt,
          },
          {
            id: "live",
            title: "Live",
            status: ProductStatus.IMPORTED,
            ebayItemId: "123",
            asin: "B0TEST1234",
            updatedAt,
          },
        ];
      },
    },
  };

  const result = await findExistingAmazonProduct(
    "store-1",
    "  b0test1234 ",
    client as never,
  );

  assert.equal(result?.id, "live");
  assert.deepEqual(receivedWhere, {
    storeId: "store-1",
    status: {
      in: [
        ProductStatus.DRAFT,
        ProductStatus.FAILED,
        ProductStatus.IMPORTED,
        ProductStatus.ON_HOLD,
      ],
    },
    asin: { equals: "B0TEST1234", mode: "insensitive" },
  });
});
