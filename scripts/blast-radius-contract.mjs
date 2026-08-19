import { createHmac } from "node:crypto";

const baseUrl = (process.env.E2E_BASE_URL ?? process.env.BLAST_RADIUS_BASE_URL ?? "http://127.0.0.1:8788").replace(/\/$/, "");
const paymentSecret = process.env.PAYMENT_WEBHOOK_SECRET ?? "ci-payment-webhook-secret-that-is-long-enough";
const streamSecret = process.env.STREAM_WEBHOOK_SECRET ?? "ci-stream-webhook-secret-that-is-long-enough";
const runId = `${Date.now()}`;
let cookie = "";
let csrfToken = "";
const observations = [];
const failures = [];

function rememberCookie(response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") ?? ""];
  const session = values.find((value) => value.startsWith("va_session="));
  if (session) cookie = session.split(";", 1)[0];
}

async function call(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(8000) });
  rememberCookie(response);
  return response;
}

async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return { raw: text }; }
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function observe(name, response, body, expectedStatuses) {
  const accepted = expectedStatuses.includes(response.status);
  observations.push({ name, status: response.status, expectedStatuses, accepted, code: body?.code, error: body?.error });
  assert(accepted, `${name}: expected ${expectedStatuses.join("/")}, received ${response.status}`);
}

async function login(role) {
  cookie = "";
  csrfToken = "";
  const response = await call("/api/auth/dev-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  const body = await readJson(response);
  assert(response.ok, `${role} login failed with ${response.status}`);
  csrfToken = body?.csrfToken ?? body?.user?.csrfToken ?? "";
  assert(Boolean(csrfToken), `${role} login did not return a CSRF token`);
}

function mutationHeaders() {
  return { "Content-Type": "application/json", "X-CSRF-Token": csrfToken };
}

async function contributorAssets() {
  const response = await call("/api/my/assets");
  const body = await readJson(response);
  assert(response.ok && Array.isArray(body?.results), `asset snapshot failed with ${response.status}`);
  return body?.results ?? [];
}

async function reconciliationSummary() {
  const response = await call("/api/ops/reconciliation/payments");
  const body = await readJson(response);
  assert(response.ok, `payment reconciliation failed with ${response.status}`);
  return {
    discrepancyCount: body?.discrepancyCount,
    rows: (body?.results ?? []).map((row) => ({
      licence_id: row.licence_id,
      licence_status: row.licence_status,
      price_cents: row.price_cents,
      sale_ledger_cents: row.sale_ledger_cents,
      refund_ledger_cents: row.refund_ledger_cents,
      discrepancy: row.discrepancy,
    })),
  };
}

async function signedPayment(body) {
  return call("/api/webhooks/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Payment-Signature": createHmac("sha256", paymentSecret).update(body).digest("hex"),
    },
    body,
  });
}

async function signedStream(body) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return call("/api/webhooks/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Webhook-Signature": `time=${timestamp},sig1=${createHmac("sha256", streamSecret).update(`${timestamp}.${body}`).digest("hex")}`,
    },
    body,
  });
}

await login("contributor");
const beforeAssets = await contributorAssets();
const knownAsset = beforeAssets.find((asset) => asset.id === "asset-garden-route-drive") ?? beforeAssets[0];
assert(Boolean(knownAsset), "no seeded contributor asset was available for moderation testing");

let response = await call("/api/assets", { method: "POST", headers: mutationHeaders(), body: "{\"kind\":" });
let body = await readJson(response);
observe("malformed asset JSON", response, body, [400]);
assert(body?.code === "invalid_json", "malformed asset JSON did not expose the invalid_json contract code");
let afterAssets = await contributorAssets();
assert(afterAssets.length === beforeAssets.length, "malformed asset JSON changed ingestion state");

response = await call("/api/assets", {
  method: "POST",
  headers: mutationHeaders(),
  body: JSON.stringify({ kind: "audio", title: "x" }),
});
body = await readJson(response);
observe("asset schema mismatch", response, body, [400]);
afterAssets = await contributorAssets();
assert(afterAssets.length === beforeAssets.length, "asset schema mismatch propagated into persisted ingestion state");

