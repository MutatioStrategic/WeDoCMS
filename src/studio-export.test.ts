import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildCampaignZip, safeFileName, sanitizeCss, sanitizeHtml } from "./studio-export";
import type { StudioSource } from "./studio-types";

describe("media studio export boundary", () => {
  it("removes executable HTML and unsafe CSS before preview/export", () => {
    const html = `<section onclick="alert(1)" style="width: expression(alert(5))"><script>alert(2)</script><img src="javascript:alert(3)" onerror="alert(4)"></section>`;
    const css = `@import url(https://evil.example/style.css); .x { background: url("javascript:alert(1)"); width: expression(alert(1)); }`;

    expect(sanitizeHtml(html)).not.toMatch(/script|onclick|onerror|javascript:/i);
    expect(sanitizeCss(css)).not.toMatch(/@import|javascript:|expression\s*\(/i);
  });

  it("creates a campaign ZIP with the document, stylesheet, manifest, and selected image", async () => {
    const sourceBlob = new Blob(["test-image"], { type: "image/png" });
    const sourceUrl = URL.createObjectURL(sourceBlob);
    const secondBlob = new Blob(["second-image"], { type: "image/png" });
    const secondUrl = URL.createObjectURL(secondBlob);
    const source: StudioSource = {
      id: "photo-1",
      title: "Test photo",
      kind: "image",
      duration: 5,
      previewUrl: sourceUrl,
      sourceFileName: "test-photo.png",
    };
    const secondSource: StudioSource = { ...source, id: "photo-2", title: "Second photo", previewUrl: secondUrl, sourceFileName: "second-photo.png" };

    try {
      const result = await buildCampaignZip({
        campaignName: "Spring launch",
        html: `<main><img src="${sourceUrl}" alt="Test photo"><img src="${secondUrl}" alt="Second photo"></main>`,
        css: "main { color: green; }",
        sources: [source, secondSource],
        editedImages: new Map(),
      });
      const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
      const names = Object.keys(zip.files);
      const html = await zip.file("index.html")?.async("string");

      expect(names).toContain("index.html");
      expect(names).toContain("styles.css");
      expect(names).toContain("campaign.json");
      expect(names.filter((name) => name.startsWith("images/") && name !== "images/").length).toBe(2);
      expect(html).not.toContain(sourceUrl);
      expect(result.missingImages).toBe(0);
    } finally {
      URL.revokeObjectURL(sourceUrl);
      URL.revokeObjectURL(secondUrl);
    }
  });

  it("keeps filenames safe for one-click downloads", () => {
    expect(safeFileName("  Spring launch / final?.zip ")).toBe("Spring-launch-final-.zip");
    expect(safeFileName("...", "campaign")).toBe("campaign");
  });
});
