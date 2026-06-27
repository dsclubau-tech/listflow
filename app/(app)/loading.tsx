function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-gray-200 ${className}`} />;
}

export default function AppLoading() {
  return (
    <div className="p-8" role="status" aria-live="polite">
      <span className="sr-only">Loading</span>

      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <SkeletonBlock className="h-6 w-44" />
          <SkeletonBlock className="mt-3 h-4 w-72" />
        </div>
        <SkeletonBlock className="h-9 w-28" />
      </div>

      <div className="mb-5 flex flex-wrap gap-3">
        <SkeletonBlock className="h-10 w-64" />
        <SkeletonBlock className="h-10 w-36" />
        <SkeletonBlock className="h-10 w-32" />
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <SkeletonBlock className="h-4 w-56" />
        </div>
        <div className="divide-y divide-gray-100">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="grid grid-cols-12 gap-4 px-4 py-4">
              <SkeletonBlock className="col-span-5 h-4" />
              <SkeletonBlock className="col-span-2 h-4" />
              <SkeletonBlock className="col-span-2 h-4" />
              <SkeletonBlock className="col-span-3 h-4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
