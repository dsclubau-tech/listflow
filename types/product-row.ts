import type { Product, Store, User } from "@/app/generated/prisma/client";
import type { AmazonPriceTrackingMode } from "@/lib/amazon-price-tracking";

export interface SerializedPriceHistorySummary {
  id: string;
  previousPrice: string;
  newPrice: string;
  previousSellPrice: string;
  newSellPrice: string;
  changePercent: number;
  ebayRevised: boolean;
  errorMessage: string | null;
  amazonPriceTrackingMode?: AmazonPriceTrackingMode;
  appliedAt: string | null;
  createdAt: string;
}

export type SerializedStore = Omit<Store, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

export type SerializedUser = Omit<User, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

export interface SerializedProductVariantSummary {
  id: string;
  title: string;
  buyPrice: string;
  feesPercent?: number;
  feesFixed?: number;
  profitPercent?: number;
  profitFixed?: number;
  promotedAdPercent?: number;
  sellPrice: string;
}

export type SerializedProductRow = Omit<
  Product,
  | "price"
  | "amazonPrice"
  | "lastPriceCheck"
  | "promotedAdSyncedAt"
  | "createdAt"
  | "updatedAt"
> & {
  price: string;
  amazonPrice?: string | null;
  lastPriceCheck?: string | null;
  promotedAdSyncedAt?: string | null;
  internalNote?: string | null;
  holdReason?: string | null;
  uploadedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  store: SerializedStore;
  createdBy: SerializedUser;
  variants?: SerializedProductVariantSummary[];
  priceHistory?: SerializedPriceHistorySummary[];
  _count?: {
    variants: number;
  };
};
