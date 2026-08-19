import { describe, expect, it } from "vitest";
import { JsonPaymentAdapter, PaystackPaymentAdapter } from "./payments";

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

describe("PaystackPaymentAdapter", () => {
  it("invokes the Worker global fetch with a valid receiver", async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return new Response(JSON.stringify({ status: true, data: { authorization_url: "https://checkout.paystack.com/access", reference: "licence-fetch" } }));
    };
    try {
      const adapter = new PaystackPaymentAdapter({ endpoint: "https://api.paystack.co/transaction/initialize", secretKey: "test-secret" });
      await adapter.createCheckoutSession({
        idempotencyKey: "licence:12345678",
        licenceId: "licence-fetch",
        amountCents: 10000,
        currency: "ZAR",
        buyer: { id: "buyer-1", email: "buyer@example.com" },
        successUrl: "https://app.example/success",
        cancelUrl: "https://app.example/cancel",
      });
      expect(called).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("initializes server-side hosted checkout with licence metadata", async () => {
    let request: Request | undefined;
    const adapter = new PaystackPaymentAdapter({
      endpoint: "https://api.paystack.co/transaction/initialize",
      secretKey: "test-secret",
      fetcher: async (input, init) => {
        request = new Request(input, init);
        return new Response(JSON.stringify({ status: true, data: { authorization_url: "https://checkout.paystack.com/access", access_code: "access", reference: "licence-1" } }));
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
      metadata: { organizationId: "org-1" },
    });
    expect(result).toMatchObject({ provider: "paystack", checkoutUrl: "https://checkout.paystack.com/access", providerReference: "licence-1" });
    expect(request?.headers.get("Authorization")).toBe("Bearer test-secret");
    expect(await request?.json()).toMatchObject({
      email: "buyer@example.com",
      amount: "12500",
      currency: "ZAR",
      reference: "licence-1",
      callback_url: "https://app.example/success",
      metadata: { licenceId: "licence-1", buyerId: "buyer-1", cancel_action: "https://app.example/cancel" },
    });
  });

  it("fails closed when Paystack omits its authorization URL", async () => {
    const adapter = new PaystackPaymentAdapter({
      endpoint: "https://api.paystack.co/transaction/initialize",
      secretKey: "test-secret",
      fetcher: async () => new Response(JSON.stringify({ status: false, message: "invalid key" })),
    });
    await expect(adapter.createCheckoutSession({
      idempotencyKey: "licence:12345678",
      licenceId: "licence-1",
      amountCents: 12500,
      currency: "ZAR",
      buyer: { id: "buyer-1", email: "buyer@example.com" },
      successUrl: "https://app.example/success",
      cancelUrl: "https://app.example/cancel",
    })).rejects.toThrow("authorization URL");
  });

  it("sends the configured artist percentage as a Paystack split", async () => {
    let request: Request | undefined;
    const adapter = new PaystackPaymentAdapter({
      endpoint: "https://api.paystack.co/transaction/initialize",
      secretKey: "test-secret",
      fetcher: async (input, init) => { request = new Request(input, init); return new Response(JSON.stringify({ status: true, data: { authorization_url: "https://checkout.paystack.com/access", reference: "licence-2" } })); },
    });
    await adapter.createCheckoutSession({
      idempotencyKey: "licence:12345678",
      licenceId: "licence-2",
      amountCents: 10000,
      currency: "ZAR",
      buyer: { id: "buyer-1", email: "buyer@example.com" },
      successUrl: "https://app.example/success",
      cancelUrl: "https://app.example/cancel",
      split: { type: "percentage", bearerType: "account", subaccounts: [{ subaccount: "ACCT_artist", share: 60 }] },
    });
    expect(await request?.json()).toMatchObject({ split: { type: "percentage", bearer_type: "account", subaccounts: [{ subaccount: "ACCT_artist", share: 60 }] } });
  });

  it("initializes a recurring Paystack plan without exposing the secret key", async () => {
    let request: Request | undefined;
    const adapter = new PaystackPaymentAdapter({
      endpoint: "https://api.paystack.co/transaction/initialize",
      secretKey: "test-secret",
      fetcher: async (input, init) => { request = new Request(input, init); return new Response(JSON.stringify({ status: true, data: { authorization_url: "https://checkout.paystack.com/subscription", reference: "sub-ref" } })); },
    });
    await adapter.createCheckoutSession({
      idempotencyKey: "subscription:12345678",
      licenceId: "subscription-1",
      reference: "sub_subscription-1",
      amountCents: 120000,
      currency: "ZAR",
      buyer: { id: "buyer-1", email: "buyer@example.com" },
      successUrl: "https://app.example/account?subscription=complete",
      cancelUrl: "https://app.example/account?subscription=cancelled",
      planCode: "PLN_monthly",
      metadata: { subscriptionId: "subscription-1" },
    });
    expect(await request?.json()).toMatchObject({ reference: "sub_subscription-1", plan: "PLN_monthly", metadata: { subscriptionId: "subscription-1", subscriptionPlanCode: "PLN_monthly" } });
  });

  it("creates a provider-hosted subscription management link", async () => {
    let request: Request | undefined;
    const adapter = new PaystackPaymentAdapter({
      endpoint: "https://api.paystack.co/transaction/initialize",
      secretKey: "test-secret",
      fetcher: async (input, init) => { request = new Request(input, init); return new Response(JSON.stringify({ status: true, data: { link: "https://paystack.com/manage/sub-1" } })); },
    });
    await expect(adapter.createSubscriptionManageLink("SUB_code")).resolves.toBe("https://paystack.com/manage/sub-1");
    expect(request?.url).toBe("https://api.paystack.co/subscription/SUB_code/manage/link");
    expect(request?.headers.get("Authorization")).toBe("Bearer test-secret");
  });
});
