import "dotenv/config";

import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient, ProductStatus } from "../app/generated/prisma/client";

const ASIN_PATTERN = /^B0[A-Z0-9]{8,}$/i;

function normalizeAsinSku(sku: string | null | undefined) {
  if (!sku) {
    return null;
  }

  const asin = sku.trim().toUpperCase();
  return ASIN_PATTERN.test(asin) ? asin : null;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const adapter = new PrismaNeon({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    const products = await prisma.product.findMany({
      where: {
        status: ProductStatus.IMPORTED,
        asin: null,
      },
      select: {
        id: true,
        title: true,
        variants: {
          take: 1,
          orderBy: { createdAt: "asc" },
          select: { sku: true },
        },
      },
    });

    let updated = 0;
    let skipped = 0;

    for (const product of products) {
      const asin = normalizeAsinSku(product.variants[0]?.sku);

      if (!asin) {
        skipped += 1;
        continue;
      }

      const result = await prisma.product.updateMany({
        where: {
          id: product.id,
          asin: null,
        },
        data: { asin },
      });

      if (result.count > 0) {
        updated += result.count;
        console.log(`Updated ${product.id}: ${asin} - ${product.title}`);
      }
    }

    console.log(
      `Finished ASIN backfill. Scanned ${products.length}, updated ${updated}, skipped ${skipped}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
