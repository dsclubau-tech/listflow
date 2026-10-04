import "server-only";
import { randomUUID } from 'node:crypto';
import { prisma } from "@/lib/prisma";
import type { Prisma } from '@/app/generated/prisma/client';
import { scrapeAmazonPrice } from './amazon-scraper';
import { extractVariantSelectionHints } from './amazon-variant-selection';
import { resolveAmazonDeliveryPostcode } from './amazon-delivery-postcode';
import { normalizeAmazonPriceTrackingMode } from './amazon-price-tracking';
import { evaluateAmazonShipping, readAmazonShippingEvidence, SHIPPING_EVIDENCE_MAX_AGE_MS } from './amazon-shipping-evidence';

import { record, readShippingConfirmation, shippingContextsMatch, getUploadShippingApproval, type ShippingConfirmation, type UploadShippingContext, type UploadShippingConfirmation } from "./amazon-upload-shipping-policy";
export { readShippingConfirmation, getUploadShippingApproval };
export class ShippingConfirmationError extends Error {
  constructor(message: string) { super(message); this.name = "ShippingConfirmationError"; }
}

/** Runs in upload-creation's transaction; browser input can reference only a server-created challenge. */
export async function resolveShippingApproval(tx: Prisma.TransactionClient, storeId: string, productIds: string[], confirmation: ShippingConfirmation) {
  if (productIds.length !== 1 || productIds[0] !== confirmation.productId) throw new ShippingConfirmationError('Shipping approval must apply to one product.');
  await tx.$queryRaw`SELECT "id" FROM "EbayActionJob" WHERE "id" = ${confirmation.sourceJobId} AND "storeId" = ${storeId} FOR UPDATE`;
  const source = await tx.ebayActionJob.findFirst({ where: { id: confirmation.sourceJobId, storeId, type: 'UPLOAD_LISTING' } });
  const pending = record(record(source?.metadata).pendingShipping);
  const challenge = record(pending[confirmation.productId]);
  const approvedContext = getUploadShippingApproval({ shippingApprovals: { [confirmation.productId]: challenge.context } }, confirmation.productId);
  if (!source || !source.productIds.includes(confirmation.productId) || challenge.nonce !== confirmation.nonce || !approvedContext) throw new ShippingConfirmationError('Shipping confirmation is invalid. Retry the shipping check.');
  const [product, settings] = await Promise.all([
    tx.product.findFirst({ where: { id: confirmation.productId, storeId } }),
    tx.supplierSettings.findUnique({ where: { storeId_supplierName: { storeId, supplierName: 'Amazon AU' } } }),
  ]);
  if (!product || product.asin !== approvedContext.asin || normalizeAmazonPriceTrackingMode(product.amazonPriceTrackingMode) !== approvedContext.mode ||
    resolveAmazonDeliveryPostcode(settings?.scrapePostcode) !== approvedContext.postcode || (settings?.maxShippingDays ?? 25) !== approvedContext.maximum) throw new ShippingConfirmationError('Product or shipping settings changed. Retry the shipping check before approving.');
  return { source, approvedContext, existingJobId: typeof challenge.approvedJobId === 'string' ? challenge.approvedJobId : null };
}

