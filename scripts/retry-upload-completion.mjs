const baseUrl = (process.env.E2E_BASE_URL ?? "https://veld-archive-api.blewisorlando.workers.dev").replace(/\/$/, "");
const uploadId = process.argv[2];
if (!uploadId) throw new Error("Usage: node scripts/retry-upload-completion.mjs <uploadId>");
let cookie = "";
let csrfToken = "";
function rememberCookie(response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") ?? ""];
  const session = values.find((value) => value.startsWith("va_session="));
  if (session) cookie = session.split(";", 1)[0];
}
async function call(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (cookie) headers.set("Cookie", cookie);
  if (csrfToken && init.method && init.method !== "GET") headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  rememberCookie(response);
  return response;
}
const login = await call("/api/auth/dev-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "contributor" }) });
if (!login.ok) throw new Error(`Login failed: HTTP ${login.status}`);
csrfToken = String((await login.json()).csrfToken ?? "");
const complete = await call(`/api/uploads/${encodeURIComponent(uploadId)}/complete`, { method: "POST" });
const body = await complete.json();
if (!complete.ok) throw new Error(`Completion failed: HTTP ${complete.status} ${JSON.stringify(body)}`);
console.log(JSON.stringify(body, null, 2));
