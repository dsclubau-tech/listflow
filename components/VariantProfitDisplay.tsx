"use client";

import type { ProductDisplayProfit } from "@/lib/product-profit";

export default function VariantProfitDisplay({
  profit,
  profitAfterAdFee,
}: ProductDisplayProfit) {
  return (
    <div className="space-y-1">
      <div className={`font-medium ${profit < 0 ? "text-red-700" : "text-gray-900"}`}>
        ${profit.toFixed(2)}
      </div>
      <div
        className="text-xs leading-4"
        title={
          profitAfterAdFee === null
            ? "Sync eBay Ads to calculate profit after the promoted-ad fee. Dynamic campaigns do not expose a fixed fee rate."
            : "Profit after the current promoted-ad fee"
        }
      >
        <span className="text-gray-500">After ad: </span>
        <span className={profitAfterAdFee !== null && profitAfterAdFee < 0 ? "font-semibold text-red-700" : "font-semibold text-gray-700"}>
          {profitAfterAdFee === null ? "Unavailable" : `$${profitAfterAdFee.toFixed(2)}`}
        </span>
      </div>
    </div>
  );
}