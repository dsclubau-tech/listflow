import type { Product, Store, User } from "@/app/generated/prisma/client";

export interface SerializedPriceHistorySummary {
  id: string;
  previousPrice: string;
  newPrice: string;
  previousSellPrice: string;
  newSellPrice: string;
  changePercent: number;
  ebayRevised: boolean;
  errorMessage: string | null;
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

export type SerializedProductRow = Omit<
  Product,
  "price" | "amazonPrice" | "lastPriceCheck" | "createdAt" | "updatedAt"
> & {
  price: string;
  amazonPrice?: string | null;
  lastPriceCheck?: string | null;
  createdAt: string;
  updatedAt: string;
  store: SerializedStore;
  createdBy: SerializedUser;
  priceHistory?: SerializedPriceHistorySummary[];
  _count?: {
    variants: number;
  };
};
