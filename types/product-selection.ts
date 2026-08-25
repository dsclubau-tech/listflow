export interface ProductSelectionVariantSummary {
  id: string;
  title: string;
  buyPrice: string;
  sellPrice: string;
  feesPercent: number;
  feesFixed: number;
}

export interface ProductSelectionSummary {
  id: string;
  title: string;
  status: string;
  asin: string | null;
  storeId: string;
  price: string;
  amazonPrice: string | null;
  variants: ProductSelectionVariantSummary[];
  _count: {
    variants: number;
  };
  hasPendingPriceChange: boolean;
}
