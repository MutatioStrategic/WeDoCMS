export type NormalizedPaymentEvent = {
  provider: "paystack";
  eventId: string;
  type: "payment_succeeded" | "payment_failed" | "refund" | "chargeback";
  productType: "licence" | "photographer_subscription" | "platform_subscription" | "credit_purchase";
  licenceId?: string;
  subscriptionId?: string;
  creditPurchaseId?: string;
  paymentReference?: string;
  amountCents: number;
  currency: string;
};

type PaystackRecord = Record<string, unknown>;

function bytes(value: string): Uint8Array<ArrayBuffer> { return new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>; }
function hex(value: ArrayBuffer): string { return [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, "0")).join(""); }
function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
async function hmac(algorithm: "SHA-256" | "SHA-512", secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", bytes(secret), { name: "HMAC", hash: algorithm }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, bytes(value)));
}

export function signPaystackWebhook(secret: string, rawBody: string): Promise<string> { return hmac("SHA-512", secret, rawBody); }
export async function verifyPaystackWebhook(secret: string, signature: string, rawBody: string): Promise<boolean> {
  return /^[a-f\d]{128}$/i.test(signature) && safeEqual((await signPaystackWebhook(secret, rawBody)).toLowerCase(), signature.toLowerCase());
}

function record(value: unknown): PaystackRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as PaystackRecord : {}; }
function string(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : undefined; }
function metadata(value: unknown): PaystackRecord {
  if (typeof value === "string") { try { return record(JSON.parse(value)); } catch { return {}; } }
  return record(value);
}
async function stableEventId(event: string, data: PaystackRecord, reference?: string): Promise<string> {
  const identity = [event, string(data.id), reference, string(data.created_at), string(data.updated_at)].filter(Boolean).join(":");
  return `paystack:${hex(await crypto.subtle.digest("SHA-256", bytes(identity || JSON.stringify(data))))}`;
}

/** Converts Paystack transaction/refund events into the marketplace's provider-neutral payment event. */
export async function normalizePaystackPaymentEvent(input: unknown): Promise<NormalizedPaymentEvent | null> {
  const envelope = record(input);
  const event = string(envelope.event);
  const data = record(envelope.data);
  if (!event || !["charge.success", "charge.failed", "refund.processed", "charge.dispute.create"].includes(event)) return null;
  const transaction = record(data.transaction);
  const reference = string(data.reference) ?? string(transaction.reference);
  const meta = metadata(data.metadata ?? transaction.metadata);
  const productTypeValue = string(meta.productType) ?? "licence";
  if (!["licence", "photographer_subscription", "platform_subscription", "credit_purchase"].includes(productTypeValue)) return null;
  const productType = productTypeValue as NormalizedPaymentEvent["productType"];
  const licenceId = string(meta.licenceId) ?? (productType === "licence" ? reference : undefined);
  const subscriptionId = string(meta.subscriptionId) ?? (["photographer_subscription", "platform_subscription"].includes(productType) ? reference : undefined);
  const creditPurchaseId = string(meta.creditPurchaseId) ?? (productType === "credit_purchase" ? reference : undefined);
  if (productType === "licence" ? !licenceId : productType === "credit_purchase" ? !creditPurchaseId : !subscriptionId) return null;
  const amountCents = Number(data.amount ?? transaction.amount);
  const currency = (string(data.currency) ?? string(transaction.currency) ?? "ZAR").toUpperCase();
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !/^[A-Z]{3}$/.test(currency)) return null;
  return {
    provider: "paystack",
    eventId: await stableEventId(event, data, reference),
    type: event === "charge.success" ? "payment_succeeded" : event === "charge.failed" ? "payment_failed" : event === "refund.processed" ? "refund" : "chargeback",
    productType,
    ...(licenceId ? { licenceId } : {}),
    ...(subscriptionId ? { subscriptionId } : {}),
    ...(creditPurchaseId ? { creditPurchaseId } : {}),
    ...(reference ? { paymentReference: reference } : {}),
    amountCents,
    currency,
  };
}
