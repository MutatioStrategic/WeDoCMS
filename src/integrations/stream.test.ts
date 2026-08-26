import { describe, expect, it, vi } from "vitest";
import { CloudflareStreamAdapter } from "./stream";

describe("Cloudflare Stream adapter", () => {
  it("provisions a signed direct upload with tenant metadata", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: true, result: { uid: "video-123", uploadURL: "https://upload.example/video-123" } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapter = new CloudflareStreamAdapter({ accountId: "account", token: "secret", allowedOrigins: ["https://app.example"], customerCode: "customer", endpoint: "https://api.example/client/v4", fetcher });
    const upload = await adapter.createDirectUpload({ assetId: "asset-1", organizationId: "org-1", creator: "user-1", filename: "cape.mp4", maxDurationSeconds: 120, idempotencyKey: "idem-1" });
    expect(upload).toMatchObject({ uid: "video-123", uploadUrl: "https://upload.example/video-123" });
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret", "Idempotency-Key": "idem-1" });
    expect(JSON.parse(String(init.body))).toMatchObject({ maxDurationSeconds: 120, allowedOrigins: ["https://app.example"], creator: "user-1", requireSignedURLs: true, meta: { assetId: "asset-1", organizationId: "org-1", filename: "cape.mp4" } });
  });

  it("turns a provider token into a short-lived iframe URL without exposing credentials", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: true, result: { token: "playback-token" } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapter = new CloudflareStreamAdapter({ accountId: "account", token: "secret", customerCode: "customer", endpoint: "https://api.example/client/v4", fetcher });
    const playback = await adapter.createSignedPlaybackToken("video/123");
    expect(playback).toMatchObject({ uid: "video/123", token: "playback-token", expiresInSeconds: 3600 });
    expect(playback.iframeUrl).toContain("customer-customer.cloudflarestream.com/playback-token/iframe");
    expect(playback.iframeUrl).not.toContain("video%2F123");
    expect(playback.iframeUrl).not.toContain("secret");
  });

  it("fails closed on provider errors and missing result fields", async () => {
    const failed = new CloudflareStreamAdapter({ accountId: "account", token: "secret", fetcher: vi.fn(async () => new Response("{}", { status: 502 })) });
    await expect(failed.createDirectUpload({ assetId: "a", organizationId: "o", creator: "u", filename: "x.mp4", maxDurationSeconds: 1 })).rejects.toThrow("HTTP 502");
    const malformed = new CloudflareStreamAdapter({ accountId: "account", token: "secret", fetcher: vi.fn(async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 })) });
    await expect(malformed.createSignedPlaybackToken("video")).rejects.toThrow("no playback token");
  });
});
