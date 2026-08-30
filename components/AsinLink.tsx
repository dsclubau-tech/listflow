import type {
  AnchorHTMLAttributes,
  MouseEvent,
  ReactNode,
} from "react";

type AsinLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "children" | "href"
> & {
  asin: string | null | undefined;
  children?: ReactNode;
  fallback?: ReactNode;
  stopPropagation?: boolean;
  warning?: string | null;
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

  if (!warning) {
    return anchor;
  }

  return (
    <span className="inline-flex items-center gap-1">
      {anchor}
      <span
        className="cursor-help text-xs"
        title={warning}
        aria-label={warning}
      >
        ⚠️
      </span>
    </span>
  );
}
