import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import {
  RK_ECOM_30_DAY_FREE_RETURN_TEMPLATE_CONTENT,
  RK_ECOM_30_DAY_FREE_RETURN_TEMPLATE_NAME,
  RK_ECOM_30_DAY_FREE_RETURN_TEMPLATE_ID,
} from "../lib/builtin-description-templates";

const adapter = new PrismaPg({
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
    {
      id: "seed-store-1",
      name: "Store 1",
      loginId: "store-1",
      password:
        process.env.STORE_1_PASSWORD ||
        process.env.STORE_BOOTSTRAP_PASSWORD ||
        process.env.STORE_DEFAULT_PASSWORD ||
        "Store@1234",
    },
    {
      id: "seed-store-2",
      name: "Store 2",
      loginId: "store-2",
      password:
        process.env.STORE_2_PASSWORD ||
        process.env.STORE_BOOTSTRAP_PASSWORD ||
        process.env.STORE_DEFAULT_PASSWORD ||
        "Store@1234",
    },
    {
      id: "seed-store-3",
      name: "Store 3",
      loginId: "store-3",
      password:
        process.env.STORE_3_PASSWORD ||
        process.env.STORE_BOOTSTRAP_PASSWORD ||
        process.env.STORE_DEFAULT_PASSWORD ||
        "Store@1234",
    },
  ];
  const stores: Record<string, string> = {};

  for (const s of storeData) {
    const hashedStorePassword = await bcrypt.hash(s.password, 12);
    const store = await prisma.store.upsert({
      where: { id: s.id },
      update: {
        loginId: s.loginId,
        password: hashedStorePassword,
      },
      create: {
        id: s.id,
        name: s.name,
        loginId: s.loginId,
        password: hashedStorePassword,
        ebayToken: null,
        ebayUserId: null,
        ebayStoreId: null,
      },
    });

    stores[s.name] = store.id;
    console.log(`Seeded store: ${s.name}`);
  }

  if (process.env.SEED_SAMPLE_PRODUCTS === "true") {
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
  } else {
    console.log("Skipped sample products. Set SEED_SAMPLE_PRODUCTS=true to include demo products.");
  }

  // --- Seed Description Templates ---
  const templates = [
    {
      id: RK_ECOM_30_DAY_FREE_RETURN_TEMPLATE_ID,
      name: RK_ECOM_30_DAY_FREE_RETURN_TEMPLATE_NAME,
      content: RK_ECOM_30_DAY_FREE_RETURN_TEMPLATE_CONTENT,
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

  for (const storeId of Object.values(stores)) {
    for (const t of templates) {
      const baseTemplateId =
        "id" in t ? t.id : `seed-template-${t.name.replace(/\s+/g, "-").toLowerCase()}`;
      const templateId = `${storeId}-${baseTemplateId}`;

      await prisma.descriptionTemplate.upsert({
        where: { id: templateId },
        update: {
          storeId,
          name: t.name,
          content: t.content,
          isDefault: t.isDefault,
        },
        create: {
          id: templateId,
          storeId,
          name: t.name,
          content: t.content,
          isDefault: t.isDefault,
        },
      });
      console.log(`Seeded template for ${storeId}: ${t.name}`);
    }
  }

  // --- Seed Keyword Blacklist ---
  const keywords = [
    { keyword: "Amazon", removeFromTitle: false, removeFromDescription: true },
    { keyword: "amazon", removeFromTitle: false, removeFromDescription: true },
    { keyword: "amazon.", removeFromTitle: true, removeFromDescription: true },
    { keyword: "Amazon.", removeFromTitle: true, removeFromDescription: true },
  ];

  for (const storeId of Object.values(stores)) {
    for (const k of keywords) {
      const keywordId = `${storeId}-seed-keyword-${k.keyword.replace(/\W/g, "_")}`;

      await prisma.keywordBlacklist.upsert({
        where: { id: keywordId },
        update: {
          storeId,
          keyword: k.keyword,
          removeFromTitle: k.removeFromTitle,
          removeFromDescription: k.removeFromDescription,
        },
        create: {
          id: keywordId,
          storeId,
          keyword: k.keyword,
          removeFromTitle: k.removeFromTitle,
          removeFromDescription: k.removeFromDescription,
        },
      });
      console.log(`Seeded keyword for ${storeId}: ${k.keyword}`);
    }
  }

  // --- Seed Supplier Settings ---
  for (const [storeName, storeId] of Object.entries(stores)) {
    const storeNumber = Number(storeName.replace(/\D/g, "")) || 1;

    await prisma.supplierSettings.upsert({
      where: {
        storeId_supplierName: {
          storeId,
          supplierName: "Amazon AU",
        },
      },
      update: { storeNumber },
      create: { storeId, supplierName: "Amazon AU", storeNumber },
    });
    console.log(`Seeded supplier settings for ${storeName}: Amazon AU`);
  }

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
