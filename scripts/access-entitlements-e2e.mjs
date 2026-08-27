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

async function assertDownload(response, label) {
  assert([200, 302].includes(response.status), `${label} did not return a downloadable response: ${response.status}`);
  if (response.status === 200) {
    assert((response.headers.get("content-disposition") ?? "").startsWith("attachment"), `${label} did not set attachment disposition`);
    assert(Number(response.headers.get("content-length") ?? 0) > 0, `${label} did not return a non-empty media object`);
    await response.body?.cancel();
  }
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
assert(allowance.limit >= 3 && allowance.remaining >= 0 && allowance.remaining <= allowance.limit, "buyer did not receive a valid configured introductory allowance");
const usedAtStart = Number(allowance.used ?? 0);
const claimedAssetIds = new Set((allowance.downloads ?? []).map((download) => String(download.asset_id ?? download.assetId ?? "")));

const assetsResponse = await call("/api/assets?kind=image&status=published");
const assetsBody = await json(assetsResponse);
const freeAssets = (assetsBody.results ?? []).filter((asset) => asset.freeDownloadEnabled === true && asset.rightsStatus === "verified");
assert(assetsResponse.ok && freeAssets.length >= 2, "published rights-verified free-photo candidates were not returned");

const unclaimedFreeAssets = freeAssets.filter((asset) => !claimedAssetIds.has(String(asset.id)));
const firstAsset = unclaimedFreeAssets[0] ?? freeAssets[0];
const firstAssetClaimed = claimedAssetIds.has(String(firstAsset.id));
const accessBefore = await call(`/api/assets/${encodeURIComponent(firstAsset.id)}/preview-access`);
const accessBeforeBody = await json(accessBefore);
assert(accessBefore.ok && accessBeforeBody.freeDownload === true && accessBeforeBody.freeDownloadsRemaining === allowance.remaining, "free-photo preview access did not expose the configured introductory offer");
if (firstAssetClaimed) assert(accessBeforeBody.paid === true, "preview access did not retain the stable buyer's existing entitlement");

let afterSecond = allowance;
if (allowance.remaining > 0 && unclaimedFreeAssets.length > 0) {
  const firstDownload = await call(`/api/assets/${encodeURIComponent(firstAsset.id)}/original`);
  await assertDownload(firstDownload, "first free download");
  const afterFirst = await json(await call("/api/my/free-downloads"));
  assert(afterFirst.used === usedAtStart + 1 && afterFirst.remaining === allowance.remaining - 1, "first free download did not consume exactly one allowance");

  // A retry of the same buyer+asset is idempotent and must not spend another free slot.
  const retryDownload = await call(`/api/assets/${encodeURIComponent(firstAsset.id)}/original`);
  await assertDownload(retryDownload, "free-download retry");
  const afterRetry = await json(await call("/api/my/free-downloads"));
  assert(afterRetry.used === usedAtStart + 1, "retrying the same free asset consumed another allowance");
  afterSecond = afterRetry;

  const secondAsset = unclaimedFreeAssets.find((asset) => asset.id !== firstAsset.id);
  if (allowance.remaining > 1 && secondAsset) {
    const secondDownload = await call(`/api/assets/${encodeURIComponent(secondAsset.id)}/original`);
    await assertDownload(secondDownload, "second free download");
    afterSecond = await json(await call("/api/my/free-downloads"));
    assert(afterSecond.used === usedAtStart + 2 && afterSecond.remaining === allowance.remaining - 2, "second free download did not update the allowance");
  }
} else {
  // Demo identities are intentionally stable between runs. When every eligible
  // asset is already claimed (or the allowance is exhausted), verify the
  // already-claimed asset remains idempotently retrievable.
  const claimedAsset = freeAssets.find((asset) => claimedAssetIds.has(String(asset.id)));
  assert(claimedAsset, "no free-photo candidate is available for the stable demo buyer");
  const retryDownload = await call(`/api/assets/${encodeURIComponent(claimedAsset.id)}/original`);
  await assertDownload(retryDownload, "exhausted free-download retry");
  afterSecond = await json(await call("/api/my/free-downloads"));
  assert(afterSecond.used === usedAtStart, "retrying an already-claimed free asset changed the allowance");
}

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
  kind: "image", title: `Free offer UAT ${Date.now()}`, description: "UAT seller opt-in", caption: "UAT seller opt-in", rightsStatus: "pending",
  modelReleaseStatus: "not_required", propertyReleaseStatus: "not_required", monetizationModel: "membership", subjectTags: ["landscape"], culturalTags: [], freeDownloadEnabled: true,
};
const upload = await call("/api/assets", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify(uploadBody) });
const uploadResult = await json(upload);
assert(upload.status === 201 && uploadResult.status === "needs_review", `seller free-download opt-in failed: ${upload.status}`);

const videoOptIn = await call("/api/assets", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify({ ...uploadBody, kind: "video", title: `Invalid video UAT ${Date.now()}` }) });
assert(videoOptIn.status === 422, `video free-download opt-in was accepted: ${videoOptIn.status}`);

console.log(JSON.stringify({ ok: true, base, buyer: buyer.id, freeCandidates: freeAssets.length, allowance: { limit: allowance.limit, usedAtStart, usedAfterTwo: afterSecond.used, remainingAfterTwo: afterSecond.remaining }, plans: subscription.plans.map((plan) => plan.id), annualCheckoutStatus: subscriptionCheckoutStatus, bundleCheckoutStatus, sellerOptInStatus: upload.status, videoOptInStatus: videoOptIn.status }, null, 2));
