import { describe, expect, it } from "vitest";
import { parseCampaignBrief, rankCampaignAsset, type BrandKit } from "./campaign-intelligence";
import type { Asset } from "./shared";

const baseAsset: Asset = {
  id: "asset-cape", kind: "image", status: "published", workflowStage: "approval", title: "Cape Town hotel terrace", description: "Warm natural light above the city", caption: "A relaxed terrace in Cape Town", country: "South Africa", province: "Western Cape", city: "Cape Town", locality: "City Bowl", landmark: "Table Mountain", subjectTags: ["travel", "hotel", "people"], culturalTags: ["Cape Town"], rightsStatus: "verified", modelReleaseStatus: "verified", propertyReleaseStatus: "not_required", authenticityConfidence: .94, humanVerified: true, contributor: "Studio", aiTags: ["premium", "hospitality"], curatorNotes: "", mediaOrientation: "landscape", mediaWidth: 2400, mediaHeight: 1600,
};

const brandKit: BrandKit = { colours: ["terracotta"], logoNotes: "", tone: "premium", industry: "hospitality", forbiddenStyles: ["generic stock"], preferredVisuals: "natural light" };

describe("campaign asset intelligence", () => {
  it("turns plain language into searchable campaign fields", () => {
    const brief = parseCampaignBrief("A warm premium campaign for young travellers in Cape Town. Instagram Story and web hero for a boutique hotel. Commercial and paid advertising use.");
    expect(brief.platforms).toEqual(expect.arrayContaining(["instagram", "web"]));
    expect(brief.locations).toContain("Cape Town");
    expect(brief.formatNeeded).toEqual(expect.arrayContaining(["portrait", "landscape"]));
    expect(brief.usageRights).toBe("advertising");
    expect(brief.modelReleaseRequired).toBe(true);
  });

  it("gives explainable, rights-aware recommendations", () => {
    const result = rankCampaignAsset(baseAsset, parseCampaignBrief("Premium hospitality campaign in Cape Town for Instagram and web, commercial use."), brandKit);
    expect(result.score).toBeGreaterThan(70);
    expect(result.reasons.join(" ")).toContain("Cape Town");
    expect(result.warnings).toHaveLength(0);
    expect(result.readiness.web).toBeGreaterThan(80);
    expect(result.suggestions).toContain("Use this as hero image");
  });

  it("blocks editorial-only media for commercial campaigns while keeping the risk visible", () => {
    const asset = { ...baseAsset, rightsStatus: "editorial_only" as const, modelReleaseStatus: "not_required" as const };
    const result = rankCampaignAsset(asset, parseCampaignBrief("Commercial advertising campaign for Instagram."));
    expect(result.usable).toBe(false);
    expect(result.warnings.map((warning) => warning.code)).toContain("editorial_only");
    expect(result.readiness.instagram).toBeLessThan(50);
  });
});
