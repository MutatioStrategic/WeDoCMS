import { describe, expect, it } from "vitest";
import { applyApiCachePolicy } from "./http-cache";

describe("applyApiCachePolicy", () => {
  it("marks API responses private and uncacheable by default", () => {
    const response = applyApiCachePolicy(new Request("https://example.test/api/me"), new Response("{}"));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("Vary")).toContain("Cookie");
    expect(response.headers.get("Vary")).toContain("Authorization");
  });

  it("preserves an explicit public cache policy", () => {
    const response = applyApiCachePolicy(
      new Request("https://example.test/api/assets/a/preview"),
      new Response("image", { headers: { "Cache-Control": "public, max-age=3600" } }),
    );
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });
});
