type ProgressTone = "blue" | "orange" | "green" | "red" | "amber" | "gray";

interface ActionProgressBarProps {
  label: string;
  percent: number;
  detail?: string;
  tone?: ProgressTone;
  compact?: boolean;
}

const toneClasses: Record<ProgressTone, string> = {
  blue: "bg-blue-600",
  orange: "bg-orange-500",
  green: "bg-emerald-500",
  red: "bg-red-500",
  amber: "bg-amber-500",
  gray: "bg-gray-700",
};

export default function ActionProgressBar({
  label,
  percent,
  detail,
  tone = "orange",
  compact = false,
}: ActionProgressBarProps) {
  const normalizedPercent = Math.min(100, Math.max(0, Math.round(percent)));
  const heightClass = compact ? "h-1.5" : "h-2";

  return (
    <div className={compact ? "min-w-[160px]" : "w-full"} aria-live="polite">
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="truncate font-medium text-gray-700">{label}</span>
        <span className="shrink-0 font-medium text-gray-500">
          {normalizedPercent}%
        </span>
      </div>
      <div
        className={`${heightClass} overflow-hidden rounded-full bg-gray-100`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={normalizedPercent}
      >
        <div
          className={`h-full rounded-full ${toneClasses[tone]} transition-all duration-300`}
          style={{ width: `${normalizedPercent}%` }}
        />
      </div>
      {detail && !compact && (
        <p className="mt-1 truncate text-xs text-gray-500">{detail}</p>
      )}
    </div>
  );
}
