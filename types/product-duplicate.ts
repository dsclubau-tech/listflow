export type ExistingProductConflict = {
  id: string;
  title: string;
  status: "DRAFT" | "FAILED" | "IMPORTED" | "ON_HOLD";
  ebayItemId: string | null;
  asin: string | null;
  location: "drafts" | "products";
};

export type DuplicateProductResponse = {
  error: string;
  code: "DUPLICATE_ASIN";
  existing: ExistingProductConflict;
};
