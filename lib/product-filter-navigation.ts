import type { ProductSortField } from "@/lib/product-sort";

export type ProductQuickFilter =
  | "all"
  | "needs-changing-price"
  | "failed-on-hold";

export function buildProductFilterUrl(
  pathname: string,
  currentQuery: string,
  nextFilter: ProductQuickFilter,
) {
  const params = new URLSearchParams(currentQuery);
  params.set("page", "1");

  if (nextFilter === "all") {
    params.delete("filter");
  } else {
    params.set("filter", nextFilter);
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function buildProductSortUrl(
  pathname: string,
  currentQuery: string,
  nextSortBy: ProductSortField,
) {
  const params = new URLSearchParams(currentQuery);
  const currentSortBy = params.get("sortBy");
  const currentSortOrder =
    params.get("sortOrder") === "desc" ? "desc" : "asc";
  const nextSortOrder =
    currentSortBy === nextSortBy && currentSortOrder === "asc" ? "desc" : "asc";

  params.set("page", "1");
  params.set("sortBy", nextSortBy);
  params.set("sortOrder", nextSortOrder);

  return `${pathname}?${params.toString()}`;
}
