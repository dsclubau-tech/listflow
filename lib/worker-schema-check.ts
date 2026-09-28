type SchemaClient = {
  supplierSettings: {
    findFirst(args: { select: { defaultLocationText: true } }): PromiseLike<unknown>;
  };
};

export async function assertWorkerSchemaReady(client: SchemaClient): Promise<void> {
  try {
    // Query the column even if there are no settings rows yet.
    await client.supplierSettings.findFirst({ select: { defaultLocationText: true } });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "P2022" || code === "P2021") {
      throw new Error(
        "Worker database schema is out of date. Apply the pending Prisma migrations " +
        "to this worker's database using the table-owner migration account, then restart workers. " +
        "Generating Prisma Client alone does not update the database.",
        { cause: error },
      );
    }
    throw error;
  }
}
