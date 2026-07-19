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
