import { describe, expect, it } from "vitest";
import { buildStatementCsv, buildStatementPdf } from "./statement-export";

const statement = {
  generatedAt: "2026-08-14T10:00:00.000Z",
  currency: "ZAR",
  customPricedLicences: { purchaseCents: 420000, royaltyCents: 336000, results: [{ id: "lic-1", buyerName: "Buyer", assetTitle: "Mountain", kind: "image", licenceType: "advertising", territory: "ZA", purchaseCents: 420000, royaltyCents: 336000, refundedCents: 0, status: "paid", paidAt: "2026-08-13", createdAt: "2026-08-12" }] },
  payoutPosition: { paidOutCents: 0, inFlightCents: 0, outstandingCents: 336000 },
  payoutPolicy: { payoutDayOfMonth: 25, method: "lump_sum", nextScheduledPayoutDate: "2026-08-25", amountExpectedCents: 336000, status: "scheduled_subject_to_approved_payout_batch" },
  veldSubscriptionRoyalty: { status: "not_allocated" },
  mediaInventory: { results: [{ id: "asset-1", title: "Mountain", kind: "image", status: "published", monetizationModel: "individual_license", licensePriceCents: 420000 }] },
  paymentFlow: { byStatus: [{ status: "paid", transactionCount: 1, amountCents: 420000 }], packageMix: [{ licenceType: "advertising", durationDays: 90, territory: "ZA", transactionCount: 1, purchaseCents: 420000, royaltyCents: 336000, refundedCents: 0 }] },
  performance: { summary: { views: 1000, licensedAssets: 1, roiExplanation: "Costs unavailable" }, assets: [{ title: "Mountain", kind: "image", views: 1000, licenceCount: 1, royaltyCents: 336000, royaltyPerThousandViewsCents: 336000 }] },
};

describe("seller statement exports", () => {
  it("includes audit sections and preserves CSV quoting", () => {
    const csv = buildStatementCsv(statement);
    expect(csv).toContain("MEDIA INVENTORY");
    expect(csv).toContain("LICENCE TRANSACTIONS");
    expect(csv).toContain("PERFORMANCE PROXY / LAST 30 DAYS");
    expect(csv).toContain("\"Buyer\"");
  });

  it("returns a PDF document with the statement hierarchy", () => {
    const pdf = buildStatementPdf(statement);
    const header = new TextDecoder().decode(pdf.slice(0, 8));
    expect(header).toContain("%PDF-1.4");
    expect(new TextDecoder().decode(pdf)).toContain("Seller royalty statement");
  });
});
