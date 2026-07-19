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
}) {
  const buyPrice = Math.max(0, normalizeNumber(input.buyPrice));
  const feesPercent = Math.max(0, normalizeNumber(input.feesPercent));
  const feesFixed = Math.max(0, normalizeNumber(input.feesFixed));
  const profitPercent = Math.max(0, normalizeNumber(input.profitPercent));
  const profitFixed = normalizeNumber(input.profitFixed);
  const totalPercent = (feesPercent + profitPercent) / 100;
  const numerator = buyPrice + feesFixed + profitFixed;

  if (totalPercent >= 1) {
    return applyRoundCents(numerator, input.roundCents);
  }

  return applyRoundCents(numerator / (1 - totalPercent), input.roundCents);
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

export function calculateNetProfit(input: {
  buyPrice: number;
  sellPrice: number;
  feesPercent: number;
  feesFixed: number;
  promotedAdPercent?: number;
}) {
  const buyPrice = Math.max(0, normalizeNumber(input.buyPrice));
  const sellPrice = Math.max(0, normalizeNumber(input.sellPrice));
  const promotedAdPercent = Math.max(
    0,
    normalizeNumber(input.promotedAdPercent),
  );
  const totalFees = calculateTotalFees({
    sellPrice,
    feesPercent: input.feesPercent,
    feesFixed: input.feesFixed,
  });
  const promotedAdFee = roundMoney((sellPrice * promotedAdPercent) / 100);

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
    sellPrice * (1 - (feesPercent + profitPercent) / 100) - buyPrice - feesFixed
  );
}
