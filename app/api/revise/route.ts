import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { buildReviseItemXML } from "@/lib/ebay-xml";
import { callEbayReviseItem, getStoreNumber } from "@/lib/ebay";
import { resolveDescriptionTemplate } from "@/lib/template-resolver";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";
import { policyIdsMatch, resolveProductPolicySelection } from "@/lib/policy-defaults";

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(request, storeSession ? { storeId: storeSession.storeId } : {});

  if (!session?.user || !storeSession) {
    log.warn("revise/route", "Unauthorized revise attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    log.error("revise/route", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { productId } = body;

  if (!productId) {
    log.warn("revise/route", "Revise request missing productId");
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, storeId: storeSession.storeId },
    include: { store: true },
  });

  if (!product) {
    log.warn("revise/route", "Product not found for revise", { productId });
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (product.status !== "IMPORTED" || !product.ebayItemId) {
    log.warn("revise/route", "Rejected revise for product not listed on eBay", {
      productId,
    });
    return NextResponse.json(
      { error: "Product is not currently listed on eBay" },
      { status: 400 },
    );
  }

  try {
    const storeNumber = await getStoreNumber(product.storeId);
    const policySelection = await resolveProductPolicySelection(
      product.storeId,
      {
        shippingPolicyId: product.shippingPolicyId,
        returnPolicyId: product.returnPolicyId,
        paymentPolicyId: product.paymentPolicyId,
      },
      product.policyTemplateId,
    );
    const productWithPolicies = {
      ...product,
      shippingPolicyId: policySelection.shippingPolicyId,
      returnPolicyId: policySelection.returnPolicyId,
      paymentPolicyId: policySelection.paymentPolicyId,
      policyTemplateId: policySelection.policyTemplateId,
    };

    if (!policyIdsMatch(product, productWithPolicies)) {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          shippingPolicyId: policySelection.shippingPolicyId,
          returnPolicyId: policySelection.returnPolicyId,
          paymentPolicyId: policySelection.paymentPolicyId,
          policyTemplateId: policySelection.policyTemplateId,
        },
      });
    }

    const finalDescription = await resolveDescriptionTemplate(productWithPolicies);
    const productWithResolvedDesc = { ...productWithPolicies, description: finalDescription };

    // Fetch variants so we can use the primary variant's sellPrice as the
    // eBay listing price instead of the potentially stale product.price.
    const variants = await prisma.variant.findMany({
      where: { productId: product.id },
      orderBy: { createdAt: "asc" },
    });

    const primarySellPrice = variants.length > 0
      ? Number(variants[0].sellPrice)
      : null;

    // If we have a valid variant sell price, use it as the eBay StartPrice
    // and sync product.price to keep them consistent.
    const overrideStartPrice =
      primarySellPrice !== null && Number.isFinite(primarySellPrice) && primarySellPrice > 0
        ? primarySellPrice
        : undefined;

    if (overrideStartPrice !== undefined) {
      await prisma.product.update({
        where: { id: productId },
        data: { price: overrideStartPrice },
      });
    }

    const xml = buildReviseItemXML(productWithResolvedDesc, overrideStartPrice);

    log.info("revise/route", "Sending ReviseItem request to eBay", {
      productId,
      ebayItemId: product.ebayItemId,
      storeNumber,
      startPrice: overrideStartPrice ?? Number(product.price),
    });

    const result = await callEbayReviseItem(xml, storeNumber);

    if (result.success) {
      await prisma.product.update({
        where: { id: productId },
        data: {
          status: "IMPORTED",
          errorMessage: null,
        },
      });

      log.info("revise/route", "eBay ReviseItem succeeded", {
        productId,
        ebayItemId: product.ebayItemId,
      });
      return NextResponse.json({ success: true });
    }

    await prisma.product.update({
      where: { id: productId },
      data: {
        errorMessage: result.errorMessage || "Revise failed",
      },
    });

    log.error("revise/route", "eBay ReviseItem failed", undefined, {
      productId,
      ebayError: result.errorMessage,
    });
    return NextResponse.json(
      { success: false, error: result.errorMessage },
      { status: 422 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    await prisma.product.update({
      where: { id: productId },
      data: {
        errorMessage: message,
      },
    });

    log.error("revise/route", "Unhandled error in revise route", error, {
      productId,
    });
    const isValidationError =
      message.includes("Policy") ||
      message.includes("Category") ||
      message.includes("Price") ||
      message.includes("Quantity");

    return NextResponse.json(
      { success: false, error: message },
      { status: isValidationError ? 422 : 500 },
    );
  }
}
