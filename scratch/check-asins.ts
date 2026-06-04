import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { writeFileSync } from "fs";
import { resolve } from "path";

async function main() {
  const out = resolve(__dirname, "asin-report.txt");
  const lines: string[] = [];
  const log = (msg: string) => lines.push(msg);

  try {
    const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
    const prisma = new PrismaClient({ adapter });

    const products = await prisma.product.findMany({
      where: { status: "IMPORTED", asin: null },
      take: 10,
      select: {
        id: true,
        title: true,
        description: true,
        variants: { take: 1, select: { sku: true } },
        itemSpecifics: true,
      },
    });

    log("Found " + products.length + " imported products without ASIN\n");

    for (const p of products) {
      log("---");
      log("Title: " + p.title.slice(0, 80));
      const sku = p.variants[0]?.sku ?? "";
      log("SKU: " + (sku || "(none)"));
      const specs = p.itemSpecifics as Record<string, string> | null;
      const keys = specs ? Object.keys(specs) : [];
      log("Specifics: " + (keys.length > 0 ? keys.join(", ") : "(none)"));
      const isAsinSku = /^B0[A-Z0-9]{8,}$/i.test(sku);
      log("SKU is ASIN?: " + isAsinSku);
      const descSnippet = (p.description ?? "").slice(0, 5000);
      const asinMatches = descSnippet.match(/\bB0[A-Z0-9]{8}\b/gi);
      log("ASINs in desc: " + (asinMatches ? [...new Set(asinMatches)].join(", ") : "(none)"));
    }

    const total = await prisma.product.count({ where: { status: "IMPORTED", asin: null } });
    const withSku = await prisma.product.count({
      where: { status: "IMPORTED", asin: null, variants: { some: { sku: { not: null } } } },
    });
    log("\n=== SUMMARY ===");
    log("Total imported (no ASIN): " + total);
    log("With SKU: " + withSku);

    await prisma.$disconnect();
  } catch (err) {
    log("ERROR: " + (err instanceof Error ? err.message : String(err)));
    log(err instanceof Error && err.stack ? err.stack : "");
  }

  writeFileSync(out, lines.join("\n"), "utf-8");
}

main();
