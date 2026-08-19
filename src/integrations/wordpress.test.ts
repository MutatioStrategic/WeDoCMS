import { describe, expect, it } from "vitest";
import { bearerToken, normalizeWordPressSiteUrl, wordPressNoticeSeverity } from "./wordpress";

describe("WordPress connector boundary", () => {
  it("normalizes secure site URLs and removes tracking components", () => {
    expect(normalizeWordPressSiteUrl("https://example.com/blog/?utm_source=test#admin", true)).toBe("https://example.com/blog");
    expect(normalizeWordPressSiteUrl("http://example.com", true)).toBeNull();
    expect(normalizeWordPressSiteUrl("http://localhost:8080", false)).toBe("http://localhost:8080");
  });

  it("accepts only the connector bearer token shape", () => {
    const token = `wpa_${"a".repeat(43)}`;
    expect(bearerToken(new Request("https://api.test", { headers: { Authorization: `Bearer ${token}` } }))).toBe(token);
    expect(bearerToken(new Request("https://api.test", { headers: { Authorization: "Bearer session-cookie" } }))).toBeNull();
  });

  it("blocks revoked or non-published usage and warns on upcoming expiry", () => {
  expect(wordPressNoticeSeverity({ assetStatus: "withdrawn", rightsStatus: "verified", licenceStatus: "paid", expiresAt: null })).toBe("blocked");
  expect(wordPressNoticeSeverity({ assetStatus: "published", rightsStatus: "verified", licenceStatus: "paid", expiresAt: new Date(Date.now() + 2 * 86_400_000).toISOString() })).toBe("warning");
  expect(wordPressNoticeSeverity({ assetStatus: "published", rightsStatus: "verified", licenceStatus: "paid", expiresAt: null })).toBe("ok");
});
});
