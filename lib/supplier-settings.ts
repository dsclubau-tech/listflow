import "server-only";

import { prisma } from "@/lib/prisma";
import {
  normalizeEbayStoreNumber,
  resolveLegacyEbayStoreNumber,
} from "@/lib/store-profile";

export const AMAZON_AU_SUPPLIER_NAME = "Amazon AU";

export async function getOrCreateStoreSupplierSettings(storeId: string) {
  let settings = await prisma.supplierSettings.findUnique({
    where: {
      storeId_supplierName: {
        storeId,
        supplierName: AMAZON_AU_SUPPLIER_NAME,
      },
    },
  });

  if (settings) {
    return settings;
  }

  const [globalSettings, store] = await Promise.all([
    prisma.supplierSettings.findFirst({
      where: { storeId: null, supplierName: AMAZON_AU_SUPPLIER_NAME },
    }),
    prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true, loginId: true },
    }),
  ]);

  const storeNumber =
    resolveLegacyEbayStoreNumber(store ?? {}) ??
    normalizeEbayStoreNumber(globalSettings?.storeNumber) ??
    1;

  settings = await prisma.supplierSettings.create({
    data: {
      storeId,
      supplierName: AMAZON_AU_SUPPLIER_NAME,
      defaultQuantity: globalSettings?.defaultQuantity ?? 1,
      defaultCountry: globalSettings?.defaultCountry ?? "Australia",
      defaultZipcode: globalSettings?.defaultZipcode ?? "3170",
      defaultShippingMethod:
        globalSettings?.defaultShippingMethod ?? "Cheapest with tracking",
      defaultShippingPolicyId: globalSettings?.defaultShippingPolicyId ?? null,
      defaultPaymentPolicyId: globalSettings?.defaultPaymentPolicyId ?? null,
      defaultReturnPolicyId: globalSettings?.defaultReturnPolicyId ?? null,
      ebayFeePercent: globalSettings?.ebayFeePercent ?? 13,
      fixedFeeAmount: globalSettings?.fixedFeeAmount ?? 0.33,
      defaultUploadProfitPercent:
        globalSettings?.defaultUploadProfitPercent ?? 0,
      defaultUploadProfitFixed: globalSettings?.defaultUploadProfitFixed ?? 0,
      minimumProfit: globalSettings?.minimumProfit ?? 1,
      capitalizeTitle: globalSettings?.capitalizeTitle ?? false,
      autofillBrand: globalSettings?.autofillBrand ?? true,
      allowVeroKeywords: globalSettings?.allowVeroKeywords ?? false,
      privateListing: globalSettings?.privateListing ?? false,
      defaultWeightUnit: globalSettings?.defaultWeightUnit ?? "Kg",
      automaticSkuFilling: globalSettings?.automaticSkuFilling ?? true,
      minProductQuantity: globalSettings?.minProductQuantity ?? 2,
      maxShippingDays: globalSettings?.maxShippingDays ?? 25,
      primeOnly: globalSettings?.primeOnly ?? true,
      priceTrackingEnabled: globalSettings?.priceTrackingEnabled ?? false,
      autoHoldOnPriceCheckFailure:
        globalSettings?.autoHoldOnPriceCheckFailure ?? true,
      priceCheckHour: globalSettings?.priceCheckHour ?? 6,
      scrapePostcode: globalSettings?.scrapePostcode ?? "2217",
      storeNumber,
      defaultItemSpecifics: globalSettings?.defaultItemSpecifics ?? {},
    },
  });

  return settings;
}
