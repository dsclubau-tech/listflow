export const UPLOAD_HISTORY_PAGE_SIZE = 50;

export function parseUploadHistoryPage(value: unknown) {
  const parsed = Number(
    Array.isArray(value) ? value[0] : typeof value === "string" ? value : "",
  );

  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function getUploadHistoryPagination(total: number, requestedPage: number) {
  const totalPages = Math.max(1, Math.ceil(total / UPLOAD_HISTORY_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);

  return {
    page,
    totalPages,
    skip: (page - 1) * UPLOAD_HISTORY_PAGE_SIZE,
  };
}
