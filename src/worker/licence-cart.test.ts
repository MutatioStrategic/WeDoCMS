import { describe, expect, it } from "vitest";
import { calculateCartTotals, cartItemSchema } from "./licence-cart";

const item = cartItemSchema.parse({
  assetId: "asset-1",
  licenceType: "commercial",
  territory: "Worldwide",
  durationDays: 365,
  creditCost: 100,
  addedAt: "2026-08-31T12:00:00.000Z",
});

describe("licence cart rules", () => {
  it("totals server-validated credit costs without accepting client totals", () => {
    expect(calculateCartTotals([item, { ...item, assetId: "asset-2", creditCost: 40 }])).toEqual({ totalCredits: 140 });
  });

  it("requires a known licence type and ISO timestamp for cart items", () => {
    expect(() => cartItemSchema.parse({ ...item, licenceType: "unlimited" })).toThrow();
    expect(() => cartItemSchema.parse({ ...item, addedAt: "tomorrow" })).toThrow();
  });
});
