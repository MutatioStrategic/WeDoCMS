import { describe, expect, it, vi } from "vitest";
import { AemAssetsAdapter, BynderAdapter, DamProviderRegistry } from "./integrations/dam";
import { IntegrationError } from "./integrations/http";
import { IntegrationContainer } from "./integrations";
import { MobileMoneyPayoutAdapter, PayoutProviderRegistry, StripeConnectPayoutAdapter } from "./integrations/payouts";
import { CloudflareEmailAdapter } from "./integrations/email";

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("provider abstraction layer", () => {
  it("composes configured providers behind provider registries", () => {
    const container = new IntegrationContainer({
      PAYMENT_PROVIDER: "checkout",
      PAYMENT_ENDPOINT: "https://payments.example.test/session",
      PAYMENT_TOKEN: "token",
      PAYFAST_ENDPOINT: "https://payouts.example.test/payfast",
      PAYFAST_TOKEN: "token",
    });

    expect(container.payments.get("checkout")).toBeDefined();
    expect(container.payouts.get("payfast")).toBeDefined();
    expect(() => container.payouts.get("za_bank")).toThrow("No payout provider registered");
  });

  it("registers the simulated payment provider only for the demo environment", () => {
    const demo = new IntegrationContainer({ APP_ENV: "demo", PAYMENT_PROVIDER: "demo" });
    expect(demo.payments.get("demo")).toBeDefined();
    expect(() => new IntegrationContainer({ APP_ENV: "development", PAYMENT_PROVIDER: "demo" }).payments.get("demo")).toThrow("No payment provider registered");
    expect(() => new IntegrationContainer({ APP_ENV: "production", PAYMENT_PROVIDER: "demo", PAYMENT_ENDPOINT: "https://example.invalid", PAYMENT_TOKEN: "configured", PAYMENT_WEBHOOK_SECRET: "configured" }).payments.get("demo")).toThrow("No payment provider registered");
  });

  it("scopes Stripe payouts to the connected account and preserves idempotency", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ id: "po_123", status: "paid", amount: 12500, currency: "zar" }));
    const adapter = new StripeConnectPayoutAdapter({ secretKey: "sk_test", fetcher });
    const payout = await adapter.createPayout({ idempotencyKey: "ledger-123", reference: "payout-123", recipient: { id: "user-1", name: "Studio", country: "ZA", stripeAccountId: "acct_123" }, money: { amountMinor: 12500, currency: "ZAR" } });
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["Stripe-Account"]).toBe("acct_123");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("ledger-123");
    expect(payout.status).toBe("paid");
    expect(payout.providerReference).toBe("po_123");
  });

  it("validates rail-specific recipient data at the adapter boundary", async () => {
    const adapter = new MobileMoneyPayoutAdapter({ endpoint: "https://momo.test/payouts", token: "token", fetcher: vi.fn() });
    await expect(adapter.createPayout({ idempotencyKey: "key", reference: "ref", recipient: { id: "1", name: "A", country: "ZA" }, money: { amountMinor: 100, currency: "ZAR" } })).rejects.toMatchObject({ name: "IntegrationError" });
  });

  it("normalizes provider errors and marks transient failures retryable", async () => {
    const adapter = new MobileMoneyPayoutAdapter({ endpoint: "https://momo.test/payouts", token: "token", fetcher: vi.fn().mockResolvedValue(jsonResponse({ error: "busy" }, 503)) });
    await expect(adapter.createPayout({ idempotencyKey: "key", reference: "ref", recipient: { id: "1", name: "A", country: "ZA", mobileNumber: "+27820000000" }, money: { amountMinor: 100, currency: "ZAR" } })).rejects.toMatchObject({ provider: "mobile_money", status: 503, retryable: true });
  });

  it("allows DAM providers to be selected through a registry", () => {
    const registry = new DamProviderRegistry();
    const bynder = new BynderAdapter({ baseUrl: "https://example.bynder.test", token: "token", brandId: "brand" });
    registry.register(bynder);
    expect(registry.get("bynder")).toBe(bynder);
  });

  it("uses AEM's direct-binary initiate, upload, complete, then metadata flow", async () => {
    const fetcher = vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://source.test/image.jpg") return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
      if (url.endsWith("initiateUpload.json")) return Promise.resolve(jsonResponse({ completeURI: "/content/dam.completeUpload.json", files: [{ fileName: "image.jpg", mimeType: "image/jpeg", uploadToken: "upload-token", uploadURIs: ["https://upload.test/part-1"], maxPartSize: 10 }] }, 201));
      if (url === "https://upload.test/part-1") return Promise.resolve(new Response(null, { status: 200 }));
      if (url.endsWith("completeUpload.json")) return Promise.resolve(jsonResponse({}, 200));
      expect(init?.method).toBe("PUT");
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    const adapter = new AemAssetsAdapter({ baseUrl: "https://aem.test", token: "token", fetcher });
    const result = await adapter.syncAsset({ id: "asset-1", filename: "image.jpg", contentType: "image/jpeg", sourceUrl: "https://source.test/image.jpg", title: "Image" }, "sync-1");
    expect(result.assetId).toBe("veld-archive/image.jpg");
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("requires explicit provider registration", () => {
    expect(() => new PayoutProviderRegistry().get("sepa")).toThrow("No payout provider registered for sepa");
    expect(new IntegrationError("test", "oops", { status: 429, retryable: true }).retryable).toBe(true);
  });

  it("sends transactional notifications through the native Cloudflare binding", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "cf-message-1" });
    const adapter = new CloudflareEmailAdapter({ send } as unknown as SendEmail, { email: "notifications@example.com", name: "Stockvel" });
    await expect(adapter.send({ to: "buyer@example.com", subject: "Asset approved", text: "Your asset is approved.", idempotencyKey: "notify-1" })).resolves.toEqual({ id: "cf-message-1", provider: "cloudflare_email_service", accepted: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: { email: "notifications@example.com", name: "Stockvel" }, to: "buyer@example.com", subject: "Asset approved", text: "Your asset is approved." }));
  });
});
