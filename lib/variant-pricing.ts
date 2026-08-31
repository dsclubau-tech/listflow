function normalizeNumber(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }

  return value;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function applyRoundCents(value: number, roundCents: number | null) {
  const normalizedValue = roundMoney(Math.max(0, normalizeNumber(value)));

  if (roundCents === null || roundCents === undefined) {
    return normalizedValue;
  }

  const normalizedRoundCents = normalizeNumber(roundCents);

  if (normalizedRoundCents <= 0 || normalizedRoundCents >= 1) {
    return normalizedValue;
  }

  const whole = Math.floor(normalizedValue);
  const roundedUp = roundMoney(whole + normalizedRoundCents);

  if (normalizedValue <= roundedUp) {
    return roundedUp;
  }

  return roundMoney(whole + 1 + normalizedRoundCents);
}

export function calculateSellPrice(input: {
  buyPrice: number;
  feesPercent: number;
  feesFixed: number;
  profitPercent: number;
  profitFixed: number;
  roundCents: number | null;
  minimumProfit?: number | null;
}) {
  const buyPrice = Math.max(0, normalizeNumber(input.buyPrice));
  const feesPercent = Math.max(0, normalizeNumber(input.feesPercent));
  const feesFixed = Math.max(0, normalizeNumber(input.feesFixed));
  const profitPercent = Math.max(0, normalizeNumber(input.profitPercent));
  let profitFixed = normalizeNumber(input.profitFixed);
  const minimumProfit = Math.max(0, normalizeNumber(input.minimumProfit));

  const estimatedProfit = (buyPrice * profitPercent) / 100 + profitFixed;
  if (minimumProfit > 0 && estimatedProfit < minimumProfit) {
    profitFixed = minimumProfit - (buyPrice * profitPercent) / 100;
  }

  const feeRate = feesPercent / 100;
  const targetProfit = (buyPrice * profitPercent) / 100 + profitFixed;
  const numerator = buyPrice + feesFixed + targetProfit;

  if (feeRate >= 1) {
    return applyRoundCents(numerator, input.roundCents);
  }

  return applyRoundCents(numerator / (1 - feeRate), input.roundCents);
}

export function calculateProfitPercentFromSellPrice(input: {
  buyPrice: number;
  sellPrice: number;
  feesPercent: number;
  feesFixed: number;
  profitFixed?: number;
}) {
  const buyPrice = Math.max(0, normalizeNumber(input.buyPrice));
  const sellPrice = Math.max(0, normalizeNumber(input.sellPrice));
  const feesPercent = Math.max(0, normalizeNumber(input.feesPercent));
  const feesFixed = Math.max(0, normalizeNumber(input.feesFixed));
  const profitFixed = normalizeNumber(input.profitFixed);

  if (buyPrice <= 0) return 0;

  const totalFees = (sellPrice * feesPercent) / 100 + feesFixed;
  const netProfit = sellPrice - buyPrice - totalFees;
  const percentProfit = netProfit - profitFixed;

  return roundMoney((percentProfit / buyPrice) * 100);
}

export function calculateTotalFees(input: {
  sellPrice: number;
  feesPercent: number;
  feesFixed: number;
}) {
  const sellPrice = Math.max(0, normalizeNumber(input.sellPrice));
  const feesPercent = Math.max(0, normalizeNumber(input.feesPercent));
  const feesFixed = Math.max(0, normalizeNumber(input.feesFixed));

  return roundMoney((sellPrice * feesPercent) / 100 + feesFixed);
}

export function calculatePromotedAdFee(input: {
  sellPrice: number;
  promotedAdPercent: number;
}) {
  const sellPrice = Math.max(0, normalizeNumber(input.sellPrice));
  const promotedAdPercent = Math.max(
    0,
    normalizeNumber(input.promotedAdPercent),
  );

  return roundMoney((sellPrice * promotedAdPercent) / 100);
}

export function calculateNetProfit(input: {
  buyPrice: number;
  sellPrice: number;
  feesPercent: number;
  feesFixed: number;
  promotedAdPercent?: number;
}) {
  const buyPrice = Math.max(0, normalizeNumber(input.buyPrice));
  const sellPrice = Math.max(0, normalizeNumber(input.sellPrice));
  const totalFees = calculateTotalFees({
    sellPrice,
    feesPercent: input.feesPercent,
    feesFixed: input.feesFixed,
  });
  const promotedAdFee = calculatePromotedAdFee({
    sellPrice,
    promotedAdPercent: input.promotedAdPercent ?? 0,
  });

  return roundMoney(sellPrice - buyPrice - totalFees - promotedAdFee);
}

export function calculateTotalProfit(input: {
  sellPrice: number;
  profitPercent: number;
  profitFixed: number;
}) {
  const sellPrice = Math.max(0, normalizeNumber(input.sellPrice));
  const profitPercent = Math.max(0, normalizeNumber(input.profitPercent));
  const profitFixed = normalizeNumber(input.profitFixed);

  return roundMoney((sellPrice * profitPercent) / 100 + profitFixed);
}

export function calculateProfitFixedFromSellPrice(input: {
  buyPrice: number;
  sellPrice: number;
  feesPercent: number;
  feesFixed: number;
  profitPercent: number;
}) {
  const buyPrice = Math.max(0, normalizeNumber(input.buyPrice));
  const sellPrice = Math.max(0, normalizeNumber(input.sellPrice));
  const feesPercent = Math.max(0, normalizeNumber(input.feesPercent));
  const feesFixed = Math.max(0, normalizeNumber(input.feesFixed));
  const profitPercent = Math.max(0, normalizeNumber(input.profitPercent));

  return roundMoney(
    sellPrice * (1 - feesPercent / 100) -
      buyPrice * (1 + profitPercent / 100) -
      feesFixed
  );
}
