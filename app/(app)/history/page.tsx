import { prisma } from "@/lib/prisma";
import ClearHistoryButton from "@/components/ClearHistoryButton";
import { getCurrentStoreSession } from "@/lib/store-session";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  getUploadHistoryPagination,
  parseUploadHistoryPage,
  UPLOAD_HISTORY_PAGE_SIZE,
} from "@/lib/upload-history-pagination";
import { getStoreBadgeClass } from "@/lib/store-badge";

function formatDate(date: Date): string {
  const d = new Date(date);
  const day = d.getDate().toString().padStart(2, "0");
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  const hours = d.getHours().toString().padStart(2, "0");
  const minutes = d.getMinutes().toString().padStart(2, "0");
  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const storeSession = await getCurrentStoreSession();

  if (!storeSession) {
    redirect("/login");
  }

  const params = (await searchParams) ?? {};
  const requestedPage = parseUploadHistoryPage(params.page);
  const totalCount = await prisma.uploadLog.count({
    where: { storeId: storeSession.storeId },
  });
  const pagination = getUploadHistoryPagination(totalCount, requestedPage);
  const logs = await prisma.uploadLog.findMany({
    where: { storeId: storeSession.storeId },
    orderBy: { createdAt: "desc" },
    skip: pagination.skip,
    take: UPLOAD_HISTORY_PAGE_SIZE,
    include: {
      product: true,
      store: true,
      user: true,
    },
  });

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900">
            Upload History
          </h1>
          <span className="text-sm text-gray-500">
            ({totalCount} uploads)
          </span>
        </div>
        <ClearHistoryButton />
      </div>

      {logs.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <svg
            className="w-12 h-12 mx-auto text-gray-300 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-gray-500 text-sm">
            No uploads yet. Import a product from the dashboard to get started.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b text-xs font-medium text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Date & Time</th>
                <th className="px-4 py-3 text-left">Product</th>
                <th className="px-4 py-3 text-left">Store</th>
                <th className="px-4 py-3 text-left">Uploaded by</th>
                <th className="px-4 py-3 text-left">eBay Item ID</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Error</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="bg-white border-b hover:bg-gray-50 transition-colors"
                >
                  {/* Date & Time */}
                  <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                    {formatDate(log.createdAt)}
                  </td>

                  {/* Product */}
                  <td className="px-4 py-3">
                    <span
                      className="text-sm font-medium text-gray-900 truncate max-w-xs block"
                      title={log.product.title}
                    >
                      {log.product.title}
                    </span>
                  </td>

                  {/* Store badge */}
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        getStoreBadgeClass(log.store.id, log.store.name)
                      }`}
                    >
                      {log.store.name}
                    </span>
                  </td>

                  {/* Uploaded by */}
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {log.user.name}
                  </td>

                  {/* eBay Item ID */}
                  <td className="px-4 py-3 text-sm">
                    {log.ebayItemId ? (
                      <a
                        href={`https://www.ebay.com.au/itm/${log.ebayItemId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {log.ebayItemId}
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    {log.status === "SUCCESS" ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        Success
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                        Failed
                      </span>
                    )}
                  </td>

                  {/* Error */}
                  <td className="px-4 py-3">
                    {log.errorMessage ? (
                      <span
                        className="text-xs text-red-600 max-w-xs block truncate"
                        title={log.errorMessage}
                      >
                        {log.errorMessage}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-sm">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalCount > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-gray-600">
          <span>
            {(pagination.page - 1) * UPLOAD_HISTORY_PAGE_SIZE + 1}-
            {Math.min(pagination.page * UPLOAD_HISTORY_PAGE_SIZE, totalCount)} of {totalCount}
          </span>
          <div className="flex items-center gap-2">
            <Link
              href={`/history?page=${pagination.page - 1}`}
              aria-disabled={pagination.page <= 1}
              className={`rounded-md border px-3 py-1.5 font-medium ${
                pagination.page <= 1
                  ? "pointer-events-none border-gray-200 text-gray-400"
                  : "border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              Previous
            </Link>
            <span>
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <Link
              href={`/history?page=${pagination.page + 1}`}
              aria-disabled={pagination.page >= pagination.totalPages}
              className={`rounded-md border px-3 py-1.5 font-medium ${
                pagination.page >= pagination.totalPages
                  ? "pointer-events-none border-gray-200 text-gray-400"
                  : "border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              Next
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
