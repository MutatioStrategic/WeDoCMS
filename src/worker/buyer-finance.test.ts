import { describe, expect, it } from "vitest";
import { creditPurchaseAmountCents, isCalendarDate, nextMonthlyChargeDate } from "./buyer-finance";

describe("buyer finance rules", () => {
  it("prices single credit at R100 (standard tier)", () => {
    expect(creditPurchaseAmountCents(1)).toBe(10000);
  });
  
  it("applies silver tier discount for 25 credits (5% off)", () => {
    // 25 credits falls in silver tier (10-49), unit price = 9500 cents
    expect(creditPurchaseAmountCents(25)).toBe(237500); // 25 * 9500
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
