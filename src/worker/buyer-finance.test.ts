import { describe, expect, it } from "vitest";
import { creditPurchaseAmountCents, isCalendarDate, nextMonthlyChargeDate } from "./buyer-finance";

describe("buyer finance rules", () => {
  it("uses the configured provider reference for credit membership checkout", () => {
    expect(creditPurchaseAmountCents(100)).toBe(29900);
    expect(creditPurchaseAmountCents(200)).toBe(59800);
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
