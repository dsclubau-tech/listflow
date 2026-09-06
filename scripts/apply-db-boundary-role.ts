import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../lib/prisma";

async function main() {
  const currentUrl = process.env.DATABASE_URL || "";
  const parsed = new URL(currentUrl);
  // Extract project ref from username e.g. postgres.tdevgrwmafwrsmeymjzd
  const userParts = parsed.username.split(".");
  const projectRef = userParts.length > 1 ? userParts[1] : "tdevgrwmafwrsmeymjzd";

  // Check if we already have a generated password in .env.listflow_app or generate a fresh one
  let securePassword = "";
  const envPath = path.join(process.cwd(), ".env.listflow_app");
  if (fs.existsSync(envPath)) {
    const existing = fs.readFileSync(envPath, "utf8");
    const m = existing.match(/LISTFLOW_APP_PASSWORD="([^"]+)"/);
    if (m) {
      securePassword = m[1];
    }
  }

  if (!securePassword) {
    securePassword = crypto.randomBytes(32).toString("base64url");
    console.log("[DB_ROLE] Generated cryptographically secure random password for listflow_app.");
  } else {
    console.log("[DB_ROLE] Using existing cryptographically secure password for listflow_app.");
  }

  // 1. Create or update role with the secure password
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'listflow_app') THEN
        CREATE ROLE listflow_app WITH LOGIN PASSWORD '${securePassword}';
      ELSE
        ALTER ROLE listflow_app WITH LOGIN PASSWORD '${securePassword}';
      END IF;
    END
    $$;
  `);

  console.log("[DB_ROLE] Executing atomic transaction: GRANT on ListFlow tables + REVOKE on AA tables + ALTER DEFAULT PRIVILEGES...");

  // 2. Atomic transaction: GRANT and REVOKE in single block so no window exists where listflow_app has access to AA tables
  await prisma.$executeRawUnsafe(`
    BEGIN;

    GRANT CONNECT ON DATABASE postgres TO listflow_app;
    GRANT USAGE ON SCHEMA public TO listflow_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO listflow_app;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO listflow_app;

    REVOKE ALL ON TABLE
      public.subscriptions,
      public.subscription_history,
      public.stores,
      public.tools,
      public.tool_credentials,
      public.tool_notifications,
      public.profiles,
      public.pricing_packages,
      public.stripe_webhook_events,
      public.admin_audit_log,
      public.rate_limits,
      public.site_settings,
      public.services,
      public.educational_content,
      public.newsletter_subscribers,
      public.contacts,
      public.cp_bot_activity_log,
      public.cp_bot_cloud_clipboard,
      public.cp_bot_config,
      public.cp_bot_fulfillments,
      public.cp_bot_gift_templates,
      public.cp_bot_insight_cards,
      public.cp_bot_licenses,
      public.cp_bot_settings,
      public.learn_articles,
      public.learn_categories,
      public.article_comments,
      public.article_reactions,
      public.comment_likes,
      public.templates,
      public.label_history,
      public.user_roles
    FROM listflow_app;

    REVOKE ALL ON SCHEMA auth FROM listflow_app;

    -- All application tables in Supabase public schema are created under role 'postgres'
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM listflow_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM listflow_app;

    COMMIT;
  `);

  console.log("[DB_ROLE] Atomic transaction committed successfully.");

  // Construct connection strings with tenant suffix: listflow_app.<projectRef>
  const host = parsed.hostname;
  const dbName = parsed.pathname.replace(/^\//, "") || "postgres";
  const tenantUser = `listflow_app.${projectRef}`;
  const encodedPassword = encodeURIComponent(securePassword);

  const pooledUrl = `postgresql://${tenantUser}:${encodedPassword}@${host}:6543/${dbName}?pgbouncer=true`;
  const directUrl = `postgresql://${tenantUser}:${encodedPassword}@${host}:5432/${dbName}`;

  const envContent = [
    `# Scoped role credentials for listflow_app (Do not commit to git)`,
    `LISTFLOW_APP_DATABASE_URL="${pooledUrl}"`,
    `LISTFLOW_APP_DIRECT_URL="${directUrl}"`,
    `LISTFLOW_APP_PASSWORD="${securePassword}"`,
    ``,
  ].join("\n");

  fs.writeFileSync(envPath, envContent, "utf8");
  console.log(`[DB_ROLE] Scoped connection strings with tenant identifier written safely to ${envPath}`);
}

main()
  .catch((err) => {
    console.error("[DB_ROLE_ERROR]", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
