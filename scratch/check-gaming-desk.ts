import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  // Find all products where variant sellPrice ~= 148.28 or buyPrice ~= 116.99
  const products = await prisma.product.findMany({
    where: { status: "IMPORTED" },
    include: {
      variants: { orderBy: { createdAt: "asc" } },
    },
  });

  console.log("🔍 Searching for products where variant buyPrice ≈ 116.99 or sellPrice ≈ 148.28...\n");

  for (const product of products) {
    for (const v of product.variants) {
      const buy = Number(v.buyPrice);
      const sell = Number(v.sellPrice);
      if (
        (Math.abs(buy - 116.99) < 0.02) ||
        (Math.abs(sell - 148.28) < 0.02) ||
        (Math.abs(sell - 164.33) < 0.02 && product.title.toLowerCase().includes("desk"))
      ) {
        console.log(`📦 ${product.title.slice(0, 70)}`);
        console.log(`   product.price = A$${Number(product.price).toFixed(2)}`);
        console.log(`   amazonPrice   = A$${product.amazonPrice ? Number(product.amazonPrice).toFixed(2) : "N/A"}`);
        console.log(`   ebayItemId    = ${product.ebayItemId}`);
        console.log(`   variant buy   = A$${buy.toFixed(2)}`);
        console.log(`   variant sell  = A$${sell.toFixed(2)}`);
        console.log(`   fees          = ${v.feesPercent}% + A$${v.feesFixed}`);
        console.log(`   profit        = ${v.profitPercent}% + A$${v.profitFixed}`);
        console.log();
      }
    }
  }

  // Also check pending price history for the gaming desk
  const pendingHistory = await prisma.priceHistory.findMany({
    where: { appliedAt: null },
    include: { product: { select: { title: true, ebayItemId: true, price: true, amazonPrice: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  console.log(`\n📋 All pending price history entries (${pendingHistory.length}):\n`);
  for (const h of pendingHistory) {
    console.log(`  ${h.product.title.slice(0, 50)}`);
    console.log(`    product.price = A$${Number(h.product.price).toFixed(2)}, amazon = A$${h.product.amazonPrice ? Number(h.product.amazonPrice).toFixed(2) : "N/A"}`);
    console.log(`    buy:  A$${Number(h.previousPrice).toFixed(2)} -> A$${Number(h.newPrice).toFixed(2)}`);
    console.log(`    sell: A$${Number(h.previousSellPrice).toFixed(2)} -> A$${Number(h.newSellPrice).toFixed(2)}`);
    console.log(`    change: ${h.changePercent.toFixed(2)}%`);
    console.log();
  }
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
