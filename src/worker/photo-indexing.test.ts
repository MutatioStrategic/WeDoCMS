import { describe, expect, it } from "vitest";
import { buildPhotoSearchDocument, parseVisionMetadata } from "./photo-indexing";

describe("photo AI indexing", () => {
  it("parses constrained vision JSON and removes unsafe identity guesses", () => {
    const metadata = parseVisionMetadata("```json\n{\"description\":\"A market stall\",\"visibleText\":\"Fresh bread\",\"subjectTags\":[\"market\",\"black people\",\"bread\"],\"confidence\":0.88}\n```");
    expect(metadata.description).toBe("A market stall");
    expect(metadata.visibleText).toBe("Fresh bread");
    expect(metadata.subjectTags).toEqual(["market", "bread"]);
    expect(metadata.confidence).toBe(0.88);
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
      cultural_tags: '["South African market"]',
    });
    expect(document).toContain("Title: Cape Town market");
    expect(document).toContain("Subject tags: market, food");
    expect(document).toContain("Visible text in image: Fresh bread");
  });
});
