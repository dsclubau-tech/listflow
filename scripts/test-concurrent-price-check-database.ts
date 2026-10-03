import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { configureWorkerDatabaseProfile } from "../lib/worker-database-profile";

// Inserts are rolled back; this does not save product changes or call eBay.
test("real database accepts independent job leases and orders Amazon observations", {
  skip: process.env.LISTFLOW_RUN_CONCURRENT_DB_TEST !== "1", timeout: 60_000,
}, async () => {
  configureWorkerDatabaseProfile();
  const { prisma } = await import("../lib/prisma");
  const rollback = new Error("intentional integration rollback");
  let storesChecked = 0;
  try {
    await assert.rejects(prisma.$transaction(async tx => {
      const stores = await tx.store.findMany({ where: {loginId:{in:["store-1","aussiewalmartonline","oz-metro"]}} });
      assert.equal(stores.length,3);
      for (const store of stores) {
        const product = await tx.product.findFirst({where:{storeId:store.id}});
        assert.ok(product);
        const prefix = `integration:${randomUUID()}`;
        const lease = (jobId:string) => ({ storeId:store.id,resourceKey:`price-check-job:${jobId}`,
          jobType:"PRICE_CHECK",jobId,workerId:prefix,workerName:"Rollback test",expiresAt:new Date(Date.now()+30000) });
        await tx.jobLease.create({data:lease(`${prefix}:a`)});
        await tx.jobLease.create({data:lease(`${prefix}:b`)});
        assert.equal(await tx.jobLease.count({where:{storeId:store.id,workerId:prefix}}),2);
        const newerAt=new Date(),olderAt=new Date(newerAt.getTime()-1000);
        const observation = (observedAt:Date) => ({storeId:store.id,productId:product.id,observedAt,
          requestedAsin:product.asin,selectedAsin:product.asin,identityOutcome:"MATCH",postcodeVerified:true,
          verifiedPostcode:"2217",buyBoxOutcome:"AVAILABLE",isSuccessful:true,price:100});
        await tx.amazonPriceObservation.create({data:observation(olderAt)});
        const newer=await tx.amazonPriceObservation.create({data:observation(newerAt)});
        const found=await tx.amazonPriceObservation.findFirst({where:{productId:product.id,observedAt:{gt:olderAt}},orderBy:{observedAt:"desc"}});
        assert.equal(found?.id,newer.id);
        assert.equal(found.observedAt.getTime(),newerAt.getTime());
        storesChecked++;
      }
      throw rollback;
    },{timeout:30000}),error => error===rollback);
    assert.equal(storesChecked,3);
  } finally { await prisma.$disconnect(); }
});