export async function guardAmazonUploadShipping(input: {
  product: { id: string; storeId: string; asin: string | null; amazonPriceTrackingMode: string; itemSpecifics: unknown; title: string; variants?: Array<{title?: string | null; variantTitle?: string | null; itemSpecifics?: unknown}> };
  userId: string; jobId?: string; approval?: UploadShippingContext | null;
}) {
  const { product } = input;
  // Non-Amazon manual drafts have no Amazon offer to evaluate.
  if (!product.asin) return { allowed: true as const };
  const settings = await prisma.supplierSettings.findUnique({ where: { storeId_supplierName: { storeId: product.storeId, supplierName: 'Amazon AU' } } });
  const postcode = resolveAmazonDeliveryPostcode(settings?.scrapePostcode);
  const mode = normalizeAmazonPriceTrackingMode(product.amazonPriceTrackingMode);
  const maximum = settings?.maxShippingDays ?? 25;
  const cached = await prisma.amazonPriceObservation.findFirst({ where: { productId: product.id, storeId: product.storeId,
    observedAt: { gte: new Date(Date.now() - SHIPPING_EVIDENCE_MAX_AGE_MS) } }, orderBy: { observedAt: 'desc' } });
  let evidence = readAmazonShippingEvidence(cached?.shippingEvidence);
  if (!cached || !cached.isSuccessful || !cached.eligibleOffer || cached.stockLeft === 0 || Number(cached.price) <= 0 || !Number.isFinite(Number(cached.price)) ||
    cached.requestedAsin !== product.asin || cached.selectedAsin !== product.asin || cached.priceMode !== mode ||
    cached.identityOutcome !== 'MATCH' || cached.buyBoxOutcome !== 'AVAILABLE' || !cached.postcodeVerified || cached.verifiedPostcode !== postcode ||
    !evidence || evidence.asin !== product.asin || evidence.mode !== mode || evidence.postcode !== postcode ||
    Date.parse(evidence.observedAt) !== cached.observedAt.getTime() || evaluateAmazonShipping(evidence, maximum, new Date(), true).outcome === 'UNKNOWN') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Amazon upload shipping verification timed out. Retry the check.')), 120_000);
    try {
      let result = await scrapeAmazonPrice(product.asin, undefined, postcode, mode, extractVariantSelectionHints(product), { signal: controller.signal });
      if (result.price !== null && evaluateAmazonShipping(result.shippingEvidence, maximum).outcome === 'UNKNOWN') {
        result = await scrapeAmazonPrice(product.asin, undefined, postcode, mode, extractVariantSelectionHints(product), { signal: controller.signal });
      }
      controller.signal.throwIfAborted();
      if (result.price === null || !Number.isFinite(result.price) || result.price <= 0 || result.stockLeft === 0 || result.variantSelectionFailed || result.detectedAsin !== product.asin || result.identityOutcome !== 'MATCH' || result.buyBoxOutcome !== 'AVAILABLE' || !result.postcodeVerified || result.selectedPriceMode !== mode) {
        throw new Error('The selected Amazon offer could not be verified. Retry before uploading.');
      }
      evidence = readAmazonShippingEvidence(result.shippingEvidence);
      if (evidence && (evidence.asin !== product.asin || evidence.mode !== mode || evidence.postcode !== postcode || Date.parse(evidence.observedAt) !== result.observedAt?.getTime())) throw new Error("Amazon delivery evidence does not match the selected offer. Retry the check.");
      await prisma.amazonPriceObservation.create({ data: { productId: product.id, storeId: product.storeId,
        requestedAsin: product.asin, selectedAsin: result.detectedAsin, identityOutcome: result.identityOutcome, buyBoxOutcome: result.buyBoxOutcome,
        verifiedPostcode: postcode, postcodeVerified: true, eligibleOffer: true, isSuccessful: true,
        stockLeft: result.stockLeft, price: result.price, regularPrice: result.priceChoices?.regular, dealPrice: result.priceChoices?.deal, priceMode: mode,
        observedAt: result.observedAt ?? new Date(), shippingEvidence: evidence ?? undefined } });
    } finally { clearTimeout(timer); }
  }
  const currentContext: UploadShippingContext = { asin: product.asin, mode, selectedMode: mode, postcode, maximum };
  const shipping = evaluateAmazonShipping(evidence, maximum, new Date(), true);
  if (shipping.outcome === 'WITHIN_LIMIT') return { allowed: true as const, context: currentContext };
  if (shipping.outcome === 'OVER_LIMIT') return { allowed: false as const, status: 422, message: shipping.message };
  if (shippingContextsMatch(input.approval, currentContext)) return { allowed: true as const, context: currentContext };
  const nonce = randomUUID();
  const message = 'Amazon delivery time could not be verified. Retry the check, upload this item anyway, or cancel.';
  let sourceJobId = input.jobId;
  if (sourceJobId) {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "EbayActionJob" WHERE "id" = ${sourceJobId} AND "storeId" = ${product.storeId} FOR UPDATE`;
      const job = await tx.ebayActionJob.findFirstOrThrow({ where: { id: sourceJobId, storeId: product.storeId } });
      const metadata = record(job.metadata);
      await tx.ebayActionJob.update({ where: { id: job.id }, data: { metadata: { ...metadata,
        hasPendingShipping: true, pendingShipping: { ...record(metadata.pendingShipping), [product.id]: { nonce, context: currentContext } } } as Prisma.InputJsonObject } });
    });
  } else {
    const job = await prisma.ebayActionJob.create({ data: { userId: input.userId, storeId: product.storeId, type: 'UPLOAD_LISTING', status: 'COMPLETED',
      productIds: [product.id], completedProductIds: [product.id], total: 1, processed: 1, failed: 1, completedAt: new Date(),
      metadata: { hasPendingShipping: true, pendingShipping: { [product.id]: { nonce, context: currentContext } } } } });
    sourceJobId = job.id;
  }
  const confirmation: UploadShippingConfirmation = { sourceJobId, productId: product.id, nonce, message };
  if (!input.jobId) await prisma.ebayActionJob.update({ where: { id: sourceJobId }, data: {
    errors: [{ productId: product.id, title: product.title, error: message, shippingConfirmation: confirmation }] } });
  return { allowed: false as const, status: 409, message, confirmation };
}

export async function assertUploadShippingContext(productId: string, storeId: string, approved: UploadShippingContext) {
  const [product, settings] = await Promise.all([
    prisma.product.findFirst({ where: { id: productId, storeId } }),
    prisma.supplierSettings.findUnique({ where: { storeId_supplierName: { storeId, supplierName: 'Amazon AU' } } }),
  ]);
  if (!product || product.ebayItemId || product.asin !== approved.asin || normalizeAmazonPriceTrackingMode(product.amazonPriceTrackingMode) !== approved.mode ||
    resolveAmazonDeliveryPostcode(settings?.scrapePostcode) !== approved.postcode || (settings?.maxShippingDays ?? 25) !== approved.maximum) throw new Error('Product or shipping settings changed during upload. Retry the check.');
}

/** A new attempt replaces unresolved prompts, without reusing a prior approval. */
export async function clearPendingShippingChallenges(tx: Prisma.TransactionClient, storeId: string, productIds: string[], exceptJobId?: string) {
  const jobs = await tx.ebayActionJob.findMany({ where: { storeId, type: 'UPLOAD_LISTING', productIds: { hasSome: productIds }, metadata: { path: ['hasPendingShipping'], equals: true }, ...(exceptJobId ? {id: {not: exceptJobId}} : {}) }, orderBy: {id: 'asc'} });
  for (const candidate of jobs) {
    await tx.$queryRaw`SELECT "id" FROM "EbayActionJob" WHERE "id" = ${candidate.id} AND "storeId" = ${storeId} FOR UPDATE`;
    const job = await tx.ebayActionJob.findFirstOrThrow({where: {id: candidate.id, storeId}});
    const metadata = record(job.metadata), pending = {...record(metadata.pendingShipping)};
    for (const productId of productIds) if (!record(pending[productId]).approvedJobId) delete pending[productId];
    await tx.ebayActionJob.update({where: {id: job.id}, data: {metadata: {...metadata, pendingShipping: pending, hasPendingShipping: Object.values(pending).some(value => !record(value).approvedJobId)} as Prisma.InputJsonObject}});
  }
}
