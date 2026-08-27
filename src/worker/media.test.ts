import { describe, expect, it, vi } from "vitest";
import { createMediaResponse, getReadableMedia, headReadableMedia, previewMediaKey, previewObjectKey, publicMediaKey, shouldStreamOriginalDownload } from "./index";

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
  it("streams demo originals from the private binding when signing is intentionally unavailable", () => {
    expect(shouldStreamOriginalDownload("demo", "primary", null)).toBe(true);
    expect(shouldStreamOriginalDownload("production", "primary", null)).toBe(false);
    expect(shouldStreamOriginalDownload("production", "primary", "https://signed.example/original")).toBe(false);
    expect(shouldStreamOriginalDownload("production", "library", null)).toBe(true);
  });

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

  it("falls back to the production media library without writing to it", async () => {
    const libraryObject = mediaObject();
    const primary = {
      head: vi.fn(async () => null),
      get: vi.fn(async () => null),
    } as unknown as Pick<R2Bucket, "get" | "head">;
    const library = {
      head: vi.fn(async () => libraryObject),
      get: vi.fn(async () => libraryObject),
    } as unknown as Pick<R2Bucket, "get" | "head">;

    expect(await headReadableMedia({ MEDIA_BUCKET: primary, MEDIA_LIBRARY_BUCKET: library }, "previews/library.webp")).toBe(libraryObject);
    expect(await getReadableMedia({ MEDIA_BUCKET: primary, MEDIA_LIBRARY_BUCKET: library }, "previews/library.webp")).toBe(libraryObject);
    expect(library.head).toHaveBeenCalledOnce();
    expect(library.get).toHaveBeenCalledOnce();
  });

  it("prefers the primary media bucket when both sources contain the object", async () => {
    const primaryObject = mediaObject();
    const libraryObject = mediaObject();
    const primary = {
      head: vi.fn(async () => primaryObject),
      get: vi.fn(async () => primaryObject),
    } as unknown as Pick<R2Bucket, "get" | "head">;
    const library = {
      head: vi.fn(async () => libraryObject),
      get: vi.fn(async () => libraryObject),
    } as unknown as Pick<R2Bucket, "get" | "head">;

    expect(await headReadableMedia({ MEDIA_BUCKET: primary, MEDIA_LIBRARY_BUCKET: library }, "previews/primary.webp")).toBe(primaryObject);
    expect(await getReadableMedia({ MEDIA_BUCKET: primary, MEDIA_LIBRARY_BUCKET: library }, "previews/primary.webp")).toBe(primaryObject);
    expect(library.head).not.toHaveBeenCalled();
    expect(library.get).not.toHaveBeenCalled();
  });
});
