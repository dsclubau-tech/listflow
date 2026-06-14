export type ProductFilterControl = "select" | "text" | "range";

export const PRODUCT_ADVANCED_FILTERS = [
  { id: "supplier", label: "Supplier", control: "select", enabled: true },
  { id: "region", label: "Region", control: "select", enabled: false },
  { id: "tags", label: "Tags", control: "text", enabled: false },
  { id: "title", label: "Title", control: "text", enabled: true },
  { id: "brand", label: "Brand", control: "text", enabled: true },
  { id: "note", label: "Note", control: "text", enabled: true },
  { id: "sellPrice", label: "Sell Price", control: "range", enabled: true },
  { id: "buyPrice", label: "Buy Price", control: "range", enabled: true },
  { id: "buyItemId", label: "Buy Item ID", control: "text", enabled: true },
  { id: "profit", label: "Profit", control: "range", enabled: true },
  { id: "quantity", label: "Quantity", control: "range", enabled: true },
  { id: "inventoryStatus", label: "Inventory Status", control: "select", enabled: true },
  { id: "collections", label: "Collections", control: "select", enabled: false },
  { id: "cityLocation", label: "City Location", control: "select", enabled: false },
  { id: "stockMonitoring", label: "Stock Monitoring", control: "select", enabled: true },
  { id: "priceMonitoring", label: "Price Monitoring", control: "select", enabled: true },
  { id: "autoOrder", label: "Auto Order", control: "select", enabled: true },
  { id: "veroViolation", label: "Vero Violation", control: "select", enabled: true },
  { id: "fees", label: "Fees", control: "range", enabled: true },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  control: ProductFilterControl;
  enabled: boolean;
}>;

export type ProductAdvancedFilterId =
  (typeof PRODUCT_ADVANCED_FILTERS)[number]["id"];

export const PRODUCT_ADVANCED_FILTER_IDS = PRODUCT_ADVANCED_FILTERS.map(
  (filter) => filter.id
) as ProductAdvancedFilterId[];

export function getProductAdvancedFilter(id: string) {
  return PRODUCT_ADVANCED_FILTERS.find((filter) => filter.id === id) ?? null;
}
