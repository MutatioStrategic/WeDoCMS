export const PLATFORM_SUBSCRIPTION_PRICE_CENTS = 129900;
export const CREDIT_REFERENCE_UNIT_CENTS = 299;
/** @deprecated Use CREDIT_REFERENCE_UNIT_CENTS; retained for old integrations. */
export const CREDIT_UNIT_CENTS = CREDIT_REFERENCE_UNIT_CENTS;

export const BULK_DISCOUNT_TIERS = [
  { minCredits: 1, maxCredits: 9, discountPercent: 0, unitPriceCents: CREDIT_REFERENCE_UNIT_CENTS, tier: "standard" as const },
  { minCredits: 10, maxCredits: 49, discountPercent: 5, unitPriceCents: 284, tier: "silver" as const },
  { minCredits: 50, maxCredits: 99, discountPercent: 10, unitPriceCents: 269, tier: "gold" as const },
  { minCredits: 100, maxCredits: 499, discountPercent: 15, unitPriceCents: 254, tier: "platinum" as const },
  { minCredits: 500, maxCredits: 100000, discountPercent: 20, unitPriceCents: 239, tier: "enterprise" as const },
] as const;

export type CreditDiscountTier = typeof BULK_DISCOUNT_TIERS[number];

export function getDiscountTier(credits: number): CreditDiscountTier {
  if (!Number.isInteger(credits) || credits < 1 || credits > 100000) throw new Error("Credit quantity must be an integer between 1 and 100000");
  return BULK_DISCOUNT_TIERS.find((tier) => credits >= tier.minCredits && credits <= tier.maxCredits) ?? BULK_DISCOUNT_TIERS[0];
}

export function creditPurchasePricing(credits: number): { amountCents: number; unitPriceCents: number; discountTier: CreditDiscountTier["tier"]; discountAmountCents: number } {
  const tier = getDiscountTier(credits);
  const standardAmountCents = credits * CREDIT_REFERENCE_UNIT_CENTS;
  const amountCents = credits * tier.unitPriceCents;
  return { amountCents, unitPriceCents: tier.unitPriceCents, discountTier: tier.tier, discountAmountCents: standardAmountCents - amountCents };
}

export function creditPurchaseAmountCents(credits: number): number {
  return creditPurchasePricing(credits).amountCents;
}

export function calculateCreditExpiryDate(fromDate?: string): string {
  const date = fromDate ? new Date(fromDate) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error("A valid purchase date is required");
  const expiry = new Date(date);
  expiry.setUTCMonth(expiry.getUTCMonth() + 12);
  return expiry.toISOString().slice(0, 19).replace("T", " ");
}

export function isCreditExpired(expiresAt: string | null, expiredAt: string | null, now = new Date()): boolean {
  if (expiredAt) return true;
  if (!expiresAt) return false;
  const expiry = new Date(expiresAt.replace(" ", "T") + (expiresAt.includes("Z") ? "" : "Z"));
  return !Number.isNaN(expiry.getTime()) && expiry <= now;
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function nextMonthlyChargeDate(fromDate: string, billingDay: number): string {
  if (!isCalendarDate(fromDate)) throw new Error("A valid calendar date is required");
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28) throw new Error("Billing day must be between 1 and 28");
  const date = new Date(`${fromDate}T00:00:00.000Z`);
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, billingDay));
  return next.toISOString().slice(0, 10);
}
