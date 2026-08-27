export type SettlementAllocation = {
  provider: string;
  currency: string;
  artistAmountCents: number;
  platformAmountCents: number;
  status?: string | null;
};

export type SettlementAmounts = {
  platformFeeCents: number;
  royaltyCents: number;
  taxCents: number;
};

export type CreditRedemptionSettlement = SettlementAmounts & {
  amountCents: number;
  artistSharePercentage: number;
};

/**
 * Convert a credit redemption into the internal settlement reference used by
 * the existing payout ledger. Credits remain the buyer-facing unit; the
 * reference amount only lets the ledger and payout provider preserve the
 * configured seller/platform split when a pooled wallet is redeemed.
 */
export function creditRedemptionSettlement(input: {
  credits: number;
  referenceUnitCents: number;
  artistSharePercentage: number;
}): CreditRedemptionSettlement {
  if (!Number.isSafeInteger(input.credits) || input.credits < 1 || input.credits > 100000) throw new Error("Credit redemption must contain between 1 and 100,000 whole credits");
  if (!Number.isSafeInteger(input.referenceUnitCents) || input.referenceUnitCents < 1) throw new Error("Credit reference unit must be a positive whole-cent amount");
  if (!Number.isSafeInteger(input.artistSharePercentage) || input.artistSharePercentage < 1 || input.artistSharePercentage > 99) throw new Error("artistSharePercentage must be between 1 and 99");
  const amountCents = input.credits * input.referenceUnitCents;
  const royaltyCents = Math.floor(amountCents * input.artistSharePercentage / 100);
  return {
    amountCents,
    artistSharePercentage: input.artistSharePercentage,
    platformFeeCents: amountCents - royaltyCents,
    royaltyCents,
    taxCents: 0,
  };
}

/**
 * Resolve ledger postings from the provider contract. Paystack is deliberately
 * fail-closed because its marketplace split is the seller settlement source of
 * truth; it must never inherit the legacy platform-fee default.
 */
export function settlementAmounts(input: {
  amountCents: number;
  currency: string;
  provider?: string;
  platformFeeCents?: number;
  royaltyCents?: number;
  taxCents: number;
  allocation?: SettlementAllocation | null;
}): SettlementAmounts {
  const currency = input.currency.toUpperCase();
  if (input.provider?.toLowerCase() === "paystack") {
    const allocation = input.allocation;
    if (!allocation) throw new Error("Paystack split allocation is missing");
    if (allocation.provider.toLowerCase() !== "paystack" || allocation.currency.toUpperCase() !== currency) throw new Error("Paystack split allocation does not match the settlement currency or provider");
    if (!["configured", "settled"].includes(String(allocation.status))) throw new Error("Paystack split allocation is not configured");
    if (![allocation.artistAmountCents, allocation.platformAmountCents].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error("Paystack split allocation amounts are malformed");
    if (input.taxCents !== 0 || allocation.artistAmountCents + allocation.platformAmountCents !== input.amountCents) throw new Error("Paystack split allocation does not balance to the payment amount");
    return { platformFeeCents: allocation.platformAmountCents, royaltyCents: allocation.artistAmountCents, taxCents: 0 };
  }
  const platformFeeCents = input.platformFeeCents ?? Math.floor(input.amountCents * 0.2);
  const royaltyCents = input.royaltyCents ?? input.amountCents - platformFeeCents - input.taxCents;
  if (platformFeeCents + royaltyCents + input.taxCents !== input.amountCents || royaltyCents < 0) throw new Error("Sale postings must balance to the settled amount");
  return { platformFeeCents, royaltyCents, taxCents: input.taxCents };
}
