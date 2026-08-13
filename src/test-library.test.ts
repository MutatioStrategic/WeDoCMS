import { describe, expect, it } from "vitest";
import { testPhotoLibrary } from "./test-library";

describe("synthetic photo library", () => {
  it("does not attach unrelated media as visual evidence", () => {
    expect(testPhotoLibrary).toHaveLength(100);
    expect(testPhotoLibrary.every((asset) => asset.previewUrl === null && asset.sourceFileName === null)).toBe(true);
  });
});
