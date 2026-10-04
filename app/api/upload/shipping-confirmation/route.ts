import { auth } from '@/auth';
import { getCurrentStoreSession } from '@/lib/store-session';
import { prisma } from '@/lib/prisma';
import { record, readShippingConfirmation } from '@/lib/amazon-upload-shipping-policy';
import type { Prisma } from '@/app/generated/prisma/client';
import { invalidateJobCaches } from '@/lib/cache-tags';
import { NextResponse } from 'next/server';

export async function DELETE(request: Request) {
  const [session, store] = await Promise.all([auth(), getCurrentStoreSession()]);
  if (!session?.user || !store) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  const confirmation = readShippingConfirmation(record(body).shippingConfirmation);
  if (!confirmation) return NextResponse.json({ error: 'Invalid shipping confirmation' }, { status: 400 });
  const cancelled = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "EbayActionJob" WHERE "id" = ${confirmation.sourceJobId} AND "storeId" = ${store.storeId} FOR UPDATE`;
    const job = await tx.ebayActionJob.findFirst({ where: { id: confirmation.sourceJobId, storeId: store.storeId, type: 'UPLOAD_LISTING' } });
    const metadata = record(job?.metadata), pending = record(metadata.pendingShipping), challenge = record(pending[confirmation.productId]);
    if (!job || challenge.nonce !== confirmation.nonce || challenge.approvedJobId) return false;
    const nextPending = { ...pending }; delete nextPending[confirmation.productId];
    const errors = Array.isArray(job.errors) ? job.errors.map(entry => {
      const row = record(entry);
      if (row.productId !== confirmation.productId) return entry;
      const next = { ...row }; delete next.shippingConfirmation; return next;
    }) : [];
    await tx.ebayActionJob.update({ where: { id: job.id }, data: {
      metadata: { ...metadata, hasPendingShipping: Object.values(nextPending).some(value => !record(value).approvedJobId), pendingShipping: nextPending } as Prisma.InputJsonObject,
      errors: errors as Prisma.InputJsonArray,
    } });
    return true;
  });
  if (!cancelled) return NextResponse.json({ error: 'Shipping confirmation has changed. Refresh the draft.' }, { status: 409 });
  invalidateJobCaches(store.storeId);
  return NextResponse.json({ success: true });
}