response = await call("/api/assets", {
  method: "POST",
  headers: mutationHeaders(),
  body: JSON.stringify({ kind: "image", title: "Unsafe metadata probe", culturalTags: ["black people"] }),
});
body = await readJson(response);
observe("unsafe metadata ingestion", response, body, [422]);
assert(body?.code === "metadata_context_required", "unsafe metadata did not enter the moderation safety boundary");
afterAssets = await contributorAssets();
assert(afterAssets.length === beforeAssets.length, "unsafe metadata was persisted before moderation review");

response = await call(`/api/governance/assets/${knownAsset?.id ?? "missing"}/action`, {
  method: "POST",
  headers: mutationHeaders(),
  body: JSON.stringify({ action: "save_correction", culturalTags: ["tribal"] }),
});
body = await readJson(response);
observe("unsafe moderation correction", response, body, [422]);
assert(body?.code === "metadata_context_required", "unsafe moderation correction bypassed the safety boundary");

response = await call(`/api/governance/assets/${knownAsset?.id ?? "missing"}/action`, {
  method: "POST",
  headers: mutationHeaders(),
  body: JSON.stringify({ action: "run_ai_tagging" }),
});
body = await readJson(response);
observe("moderation queue/schema fault containment", response, body, [200, 409, 503]);
assert(
  response.status === 503
    ? body?.code === "metadata_schema_unavailable"
    : response.status === 409
      ? body?.code === "ai_enrichment_upload_only"
      : ["enrichment_queued", "enrichment_retry_pending"].includes(body?.indexing),
  "moderation queue/schema result was not explicit",
);
afterAssets = await contributorAssets();
const moderatedAsset = afterAssets.find((asset) => asset.id === knownAsset?.id);
assert(moderatedAsset?.status === "needs_review", "moderation queue fault changed the asset to a publishable state");

response = await call("/api/checkout/validate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ assetId: knownAsset?.id ?? "missing", licenceType: "commercial", territory: "ZA", durationDays: "30" }),
});
body = await readJson(response);
observe("licensing schema mismatch", response, body, [400]);

response = await signedStream(JSON.stringify({ uid: 42, status: { state: "ready" } }));
body = await readJson(response);
observe("Stream webhook schema mismatch", response, body, [400]);

await login("admin");
const ledgerBefore = await reconciliationSummary();

response = await signedPayment("{\"provider\":\"test-provider\"");
body = await readJson(response);
observe("malformed signed payment JSON", response, body, [400]);
response = await signedPayment("{\"provider\":\"test-provider\"");
body = await readJson(response);
observe("malformed payment retry", response, body, [400]);

const invalidShape = JSON.stringify({ provider: "test-provider", eventId: `blast-invalid-${runId}`, type: "payment_succeeded", licenceId: "missing-licence", amountCents: "1000", currency: "ZAR" });
response = await signedPayment(invalidShape);
body = await readJson(response);
observe("payment schema mismatch", response, body, [400]);

const failedLedgerEvent = JSON.stringify({ provider: "test-provider", eventId: `blast-failed-${runId}`, type: "payment_succeeded", licenceId: "licence-spring-asset-1", amountCents: 1000, currency: "ZAR" });
response = await signedPayment(failedLedgerEvent);
body = await readJson(response);
observe("valid webhook with isolated ledger failure", response, body, [422]);
response = await signedPayment(failedLedgerEvent);
body = await readJson(response);
observe("failed webhook idempotent retry", response, body, [200]);
assert(body?.duplicate === true, "failed ledger event was not isolated and idempotent");

const ledgerAfter = await reconciliationSummary();
assert(JSON.stringify(ledgerAfter) === JSON.stringify(ledgerBefore), "malformed or failed payment input changed ledger reconciliation state");

console.log(JSON.stringify({ ok: failures.length === 0, baseUrl, observations, failures, containment: {
  ingestion: "rejected malformed/schema-unsafe input without increasing contributor asset count",
  moderation: "unsafe labels rejected; queue outcome explicit and asset remained needs_review",
  licensing: "typed mismatch rejected before licence validation",
  ledger: "malformed input rejected before event persistence; valid failed event persisted as failed and retried idempotently without ledger drift",
} }, null, 2));
if (failures.length > 0) process.exitCode = 1;
