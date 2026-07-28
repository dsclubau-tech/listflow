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
    "border-gray-900 bg-gray-900 text-white shadow-sm hover:border-gray-700 hover:bg-gray-700 active:border-gray-950 active:bg-gray-950",
  secondary:
    "border-gray-300 bg-white text-gray-700 shadow-sm hover:border-gray-400 hover:bg-gray-50 active:bg-gray-100",
  danger:
    "border-red-200 bg-white text-red-700 shadow-sm hover:border-red-300 hover:bg-red-50 active:bg-red-100",
  ghost:
    "border-transparent bg-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900 active:bg-gray-200",
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
      className={`inline-flex items-center justify-center gap-2 rounded-lg border font-semibold transition-all duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${sizeClasses[size]} ${variantClasses[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    >
      {pending ? <Spinner label={pendingLabel || "Working"} /> : icon}
      <span>{pending && pendingLabel ? pendingLabel : children}</span>
    </button>
  );
});

export default Button;
