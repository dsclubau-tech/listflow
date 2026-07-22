interface SpinnerProps {
  className?: string;
  label?: string;
}

export default function Spinner({
  className = "h-4 w-4",
  label = "Loading",
}: SpinnerProps) {
  return (
    <span
      className={`inline-block shrink-0 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-r-transparent ${className}`}
      role="status"
      aria-label={label}
    />
  );
}
