import "dotenv/config";
import { defineConfig } from "prisma/config";

// Vercel cannot reach Supabase's IPv6-only direct host; use its session pooler.
const datasourceUrl =
  process.env["VERCEL"] === "1"
    ? process.env["DATABASE_URL"] || process.env["DIRECT_URL"]
    : process.env["DIRECT_URL"] || process.env["DATABASE_URL"];

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
    url: datasourceUrl,
  },
});
