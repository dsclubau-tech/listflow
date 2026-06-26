import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function parsePoolMax() {
  const value =
    process.env.LISTFLOW_DB_POOL_MAX ??
    (process.env.NODE_ENV === "production" ? "1" : "5");
  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
    max: parsePoolMax(),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  return new PrismaClient({ adapter });
}

function hasCurrentPrismaDelegates(client: PrismaClient | undefined) {
  return Boolean(
    client &&
      "priceCheckJob" in client &&
      "ebayImportStatsCache" in client &&
      "ebayImportJob" in client &&
      "ebayResearchJob" in client,
  );
}

export const prisma = hasCurrentPrismaDelegates(globalForPrisma.prisma)
  ? globalForPrisma.prisma!
  : createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
