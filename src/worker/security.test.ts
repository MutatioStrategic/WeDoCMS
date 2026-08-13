import { describe, expect, it, vi } from "vitest";
import { allowedOrigin, applySecurityHeaders, enforceRateLimit, scanMediaObject, type SecurityBindings } from "./security";

describe("production security controls", () => {
  it("allows only configured origins and emits browser hardening headers", () => {
    const env = { APP_ENV: "production", ALLOWED_ORIGINS: "https://app.example.com" };
    expect(allowedOrigin(env as SecurityBindings, "https://app.example.com")).toBe("https://app.example.com");
    expect(allowedOrigin(env as SecurityBindings, "https://evil.example")).toBeUndefined();
    const headers = new Headers();
    applySecurityHeaders(headers);
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
  });

  it("enforces D1-backed request windows", async () => {
    const row = { request_count: 1, window_start: Math.floor(Date.now() / 60_000) * 60 };
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({ run: vi.fn(async () => ({})), first: vi.fn(async () => row) })),
    }));
    const result = await enforceRateLimit({ DB: { prepare } as unknown as D1Database }, "test", 2, 60);
    expect(result.allowed).toBe(true);
    expect(prepare).toHaveBeenCalled();
  });

  it("rejects mismatched media signatures and passes known development media", async () => {
    const badBucket = { get: vi.fn(async () => ({ arrayBuffer: async () => new Uint8Array([0, 1, 2]).buffer })) } as unknown as R2Bucket;
    await expect(scanMediaObject({ APP_ENV: "development" } as SecurityBindings, badBucket, "x.jpg", "image/jpeg")).resolves.toMatchObject({ status: "blocked" });
    const goodBucket = { get: vi.fn(async () => ({ arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer })) } as unknown as R2Bucket;
    await expect(scanMediaObject({ APP_ENV: "development" } as SecurityBindings, goodBucket, "x.jpg", "image/jpeg")).resolves.toMatchObject({ status: "passed", scanner: "magic-bytes" });
  });
});
