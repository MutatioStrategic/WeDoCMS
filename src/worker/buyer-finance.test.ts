import { describe, expect, it } from "vitest";
import { calculateCreditExpiryDate, creditPurchaseAmountCents, creditPurchasePricing, getDiscountTier, isCalendarDate, isCreditExpired, nextMonthlyChargeDate } from "./buyer-finance";

describe("buyer finance rules", () => {
  it("uses the configured provider reference for credit membership checkout", () => {
    expect(creditPurchaseAmountCents(1)).toBe(299);
    expect(creditPurchaseAmountCents(100)).toBe(25400);
  });

  it("applies deterministic bulk pricing while preserving the one-credit price", () => {
    expect(getDiscountTier(1).tier).toBe("standard");
    expect(creditPurchasePricing(10)).toMatchObject({ amountCents: 2840, unitPriceCents: 284, discountTier: "silver", discountAmountCents: 150 });
    expect(creditPurchaseAmountCents(500)).toBe(119500);
  });

  it("calculates and detects credit expiry timestamps", () => {
    expect(calculateCreditExpiryDate("2026-08-31T12:00:00.000Z")).toBe("2027-08-31 12:00:00");
    expect(isCreditExpired("2026-08-30 12:00:00", null, new Date("2026-08-31T00:00:00.000Z"))).toBe(true);
    expect(isCreditExpired("2027-08-30 12:00:00", null, new Date("2026-08-31T00:00:00.000Z"))).toBe(false);
  });

  it("rejects invalid or fractional credit quantities", () => {
    expect(() => creditPurchaseAmountCents(0)).toThrow();
    expect(() => creditPurchaseAmountCents(1.5)).toThrow();
    expect(() => creditPurchaseAmountCents(100001)).toThrow();
  });

  it("validates calendar dates and advances the selected billing day", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(nextMonthlyChargeDate("2026-01-15", 15)).toBe("2026-02-15");
    expect(nextMonthlyChargeDate("2026-01-31", 28)).toBe("2026-02-28");
    expect(nextMonthlyChargeDate("2026-12-15", 15)).toBe("2027-01-15");
  });
});
