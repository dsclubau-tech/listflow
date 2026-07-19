export type PriceChangeDirection = "up" | "down" | "unchanged";

export function getPriceChangeDirection(
  value: string | number,
): PriceChangeDirection {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount === 0) {
    return "unchanged";
  }

  return amount > 0 ? "up" : "down";
}

export function compareAbsolutePriceChanges(
  left: string | number,
  right: string | number,
  order: "largest" | "smallest",
) {
  const difference = Math.abs(Number(left)) - Math.abs(Number(right));
  return order === "largest" ? -difference : difference;
}
