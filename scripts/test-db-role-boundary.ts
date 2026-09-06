import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

async function main() {
  const envPath = path.join(process.cwd(), ".env.listflow_app");
  if (!fs.existsSync(envPath)) {
    throw new Error(`.env.listflow_app not found at ${envPath}`);
  }

  const envContent = fs.readFileSync(envPath, "utf8");
  const directUrlMatch = envContent.match(/LISTFLOW_APP_DIRECT_URL="([^"]+)"/);
  if (!directUrlMatch) {
    throw new Error("Could not find LISTFLOW_APP_DIRECT_URL in .env.listflow_app");
  }

  const connectionString = directUrlMatch[1];
  const client = new Client({ connectionString });
  await client.connect();

  console.log("[TEST_BOUNDARY] Connected to PostgreSQL as listflow_app.");

  // Verify current user
  const whoami = await client.query("SELECT current_user, session_user;");
  console.log(`[TEST_BOUNDARY] Current user: ${whoami.rows[0].current_user}`);
  if (whoami.rows[0].current_user !== "listflow_app") {
    throw new Error(`Expected current_user to be listflow_app, got ${whoami.rows[0].current_user}`);
  }

  // 1. Test allowed query on ListFlow tables
  const storeCount = await client.query('SELECT count(*) FROM "Store";');
  console.log(`[TEST_BOUNDARY] Access to "Store" allowed: ${storeCount.rows[0].count} stores found.`);

  const snapshotCount = await client.query('SELECT count(*) FROM "EntitlementSnapshot";');
  console.log(`[TEST_BOUNDARY] Access to "EntitlementSnapshot" allowed: ${snapshotCount.rows[0].count} snapshots found.`);

  const productCount = await client.query('SELECT count(*) FROM "Product";');
  console.log(`[TEST_BOUNDARY] Access to "Product" allowed: ${productCount.rows[0].count} products found.`);

  // 2. Test REVOKED access to AA public.subscriptions table
  let deniedSubscriptions = false;
  try {
    await client.query("SELECT * FROM public.subscriptions LIMIT 1;");
  } catch (err: any) {
    if (err.code === "42501") {
      deniedSubscriptions = true;
      console.log(`[TEST_BOUNDARY] Access to public.subscriptions successfully DENIED (code 42501: ${err.message})`);
    } else {
      throw new Error(`Expected 42501 on subscriptions, got ${err.code}: ${err.message}`);
    }
  }

  if (!deniedSubscriptions) {
    throw new Error("SECURITY VIOLATION: listflow_app was able to query public.subscriptions!");
  }

  // 3. Test REVOKED access to AA public.stores table
  let deniedStores = false;
  try {
    await client.query("SELECT * FROM public.stores LIMIT 1;");
  } catch (err: any) {
    if (err.code === "42501") {
      deniedStores = true;
      console.log(`[TEST_BOUNDARY] Access to public.stores successfully DENIED (code 42501: ${err.message})`);
    } else {
      throw new Error(`Expected 42501 on stores, got ${err.code}: ${err.message}`);
    }
  }

  if (!deniedStores) {
    throw new Error("SECURITY VIOLATION: listflow_app was able to query public.stores!");
  }

  // 4. Test REVOKED access to auth.users
  let deniedAuthUsers = false;
  try {
    await client.query("SELECT * FROM auth.users LIMIT 1;");
  } catch (err: any) {
    if (err.code === "42501") {
      deniedAuthUsers = true;
      console.log(`[TEST_BOUNDARY] Access to auth.users successfully DENIED (code 42501: ${err.message})`);
    } else {
      throw new Error(`Expected 42501 on auth.users, got ${err.code}: ${err.message}`);
    }
  }

  if (!deniedAuthUsers) {
    throw new Error("SECURITY VIOLATION: listflow_app was able to query auth.users!");
  }

  await client.end();
  console.log("[TEST_BOUNDARY] ALL SECURITY BOUNDARY ASSERTIONS PASSED!");
}

main().catch((err) => {
  console.error("[TEST_BOUNDARY_FAILED]", err);
  process.exit(1);
});
