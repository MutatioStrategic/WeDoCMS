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
    if (allocation.status && !["configured", "settled"].includes(allocation.status)) throw new Error("Paystack split allocation is not configured");
    if (![allocation.artistAmountCents, allocation.platformAmountCents].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error("Paystack split allocation amounts are malformed");
    if (input.taxCents !== 0 || allocation.artistAmountCents + allocation.platformAmountCents !== input.amountCents) throw new Error("Paystack split allocation does not balance to the payment amount");
    return { platformFeeCents: allocation.platformAmountCents, royaltyCents: allocation.artistAmountCents, taxCents: 0 };
  }
  const platformFeeCents = input.platformFeeCents ?? Math.floor(input.amountCents * 0.2);
  const royaltyCents = input.royaltyCents ?? input.amountCents - platformFeeCents - input.taxCents;
  if (platformFeeCents + royaltyCents + input.taxCents !== input.amountCents || royaltyCents < 0) throw new Error("Sale postings must balance to the settled amount");
  return { platformFeeCents, royaltyCents, taxCents: input.taxCents };
}
