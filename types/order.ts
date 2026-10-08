export const ORDER_STATUSES = ["PENDING", "ORDERED", "SHIPPED", "DELIVERED", "CANCELED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Pending", ORDERED: "Ordered", SHIPPED: "Shipped",
  DELIVERED: "Delivered", CANCELED: "Canceled",
};

export type OrderRow = {
  id: string;
  title: string;
  quantity: number;
  image: string | null;
  buyTotal: number | null;
  buyCurrency: string;
  sellTotal: number;
  currency: string;
  profit: number | null;
  buyItemId: string | null;
  ebayItemId: string | null;
  status: OrderStatus;
  estimatedArrival: string | null;
  matched: boolean;
};

export type OrdersPageData = {
  storeId: string;
  rows: OrderRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  sync: { activatedAt: string | null; lastSuccessAt: string | null; error: string | null };
};
