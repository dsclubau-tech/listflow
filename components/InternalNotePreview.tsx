"use client";

export default function InternalNotePreview({
  note,
  productTitle,
  onClick,
}: {
  note: string | null | undefined;
  productTitle: string;
  onClick: () => void;
}) {
  const text = note?.trim() ?? "";
  return (
    <button
      type="button"
      onClick={onClick}
      title={text || undefined}
      aria-label={text ? `Edit note for ${productTitle}: ${text}` : `Add note for ${productTitle}`}
      className={`flex w-full min-w-0 flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
        text
          ? "border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100"
          : "border-dashed border-gray-300 bg-gray-50 text-gray-600 hover:border-amber-300 hover:bg-amber-50"
      }`}
    >
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        text ? "bg-amber-200 text-amber-900" : "bg-gray-200 text-gray-600"
      }`}>Note</span>
      <span className="line-clamp-2 max-w-full whitespace-pre-line break-words text-xs leading-4">
        {text || "+ Add note"}
      </span>
    </button>
  );
}
