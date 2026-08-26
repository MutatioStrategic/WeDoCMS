/*
 * UAT/E2E coverage for the signup-to-access decision:
 *   registered buyer -> introductory allowance -> bundle/subscription fallback
 * and the seller upload opt-in that controls free-photo eligibility.
 *
 * Run against a local Worker after `npm run seed:demo-media`, or pass a
 * deployed URL as the first argument. The script uses only public HTTP
 * routes; no D1 tables are edited directly.
 */
const base = (process.argv[2] ?? process.env.E2E_BASE_URL ?? "").replace(/\/$/, "");
if (!base) throw new Error("Usage: node scripts/access-entitlements-e2e.mjs http://127.0.0.1:8787");

let cookie = "";
let csrfToken = "";

function rememberSession(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  const session = values.find((value) => value.startsWith("va_session="));
  if (session) cookie = session.split(";", 1)[0];
}

async function call(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(`${base}${path}`, { ...init, headers, redirect: "manual" });
  rememberSession(response);
  return response;
}

async function json(response) {
  return response.json().catch(() => ({}));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function login(role) {
  const endpoint = role === "buyer" ? ["/api/auth/demo-login", "/api/auth/dev-login"] : ["/api/auth/demo-login", "/api/auth/dev-login"];
  let response;
  for (const path of endpoint) {
    response = await call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
    if (response.status !== 404) break;
  }
  const body = await json(response);
  assert(response.ok, `${role} login failed: ${response.status}`);
  csrfToken = body.csrfToken ?? "";
  assert(body.user?.role === role && csrfToken, `${role} login did not return a session and CSRF token`);
  return body.user;
}

const unauthenticated = await call("/api/my/free-downloads");
assert(unauthenticated.status === 401, `free-downloads leaked without authentication: ${unauthenticated.status}`);

const buyer = await login("buyer");
const allowanceResponse = await call("/api/my/free-downloads");
const allowance = await json(allowanceResponse);
assert(allowanceResponse.ok, `buyer allowance failed: ${allowanceResponse.status}`);
assert(allowance.limit >= 3 && allowance.remaining === allowance.limit, "new buyer did not receive the configured introductory allowance");

const assetsResponse = await call("/api/assets?kind=image&status=published");
const assetsBody = await json(assetsResponse);
const freeAssets = (assetsBody.results ?? []).filter((asset) => asset.freeDownloadEnabled === true && asset.rightsStatus === "verified");
assert(assetsResponse.ok && freeAssets.length >= 2, "published rights-verified free-photo candidates were not returned");

const firstAsset = freeAssets[0];
const accessBefore = await call(`/api/assets/${encodeURIComponent(firstAsset.id)}/preview-access`);
const accessBeforeBody = await json(accessBefore);
assert(accessBefore.ok && accessBeforeBody.freeDownload === true && accessBeforeBody.paid === false, "free-photo preview access did not expose the introductory entitlement");

const firstDownload = await call(`/api/assets/${encodeURIComponent(firstAsset.id)}/original`);
assert(firstDownload.status === 302, `first free download did not return a signed redirect: ${firstDownload.status}`);
const afterFirst = await json(await call("/api/my/free-downloads"));
assert(afterFirst.used === 1 && afterFirst.remaining === allowance.limit - 1, "first free download did not consume exactly one allowance");

// A retry of the same buyer+asset is idempotent and must not spend another free slot.
const retryDownload = await call(`/api/assets/${encodeURIComponent(firstAsset.id)}/original`);
assert(retryDownload.status === 302, `free-download retry failed: ${retryDownload.status}`);
const afterRetry = await json(await call("/api/my/free-downloads"));
assert(afterRetry.used === 1, "retrying the same free asset consumed another allowance");

const secondAsset = freeAssets.find((asset) => asset.id !== firstAsset.id);
const secondDownload = await call(`/api/assets/${encodeURIComponent(secondAsset.id)}/original`);
assert(secondDownload.status === 302, `second free download did not return a signed redirect: ${secondDownload.status}`);
const afterSecond = await json(await call("/api/my/free-downloads"));
assert(afterSecond.used === 2 && afterSecond.remaining === allowance.limit - 2, "second free download did not update the allowance");

const subscriptionResponse = await call("/api/subscription");
const subscription = await json(subscriptionResponse);
assert(subscriptionResponse.ok, `subscription configuration failed: ${subscriptionResponse.status}`);
assert((subscription.plans ?? []).some((plan) => plan.id === "monthly") && (subscription.plans ?? []).some((plan) => plan.id === "annual"), "monthly and annual subscription choices are not exposed");

let subscriptionCheckoutStatus = "skipped_configured_provider";
let bundleCheckoutStatus = "skipped_configured_provider";
if (subscription.configured && process.env.E2E_ALLOW_REAL_PAYMENTS !== "true") {
  // Never create a real Paystack charge from an unattended UAT run.
  console.log("Payment checkout assertions skipped because this environment has a configured provider; set E2E_ALLOW_REAL_PAYMENTS=true only for a controlled sandbox.");
} else {
  const checkoutBody = { plan: "annual", successUrl: `${base}/account?subscription=success`, cancelUrl: `${base}/account?subscription=cancelled` };
  const subscriptionCheckout = await call("/api/subscription/session", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify(checkoutBody) });
  // Demo/local environments intentionally fail closed when Paystack credentials are absent.
  assert([201, 503].includes(subscriptionCheckout.status), `annual subscription checkout returned an unexpected status: ${subscriptionCheckout.status}`);
  subscriptionCheckoutStatus = String(subscriptionCheckout.status);

  const bundleCheckout = await call("/api/buyer/credits/checkout", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify({ credits: 5, successUrl: `${base}/account?bundle=success`, cancelUrl: `${base}/account?bundle=cancelled` }) });
  assert([201, 503].includes(bundleCheckout.status), `once-off bundle checkout returned an unexpected status: ${bundleCheckout.status}`);
  bundleCheckoutStatus = String(bundleCheckout.status);
}

await call("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken } });
cookie = "";
await login("contributor");
const uploadBody = {
  kind: "image", title: `Free offer UAT ${Date.now()}`, description: "UAT seller opt-in", caption: "UAT seller opt-in", rightsStatus: "verified",
  modelReleaseStatus: "not_required", propertyReleaseStatus: "not_required", monetizationModel: "membership", subjectTags: ["landscape"], culturalTags: [], freeDownloadEnabled: true,
};
const upload = await call("/api/assets", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify(uploadBody) });
const uploadResult = await json(upload);
assert(upload.status === 201 && uploadResult.status === "needs_review", `seller free-download opt-in failed: ${upload.status}`);

const videoOptIn = await call("/api/assets", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify({ ...uploadBody, kind: "video", title: `Invalid video UAT ${Date.now()}` }) });
assert(videoOptIn.status === 422, `video free-download opt-in was accepted: ${videoOptIn.status}`);

console.log(JSON.stringify({ ok: true, base, buyer: buyer.id, freeCandidates: freeAssets.length, allowance: { limit: allowance.limit, usedAfterTwo: afterSecond.used, remainingAfterTwo: afterSecond.remaining }, plans: subscription.plans.map((plan) => plan.id), annualCheckoutStatus: subscriptionCheckoutStatus, bundleCheckoutStatus, sellerOptInStatus: upload.status, videoOptInStatus: videoOptIn.status }, null, 2));
