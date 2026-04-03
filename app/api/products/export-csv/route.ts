import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const DEFAULT_SUPPLIER = "amazon";
const DEFAULT_REGION = "au";
const KNOWN_SUPPLIER_REGIONS = new Set([
  "au",
  "ca",
  "de",
  "es",
  "fr",
  "in",
  "it",
  "jp",
  "mx",
  "uk",
  "us",
]);

function hasValue(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseSupplierDetails(supplierName: string | null | undefined) {
  if (!hasValue(supplierName)) {
    return {
      supplier: DEFAULT_SUPPLIER,
      region: DEFAULT_REGION,
    };
  }

  const parts = supplierName.trim().split(/\s+/);
  if (parts.length < 2) {
    return {
      supplier: DEFAULT_SUPPLIER,
      region: DEFAULT_REGION,
    };
  }

  const region = parts.at(-1)?.toLowerCase() ?? DEFAULT_REGION;
  const supplier = parts.slice(0, -1).join(" ").trim().toLowerCase();

  if (!supplier || !KNOWN_SUPPLIER_REGIONS.has(region)) {
    return {
      supplier: DEFAULT_SUPPLIER,
      region: DEFAULT_REGION,
    };
  }

  return { supplier, region };
}

function escapeCsvCell(value: string) {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [products, supplierSettings] = await Promise.all([
    prisma.product.findMany({
      where: { status: "IMPORTED" },
      orderBy: { createdAt: "desc" },
      select: {
        ebayItemId: true,
        asin: true,
        variants: {
          orderBy: { createdAt: "asc" },
          select: { sku: true },
        },
      },
    }),
    prisma.supplierSettings.findFirst({
      orderBy: { createdAt: "asc" },
      select: { supplierName: true },
    }),
  ]);

  const { supplier, region } = parseSupplierDetails(
    supplierSettings?.supplierName
  );

  const exportableProducts = products.filter(
    (product) => hasValue(product.ebayItemId) && hasValue(product.asin)
  );

  const rows = [
    ["ProductId", "BuyId", "Supplier", "SupplierRegion", "VariantSKU"],
    ...exportableProducts.flatMap((product) => {
      const baseRow = [
        product.ebayItemId!.trim(),
        product.asin!.trim(),
        supplier,
        region,
      ];

      if (product.variants.length === 0) {
        return [[...baseRow, ""]];
      }

      return product.variants.map((variant) => [
        ...baseRow,
        variant.sku?.trim() ?? "",
      ]);
    }),
  ];

  const csv = rows
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
    .join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition":
        'attachment; filename="listflow_products_export.csv"',
      "Content-Type": "text/csv; charset=utf-8",
      "X-Exported-Products": String(exportableProducts.length),
      "X-Exported-Rows": String(rows.length - 1),
      "X-Skipped-Products": String(products.length - exportableProducts.length),
    },
  });
}
