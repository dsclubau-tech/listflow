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

  const explicitDatabaseUrl = environment.LISTFLOW_DEPLOYED_DATABASE_URL?.trim();
  const databaseUrl = explicitDatabaseUrl || environment.MIGRATION_SOURCE_DATABASE_URL?.trim();
  // Legacy migration-source credentials may point at a different database.
  const directUrl = environment.LISTFLOW_DEPLOYED_DIRECT_URL?.trim() ||
    (!explicitDatabaseUrl ? environment.MIGRATION_SOURCE_DIRECT_URL?.trim() : undefined);

  if (!databaseUrl) {
    throw new Error(
      "The deployed worker database URL is missing. Configure LISTFLOW_DEPLOYED_DATABASE_URL or MIGRATION_SOURCE_DATABASE_URL.",
    );
  }

  environment.DATABASE_URL = databaseUrl;
  environment.LISTFLOW_SUPABASE_TRANSACTION_POOLER = "false";
  environment.DIRECT_URL = directUrl || databaseUrl;

  return profile;
}
