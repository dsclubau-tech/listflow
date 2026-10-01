import type { Prisma, PrismaClient } from "@/app/generated/prisma/client";

export const BULK_EDIT_DATABASE_BATCH_SIZE = 1_000;

export async function createBulkEditJobWithItems(
  database: Pick<PrismaClient, "$transaction">,
  data: Prisma.EbayActionJobUncheckedCreateInput,
  productIds: string[],
  payload: Prisma.InputJsonValue,
) {
  return database.$transaction(async (tx) => {
    const job = await tx.ebayActionJob.create({ data });
    for (let offset = 0; offset < productIds.length; offset += BULK_EDIT_DATABASE_BATCH_SIZE) {
      await tx.bulkEditJobItem.createMany({
        data: productIds.slice(offset, offset + BULK_EDIT_DATABASE_BATCH_SIZE).map(productId => ({
          jobId: job.id,
          productId,
          payload,
        })),
      });
    }
    return job;
  }, { timeout: 30_000 });
}