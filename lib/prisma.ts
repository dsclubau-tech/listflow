import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const adapter = new PrismaNeon({
    connectionString: process.env.DATABASE_URL!,
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
