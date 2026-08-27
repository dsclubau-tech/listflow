export type WorkerDatabaseProfile = "default" | "deployed";

type WorkerDatabaseEnvironment = Record<string, string | undefined>;

export function configureWorkerDatabaseProfile(
  environment: WorkerDatabaseEnvironment = process.env,
): WorkerDatabaseProfile {
  const profile =
    environment.LISTFLOW_WORKER_DATABASE_PROFILE?.trim().toLowerCase() ||
    "default";

  if (profile === "default") {
    return profile;
  }

  if (profile !== "deployed") {
    throw new Error(`Unsupported worker database profile: ${profile}`);
  }

  const databaseUrl =
    environment.LISTFLOW_DEPLOYED_DATABASE_URL?.trim() ||
    environment.MIGRATION_SOURCE_DATABASE_URL?.trim();
  const directUrl =
    environment.LISTFLOW_DEPLOYED_DIRECT_URL?.trim() ||
    environment.MIGRATION_SOURCE_DIRECT_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      "The deployed worker database URL is missing. Configure LISTFLOW_DEPLOYED_DATABASE_URL or MIGRATION_SOURCE_DATABASE_URL.",
    );
  }

  environment.DATABASE_URL = databaseUrl;
  environment.LISTFLOW_SUPABASE_TRANSACTION_POOLER = "false";
  if (directUrl) {
    environment.DIRECT_URL = directUrl;
  }

  return profile;
}
