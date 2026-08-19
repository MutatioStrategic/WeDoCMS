import { describe, expect, it } from "vitest";
import { archiveDomain, buildMatchExplanation, evaluateLicenceRequest, type Asset } from "./shared";

describe("asset domain contract", () => {
  it("preserves the rights and authenticity fields needed for trusted discovery", () => {
    const asset: Asset = {
      id: "asset-1",
      kind: "image",
      status: "published",
      title: "Table Mountain at dawn",
      description: "Verified Cape Town landscape",
      caption: "Table Mountain viewed from Cape Town",
      country: "South Africa",
      province: "Western Cape",
      city: "Cape Town",
      locality: "City Bowl",
      landmark: "Table Mountain",
      subjectTags: ["landscape"],
      culturalTags: ["South African landscape"],
      rightsStatus: "verified",
      modelReleaseStatus: "not_required",
      propertyReleaseStatus: "not_required",
      authenticityConfidence: 0.98,
      humanVerified: true,
      contributor: "Veld Studio",
      workflowStage: "approval",
      aiTags: [],
      curatorNotes: "",
    };

    expect(asset.country).toBe("South Africa");
    expect(asset.rightsStatus).toBe("verified");
    expect(asset.humanVerified).toBe(true);
    expect(asset.authenticityConfidence).toBeGreaterThan(0.9);
  });

  it("blocks commercial checkout when a required release is not verified", () => {
    const asset: Asset = {
      id: "asset-road", kind: "video", status: "published", workflowStage: "approval", title: "Garden Route", description: "Road footage", caption: "Road footage", country: "South Africa", province: "Western Cape", city: "George", locality: "Garden Route", landmark: null,
      subjectTags: ["road"], culturalTags: [], rightsStatus: "verified", modelReleaseStatus: "not_required", propertyReleaseStatus: "pending", authenticityConfidence: .9, humanVerified: true, contributor: "Studio", aiTags: [], curatorNotes: "",
    };
    const result = evaluateLicenceRequest(asset, { assetId: asset.id, licenceType: "commercial", territory: "Worldwide", durationDays: 365 });
    expect(result.allowed).toBe(false);
    expect(result.blockingReasons.some((reason) => reason.includes("Property release"))).toBe(true);
  });

  it("allows editorial checkout for an approved editorial-only asset", () => {
    const asset: Asset = {
      id: "asset-editorial", kind: "video", status: "published", workflowStage: "approval", title: "Road", description: "Road", caption: "Road", country: "South Africa", province: "Western Cape", city: "George", locality: null, landmark: null,
      subjectTags: [], culturalTags: [], rightsStatus: "editorial_only", modelReleaseStatus: "not_required", propertyReleaseStatus: "pending", authenticityConfidence: .9, humanVerified: true, contributor: "Studio", aiTags: [], curatorNotes: "",
    };
    const result = evaluateLicenceRequest(asset, { assetId: asset.id, licenceType: "editorial", territory: "Worldwide", durationDays: 30 });
    expect(result.allowed).toBe(true);
  });

  it("explains matches using explicit fields and preserves human-review state", () => {
    const asset: Asset = {
      id: "asset-context", kind: "image", status: "needs_review", workflowStage: "curator_correction", title: "Saturday braai", description: "A wood-fire gathering", caption: "Friends gather around a braai in Cape Town", country: "South Africa", province: "Western Cape", city: "Cape Town", locality: "Mitchells Plain", landmark: null,
      subjectTags: ["food", "community"], culturalTags: ["South African braai"], rightsStatus: "pending", modelReleaseStatus: "pending", propertyReleaseStatus: "not_required", authenticityConfidence: .92, humanVerified: false, contributor: "Studio", aiTags: ["community"], curatorNotes: "",
    };
    const explanation = buildMatchExplanation(asset, "braai Cape Town");
    expect(explanation.matchConfidence).toBeGreaterThan(.7);
    expect(explanation.metadataUsed.map((item) => item.field)).toContain("Location");
    expect(explanation.metadataReviewStatus).toBe("needs_context");
    expect(explanation.metadataReviewNote).toContain("AI suggestions never infer identity");
  });

  it("exposes shared rules through the archive domain object", () => {
    const asset: Asset = {
      id: "asset-facade", kind: "image", status: "published", workflowStage: "approval", title: "Cape Town", description: "Cape Town", caption: "Cape Town", country: "South Africa", province: "Western Cape", city: "Cape Town", locality: null, landmark: null,
      subjectTags: [], culturalTags: [], rightsStatus: "verified", modelReleaseStatus: "not_required", propertyReleaseStatus: "not_required", authenticityConfidence: .9, humanVerified: true, contributor: "Studio", aiTags: [], curatorNotes: "",
    };
    expect(archiveDomain.withMatchExplanation(asset, "Cape Town").matchExplanation?.matchConfidence).toBeGreaterThan(0);
    expect(archiveDomain.percent(.875)).toBe(88);
    expect(archiveDomain.confidenceLabel(.9)).toBe("high");
    expect(archiveDomain.evaluateLicenceRequest(asset, { assetId: asset.id, licenceType: "editorial", territory: "ZA", durationDays: 30 }).allowed).toBe(true);
  });

  it("approves only the exact metadata revision a human reviewed", () => {
    expect(archiveDomain.canApproveMetadataRevision({ assetRevision: 4, reviewedRevision: 4, metadataReviewStatus: "reviewed" })).toBe(true);
    expect(archiveDomain.canApproveMetadataRevision({ assetRevision: 5, reviewedRevision: 4, metadataReviewStatus: "reviewed" })).toBe(false);
    expect(archiveDomain.canApproveMetadataRevision({ assetRevision: 4, reviewedRevision: 4, metadataReviewStatus: "needs_context" })).toBe(false);
  });

  it("filters broad one-token matches out of story searches", () => {
    const baseAsset: Asset = {
      id: "asset-base", kind: "image", status: "published", workflowStage: "approval", title: "", description: "", caption: "", country: "South Africa", province: "Western Cape", city: "Cape Town", locality: null, landmark: null,
      subjectTags: [], culturalTags: [], rightsStatus: "verified", modelReleaseStatus: "not_required", propertyReleaseStatus: "not_required", authenticityConfidence: .9, humanVerified: true, contributor: "Studio", aiTags: [], curatorNotes: "",
    };
    const results = archiveDomain.rankSearchAssets([
      { ...baseAsset, id: "table", title: "Table Mountain above Cape Town", description: "A verified landscape", caption: "Table Mountain at golden hour", landmark: "Table Mountain", subjectTags: ["landscape"], culturalTags: ["Cape Town"] },
      { ...baseAsset, id: "garden", title: "Garden Route landscape", city: "Knysna", locality: "Garden Route", landmark: "Garden Route National Park", subjectTags: ["landscape"], culturalTags: ["Garden Route"] },
      { ...baseAsset, id: "braai", title: "Saturday braai, Cape Flats", locality: "Mitchells Plain", subjectTags: ["food", "community"], culturalTags: ["Cape Flats", "South African braai"] },
    ], "A verified Table Mountain landscape at golden hour");
    expect(results.map((asset) => asset.id)).toEqual(["table"]);
  });
});
