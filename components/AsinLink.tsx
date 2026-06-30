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

  return (
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
}
