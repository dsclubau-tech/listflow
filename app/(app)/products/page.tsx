import ProductsPageClient from "@/components/ProductsPageClient";
import PageLoadErrorState from "@/components/PageLoadErrorState";
import {
  getCachedProductsPageData,
  normalizeProductsQuery,
  type SearchParamValue,
} from "@/lib/products-page-data";
import { getCurrentStoreSession } from "@/lib/store-session";
import { logger } from "@/lib/logger";
import { redirect } from "next/navigation";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, SearchParamValue>>;
}) {
  const params = (await searchParams) ?? {};
  const storeSession = await getCurrentStoreSession();

  if (!storeSession) {
    redirect("/login");
  }

  let data: Awaited<ReturnType<typeof getCachedProductsPageData>> | null = null;

  try {
    data = await getCachedProductsPageData(
      storeSession.storeId,
      storeSession.storeName,
      normalizeProductsQuery(params),
    );
  } catch (error) {
    logger.error(
      "products/page",
      "Failed to load Products page data",
      error,
      { storeId: storeSession.storeId },
    );

  }

  if (!data) {
    return (
      <div className="w-full">
        <PageLoadErrorState
          title="Products"
          message="Products are temporarily unavailable. Refresh and try again."
        />
      </div>
    );
  }

  return (
    <div className="w-full">
      <ProductsPageClient
        products={data.products}
        totalCount={data.totalCount}
        page={data.page}
        pageSize={data.pageSize}
        sortBy={data.sortBy}
        sortOrder={data.sortOrder}
        importedFilter={data.importedFilter}
        productFilter={data.productFilter}
        hasAdvancedFilters={data.hasAdvancedFilters}
        supplierOptions={data.supplierOptions}
      />
    </div>
  );
}
