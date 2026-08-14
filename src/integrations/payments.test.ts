import { describe, expect, it } from "vitest";
import { JsonPaymentAdapter } from "./payments";

describe("JsonPaymentAdapter", () => {
  it("creates a hosted checkout session with an idempotency key", async () => {
    let request: Request | undefined;
    const adapter = new JsonPaymentAdapter({
      provider: "test-psp",
      endpoint: "https://payments.example/checkout",
      token: "secret",
      fetcher: async (input, init) => {
        request = new Request(input, init);
        return new Response(JSON.stringify({ id: "psp-session-1", checkoutUrl: "https://payments.example/pay/1", status: "created" }), { status: 201 });
      },
    });
    const result = await adapter.createCheckoutSession({
      idempotencyKey: "licence:12345678",
      licenceId: "licence-1",
      amountCents: 12500,
      currency: "ZAR",
      buyer: { id: "buyer-1", email: "buyer@example.com" },
      successUrl: "https://app.example/success",
      cancelUrl: "https://app.example/cancel",
    });
    expect(result.checkoutUrl).toBe("https://payments.example/pay/1");
    expect(request?.headers.get("Idempotency-Key")).toBe("licence:12345678");
    expect(await request?.json()).toMatchObject({ reference: "licence-1", amount: 12500, currency: "ZAR" });
  });

  it("fails closed when the provider omits the hosted URL", async () => {
    const adapter = new JsonPaymentAdapter({
      provider: "test-psp",
      endpoint: "https://payments.example/checkout",
      token: "secret",
      fetcher: async () => new Response(JSON.stringify({ id: "psp-session-1" }), { status: 201 }),
    });
    await expect(adapter.createCheckoutSession({
      idempotencyKey: "licence:12345678",
      licenceId: "licence-1",
      amountCents: 12500,
      currency: "ZAR",
      buyer: { id: "buyer-1", email: "buyer@example.com" },
      successUrl: "https://app.example/success",
      cancelUrl: "https://app.example/cancel",
    })).rejects.toThrow("hosted URL");
  });

  it("passes membership recurrence details to the payment provider", async () => {
    let request: Request | undefined;
    const adapter = new JsonPaymentAdapter({
      provider: "test-psp",
      endpoint: "https://payments.example/checkout",
      token: "secret",
      fetcher: async (input, init) => {
        request = new Request(input, init);
        return new Response(JSON.stringify({ id: "psp-membership-1", checkoutUrl: "https://payments.example/pay/membership-1" }), { status: 201 });
      },
    });
    await adapter.createCheckoutSession({
      idempotencyKey: "platform_subscription:12345678",
      referenceId: "platform-subscription-1",
      productType: "platform_subscription",
      recurring: { interval: "month", billingDay: 12, startDate: "2026-09-12" },
      amountCents: 129900,
      currency: "ZAR",
      buyer: { id: "buyer-1", email: "buyer@example.com" },
      successUrl: "https://app.example/success",
      cancelUrl: "https://app.example/cancel",
    });
    expect(await request?.json()).toMatchObject({
      reference: "platform-subscription-1",
      productType: "platform_subscription",
      amount: 129900,
      recurring: { interval: "month", billingDay: 12, startDate: "2026-09-12" },
    });
  });
});
