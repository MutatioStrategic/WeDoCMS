import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PAYFAST_SANDBOX_ENDPOINT, PayFastPaymentAdapter, isPayFastIp, payfastAmountCents, payfastSignature, verifyPayFastSignature } from "./payfast";

describe("PayFast payment integration", () => {
  it("matches PayFast's ordered URL-encoded MD5 signature rules", () => {
    const fields: Array<[string, string]> = [["merchant_id", "10000100"], ["item_name", "Test Product"], ["amount", "100.00"]];
    const canonical = "merchant_id=10000100&item_name=Test+Product&amount=100.00&passphrase=secret-passphrase";
    const expected = createHash("md5").update(canonical).digest("hex");
    expect(payfastSignature(fields, "secret-passphrase")).toBe(expected);
    expect(verifyPayFastSignature(fields, expected, "secret-passphrase")).toBe(true);
    expect(verifyPayFastSignature(fields, "0".repeat(32), "secret-passphrase")).toBe(false);
  });

  it("builds a sandbox form for credit purchases and recurring membership", async () => {
    const adapter = new PayFastPaymentAdapter({ merchantId: "10000100", merchantKey: "merchant-key", passphrase: "passphrase", notifyUrl: "https://archive.example/api/webhooks/payfast", endpoint: PAYFAST_SANDBOX_ENDPOINT });
    const session = await adapter.createCheckoutSession({
      idempotencyKey: "platform-subscription:subscription-1",
      referenceId: "subscription-1",
      productType: "platform_subscription",
      recurring: { interval: "month", billingDay: 12, startDate: "2026-09-12" },
      amountCents: 129900,
      currency: "ZAR",
      buyer: { id: "buyer-1", email: "buyer@example.com" },
      successUrl: "https://archive.example/success",
      cancelUrl: "https://archive.example/cancel",
    });
    expect(session.checkoutForm?.action).toBe(PAYFAST_SANDBOX_ENDPOINT);
    expect(session.checkoutForm?.fields).toMatchObject({ amount: "1299.00", subscription_type: "1", billing_date: "2026-09-12", frequency: "3", cycles: "0" });
    expect(session.checkoutForm?.fields.signature).toHaveLength(32);
  });

  it("validates amounts and the published PayFast notification ranges", () => {
    expect(payfastAmountCents("1299.00")).toBe(129900);
    expect(payfastAmountCents("100")).toBe(10000);
    expect(() => payfastAmountCents("R100")).toThrow();
    expect(isPayFastIp("197.97.145.144")).toBe(true);
    expect(isPayFastIp("41.74.179.223")).toBe(true);
    expect(isPayFastIp("203.0.113.10")).toBe(false);
  });
});
