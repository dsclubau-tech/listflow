export const variantStatuses = ["IN_STOCK", "OUT_OF_STOCK"] as const;

export type VariantStatusValue = (typeof variantStatuses)[number];

export interface VariantRecord {
  id: string;
  sku: string | null;
  title: string;
  images: string[];
  buyPrice: string;
  feesPercent: number;
  feesFixed: number;
  profitPercent: number;
  profitFixed: number;
  promotedAdPercent: number;
  sellPrice: string;
  quantity: number;
  status: VariantStatusValue;
  automation: string | null;
  includeShipping: boolean;
  allowMarketplace: boolean;
  roundCents: number | null;
  itemSpecifics: Record<string, string>;
  productId: string;
  createdAt: string;
  updatedAt: string;
}

export interface VariantPayload {
  sku: string | null;
  title: string;
  images: string[];
  buyPrice: number;
  feesPercent: number;
  feesFixed: number;
  profitPercent: number;
  profitFixed: number;
  promotedAdPercent: number;
  sellPrice: number;
  quantity: number;
  status: VariantStatusValue;
  automation: string | null;
  includeShipping: boolean;
  allowMarketplace: boolean;
  roundCents: number | null;
  itemSpecifics: Record<string, string>;
}
