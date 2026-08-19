const baseUrl = (process.env.E2E_BASE_URL ?? "https://veld-archive-api.blewisorlando.workers.dev").replace(/\/$/, "");
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
const login = await call("/api/auth/dev-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "admin" }) });
if (!login.ok) throw new Error(`Login failed: HTTP ${login.status}`);
csrfToken = String((await login.json()).csrfToken ?? "");
const jobsResponse = await call("/api/admin/photo-jobs?status=needs_review");
if (!jobsResponse.ok) throw new Error(`Photo job list failed: HTTP ${jobsResponse.status}`);
const jobsBody = await jobsResponse.json();
const jobs = jobsBody.results.filter((job) => job.operation === "enrich" && String(job.title ?? "").startsWith("photo-"));
let queued = 0;
for (const job of jobs) {
  const response = await call(`/api/admin/photo-jobs/${encodeURIComponent(job.id)}/re-enrich`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation: "re-enrich" }),
  });
  if (response.ok) queued += 1;
  else console.error(`Could not queue ${job.id}: HTTP ${response.status} ${await response.text()}`);
}
console.log(JSON.stringify({ candidates: jobs.length, queued }, null, 2));
