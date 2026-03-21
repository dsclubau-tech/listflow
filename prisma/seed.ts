import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaNeon } from "@prisma/adapter-neon";
import bcrypt from "bcryptjs";

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  // --- Seed Users (from Part 1) ---
  const users = [
    {
      name: "Admin",
      email: "admin@listflow.com",
      password: "Admin@1234",
      role: "admin",
    },
    {
      name: "Alice",
      email: "alice@listflow.com",
      password: "Alice@1234",
      role: "user",
    },
    {
      name: "Bob",
      email: "bob@listflow.com",
      password: "Bob@1234",
      role: "user",
    },
    {
      name: "Carol",
      email: "carol@listflow.com",
      password: "Carol@1234",
      role: "user",
    },
  ];

  for (const user of users) {
    const hashedPassword = await bcrypt.hash(user.password, 12);

    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: {
        name: user.name,
        email: user.email,
        password: hashedPassword,
        role: user.role,
      },
    });

    console.log(`Seeded user: ${user.email}`);
  }

  // --- Seed Stores (Part 2) ---
  const storeData = [
    { id: "seed-store-1", name: "Store 1" },
    { id: "seed-store-2", name: "Store 2" },
    { id: "seed-store-3", name: "Store 3" },
  ];
  const stores: Record<string, string> = {};

  for (const s of storeData) {
    const store = await prisma.store.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id,
        name: s.name,
        ebayToken: null,
        ebayUserId: null,
        ebayStoreId: null,
      },
    });

    stores[s.name] = store.id;
    console.log(`Seeded store: ${s.name}`);
  }

  // --- Get Admin user for product creation ---
  const adminUser = await prisma.user.findUnique({
    where: { email: "admin@listflow.com" },
  });

  if (!adminUser) {
    throw new Error("Admin user not found — cannot seed products");
  }

  // --- Seed Products (Part 2) ---
  const product1 = await prisma.product.upsert({
    where: { id: "seed-product-1" },
    update: {},
    create: {
      id: "seed-product-1",
      title: "Sony WH-1000XM5 Wireless Noise Cancelling Headphones - Black",
      description:
        "Industry-leading noise cancellation with 30-hour battery life.",
      price: 299.99,
      quantity: 5,
      category: "Consumer Electronics",
      condition: "New",
      images: ["https://placehold.co/600x600?text=Product+1"],
      itemSpecifics: {
        Brand: "Sony",
        Color: "Black",
        Connectivity: "Wireless",
      },
      status: "DRAFT",
      storeId: stores["Store 1"],
      createdById: adminUser.id,
    },
  });
  console.log(`Seeded product: ${product1.title}`);

  const product2 = await prisma.product.upsert({
    where: { id: "seed-product-2" },
    update: {},
    create: {
      id: "seed-product-2",
      title: "Apple iPad Air 13-inch M2 chip 128GB - Space Gray",
      description:
        "Powerful M2 chip with stunning 13-inch Liquid Retina display.",
      price: 1099.0,
      quantity: 3,
      category: "Tablets & eReaders",
      condition: "New",
      images: ["https://placehold.co/600x600?text=Product+2"],
      itemSpecifics: {
        Brand: "Apple",
        Storage: "128GB",
        Color: "Space Gray",
      },
      status: "DRAFT",
      storeId: stores["Store 2"],
      createdById: adminUser.id,
    },
  });
  console.log(`Seeded product: ${product2.title}`);

  console.log("Seeding complete!");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
