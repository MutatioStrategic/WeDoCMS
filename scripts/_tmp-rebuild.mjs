const base = "https://veld-archive-api.blewisorlando.workers.dev";
(async () => {
  const login = await fetch(base + "/api/auth/dev-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "admin" }),
  });
  const lb = await login.json();
  if (!login.ok) { console.log("LOGIN FAILED", login.status, JSON.stringify(lb)); process.exit(1); }
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const h = { "Content-Type": "application/json", "Cookie": cookie, "X-CSRF-Token": lb.csrfToken };
  const rebuild = await fetch(base + "/api/admin/photo-index/rebuild", { method: "POST", headers: h, body: "{}" });
  const rb = await rebuild.json().catch(() => ({}));
  console.log("REBUILD", rebuild.status, JSON.stringify(rb));
})().catch((e) => { console.error("ERR", e); process.exit(1); });
