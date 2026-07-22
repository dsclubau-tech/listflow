type ProgressTone = "blue" | "orange" | "green" | "red" | "amber" | "gray";

interface ActionProgressBarProps {
  label: string;
  percent: number;
  detail?: string;
  tone?: ProgressTone;
  compact?: boolean;
  indeterminate?: boolean;
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
  indeterminate = false,
}: ActionProgressBarProps) {
  const normalizedPercent = Math.min(100, Math.max(0, Math.round(percent)));
  const heightClass = compact ? "h-1.5" : "h-2";

  return (
    <div className={compact ? "min-w-0 w-full" : "w-full"} aria-live="polite">
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="truncate font-medium text-gray-700">{label}</span>
        {!indeterminate && (
          <span className="shrink-0 font-medium text-gray-500">
            {normalizedPercent}%
          </span>
        )}
      </div>
      <div
        className={`${heightClass} overflow-hidden rounded-full bg-gray-100`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : normalizedPercent}
      >
        {indeterminate ? (
          <div className="h-full w-full overflow-hidden rounded-full">
            <div
              className={`listflow-progress-indeterminate h-full w-2/5 rounded-full ${toneClasses[tone]} motion-reduce:w-full motion-reduce:animate-none`}
            />
          </div>
        ) : (
          <div
            className={`h-full rounded-full ${toneClasses[tone]} transition-all duration-300`}
            style={{ width: `${normalizedPercent}%` }}
          />
        )}
      </div>
      {detail && !compact && (
        <p className="mt-1 text-xs leading-5 text-gray-500">{detail}</p>
      )}
    </div>
  );
}
