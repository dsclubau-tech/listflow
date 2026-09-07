import type {
  AnchorHTMLAttributes,
  MouseEvent,
  ReactNode,
} from "react";
import CopyButton from "@/components/ui/CopyButton";

type AsinLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "children" | "href"
> & {
  asin: string | null | undefined;
  children?: ReactNode;
  fallback?: ReactNode;
  stopPropagation?: boolean;
  warning?: string | null;
  showCopyButton?: boolean;
};

export function getAmazonAsinUrl(asin: string) {
  return `https://www.amazon.com.au/dp/${encodeURIComponent(asin.trim())}`;
}

export default function AsinLink({
  asin,
  children,
  className = "font-mono text-xs text-orange-600 hover:text-orange-800 hover:underline",
  fallback = "-",
  onClick,
  stopPropagation = false,
  title,
  warning,
  showCopyButton = false,
  ...props
}: AsinLinkProps) {
  const normalizedAsin = asin?.trim().toUpperCase();

  if (!normalizedAsin) {
    return <>{fallback}</>;
  }

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (stopPropagation) {
      event.stopPropagation();
    }

    onClick?.(event);
  }

  const anchor = (
    <a
      href={getAmazonAsinUrl(normalizedAsin)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      className={className}
      title={title ?? `Open Amazon ASIN ${normalizedAsin}`}
      {...props}
    >
      {children ?? normalizedAsin}
    </a>
  );

  if (!warning && !showCopyButton) {
    return anchor;
  }

  return (
    <span className="inline-flex items-center gap-1">
      {anchor}
      {showCopyButton && (
        <CopyButton
          text={normalizedAsin}
          label="Copy ASIN"
          stopPropagation={stopPropagation}
        />
      )}
      {warning && (
        <span
          className="cursor-help text-xs"
          title={warning}
          aria-label={warning}
        >
          ⚠️
        </span>
      )}
    </span>
  );
}
