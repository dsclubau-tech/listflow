import ProductsPageClient from "@/components/ProductsPageClient";
import {
  getCachedProductsPageData,
  normalizeProductsQuery,
  type SearchParamValue,
} from "@/lib/products-page-data";
import { getCurrentStoreSession } from "@/lib/store-session";
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

  const data = await getCachedProductsPageData(
    storeSession.storeId,
    normalizeProductsQuery(params),
  );

  return (
    <div className="p-8">
      <ProductsPageClient
        products={data.products}
        totalCount={data.totalCount}
        page={data.page}
        pageSize={data.pageSize}
        importedFilter={data.importedFilter}
        productFilter={data.productFilter}
        hasAdvancedFilters={data.hasAdvancedFilters}
        supplierOptions={data.supplierOptions}
      />
    </div>
  );
}
