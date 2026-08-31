export const PLATFORM_SUBSCRIPTION_PRICE_CENTS = 129900;
export const CREDIT_UNIT_CENTS = 10000;

/** Bulk discount tiers for credit purchases */
export const BULK_DISCOUNT_TIERS = [
  { minCredits: 1, maxCredits: 9, discountPercent: 0, unitPriceCents: CREDIT_UNIT_CENTS, tier: "standard" as const },
  { minCredits: 10, maxCredits: 49, discountPercent: 5, unitPriceCents: 9500, tier: "silver" as const },
  { minCredits: 50, maxCredits: 99, discountPercent: 10, unitPriceCents: 9000, tier: "gold" as const },
  { minCredits: 100, maxCredits: 499, discountPercent: 15, unitPriceCents: 8500, tier: "platinum" as const },
  { minCredits: 500, maxCredits: 100000, discountPercent: 20, unitPriceCents: 8000, tier: "enterprise" as const },
] as const;

export function getDiscountTier(credits: number): typeof BULK_DISCOUNT_TIERS[number] {
  if (!Number.isInteger(credits) || credits < 1 || credits > 100000) throw new Error("Credit quantity must be an integer between 1 and 100000");
  const tier = BULK_DISCOUNT_TIERS.find(t => credits >= t.minCredits && credits <= t.maxCredits);
  return tier ?? BULK_DISCOUNT_TIERS[0];
}

export function creditPurchaseAmountCents(credits: number): number {
  if (!Number.isInteger(credits) || credits < 1 || credits > 100000) throw new Error("Credit quantity must be an integer between 1 and 100000");
  const tier = getDiscountTier(credits);
  return credits * tier.unitPriceCents;
}

/** Calculate expiry date (12 months from purchase) */
export function calculateCreditExpiryDate(fromDate?: string): string {
  const date = fromDate ? new Date(fromDate) : new Date();
  const expiry = new Date(date);
  expiry.setUTCMonth(expiry.getUTCMonth() + 12);
  return expiry.toISOString().slice(0, 19).replace("T", " ");
}

export function isCreditExpired(expiresAt: string | null, expiredAt: string | null): boolean {
  if (expiredAt) return true;
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
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
