import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaNeon } from "@prisma/adapter-neon";

/**
 * Data-fix script: Dismiss stale pending price history entries.
 *
 * After fixing the price checker calculation logic, old pending entries
 * contain incorrect nextBuyPrice / nextSellPrice values (calculated using
 * the old ratio-based approach). This script dismisses all pending entries
 * so the next price check run generates new, correct ones.
 *
 * It also syncs product.price with the primary variant's sellPrice for
 * all imported products where they differ.
 *
 * Usage: npx tsx scratch/sync-product-prices.ts
 */

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  // --- Part 1: Dismiss stale pending price history entries ---

  console.log("🔍 Scanning for stale pending price history entries...\n");

  const pendingEntries = await prisma.priceHistory.findMany({
    where: { appliedAt: null },
    include: {
      product: { select: { title: true, id: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`📊 Found ${pendingEntries.length} pending price history entries`);

  if (pendingEntries.length > 0) {
    console.log("\n📋 Entries to dismiss:\n");

    for (const entry of pendingEntries) {
      console.log(
        `  ${entry.product.title.slice(0, 55).padEnd(55)} | ` +
        `buy: A$${Number(entry.previousPrice).toFixed(2)} -> A$${Number(entry.newPrice).toFixed(2)} | ` +
        `sell: A$${Number(entry.previousSellPrice).toFixed(2)} -> A$${Number(entry.newSellPrice).toFixed(2)}`
      );
    }

    const dismissedAt = new Date();
    const result = await prisma.priceHistory.updateMany({
      where: { appliedAt: null },
      data: {
        appliedAt: dismissedAt,
        ebayRevised: false,
        errorMessage: "Dismissed by data-fix script: recalculation logic updated.",
      },
    });

    console.log(`\n✅ Dismissed ${result.count} stale pending entries.`);
    console.log("   The next price check will generate new entries with correct calculations.\n");
  }

  // --- Part 2: Sync product.price with primary variant sellPrice ---

  console.log("---\n");
  console.log("🔍 Scanning for product.price / variant.sellPrice mismatches...\n");

  const products = await prisma.product.findMany({
    where: { status: "IMPORTED" },
    include: {
      variants: {
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  let synced = 0;

  for (const product of products) {
    if (product.variants.length === 0) continue;

    const productPrice = Number(product.price);
    const variantSellPrice = Number(product.variants[0].sellPrice);

    if (Math.abs(productPrice - variantSellPrice) > 0.01) {
      console.log(
        `  ${product.title.slice(0, 55).padEnd(55)} | ` +
        `product.price: A$${productPrice.toFixed(2)} -> A$${variantSellPrice.toFixed(2)}`
      );

      await prisma.product.update({
        where: { id: product.id },
        data: { price: variantSellPrice },
      });

      synced++;
    }
  }

  if (synced > 0) {
    console.log(`\n✅ Synced ${synced} product prices to match their primary variant.`);
  } else {
    console.log("✅ All product prices already match their primary variant.");
  }

  console.log("\n🎉 Data fix complete.");
  console.log("   Next steps:");
  console.log("   1. Run a price check to generate fresh pending entries with correct calculations");
  console.log("   2. Review and Apply/Dismiss the new pending entries");
  console.log('   3. Consider setting up fee/profit percentages on variants for more accurate pricing');
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => {
    console.error("💥 Script failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
