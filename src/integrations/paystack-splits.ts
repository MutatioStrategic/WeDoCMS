export type MarketplaceSplit = {
  artistSharePercentage: number;
  artistAmountCents: number;
  platformAmountCents: number;
};

/** Calculate the gross-price allocation sent to Paystack's percentage split. */
export function calculateMarketplaceSplit(amountCents: number, artistSharePercentage: number): MarketplaceSplit {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("amountCents must be a positive integer");
  if (!Number.isInteger(artistSharePercentage) || artistSharePercentage < 1 || artistSharePercentage > 99) throw new Error("artistSharePercentage must be between 1 and 99");
  const artistAmountCents = Math.floor(amountCents * artistSharePercentage / 100);
  return { artistSharePercentage, artistAmountCents, platformAmountCents: amountCents - artistAmountCents };
}
