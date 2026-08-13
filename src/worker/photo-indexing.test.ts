import { describe, expect, it } from "vitest";
import {
  buildPhotoSearchDocument,
  classifyVisionResult,
  mergeHybridSearchRows,
  parseVisionMetadata,
  photoJobMatchesAsset,
} from "./photo-indexing";

describe("photo AI indexing", () => {
  it("parses constrained vision JSON and removes unsafe identity guesses", () => {
    const metadata = parseVisionMetadata("```json\n{\"description\":\"A market stall displaying bread outdoors\",\"visibleText\":\"Fresh bread\",\"subjectTags\":[\"market\",\"black people\",\"bread\"],\"locationType\":\"market_scene\",\"primaryCategory\":\"food\",\"sceneAttributes\":[\"outdoor\",\"daylight\"],\"detectedLanguage\":\"en\",\"textReadability\":\"clear\",\"imageQuality\":\"readable\",\"confidence\":0.88,\"fieldConfidences\":{\"description\":0.9,\"visibleText\":0.92,\"locationType\":0.86,\"primaryCategory\":0.84,\"sceneAttributes\":0.8}}\n```");
    expect(metadata.description).toBe("A market stall displaying bread outdoors");
    expect(metadata.visibleText).toBe("Fresh bread");
    expect(metadata.subjectTags).toEqual(["market", "bread"]);
    expect(metadata.confidence).toBe(0.88);
    expect(metadata.locationType).toBe("market_scene");
    expect(metadata.primaryCategory).toBe("food");
  });

  it("routes malformed, low-confidence, unreadable, and unsupported-language output to review", () => {
    const malformed = classifyVisionResult("not-json");
    expect(malformed.accepted).toBe(false);
    expect(malformed.issues).toContain("malformed_json");

    const lowQuality = classifyVisionResult(JSON.stringify({
      description: "Unclear frame",
      visibleText: "Texte",
      subjectTags: ["street"],
      locationType: "urban_street",
      primaryCategory: "travel",
      sceneAttributes: ["outdoor"],
      detectedLanguage: "fr",
      textReadability: "unreadable",
      imageQuality: "unreadable",
      confidence: 0.3,
      fieldConfidences: { description: 0.4, visibleText: 0.2, locationType: 0.4, primaryCategory: 0.4, sceneAttributes: 0.4 },
    }));
    expect(lowQuality.accepted).toBe(false);
    expect(lowQuality.issues).toEqual(expect.arrayContaining(["low_confidence", "unreadable_image", "unsupported_language"]));
  });

  it("rejects stale queue messages by both revision and source etag", () => {
    const asset = { asset_revision: 8, source_etag: "etag-new" };
    expect(photoJobMatchesAsset({ assetRevision: 8, sourceEtag: "etag-new" }, asset)).toBe(true);
    expect(photoJobMatchesAsset({ assetRevision: 7, sourceEtag: "etag-new" }, asset)).toBe(false);
    expect(photoJobMatchesAsset({ assetRevision: 8, sourceEtag: "etag-old" }, asset)).toBe(false);
  });

  it("hybrid-ranks exact structured matches alongside semantic candidates", () => {
    const semantic = [
      { id: "coast", title: "Ocean view", description: "Waves at dusk", subject_tags: "[]", ai_tags: "[]", ocr_text: "", visual_location_type: "coastal_landscape", primary_category: "nature", human_verified: 1 },
      { id: "market", title: "Street scene", description: "People outdoors", subject_tags: '["people"]', ai_tags: "[]", ocr_text: "", visual_location_type: "market_scene", primary_category: "lifestyle", human_verified: 1 },
    ];
    const keyword = [
      { ...semantic[1], title: "Fresh bread market", ocr_text: "Fresh bread" },
    ];
    const ranked = mergeHybridSearchRows(semantic, keyword, "fresh bread market", new Map([["coast", 0.91], ["market", 0.76]]));
    expect(ranked[0]?.id).toBe("market");
  });

  it("builds a stable searchable record from persisted metadata", () => {
    const document = buildPhotoSearchDocument({
      title: "Cape Town market",
      description: "A busy open-air market.",
      caption: "Sellers arrange bread at a stall.",
      country: "South Africa",
      province: "Western Cape",
      city: "Cape Town",
      locality: "Woodstock",
      subject_tags: '["market","food"]',
      ai_tags: '["stall","bread"]',
      ocr_text: "Fresh bread",
      visual_location_type: "market_scene",
      primary_category: "food",
      scene_attributes: '["outdoor","daylight"]',
      cultural_tags: '["South African market"]',
    });
    expect(document).toContain("Title: Cape Town market");
    expect(document).toContain("Subject tags: market, food");
    expect(document).toContain("Visible text in image: Fresh bread");
    expect(document).toContain("Visible location type: market scene");
    expect(document).toContain("Primary category: food");
  });
});
