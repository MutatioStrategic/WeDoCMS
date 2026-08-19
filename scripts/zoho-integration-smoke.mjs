import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";

const failures = [];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const state = {
  requests: [],
  tokenExchanges: 0,
  crmUpserts: 0,
  flowCalls: { social: 0, desk: 0, campaigns: 0, analytics: 0 },
  failFirstCrm: true,
  failFirstAnalytics: true,
};

function jsonResponse(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  response.end(payload);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

const provider = http.createServer(async (request, response) => {
  const body = await readBody(request);
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  state.requests.push({ method: request.method, path: url.pathname, body });

  if (url.pathname === "/oauth/v2/token" && request.method === "POST") {
    state.tokenExchanges += 1;
    if (String(body?.code ?? "") === "bad-code") return jsonResponse(response, 400, { error: "invalid_code" });
    return jsonResponse(response, 200, { access_token: `access-${state.tokenExchanges}`, refresh_token: "tenant-refresh-token", api_domain: `http://${request.headers.host}`, expires_in: 3600, scope: "ZohoCRM.modules.ALL" });
  }

  if (url.pathname === "/crm/v8/settings/modules" && request.method === "GET") {
    return jsonResponse(response, 200, { modules: [{ api_name: "Campaigns", module_name: "Campaigns", creatable: true, editable: true }] });
  }
  if (url.pathname === "/crm/v8/settings/fields" && request.method === "GET") {
    return jsonResponse(response, 200, { fields: [
      { api_name: "External_ID", field_label: "External ID", data_type: "text", system_mandatory: false },
      { api_name: "Campaign_Name", field_label: "Campaign Name", data_type: "text", system_mandatory: true },
      { api_name: "Description", field_label: "Description", data_type: "textarea", system_mandatory: false },
    ] });
  }
  if (url.pathname === "/crm/v8/Campaigns/upsert" && request.method === "POST") {
    state.crmUpserts += 1;
    if (state.failFirstCrm) {
      state.failFirstCrm = false;
      return jsonResponse(response, 500, { code: "mock_transient_failure" });
    }
    return jsonResponse(response, 200, { data: [{ status: "success", details: { id: `crm-record-${state.crmUpserts}` } }] });
  }

  const flowMatch = url.pathname.match(/^\/flow\/(social|desk|campaigns|analytics)$/);
  if (flowMatch && request.method === "POST") {
    const flow = flowMatch[1];
    state.flowCalls[flow] += 1;
    if (flow === "analytics" && state.failFirstAnalytics) {
      state.failFirstAnalytics = false;
      // Simulate a provider/network outcome that cannot be classified as
      // accepted or rejected by the caller.
      request.socket.destroy();
      return;
    }
    return jsonResponse(response, 200, { id: `${flow}-handoff-${state.flowCalls[flow]}` });
  }
  return jsonResponse(response, 404, { error: "mock_not_found", path: url.pathname });
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function waitForExit(processHandle) {
  return new Promise((resolve) => processHandle.once("exit", resolve));
}

async function waitFor(check, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
      last = "condition returned false";
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${label} timed out (${last ?? "no result"})`);
}

const providerPort = await listen(provider);
const providerUrl = `http://127.0.0.1:${providerPort}`;
const workerPort = 18787 + Math.floor(Math.random() * 400);
const workerUrl = `http://127.0.0.1:${workerPort}`;
const persistPath = mkdtempSync(join(tmpdir(), "veld-zoho-smoke-"));
const quoteArg = (value) => /\s/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
const npx = "npx";
const runNpx = (args, options = {}) => process.platform === "win32"
  ? execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `npx ${args.map(quoteArg).join(" ")}`], options)
  : execFileSync(npx, args, options);
runNpx(["wrangler", "d1", "migrations", "apply", "veld-archive", "--local", "--persist-to", persistPath], { cwd: process.cwd(), stdio: "pipe" });
const workerArgs = [
  "wrangler", "dev", "--local", "--ip", "127.0.0.1", "--port", String(workerPort), "--persist-to", persistPath,
  "--var", `APP_PUBLIC_URL:${workerUrl}`,
  "--var", `SESSION_SECRET:zoho-smoke-session-secret-long-enough`,
  "--var", `ZOHO_ACCOUNTS_URL:${providerUrl}`,
  "--var", `ZOHO_API_DOMAIN:${providerUrl}`,
  "--var", "ZOHO_CLIENT_ID:zoho-smoke-client",
  "--var", "ZOHO_CLIENT_SECRET:zoho-smoke-client-secret",
  "--var", "ZOHO_TOKEN_ENCRYPTION_KEY:zoho-smoke-token-encryption-key",
  "--var", "ZOHO_CRM_MODULE:Campaigns",
  "--var", "ZOHO_CRM_EXTERNAL_FIELD:External_ID",
  "--var", "ZOHO_CRM_NAME_FIELD:Campaign_Name",
  "--var", "ZOHO_CRM_DESCRIPTION_FIELD:Description",
  "--var", `ZOHO_SOCIAL_FLOW_WEBHOOK_URL:${providerUrl}/flow/social`,
  "--var", `ZOHO_DESK_FLOW_WEBHOOK_URL:${providerUrl}/flow/desk`,
  "--var", `ZOHO_CAMPAIGNS_FLOW_WEBHOOK_URL:${providerUrl}/flow/campaigns`,
  "--var", `ZOHO_ANALYTICS_FLOW_WEBHOOK_URL:${providerUrl}/flow/analytics`,
];
const worker = process.platform === "win32"
  ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `npx ${workerArgs.map(quoteArg).join(" ")}`], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] })
  : spawn(npx, workerArgs, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
let workerOutput = "";
worker.stdout.on("data", (chunk) => { workerOutput += chunk.toString(); });
worker.stderr.on("data", (chunk) => { workerOutput += chunk.toString(); });

let cookie = "";
let csrf = "";
function rememberCookie(response) {
  const setCookie = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") ?? ""];
  const session = setCookie.find((value) => value.startsWith("va_session="));
  if (session) cookie = session.split(";", 1)[0];
}

async function call(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(`${workerUrl}${path}`, { ...init, headers, redirect: "manual" });
  rememberCookie(response);
  let body = null;
  const text = await response.text();
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

async function runScheduledDispatch() {
  await fetch(`${workerUrl}/cdn-cgi/local/scheduled`);
}

async function pollJob(jobId, expected) {
  await runScheduledDispatch();
  return waitFor(async () => {
    const result = await call("/api/integrations/zoho/outbox");
    const job = result.body?.results?.find((item) => item.id === jobId);
    return job?.status === expected ? job : false;
  }, `outbox job ${jobId} -> ${expected}`);
}

try {
  await waitFor(async () => (await fetch(`${workerUrl}/api/health`)).ok, "Worker health");

  const unauthenticated = await call("/api/integrations/zoho/status");
  assert(unauthenticated.response.status === 401, "Zoho status must require authentication");

  const login = await call("/api/auth/dev-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "admin" }) });
  assert(login.response.ok && login.body?.csrfToken, `admin login failed: ${login.response.status}`);
  csrf = login.body.csrfToken;
  const mutationHeaders = { "Content-Type": "application/json", "X-CSRF-Token": csrf };

  const statusBefore = await call("/api/integrations/zoho/status");
  assert(statusBefore.response.ok && statusBefore.body.connection === null, "initial Zoho status should not expose a connection");

  // Create the campaign before connecting Zoho so this test isolates the
  // explicit CRM route from the automatic campaign-created correlation event.
  const campaignCreate = await call("/api/campaigns", { method: "POST", headers: mutationHeaders, body: JSON.stringify({ name: `Zoho smoke ${Date.now()}`, brief: "A Cape Town campaign for commercial social use", platforms: ["instagram", "linkedin"] }) });
  assert(campaignCreate.response.status === 201, `campaign creation failed: ${campaignCreate.response.status}`);
  const campaignId = campaignCreate.body.id;
  const rights = await call("/api/rights/takedown", { method: "POST", headers: mutationHeaders, body: JSON.stringify({ assetId: "asset-table-mountain", reason: "metadata", summary: "The metadata requires editorial review before external publication." }) });
  assert(rights.response.status === 201, `rights case creation failed: ${rights.response.status}`);

  const start = await call("/api/integrations/zoho/connect/start", { method: "POST", headers: mutationHeaders, body: JSON.stringify({}) });
  assert(start.response.status === 201 && start.body.authorizationUrl, `OAuth start failed: ${start.response.status}`);
  const authorization = new URL(start.body.authorizationUrl);
  assert(authorization.pathname === "/oauth/v2/auth" && authorization.searchParams.get("state"), "OAuth authorization contract missing state");
  const stateToken = authorization.searchParams.get("state");

  const invalidCallback = await call("/api/integrations/zoho/oauth/callback?code=auth-code");
  assert(invalidCallback.response.status === 400, "OAuth callback must reject missing state");
  const callback = await call(`/api/integrations/zoho/oauth/callback?code=auth-code&state=${encodeURIComponent(stateToken)}`);
  assert(callback.response.status === 302 && callback.response.headers.get("location")?.includes("zoho=connected"), `OAuth callback failed: ${callback.response.status}`);
  const replay = await call(`/api/integrations/zoho/oauth/callback?code=auth-code&state=${encodeURIComponent(stateToken)}`);
  assert(replay.response.status === 400, "OAuth state must be single-use");

  const statusAfter = await call("/api/integrations/zoho/status");
  assert(statusAfter.response.ok && statusAfter.body.connection?.status === "active", "tenant Zoho connection was not stored as active");
  assert(!JSON.stringify(statusAfter.body).includes("tenant-refresh-token"), "refresh token leaked through status response");

  const validation = await call("/api/integrations/zoho/crm/validate", { method: "POST", headers: mutationHeaders, body: JSON.stringify({}) });
  assert(validation.response.ok && validation.body.status === "valid", `CRM metadata validation failed: ${validation.response.status}`);

  const crmQueue = await call(`/api/campaigns/${campaignId}/integrations/zoho/crm`, { method: "POST", headers: mutationHeaders, body: JSON.stringify({}) });
  assert([200, 202].includes(crmQueue.response.status) && crmQueue.body.jobId, `CRM route did not expose a job: ${crmQueue.response.status} ${JSON.stringify(crmQueue.body)}`);
  const crmJobId = crmQueue.body.jobId;
  const crmFailed = await pollJob(crmJobId, "failed");
  assert(crmFailed.attempts >= 1 && state.crmUpserts === 1, "CRM transient failure was not recorded");
  const crmRetry = await call(`/api/integrations/zoho/outbox/${crmJobId}/retry`, { method: "POST", headers: mutationHeaders });
  assert(crmRetry.response.status === 202, `CRM manual retry failed: ${crmRetry.response.status}`);
  await pollJob(crmJobId, "succeeded");
  assert(state.crmUpserts === 2, "CRM retry did not make the second provider call");
  const crmReplay = await call(`/api/campaigns/${campaignId}/integrations/zoho/crm`, { method: "POST", headers: mutationHeaders, body: JSON.stringify({}) });
  assert(crmReplay.response.ok && ["already_synced", "already_queued"].includes(crmReplay.body.status), "CRM replay was not idempotent");

  const deskQueue = await call(`/api/rights/cases/${rights.body.id}/integrations/zoho/desk`, { method: "POST", headers: mutationHeaders });
  assert([200, 202].includes(deskQueue.response.status) && deskQueue.body.jobId, `Desk route did not queue: ${deskQueue.response.status}`);
  await pollJob(deskQueue.body.jobId, "succeeded");
  assert(state.flowCalls.desk >= 1, "Desk provider was not called");

  const analytics = await call("/api/analytics/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: true, type: "asset_view", assetId: "asset-table-mountain", country: "ZA", province: "Western Cape", city: "Cape Town" }) });
  assert(analytics.response.status === 202, `analytics event failed: ${analytics.response.status}`);
  await runScheduledDispatch();
  const analyticsJob = await waitFor(async () => {
    const outbox = await call("/api/integrations/zoho/outbox");
    return outbox.body?.results?.find((item) => item.app === "analytics" && item.entityId === "asset-table-mountain") ?? false;
  }, "analytics outbox job");
  await pollJob(analyticsJob.id, "unknown");
  const analyticsRetry = await call(`/api/integrations/zoho/outbox/${analyticsJob.id}/retry`, { method: "POST", headers: mutationHeaders });
  assert(analyticsRetry.response.status === 202, `analytics unknown retry failed: ${analyticsRetry.response.status}`);
  await pollJob(analyticsJob.id, "succeeded");
  assert(state.flowCalls.analytics === 2, "analytics unknown outcome was not reconciled with one explicit retry");

  const social = await call(`/api/campaigns/${campaignId}/integrations/zoho/social`, { method: "POST", headers: mutationHeaders, body: JSON.stringify({ copy: "Smoke test", channels: ["instagram"] }) });
  assert([202, 422].includes(social.response.status), `Social route returned unexpected status: ${social.response.status}`);
  const outbox = await call("/api/integrations/zoho/outbox");
  assert(outbox.response.ok && outbox.body.results.length >= 4, "outbox endpoint did not expose correlated delivery jobs");

  const expectedPaths = ["/oauth/v2/token", "/crm/v8/settings/modules", "/crm/v8/settings/fields", "/crm/v8/Campaigns/upsert", "/flow/desk", "/flow/analytics"];
  for (const path of expectedPaths) assert(state.requests.some((request) => request.path === path), `mock Zoho server did not receive ${path}`);
  console.log(JSON.stringify({ ok: true, workerUrl, providerUrl, checks: ["auth", "oauth-state", "tenant-encryption-boundary", "crm-metadata", "crm-retry", "crm-idempotency", "desk-delivery", "analytics-unknown-reconciliation", "social-rights-guard", "outbox-listing"], providerRequests: state.requests.length, crmUpserts: state.crmUpserts, flowCalls: state.flowCalls }, null, 2));
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
  console.error(JSON.stringify({ ok: false, failures, workerOutput: workerOutput.slice(-12000), providerRequests: state.requests }, null, 2));
  process.exitCode = 1;
} finally {
  provider.close();
  if (process.platform === "win32" && worker.pid) {
    try { execFileSync("taskkill", ["/PID", String(worker.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* process may already have exited */ }
  } else {
    worker.kill();
  }
  await waitForExit(worker).catch(() => undefined);
  try { rmSync(persistPath, { recursive: true, force: true }); } catch { /* Windows can release the SQLite file slightly after exit */ }
}
