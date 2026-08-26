import { describe, expect, it } from "vitest";
import { settlementAmounts } from "./payment-settlement";

describe("provider settlement amounts", () => {
  it("uses the stored Paystack allocation exactly", () => {
    expect(settlementAmounts({ amountCents: 1000, currency: "ZAR", provider: "paystack", taxCents: 0, allocation: { provider: "paystack", currency: "ZAR", artistAmountCents: 600, platformAmountCents: 400, status: "configured" } })).toEqual({ platformFeeCents: 400, royaltyCents: 600, taxCents: 0 });
  });

  it("fails closed when the Paystack allocation is absent or unbalanced", () => {
    expect(() => settlementAmounts({ amountCents: 1000, currency: "ZAR", provider: "paystack", taxCents: 0 })).toThrow("missing");
    expect(() => settlementAmounts({ amountCents: 1000, currency: "ZAR", provider: "paystack", taxCents: 0, allocation: { provider: "paystack", currency: "ZAR", artistAmountCents: 600, platformAmountCents: 399, status: "configured" } })).toThrow("balance");
  });

  it("keeps legacy fallback behavior for non-split providers", () => {
    expect(settlementAmounts({ amountCents: 1000, currency: "ZAR", provider: "payfast", taxCents: 0 })).toEqual({ platformFeeCents: 200, royaltyCents: 800, taxCents: 0 });
  });
});
