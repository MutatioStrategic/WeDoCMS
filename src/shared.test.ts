import { describe, expect, it } from "vitest";
import { archiveDomain, buildMatchExplanation, evaluateLicenceRequest, metadataSearchEvidence, metadataSearchSuggestions, normalizeHttpUrl, rankMetadataSearchRows, type Asset } from "./shared";
import { friendlySupabasePhoneError, normalizeSouthAfricanPhone } from "./phone";

describe("South African phone rules", () => {
  it("normalizes local input to the Supabase E.164 format", () => {
    expect(normalizeSouthAfricanPhone("073 712 3456")).toBe("+27737123456");
    expect(archiveDomain.normalizeSouthAfricanPhone("+27 73 712 3456")).toBe("+27737123456");
    expect(normalizeSouthAfricanPhone("0027 73-712-3456")).toBe("+27737123456");
  });

  it("rejects foreign, landline, and malformed numbers", () => {
    expect(() => normalizeSouthAfricanPhone("+14155550123")).toThrow("South African mobile");
    expect(() => normalizeSouthAfricanPhone("021 555 0123")).toThrow("South African mobile");
    expect(() => normalizeSouthAfricanPhone("0737")).toThrow("South African mobile");
  });

  it("turns an unavailable SMS provider into a useful recovery message", () => {
    expect(friendlySupabasePhoneError(new Error("SMS provider is not configured"), "send")).toContain("configure an SMS provider");
  });
});

describe("proof URL rules", () => {
  it("adds HTTPS when a seller enters a normal website address", () => {
    expect(normalizeHttpUrl("www.mutationsstrategic.io/proof")).toBe("https://www.mutationsstrategic.io/proof");
    expect(archiveDomain.normalizeHttpUrl(" https://example.com/licence ")).toBe("https://example.com/licence");
  });

  it("rejects malformed proof addresses", () => {
    expect(() => normalizeHttpUrl("not a website")).toThrow("valid website address");
  });
});

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
      contributor: "Stockvel Studio",
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

  it("keeps media access denominated in credits with a predictable duration multiple", () => {
    expect(archiveDomain.mediaLicenceCreditCost(365)).toBe(100);
    expect(archiveDomain.mediaLicenceCreditCost(730)).toBe(200);
    expect(archiveDomain.mediaLicenceCreditCost(365, 250)).toBe(250);
    expect(archiveDomain.mediaMembershipDurationLabel(365)).toBe("12 months");
    expect(archiveDomain.mediaCreditReferenceAmountCents(100)).toBe(29_900);
    expect(() => archiveDomain.mediaLicenceCreditCost(0)).toThrow();
  });

  it("approves only the exact metadata revision a human reviewed", () => {
    expect(archiveDomain.canApproveMetadataRevision({ assetRevision: 4, reviewedRevision: 4, metadataReviewStatus: "reviewed" })).toBe(true);
    expect(archiveDomain.canApproveMetadataRevision({ assetRevision: 5, reviewedRevision: 4, metadataReviewStatus: "reviewed" })).toBe(false);
    expect(archiveDomain.canApproveMetadataRevision({ assetRevision: 4, reviewedRevision: 4, metadataReviewStatus: "needs_context" })).toBe(false);
  });

  it("keeps the introductory offer bounded and never returns a negative balance", () => {
    expect(archiveDomain.introductoryDownloadsRemaining(0)).toBe(3);
    expect(archiveDomain.introductoryDownloadsRemaining(2)).toBe(1);
    expect(archiveDomain.introductoryDownloadsRemaining(8)).toBe(0);
    expect(archiveDomain.introductoryDownloadsRemaining(1, 5)).toBe(4);
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

  it("ranks title metadata before description metadata and records the source field", () => {
    const exact = metadataSearchEvidence({ id: "exact", title: "Table Mountain", description: "A Cape Town landscape" }, "table mountain");
    const title = metadataSearchEvidence({ id: "title", title: "Table Mountain at dawn", description: "A landscape" }, "table mountain");
    const description = metadataSearchEvidence({ id: "description", title: "Cape Town landscape", description: "Table Mountain at dawn" }, "table mountain");

    expect(exact).toMatchObject({ matched_field: "title", match_type: "exact", metadata_score: 100, source_id: "exact" });
    expect(title?.metadata_score).toBeGreaterThan(description?.metadata_score ?? 0);
    expect(rankMetadataSearchRows([
      { id: "description", ...description },
      { id: "title", ...title },
      { id: "exact", ...exact },
    ]).map((row) => row.id)).toEqual(["exact", "title", "description"]);
  });

  it("uses edit distance only in the fuzzy metadata fallback", () => {
    expect(metadataSearchEvidence({ id: "no-fuzzy", title: "Forest path", description: "A quiet trail" }, "forst path")).toBeNull();
    expect(metadataSearchEvidence({ id: "fuzzy", title: "Forest path", description: "A quiet trail" }, "forst path", true)).toMatchObject({
      matched_field: "title",
      match_type: "fuzzy",
      source_id: "fuzzy",
    });
  });

  it("matches metadata terms as words instead of arbitrary substrings", () => {
    expect(metadataSearchEvidence({ id: "location", title: "Coastal location", description: "A quiet shoreline" }, "cat")).toBeNull();
    expect(metadataSearchEvidence({ id: "cattle", title: "Cattle in a field", description: "A rural scene" }, "cat", true)).toBeNull();
    expect(metadataSearchEvidence({ id: "cats", title: "Cats in a garden", description: "Two domestic cats outdoors" }, "cat")).toMatchObject({
      matched_field: "title",
      match_type: "contains",
      source_id: "cats",
    });
    expect(metadataSearchEvidence({ id: "cat", title: "Cat portrait", description: "A close-up portrait" }, "cat")).toMatchObject({
      matched_field: "title",
      match_type: "contains",
    });
  });

  it("explains a live result from its deterministic metadata evidence", () => {
    const asset: Asset = {
      id: "metadata-result", kind: "image", status: "published", workflowStage: "approval", title: "Forest path", description: "A quiet trail", caption: "A quiet trail", country: "South Africa", province: null, city: null, locality: null, landmark: null,
      subjectTags: ["landscape"], culturalTags: [], rightsStatus: "verified", modelReleaseStatus: "not_required", propertyReleaseStatus: "not_required", authenticityConfidence: .9, humanVerified: true, contributor: "Studio", aiTags: [], curatorNotes: "",
      matched_field: "title", match_type: "fuzzy", metadata_score: 72, source_id: "metadata-result", match_snippet: "Forest path",
    };
    const explanation = archiveDomain.withMatchExplanation(asset, "forst path").matchExplanation;
    expect(explanation?.signals).toEqual([expect.objectContaining({ field: "title", source: "editorial" })]);
    expect(explanation?.metadataReviewNote).toContain("Deterministic title metadata match");
  });

  it("derives no-result suggestions from stored metadata", () => {
    const suggestions = metadataSearchSuggestions("forst", [
      { id: "forest", title: "Forest path", description: "A quiet trail" },
      { id: "coast", title: "Coastal morning", description: "Sea light" },
    ]);
    expect(suggestions).toContain("forest");
  });
});
