function Skeleton({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse motion-reduce:animate-none rounded-lg bg-gray-200 ${className}`}
    />
  );
}

export default function DraftsLoading() {
  return (
    <div
      className="min-h-full px-4 py-5 md:px-6 md:py-7 2xl:p-8"
      role="status"
      aria-live="polite"
      aria-label="Loading drafts"
    >
      <span className="sr-only">Loading drafts</span>

      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <Skeleton className="h-7 w-36" />
            <Skeleton className="mt-3 h-4 w-64 max-w-full" />
          </div>
          <div className="grid w-full gap-2 sm:grid-cols-2 xl:w-auto">
            <Skeleton className="h-11 w-full xl:w-40" />
            <Skeleton className="h-11 w-full xl:w-40" />
          </div>
        </div>
      </div>

      <div className="space-y-3 xl:hidden">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
          >
            <div className="flex gap-4">
              <Skeleton className="h-5 w-5 shrink-0" />
              <Skeleton className="h-16 w-16 shrink-0" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="mt-2 h-4 w-3/4" />
                <div className="mt-4 flex gap-2">
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-6 w-16" />
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-gray-100 pt-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm xl:block">
        <div className="grid grid-cols-12 gap-4 border-b border-gray-200 bg-gray-50 px-5 py-4">
          <Skeleton className="col-span-1 h-4" />
          <Skeleton className="col-span-5 h-4" />
          <Skeleton className="col-span-2 h-4" />
          <Skeleton className="col-span-2 h-4" />
          <Skeleton className="col-span-2 h-4" />
        </div>
        {Array.from({ length: 7 }).map((_, index) => (
          <div
            key={index}
            className="grid grid-cols-12 items-center gap-4 border-b border-gray-100 px-5 py-4 last:border-0"
          >
            <Skeleton className="col-span-1 h-12" />
            <Skeleton className="col-span-5 h-4" />
            <Skeleton className="col-span-2 h-6" />
            <Skeleton className="col-span-2 h-6" />
            <Skeleton className="col-span-2 h-10" />
          </div>
        ))}
      </div>
    </div>
  );
}
