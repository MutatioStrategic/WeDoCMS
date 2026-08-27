export const PLATFORM_SUBSCRIPTION_PRICE_CENTS = 129900;
export const CREDIT_REFERENCE_UNIT_CENTS = 299;
/** @deprecated Use CREDIT_REFERENCE_UNIT_CENTS; retained for old integrations. */
export const CREDIT_UNIT_CENTS = CREDIT_REFERENCE_UNIT_CENTS;

export function creditPurchaseAmountCents(credits: number): number {
  if (!Number.isInteger(credits) || credits < 1 || credits > 100000) throw new Error("Credit quantity must be an integer between 1 and 100000");
  return credits * CREDIT_REFERENCE_UNIT_CENTS;
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
