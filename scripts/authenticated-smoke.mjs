const baseUrl = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const smokeAssetId = process.env.SMOKE_ASSET_ID ?? "asset-demo-table-mountain";
let cookie = "";

function rememberCookie(response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") ?? ""];
  const session = values.find((value) => value.startsWith("va_session="));
  if (session) cookie = session.split(";", 1)[0];
}

async function call(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  rememberCookie(response);
  return response;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const unauthenticated = await call("/api/me");
assert(unauthenticated.ok && (await unauthenticated.json()).authenticated === false, "unauthenticated session check failed");
const authConfig = await call("/api/auth/config");
const authConfigBody = await authConfig.json();
assert(authConfig.ok && ["supabase", "demo", "unavailable"].includes(authConfigBody.provider) && typeof authConfigBody.redirectUrl === "string", "auth configuration contract failed");
if (authConfigBody.provider === "supabase") assert(typeof authConfigBody.publishableKey === "string" && authConfigBody.publishableKey.length > 0, "Supabase auth configuration omitted the publishable key");
const publicDiscovery = await call("/api/discovery");
assert(publicDiscovery.ok && Array.isArray((await publicDiscovery.json()).trending), "public trending discovery failed");

const login = await call("/api/auth/dev-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "contributor" }) });
assert(login.ok, `dev login failed with ${login.status}`);
const loginBody = await login.json();
assert(loginBody.user?.organizationId && loginBody.csrfToken, "login did not return organization and CSRF context");

const me = await call("/api/me", { headers: { "x-user-id": "demo-admin", "x-user-role": "admin" } });
const meBody = await me.json();
assert(me.ok && meBody.user.id === loginBody.user.id && meBody.user.role === "contributor", "spoofable identity headers changed the authenticated identity");

const members = await call("/api/organization/members");
assert(members.status === 403, "non-admin organization member listing was allowed");
const contributorReview = await call("/api/admin/review");
assert(contributorReview.status === 403, "contributor reached the editor review queue");
const contributorBuyerKeys = await call("/api/buyer-api-keys");
assert(contributorBuyerKeys.status === 403, "contributor reached the buyer API-key workspace");

const publicOrigin = await fetch(`${baseUrl}/api/health`, { headers: { Origin: "https://untrusted.example" } });
assert(!publicOrigin.headers.has("access-control-allow-origin"), "untrusted CORS origin was allowed");

const uploadWithoutSession = await fetch(`${baseUrl}/api/uploads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: "x.jpg", contentType: "image/jpeg", sizeBytes: 10 }) });
assert(uploadWithoutSession.status === 401, `unauthenticated upload was not denied: ${uploadWithoutSession.status}`);

const missingCsrf = await call("/api/onboarding", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
assert(missingCsrf.status === 403, "cookie-authenticated mutation without CSRF protection was allowed");

const cases = await call("/api/rights/cases");
assert(cases.ok, "authenticated rights-case listing failed");

const lightboxes = await call("/api/lightboxes");
assert(lightboxes.ok && Array.isArray((await lightboxes.clone().json()).results), "authenticated lightbox listing failed");
const lightboxName = `Smoke ${Date.now()}`;
const createdLightbox = await call("/api/lightboxes", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": loginBody.csrfToken }, body: JSON.stringify({ name: lightboxName }) });
assert(createdLightbox.status === 201, `lightbox creation failed: ${createdLightbox.status}`);
const lightbox = await createdLightbox.json();
const savedAsset = await call(`/api/lightboxes/${lightbox.id}/assets`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": loginBody.csrfToken }, body: JSON.stringify({ assetId: smokeAssetId }) });
assert(savedAsset.ok, `lightbox asset save failed: ${savedAsset.status}`);
const lightboxAfterSave = await call("/api/lightboxes");
const savedLightbox = (await lightboxAfterSave.json()).results.find((item) => item.id === lightbox.id);
assert(savedLightbox?.assetIds?.includes(smokeAssetId), "saved asset was not returned in lightbox listing");
const shareLink = await call(`/api/lightboxes/${lightbox.id}/share-link`, { method: "POST", headers: { "X-CSRF-Token": loginBody.csrfToken } });
assert(shareLink.status === 201, `lightbox share link failed: ${shareLink.status}`);
const shareBody = await shareLink.json();
const sharedView = await call(shareBody.shareUrl);
assert(sharedView.ok && Array.isArray((await sharedView.json()).results), "shared lightbox view failed");
const removedAsset = await call(`/api/lightboxes/${lightbox.id}/assets/${smokeAssetId}`, { method: "DELETE", headers: { "X-CSRF-Token": loginBody.csrfToken } });
assert(removedAsset.ok, `lightbox asset removal failed: ${removedAsset.status}`);
const deletedLightbox = await call(`/api/lightboxes/${lightbox.id}`, { method: "DELETE", headers: { "X-CSRF-Token": loginBody.csrfToken } });
assert(deletedLightbox.ok, `lightbox deletion failed: ${deletedLightbox.status}`);

const savedSearchName = `Cape Town smoke ${Date.now()}`;
const createdSearch = await call("/api/saved-searches", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": loginBody.csrfToken }, body: JSON.stringify({ name: savedSearchName, query: "Cape Town", mediaKind: "image", alertFrequency: "weekly" }) });
assert(createdSearch.status === 201, `saved search creation failed: ${createdSearch.status}`);
const savedSearch = await createdSearch.json();
const personalizedDiscovery = await call("/api/discovery");
const personalizedBody = await personalizedDiscovery.json();
assert(personalizedDiscovery.ok && personalizedBody.savedSearches.some((item) => item.id === savedSearch.id), "saved search was not returned by discovery");
const deletedSearch = await call(`/api/saved-searches/${savedSearch.id}`, { method: "DELETE", headers: { "X-CSRF-Token": loginBody.csrfToken } });
assert(deletedSearch.ok, `saved search deletion failed: ${deletedSearch.status}`);

const campaignName = `Integrated campaign ${Date.now()}`;
const createdCampaign = await call("/api/campaigns", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": loginBody.csrfToken }, body: JSON.stringify({ name: campaignName, brief: "Cape Town travel campaign for social and web use with commercial rights", platforms: ["instagram", "website"] }) });
assert(createdCampaign.status === 201, `campaign creation failed: ${createdCampaign.status}`);
const campaign = await createdCampaign.json();
const stagedAsset = await call(`/api/campaigns/${campaign.id}/assets`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": loginBody.csrfToken }, body: JSON.stringify({ assetId: smokeAssetId, stage: "approved", note: "Approved by the integrated smoke path" }) });
assert(stagedAsset.ok, `campaign asset staging failed: ${stagedAsset.status}`);
const campaignDetail = await call(`/api/campaigns/${campaign.id}`);
const campaignDetailBody = await campaignDetail.json();
assert(campaignDetail.ok && Array.isArray(campaignDetailBody.assets) && Array.isArray(campaignDetailBody.recommendations) && campaignDetailBody.assets.some((asset) => asset.id === smokeAssetId && asset.campaignStage === "approved"), "consolidated campaign detail did not expose CMS assets and recommendations");
const campaignManifest = await call(`/api/campaigns/${campaign.id}/manifest`);
const manifestBody = await campaignManifest.json();
assert(campaignManifest.ok && manifestBody.manifestVersion === "3A" && manifestBody.auditTrail?.approvedCount === 1, "campaign manifest did not include the approved asset and audit summary");

const logout = await call("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": loginBody.csrfToken } });
assert(logout.ok, "logout failed");
const afterLogout = await call("/api/me");
assert(afterLogout.ok && (await afterLogout.json()).authenticated === false, "revoked session remained active");

for (const role of ["buyer", "editor", "admin"]) {
  cookie = "";
  const roleLogin = await call("/api/auth/dev-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
  assert(roleLogin.ok, `${role} dev login failed with ${roleLogin.status}`);
  const roleBody = await roleLogin.json();
  assert(roleBody.user?.role === role, `${role} login returned ${roleBody.user?.role ?? "no role"}`);

  const review = await call("/api/admin/review");
  assert(role === "editor" || role === "admin" ? review.ok : review.status === 403, `${role} editor-review permission was incorrect`);
  const buyerKeys = await call("/api/buyer-api-keys");
  assert(role === "buyer" || role === "admin" ? buyerKeys.ok : buyerKeys.status === 403, `${role} buyer-workspace permission was incorrect`);
  const organizationMembers = await call("/api/organization/members");
  assert(role === "editor" || role === "admin" ? organizationMembers.ok : organizationMembers.status === 403, `${role} organization-admin permission was incorrect`);

  const roleLogout = await call("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": roleBody.csrfToken } });
  assert(roleLogout.ok, `${role} logout failed`);
}

console.log(JSON.stringify({ ok: true, baseUrl, checks: ["session", "header-spoofing", "role-matrix", "org-rbac", "cors", "upload-auth", "csrf", "rights", "lightboxes", "lightbox-sharing", "discovery", "saved-searches", "campaign-cms", "campaign-manifest", "logout"], roles: ["buyer", "contributor", "editor", "admin"] }, null, 2));
