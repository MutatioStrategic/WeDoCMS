import { describe, expect, it } from "vitest";
import { normalizePaystackPaymentEvent, signPaystackWebhook, verifyPaystackWebhook } from "./paystack-webhooks";

describe("Paystack webhooks", () => {
  it("verifies x-paystack-signature with HMAC SHA-512", async () => {
    const body = JSON.stringify({ event: "charge.success", data: { id: 42 } });
    const signature = await signPaystackWebhook("secret", body);
    expect(await verifyPaystackWebhook("secret", signature, body)).toBe(true);
    expect(await verifyPaystackWebhook("secret", `${signature}00`, body)).toBe(false);
  });

  it("normalizes a licence charge.success event", async () => {
    const event = await normalizePaystackPaymentEvent({
      event: "charge.success",
      data: {
        id: 42,
        reference: "licence-1",
        amount: 25000,
        currency: "ZAR",
        metadata: { productType: "licence", licenceId: "licence-1" },
      },
    });
    expect(event).toMatchObject({ provider: "paystack", type: "payment_succeeded", productType: "licence", licenceId: "licence-1", amountCents: 25000, paymentReference: "licence-1" });
    expect(event?.eventId).toMatch(/^paystack:/);
  });

  it("normalizes refund events and stringified metadata", async () => {
    const event = await normalizePaystackPaymentEvent({
      event: "refund.processed",
      data: {
        id: 81,
        amount: 5000,
        currency: "ZAR",
        transaction: { reference: "tx-1", metadata: JSON.stringify({ productType: "credit_purchase", creditPurchaseId: "credits-1" }) },
      },
    });
    expect(event).toMatchObject({ type: "refund", productType: "credit_purchase", creditPurchaseId: "credits-1", amountCents: 5000 });
  });
});
