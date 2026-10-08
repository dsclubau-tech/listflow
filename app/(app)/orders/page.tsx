import OrdersPageClient from "@/components/OrdersPageClient";
import PageLoadErrorState from "@/components/PageLoadErrorState";
import { getOrdersPageData, normalizeOrdersPagination } from "@/lib/orders-data";
import { getRenderCurrentStoreSession } from "@/lib/render-store-session";
import { logger } from "@/lib/logger";

export default async function OrdersPage({
  searchParams,
}: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getRenderCurrentStoreSession();
  if (!session) return null;
  const params = await searchParams ?? {};
  const { page, pageSize } = normalizeOrdersPagination(params.page, params.pageSize);
  let data: Awaited<ReturnType<typeof getOrdersPageData>> | null = null;
  try {
    data = await getOrdersPageData(session.storeId, page, pageSize);
  } catch (error) {
    logger.error("orders/page", "Failed to load Orders page", error, { storeId: session.storeId });
  }
  if (!data) return <PageLoadErrorState title="Orders" message="Orders are temporarily unavailable. Refresh and try again." />;
  return <OrdersPageClient key={session.storeId} initialData={data} />;
}
