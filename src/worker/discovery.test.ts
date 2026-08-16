import { describe, expect, it } from "vitest";
import type { Asset } from "../shared";
import { discoveryTokens, isDemoAssetRow, normalizeSavedQuery, scoreRecommendation } from "./discovery";

const asset: Asset = {
  id: "asset-cape", kind: "image", status: "published", workflowStage: "approval",
  title: "Cape Town neighbourhood market", description: "Everyday city life", caption: "A Saturday market",
  country: "South Africa", province: "Western Cape", city: "Cape Town", locality: "Woodstock", landmark: null,
  subjectTags: ["market", "community"], culturalTags: ["South African city life"], rightsStatus: "verified",
  modelReleaseStatus: "verified", propertyReleaseStatus: "not_required", authenticityConfidence: .95,
  humanVerified: true, contributor: "Local Studio", aiTags: [], curatorNotes: "",
};

describe("personalized discovery", () => {
  it("normalizes explicit saved queries into bounded preference tokens", () => {
    expect(normalizeSavedQuery("  Cape   Town market  ")).toBe("Cape Town market");
    expect(discoveryTokens(["Cape Town market", "market with people"])).toEqual(["cape", "town", "market", "people"]);
  });

  it("explains recommendations using stored archive metadata", () => {
    const result = scoreRecommendation(asset, ["market"]);
    expect(result.score).toBeGreaterThan(2);
    expect(result.reason).toContain("market");
    expect(result.reason).toContain("title");
  });

  it("recognizes seeded records so production discovery can fail closed", () => {
    expect(isDemoAssetRow({ id: "asset-real", demo_seed: 0, contributor: "Studio" })).toBe(false);
    expect(isDemoAssetRow({ id: "asset-demo-table-mountain", demo_seed: 0 })).toBe(true);
    expect(isDemoAssetRow({ id: "asset-real", demo_seed: 1 })).toBe(true);
  });
});
