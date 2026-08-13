import { describe, expect, it } from "vitest";
import { createPresignedR2Url } from "./r2-presign";

describe("R2 presigned URLs", () => {
  it("uses the bucket virtual-hosted endpoint and object-only path", async () => {
    const url = await createPresignedR2Url({
      R2_ACCOUNT_ID: "account123",
      R2_ACCESS_KEY_ID: "access123",
      R2_SECRET_ACCESS_KEY: "secret123",
    }, "media-bucket", "originals/photo-001.jpg", "PUT");

    expect(url).toMatch(/^https:\/\/media-bucket\.account123\.r2\.cloudflarestorage\.com\/originals\/photo-001\.jpg\?/);
    expect(url).not.toContain("/media-bucket/originals/");
    expect(url).toContain("X-Amz-SignedHeaders=host");
  });
});
