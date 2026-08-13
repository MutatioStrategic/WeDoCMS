import { describe, expect, it } from "vitest";
import { createMediaResponse, previewMediaKey, previewObjectKey, publicMediaKey } from "./index";

function mediaObject(range?: { offset: number; length: number }): R2ObjectBody {
  return {
    size: 10,
    httpEtag: '"preview-etag"',
    range,
    body: new ReadableStream<Uint8Array>(),
    writeHttpMetadata(headers: Headers) {
      headers.set("Content-Type", "video/mp4");
    },
  } as unknown as R2ObjectBody;
}

describe("media preview responses", () => {
  it("never exposes an image original when a generated preview is not available", () => {
    expect(publicMediaKey({ kind: "image", preview_key: null, original_key: "originals/uploads/mountain.jpg" })).toBeNull();
    expect(publicMediaKey({ kind: "video", preview_key: null, original_key: "originals/uploads/mountain.mp4" })).toBeNull();
    expect(publicMediaKey({ preview_key: "previews/mountain.jpg", original_key: "originals/uploads/mountain.jpg" })).toBe("previews/mountain.jpg");
  });

  it("uses the private original only after the caller has an entitlement", () => {
    const row = { kind: "video", preview_key: "previews/uploads/clip.mp4", original_key: "originals/uploads/clip.mp4" };
    expect(previewMediaKey(row)).toBe("previews/uploads/clip.mp4");
    expect(previewMediaKey(row, true)).toBe("originals/uploads/clip.mp4");
  });

  it("uses a compact WebP key for image previews", () => {
    expect(previewObjectKey("originals/uploads/mountain.jpg", "image/jpeg")).toBe("previews/uploads/mountain.webp");
    expect(previewObjectKey("originals/uploads/clip.mp4", "video/mp4")).toBe("previews/uploads/clip.mp4");
  });

  it("preserves byte ranges for browser video seeking", () => {
    const response = createMediaResponse(new Request("https://archive.test/api/assets/a/preview", { headers: { Range: "bytes=2-5" } }), mediaObject({ offset: 2, length: 4 }), "video/mp4");
    expect(response.status).toBe(206);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(response.headers.get("Content-Length")).toBe("4");
  });

  it("returns headers without a body for HEAD requests", () => {
    const response = createMediaResponse(new Request("https://archive.test/api/assets/a/preview", { method: "HEAD" }), mediaObject(), "video/mp4");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(response.body).toBeNull();
  });
});
