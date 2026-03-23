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

  // --- Seed Description Templates ---
  const templates = [
    {
      name: "RK Ecom, 30 Day Free Return",
      content: `<div style="font-family:Arial,sans-serif;font-size:13px;color:#333;border-top:1px solid #eee;margin-top:20px;padding-top:16px;">
<p><strong>FREE FAST SHIPPING!</strong> (*T&Cs apply)</p>
<p>To the best of our ability, RK ECOMMERCE endeavours to cover the shipping cost of up to $25 on every item. However, please note that this does not guarantee free shipping on every item. If the Shipping cost comes to greater than $25, you may be required to pay the difference. If this happens, you will be automatically contacted by our logistics team with further details.</p>
<p>Are there any exemptions to the free shipping policy?</p>
<p>In certain situations, RK ECOMMERCE may encounter difficulties in securing a courier willing to deliver to the customer's address, especially in remote and rural areas. In these cases, a shipping charge may apply.</p>
<p><strong>Returns:</strong> We accept returns within 30 days of delivery. Item must be in original condition. Return shipping is FREE.</p>
</div>`,
      isDefault: true,
    },
    {
      name: "RK Ecom, Buyer Pay For Return 30 Days",
      content: `<div style="font-family:Arial,sans-serif;font-size:13px;color:#333;border-top:1px solid #eee;margin-top:20px;padding-top:16px;">
<p><strong>FREE FAST SHIPPING!</strong> (*T&Cs apply)</p>
<p>To the best of our ability, RK ECOMMERCE endeavours to cover the shipping cost of up to $25 on every item. However, please note that this does not guarantee free shipping on every item. If the Shipping cost comes to greater than $25, you may be required to pay the difference. If this happens, you will be automatically contacted by our logistics team with further details.</p>
<p>Are there any exemptions to the free shipping policy?</p>
<p>In certain situations, RK ECOMMERCE may encounter difficulties in securing a courier willing to deliver to the customer's address, especially in remote and rural areas. In these cases, a shipping charge may apply.</p>
<p><strong>Returns:</strong> We accept returns within 30 days. Buyer pays return shipping.</p>
</div>`,
      isDefault: false,
    },
    {
      name: "No Return",
      content: `<div style="font-family:Arial,sans-serif;font-size:13px;color:#333;border-top:1px solid #eee;margin-top:20px;padding-top:16px;">
<p><strong>FREE FAST SHIPPING!</strong> (*T&Cs apply)</p>
<p>To the best of our ability, RK ECOMMERCE endeavours to cover the shipping cost of up to $25 on every item. However, please note that this does not guarantee free shipping on every item. If the Shipping cost comes to greater than $25, you may be required to pay the difference. If this happens, you will be automatically contacted by our logistics team with further details.</p>
<p>Are there any exemptions to the free shipping policy?</p>
<p>In certain situations, RK ECOMMERCE may encounter difficulties in securing a courier willing to deliver to the customer's address, especially in remote and rural areas. In these cases, a shipping charge may apply.</p>
<p><strong>Returns:</strong> All sales are final. We do not accept returns.</p>
</div>`,
      isDefault: false,
    },
  ];

  for (const t of templates) {
    await prisma.descriptionTemplate.upsert({
      where: { id: `seed-template-${t.name.replace(/\s+/g, "-").toLowerCase()}` },
      update: {},
      create: {
        id: `seed-template-${t.name.replace(/\s+/g, "-").toLowerCase()}`,
        name: t.name,
        content: t.content,
        isDefault: t.isDefault,
      },
    });
    console.log(`Seeded template: ${t.name}`);
  }

  // --- Seed Keyword Blacklist ---
  const keywords = [
    { keyword: "Amazon", removeFromTitle: false, removeFromDescription: true },
    { keyword: "amazon", removeFromTitle: false, removeFromDescription: true },
    { keyword: "amazon.", removeFromTitle: true, removeFromDescription: true },
    { keyword: "Amazon.", removeFromTitle: true, removeFromDescription: true },
  ];

  for (const k of keywords) {
    await prisma.keywordBlacklist.upsert({
      where: { id: `seed-keyword-${k.keyword.replace(/\W/g, "_")}` },
      update: {},
      create: {
        id: `seed-keyword-${k.keyword.replace(/\W/g, "_")}`,
        keyword: k.keyword,
        removeFromTitle: k.removeFromTitle,
        removeFromDescription: k.removeFromDescription,
      },
    });
    console.log(`Seeded keyword: ${k.keyword}`);
  }
  // --- Seed Supplier Settings ---
  await prisma.supplierSettings.upsert({
    where: { supplierName: "Amazon AU" },
    update: {},
    create: { supplierName: "Amazon AU" },
  });
  console.log("Seeded supplier settings: Amazon AU");

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
