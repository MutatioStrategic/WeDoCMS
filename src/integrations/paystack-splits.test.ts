import { describe, expect, it } from "vitest";
import { calculateMarketplaceSplit } from "./paystack-splits";

describe("Paystack marketplace split allocation", () => {
  it("allocates 60% to the artist and 40% to the platform", () => {
    expect(calculateMarketplaceSplit(100_000, 60)).toEqual({
      artistSharePercentage: 60,
      artistAmountCents: 60_000,
      platformAmountCents: 40_000,
    });
  });

  it("keeps the allocation balanced for prices that do not divide evenly", () => {
    const result = calculateMarketplaceSplit(999, 60);
    expect(result.artistAmountCents + result.platformAmountCents).toBe(999);
    expect(result.artistAmountCents).toBe(599);
  });

  it("rejects unsafe percentages", () => {
    expect(() => calculateMarketplaceSplit(100_000, 0)).toThrow("between 1 and 99");
    expect(() => calculateMarketplaceSplit(100_000, 100)).toThrow("between 1 and 99");
  });
});
