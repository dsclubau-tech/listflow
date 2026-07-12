import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { reuseOrCreateClient } from "@/lib/prisma-client-policy";

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

function getDatabaseConnectionString() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  return normalizeSupabasePoolerUrl(connectionString);
}

function normalizeSupabasePoolerUrl(connectionString: string) {
  const shouldUseTransactionPooler =
    process.env.LISTFLOW_SUPABASE_TRANSACTION_POOLER !== "false" &&
    (process.env.VERCEL === "1" ||
      process.env.LISTFLOW_SUPABASE_TRANSACTION_POOLER === "true");

  if (!shouldUseTransactionPooler) return connectionString;

  try {
    const url = new URL(connectionString);
    const isSupabasePooler = url.hostname.endsWith(".pooler.supabase.com");

    if (isSupabasePooler && (!url.port || url.port === "5432")) {
      url.port = "6543";
      return url.toString();
    }
  } catch {
    return connectionString;
  }

  return connectionString;
}

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: getDatabaseConnectionString(),
    max: parsePoolMax(),
    idleTimeoutMillis: 1_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  return new PrismaClient({ adapter });
}

export const prisma = reuseOrCreateClient(
  globalForPrisma.prisma,
  createPrismaClient
);

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
