import type { HttpClient } from "./http";

function bytes(value: string): Uint8Array<ArrayBuffer> { return new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>; }
function hex(value: ArrayBuffer): string { return [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, "0")).join(""); }
function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
async function signature(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", bytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, bytes(body)));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = canonicalValue((value as Record<string, unknown>)[key]);
    return result;
  }, {});
  return value;
}

export function canonicalJson(value: unknown): string { return JSON.stringify(canonicalValue(value)); }
export function signDiditWebhookV2(secret: string, _timestamp: string, payload: unknown): Promise<string> { return signature(secret, canonicalJson(payload)); }

export async function verifyDiditWebhook(input: { secret: string; rawBody: string; payload: unknown; signatureV2?: string; signature?: string; timestamp?: string; nowSeconds?: number }): Promise<boolean> {
  const timestamp = Number(input.timestamp);
  if (!Number.isSafeInteger(timestamp) || Math.abs((input.nowSeconds ?? Math.floor(Date.now() / 1000)) - timestamp) > 300) return false;
  if (input.signatureV2 && /^[a-f\d]{64}$/i.test(input.signatureV2)) return safeEqual((await signature(input.secret, canonicalJson(input.payload))).toLowerCase(), input.signatureV2.toLowerCase());
  if (input.signature && /^[a-f\d]{64}$/i.test(input.signature)) return safeEqual((await signature(input.secret, input.rawBody)).toLowerCase(), input.signature.toLowerCase());
  return false;
}

export type DiditSession = { sessionId: string; sessionKind: "user" | "business"; url: string; status: string; workflowId: string; vendorData: string };

export async function createDiditSession(input: { apiKey: string; workflowId: string; vendorData: string; callbackUrl: string; contactDetails?: { email?: string; phone?: string }; fetcher?: HttpClient; endpoint?: string }): Promise<DiditSession> {
  const fetcher = input.fetcher ?? globalThis.fetch;
  const response = await fetcher(input.endpoint ?? "https://verification.didit.me/v3/session/", {
    method: "POST",
    headers: { "x-api-key": input.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ workflow_id: input.workflowId, vendor_data: input.vendorData, callback: input.callbackUrl, ...(input.contactDetails ? { contact_details: input.contactDetails } : {}) }),
    signal: AbortSignal.timeout(8_000),
  });
  const value = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (response.status !== 201 || typeof value.session_id !== "string" || typeof value.url !== "string") throw new Error(`Didit session creation failed (${response.status})`);
  return { sessionId: value.session_id, sessionKind: value.session_kind === "business" ? "business" : "user", url: value.url, status: String(value.status ?? "Not Started"), workflowId: String(value.workflow_id ?? input.workflowId), vendorData: String(value.vendor_data ?? input.vendorData) };
}

export function normalizeDiditStatus(status: string): "pending" | "in_review" | "verified" | "rejected" | "expired" {
  if (status === "Approved") return "verified";
  if (status === "Declined") return "rejected";
  if (["Expired", "Kyc Expired", "Abandoned"].includes(status)) return "expired";
  if (["In Review", "Resubmitted"].includes(status)) return "in_review";
  return "pending";
}

export class DiditVerificationAdapter {
  constructor(private readonly config: { apiKey: string; kycWorkflowId: string; kybWorkflowId: string; endpoint?: string; fetcher?: HttpClient }) {}

  createSellerSession(input: { sellerType: "individual" | "company"; contributorId: string; callbackUrl: string; email: string; phone: string }): Promise<DiditSession> {
    return createDiditSession({
      apiKey: this.config.apiKey,
      workflowId: input.sellerType === "company" ? this.config.kybWorkflowId : this.config.kycWorkflowId,
      vendorData: input.contributorId,
      callbackUrl: input.callbackUrl,
      contactDetails: { email: input.email, phone: input.phone },
      endpoint: this.config.endpoint,
      fetcher: this.config.fetcher,
    });
  }
}
