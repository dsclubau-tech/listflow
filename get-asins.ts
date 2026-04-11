import { PrismaClient } from "./app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import dotenv from "dotenv";

dotenv.config();

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const products = await prisma.product.findMany({
    where: { asin: { not: null } },
    select: { asin: true, title: true },
    take: 5,
  });

  if (products.length === 0) {
    console.log("No products with ASINs found in the database.");
  } else {
    console.log("Products with ASINs in your database:");
    for (const p of products) {
      console.log(`  ASIN: ${p.asin}  →  ${p.title?.substring(0, 60)}`);
    }
  }

  await prisma.$disconnect();
}

main();
