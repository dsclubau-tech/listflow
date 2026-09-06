import "dotenv/config";
import { prisma } from "../lib/prisma";

// Configurable mapping of existing stores to their AA account email or UUID
const STORE_OWNER_MAPPING: Record<string, string> = {
  "store-1": process.env.MIGRATION_STORE_1_OWNER || "dsclub.au@gmail.com",
  "oz-metro": process.env.MIGRATION_OZ_METRO_OWNER || "dsclub.au@gmail.com",
  "aussiewalmartonline": process.env.MIGRATION_AUSSIE_WALMART_OWNER || "dsclub.au@gmail.com",
  "store-3": process.env.MIGRATION_STORE_3_OWNER || "dsclub.au@gmail.com",
};

async function main() {
  console.log("[MIGRATE] Starting existing store ownerUserId migration...");

  // 1. Fetch all stores in DB (including inactive stores like store-3)
  const stores = await prisma.store.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: {
        select: { products: true },
      },
    },
  });

  console.log(`[MIGRATE] Found ${stores.length} stores in database.`);

  // 2. Query AA users to resolve emails to UUIDs
  const aaUsers = await prisma.$queryRawUnsafe<Array<{ id: string; email: string }>>(`
    SELECT id, email FROM auth.users;
  `);
  const userByEmail = new Map<string, string>();
  const userById = new Set<string>();
  for (const u of aaUsers) {
    if (u.email) userByEmail.set(u.email.toLowerCase(), u.id);
    userById.add(u.id);
  }

  // 3. STRICT PRE-FLIGHT VALIDATION: Fail loudly if ANY store cannot be resolved
  const resolvedUpdates: Array<{ storeId: string; loginId: string; name: string; ownerUserId: string; productsCount: number }> = [];

  for (const store of stores) {
    const loginId = store.loginId;
    if (!loginId || !STORE_OWNER_MAPPING[loginId]) {
      throw new Error(
        `[MIGRATION_ABORTED] CRITICAL: Store '${store.name}' (id: ${store.id}, loginId: ${loginId}, products: ${store._count.products}) has no mapped AA account in STORE_OWNER_MAPPING! Migration aborted with zero changes.`
      );
    }

    const target = STORE_OWNER_MAPPING[loginId];
    let resolvedUserId: string | null = null;

    if (userById.has(target)) {
      resolvedUserId = target;
    } else if (userByEmail.has(target.toLowerCase())) {
      resolvedUserId = userByEmail.get(target.toLowerCase())!;
    } else {
      throw new Error(
        `[MIGRATION_ABORTED] CRITICAL: Target owner '${target}' for store '${loginId}' (${store.name}) could not be resolved in AA auth.users! Migration aborted with zero changes.`
      );
    }

    resolvedUpdates.push({
      storeId: store.id,
      loginId,
      name: store.name,
      ownerUserId: resolvedUserId,
      productsCount: store._count.products,
    });
  }

  console.log(`[MIGRATE] Pre-flight passed: all ${resolvedUpdates.length} stores successfully resolved to valid AA user UUIDs.`);

  // 4. Perform atomic update preserving original updatedAt timestamps
  for (const update of resolvedUpdates) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Store" SET "ownerUserId" = $1, "updatedAt" = "updatedAt" WHERE "id" = $2;`,
      update.ownerUserId,
      update.storeId
    );
    console.log(`[MIGRATE] Linked store '${update.loginId}' (${update.name}) -> ownerUserId: ${update.ownerUserId}`);
  }

  console.log("[MIGRATE] Migration completed successfully.");
  console.table(
    resolvedUpdates.map((u) => ({
      storeId: u.storeId,
      loginId: u.loginId,
      storeName: u.name,
      ownerUserId: u.ownerUserId,
      products: u.productsCount,
    }))
  );
}

main()
  .catch((err) => {
    console.error("[MIGRATE_ERROR]", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
