import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import Spinner from "@/components/ui/Spinner";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pending?: boolean;
  pendingLabel?: string;
  fullWidth?: boolean;
  icon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border-gray-900 bg-gray-900 text-white shadow-sm hover:border-gray-700 hover:bg-gray-700",
  secondary:
    "border-gray-300 bg-white text-gray-700 shadow-sm hover:border-gray-400 hover:bg-gray-50",
  danger:
    "border-red-200 bg-white text-red-700 shadow-sm hover:border-red-300 hover:bg-red-50",
  ghost:
    "border-transparent bg-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-10 px-3 py-2 text-sm",
  md: "min-h-11 px-4 py-2.5 text-sm",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    className = "",
    variant = "secondary",
    size = "sm",
    pending = false,
    pendingLabel,
    fullWidth = false,
    icon,
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  const isDisabled = disabled || pending;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={pending || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${sizeClasses[size]} ${variantClasses[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    >
      {pending ? <Spinner label={pendingLabel || "Working"} /> : icon}
      <span>{pending && pendingLabel ? pendingLabel : children}</span>
    </button>
  );
});

export default Button;
