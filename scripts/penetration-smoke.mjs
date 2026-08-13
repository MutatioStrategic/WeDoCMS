const baseUrl = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
let cookie = "";
function remember(response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") ?? ""];
  const session = values.find((value) => value.startsWith("va_session="));
  if (session) cookie = session.split(";", 1)[0];
}
async function call(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  remember(response);
  return response;
}
function assert(condition, message) { if (!condition) throw new Error(message); }

const health = await fetch(`${baseUrl}/api/health`);
assert(health.headers.get("content-security-policy")?.includes("default-src 'self'"), "CSP header missing");
assert(health.headers.get("x-content-type-options") === "nosniff", "content sniffing protection missing");
assert(health.headers.get("x-frame-options") === "DENY", "frame protection missing");

const invalidExchange = await call("/api/auth/exchange", { method: "POST", headers: { Authorization: "Bearer invalid", "Content-Type": "application/json" }, body: "{}" });
assert(invalidExchange.status === 401, `invalid external identity token was accepted: ${invalidExchange.status}`);

const login = await call("/api/auth/dev-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "admin" }) });
assert(login.ok, `admin login failed: ${login.status}`);
const session = await login.json();
const missingCsrf = await call("/api/organization/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "attacker@example.com", role: "buyer" }) });
assert(missingCsrf.status === 403, `mutation without CSRF was accepted: ${missingCsrf.status}`);

const injectionPath = await call("/api/assets?query=%27%20OR%201%3D1--");
assert(injectionPath.ok, `escaped search input caused an unexpected error: ${injectionPath.status}`);
const webhook = await call("/api/webhooks/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "attacker", eventId: "evt-attack", type: "payment_succeeded", licenceId: "licence-1", amountCents: 1, currency: "ZAR" }) });
assert([401, 503].includes(webhook.status), `unsigned payment webhook was accepted: ${webhook.status}`);

await call("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": session.csrfToken } });
console.log(JSON.stringify({ ok: true, checks: ["security-headers", "invalid-token", "csrf", "input-boundary", "unsigned-webhook"] }, null, 2));
