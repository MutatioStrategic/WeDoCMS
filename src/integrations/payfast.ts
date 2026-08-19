import { IntegrationError } from "./http";
import type { PaymentProvider, PaymentSession, PaymentSessionRequest } from "./payments";

export const PAYFAST_LIVE_ENDPOINT = "https://www.payfast.co.za/eng/process";
export const PAYFAST_SANDBOX_ENDPOINT = "https://sandbox.payfast.co.za/eng/process";

type PayFastConfig = {
  merchantId: string;
  merchantKey: string;
  passphrase?: string;
  notifyUrl: string;
  endpoint?: string;
};

const PAYMENT_FIELD_ORDER = [
  "merchant_id", "merchant_key", "return_url", "cancel_url", "notify_url",
  "name_first", "name_last", "email_address", "cell_number", "m_payment_id",
  "amount", "item_name", "item_description", "custom_int1", "custom_int2",
  "custom_int3", "custom_int4", "custom_int5", "custom_str1", "custom_str2",
  "custom_str3", "custom_str4", "custom_str5", "subscription_type", "billing_date",
  "recurring_amount", "frequency", "cycles", "subscription_notify_email",
  "subscription_notify_webhook", "subscription_notify_buyer",
] as const;

function payfastEncode(value: string): string {
  return encodeURIComponent(value.trim())
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function orderedPayFastString(fields: Array<[string, string]>): string {
  return fields.filter(([, value]) => value !== "").map(([key, value]) => `${key}=${payfastEncode(value)}`).join("&");
}

function md5(value: string): string {
  const input = new TextEncoder().encode(value);
  const bitLength = input.length * 8;
  const paddedLength = (((input.length + 8) >>> 6) + 1) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000));
  const rotateLeft = (value: number, amount: number) => (value << amount) | (value >>> (32 - amount));

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = Array.from({ length: 16 }, (_, index) => view.getUint32(offset + index * 4, true));
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let index = 0; index < 64; index += 1) {
      let f: number;
      let g: number;
      if (index < 16) {
        f = (b & c) | (~b & d);
        g = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        g = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        g = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * index) % 16;
      }
      const group = Math.floor(index / 16);
      const shift = shifts[group * 4 + (index % 4)];
      const next = (a + f + constants[index] + words[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotateLeft(next, shift)) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0].flatMap((word) => [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, word >>> 24])
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function payfastSignature(fields: Array<[string, string]>, passphrase?: string): string {
  const value = orderedPayFastString(fields) + (passphrase ? `&passphrase=${payfastEncode(passphrase)}` : "");
  return md5(value);
}

export function verifyPayFastSignature(fields: Array<[string, string]>, signature: string, passphrase?: string): boolean {
  const expected = payfastSignature(fields, passphrase);
  if (expected.length !== signature.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return difference === 0;
}

export function payfastAmountCents(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) throw new Error("PayFast amount is invalid");
  const [whole, fraction = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 1) throw new Error("PayFast amount is invalid");
  return cents;
}

export function isPayFastIp(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const value = octets.reduce((total, octet) => total * 256 + octet, 0);
  return [
    { base: [197, 97, 145, 144], prefix: 28 },
    { base: [41, 74, 179, 192], prefix: 27 },
    { base: [102, 216, 36, 0], prefix: 28 },
    { base: [102, 216, 36, 128], prefix: 28 },
    { base: [144, 126, 193, 139], prefix: 32 },
  ].some(({ base, prefix }) => {
    const network = base.reduce((total, octet) => total * 256 + octet, 0);
    const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (network & mask);
  });
}

function metadataFields(request: PaymentSessionRequest): Record<string, string> {
  const metadata = Object.entries(request.metadata ?? {}).slice(0, 5);
  return Object.fromEntries(metadata.map(([key, value], index) => [`custom_str${index + 1}`, `${key}:${value}`.slice(0, 255)]));
}

export class PayFastPaymentAdapter implements PaymentProvider {
  readonly provider = "payfast";

  constructor(private readonly config: PayFastConfig) {}

  async createCheckoutSession(request: PaymentSessionRequest): Promise<PaymentSession> {
    if (request.currency.toUpperCase() !== "ZAR") throw new IntegrationError(this.provider, "PayFast payments must use ZAR");
    if (request.recurring && !this.config.passphrase) throw new IntegrationError(this.provider, "A PayFast passphrase is required for recurring payments");
    const reference = request.referenceId ?? request.licenceId ?? request.idempotencyKey;
    const fields: Record<string, string> = {
      merchant_id: this.config.merchantId,
      merchant_key: this.config.merchantKey,
      return_url: request.successUrl,
      cancel_url: request.cancelUrl,
      notify_url: this.config.notifyUrl,
      email_address: request.buyer.email,
      m_payment_id: reference,
      amount: (request.amountCents / 100).toFixed(2),
      item_name: request.productType === "credit_purchase" ? "Veld Archive credits" : request.productType === "platform_subscription" ? "Veld Archive monthly membership" : "Veld Archive licence",
      item_description: `Veld Archive ${request.productType ?? "licence"}`,
      ...metadataFields(request),
    };
    if (request.recurring) {
      Object.assign(fields, {
        subscription_type: "1",
        billing_date: request.recurring.startDate,
        recurring_amount: (request.amountCents / 100).toFixed(2),
        frequency: "3",
        cycles: "0",
        subscription_notify_webhook: "1",
        subscription_notify_buyer: "1",
      });
    }
    const orderedFields = PAYMENT_FIELD_ORDER.map((key) => [key, fields[key] ?? ""] as [string, string]);
    const checkoutFields = { ...fields, signature: payfastSignature(orderedFields, this.config.passphrase) };
    return {
      id: reference,
      provider: this.provider,
      status: "created",
      checkoutUrl: this.config.endpoint ?? PAYFAST_LIVE_ENDPOINT,
      checkoutForm: { action: this.config.endpoint ?? PAYFAST_LIVE_ENDPOINT, fields: checkoutFields },
      providerReference: reference,
      raw: { sandbox: (this.config.endpoint ?? PAYFAST_LIVE_ENDPOINT) === PAYFAST_SANDBOX_ENDPOINT },
    };
  }
}
