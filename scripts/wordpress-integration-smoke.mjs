const baseUrl = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
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

function assert(condition, message) { if (!condition) throw new Error(message); }

const login = await call("/api/auth/dev-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "admin" }) });
assert(login.ok, `admin dev login failed: ${login.status}`);
const loginBody = await login.json();
const siteUrl = `https://wordpress-${Date.now()}.example.test`;
const pairingResponse = await call("/api/integrations/wordpress/pairing", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": loginBody.csrfToken }, body: JSON.stringify({ siteUrl, siteName: "Smoke WordPress" }) });
assert(pairingResponse.status === 201, `pairing creation failed: ${pairingResponse.status}`);
const pairing = await pairingResponse.json();
const exchange = await fetch(`${baseUrl}/api/integrations/wordpress/pairing/exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pairingCode: pairing.pairingCode, siteUrl, siteName: "Smoke WordPress", pluginVersion: "0.1.0" }) });
assert(exchange.status === 201, `pairing exchange failed: ${exchange.status}`);
const connection = await exchange.json();
assert(connection.accessToken && connection.connectionId, "pairing exchange did not return a connector token");
const me = await fetch(`${baseUrl}/api/integrations/wordpress/v1/me`, { headers: { Authorization: `Bearer ${connection.accessToken}` } });
assert(me.ok && (await me.json()).connectionId === connection.connectionId, "connector token could not authenticate");
const assets = await fetch(`${baseUrl}/api/integrations/wordpress/v1/assets?q=mountain`, { headers: { Authorization: `Bearer ${connection.accessToken}` } });
assert(assets.ok && Array.isArray((await assets.json()).results), "connector asset search failed");
const revoked = await call(`/api/integrations/wordpress/connections/${connection.connectionId}/revoke`, { method: "POST", headers: { "X-CSRF-Token": loginBody.csrfToken } });
assert(revoked.ok, `connection revocation failed: ${revoked.status}`);
const afterRevoke = await fetch(`${baseUrl}/api/integrations/wordpress/v1/me`, { headers: { Authorization: `Bearer ${connection.accessToken}` } });
assert(afterRevoke.status === 401, `revoked connector token remained active: ${afterRevoke.status}`);

console.log(JSON.stringify({ ok: true, checks: ["pairing", "single-token-auth", "asset-search", "revocation"], baseUrl }, null, 2));
