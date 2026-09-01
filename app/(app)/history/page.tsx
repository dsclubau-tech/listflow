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

function formatDuration(startedAt: Date | null, completedAt: Date | null): string {
  if (!startedAt || !completedAt) return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms <= 0) return "< 1s";
  const totalSecs = Math.floor(ms / 1000);
  if (totalSecs < 60) return `${totalSecs}s`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}m ${secs}s`;
}

function getActionJobLabel(type: string): string {
  switch (type) {
    case "UPLOAD_LISTING":
      return "Upload listing";
    case "REVISE_LISTING":
      return "Update eBay listing";
    case "HOLD":
      return "Put listing on hold";
    case "RESUME":
      return "Resume listing";
    case "END":
      return "End listing";
    case "BULK_EDIT_REVISE":
      return "Bulk edit listings";
    case "MANAGE_PROMOTED_ADS":
      return "Manage promoted ads";
    case "SYNC_PACKAGE_DATA":
      return "Sync package data";
    case "APPLY_PACKAGE_DATA":
      return "Update eBay package data";
    default:
      return type.replace(/_/g, " ").toLowerCase();
  }
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
  const activeTab = params.tab === "jobs" ? "jobs" : "uploads";
  const requestedPage = parseUploadHistoryPage(params.page);

  // Fetch counts for both tabs
  const [uploadTotalCount, ebayActionJobCount, priceCheckJobCount] =
    await Promise.all([
      prisma.uploadLog.count({
        where: { storeId: storeSession.storeId },
      }),
      prisma.ebayActionJob.count({
        where: { storeId: storeSession.storeId },
      }),
      prisma.priceCheckJob.count({
        where: { storeId: storeSession.storeId },
      }),
    ]);

  const jobTotalCount = ebayActionJobCount + priceCheckJobCount;

  // Fetch data for the active tab
  const currentTotal = activeTab === "jobs" ? jobTotalCount : uploadTotalCount;
  const pagination = getUploadHistoryPagination(currentTotal, requestedPage);

  const [uploadLogs, ebayJobs, priceCheckJobs] = await Promise.all([
    activeTab === "uploads"
      ? prisma.uploadLog.findMany({
          where: { storeId: storeSession.storeId },
          orderBy: { createdAt: "desc" },
          skip: pagination.skip,
          take: UPLOAD_HISTORY_PAGE_SIZE,
          include: {
            product: true,
            store: true,
            user: true,
          },
        })
      : Promise.resolve([]),
    activeTab === "jobs"
      ? prisma.ebayActionJob.findMany({
          where: { storeId: storeSession.storeId },
          orderBy: { createdAt: "desc" },
          take: pagination.skip + UPLOAD_HISTORY_PAGE_SIZE,
          include: {
            store: true,
            user: true,
          },
        })
      : Promise.resolve([]),
    activeTab === "jobs"
      ? prisma.priceCheckJob.findMany({
          where: { storeId: storeSession.storeId },
          orderBy: { createdAt: "desc" },
          take: pagination.skip + UPLOAD_HISTORY_PAGE_SIZE,
          include: {
            store: true,
            user: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const actionJobs = [
    ...ebayJobs.map((j) => ({
      id: j.id,
      typeLabel: getActionJobLabel(j.type),
      typeRaw: j.type,
      isAuto: false,
      store: j.store,
      userName: j.user?.name ?? "User",
      total: j.total,
      succeeded: j.succeeded,
      failed: j.failed,
      startedAt: j.startedAt,
      completedAt: j.completedAt,
      status: j.status,
      errorMessage: j.errorMessage,
      createdAt: j.createdAt,
    })),
    ...priceCheckJobs.map((j) => ({
      id: j.id,
      typeLabel:
        j.trigger === "AUTOMATIC" ? "Auto Price Check" : "Price Check",
      typeRaw: j.trigger === "AUTOMATIC" ? "AUTO_PRICE_CHECK" : "PRICE_CHECK",
      isAuto: j.trigger === "AUTOMATIC",
      store: j.store ?? {
        id: storeSession.storeId,
        name: storeSession.storeName,
      },
      userName:
        j.trigger === "AUTOMATIC" ? "Auto Schedule" : j.user?.name ?? "User",
      total: j.total,
      succeeded: j.checked,
      failed: j.failed,
      startedAt: j.startedAt,
      completedAt: j.completedAt,
      status: j.status,
      errorMessage: j.errorMessage || j.reason,
      createdAt: j.createdAt,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(pagination.skip, pagination.skip + UPLOAD_HISTORY_PAGE_SIZE);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900">
            Logs
          </h1>
          <span className="text-sm text-gray-500">
            ({activeTab === "uploads" ? `${uploadTotalCount} uploads` : `${jobTotalCount} actions`})
          </span>
        </div>
        {activeTab === "uploads" && <ClearHistoryButton />}
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6 overflow-x-auto no-scrollbar">
        <nav className="flex gap-4 sm:gap-6 whitespace-nowrap min-w-max">
          <Link
            href="/history?tab=uploads"
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "uploads"
                ? "border-orange-500 text-orange-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            Upload History ({uploadTotalCount})
          </Link>
          <Link
            href="/history?tab=jobs"
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "jobs"
                ? "border-orange-500 text-orange-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            Job History ({jobTotalCount})
          </Link>
        </nav>
      </div>

      {/* Tab 1: Upload History Content */}
      {activeTab === "uploads" && (
        <>
          {uploadLogs.length === 0 ? (
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
                  {uploadLogs.map((log) => (
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
        </>
      )}

      {/* Tab 2: Job History Content */}
      {activeTab === "jobs" && (
        <>
          {actionJobs.length === 0 ? (
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
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                />
              </svg>
              <p className="text-gray-500 text-sm">
                No job actions yet. Actions like holds, resumes, bulk edits, and uploads will be logged here.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b text-xs font-medium text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Date & Time</th>
                    <th className="px-4 py-3 text-left">Action</th>
                    <th className="px-4 py-3 text-left">Store</th>
                    <th className="px-4 py-3 text-left">Triggered by</th>
                    <th className="px-4 py-3 text-left">Progress / Total</th>
                    <th className="px-4 py-3 text-left">Duration</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {actionJobs.map((job) => (
                    <tr
                      key={job.id}
                      className="bg-white border-b hover:bg-gray-50 transition-colors"
                    >
                      {/* Date & Time */}
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                        {formatDate(job.createdAt)}
                      </td>

                      {/* Action Type */}
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-gray-900 flex items-center gap-1.5 whitespace-nowrap">
                          {job.isAuto && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 border border-blue-200">
                              AUTO
                            </span>
                          )}
                          {job.typeLabel}
                        </span>
                        <span className="text-xs text-gray-400 font-mono">
                          {job.typeRaw}
                        </span>
                      </td>

                      {/* Store */}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            getStoreBadgeClass(job.store.id, job.store.name)
                          }`}
                        >
                          {job.store.name}
                        </span>
                      </td>

                      {/* User */}
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {job.userName}
                      </td>

                      {/* Counts / Progress */}
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                        <div>
                          <span className="font-medium text-gray-900">
                            {job.succeeded}
                          </span>
                          <span className="text-gray-400"> / </span>
                          <span>{job.total}</span>
                          <span className="text-xs text-gray-400 ml-1">items</span>
                        </div>
                        {job.failed > 0 && (
                          <span className="text-xs text-red-600 font-medium">
                            {job.failed} failed
                          </span>
                        )}
                      </td>

                      {/* Duration */}
                      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                        {formatDuration(job.startedAt, job.completedAt)}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        {job.status === "COMPLETED" && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            Completed
                          </span>
                        )}
                        {job.status === "FAILED" && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                            Failed
                          </span>
                        )}
                        {job.status === "RUNNING" && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 animate-pulse">
                            Running
                          </span>
                        )}
                        {job.status === "QUEUED" && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                            Queued
                          </span>
                        )}
                      </td>

                      {/* Error */}
                      <td className="px-4 py-3">
                        {job.errorMessage ? (
                          <span
                            className="text-xs text-red-600 max-w-xs block truncate"
                            title={job.errorMessage}
                          >
                            {job.errorMessage}
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
        </>
      )}

      {/* Pagination */}
      {currentTotal > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-gray-600">
          <span>
            {(pagination.page - 1) * UPLOAD_HISTORY_PAGE_SIZE + 1}-
            {Math.min(pagination.page * UPLOAD_HISTORY_PAGE_SIZE, currentTotal)} of {currentTotal}
          </span>
          <div className="flex items-center gap-2">
            <Link
              href={`/history?tab=${activeTab}&page=${pagination.page - 1}`}
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
              href={`/history?tab=${activeTab}&page=${pagination.page + 1}`}
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
