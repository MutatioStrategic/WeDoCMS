import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import newman from "newman";

const root = process.cwd();
const readEnvFile = async (filePath) => {
  const content = await fs.readFile(filePath, "utf8").catch(() => "");
  return Object.fromEntries(content.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, "")]] : [];
  }));
};
const desktopEnv = await readEnvFile(path.join(root, ".env.local"));
const mobileEnv = await readEnvFile(path.join(root, "apps/mobile/.env.local"));
const envValue = (name) => process.env[name]?.trim() || desktopEnv[name]?.trim() || mobileEnv[name]?.trim() || "";
const desktopUrl = (process.env.POSTMAN_DESKTOP_URL ?? "https://veld-archive.pages.dev").replace(/\/$/, "");
const configuredApiBaseUrl = envValue("VITE_API_BASE_URL");
const baseUrl = (process.env.POSTMAN_BASE_URL ?? (configuredApiBaseUrl.startsWith("http") ? configuredApiBaseUrl : "https://veld-archive-api.blewisorlando.workers.dev")).replace(/\/$/, "");
const signupBoundaryEnabled = process.env.POSTMAN_SKIP_SUPABASE !== "true";
const source = await fs.readFile(path.join(root, "src/worker/index.ts"), "utf8");
const routes = [...source.matchAll(/app\.(get|post|put|patch|delete|options)\("([^"]+)"/g)]
  .map((match) => ({ method: match[1].toUpperCase(), path: match[2] }))
  .filter((route) => route.path.startsWith("/api/"));

const replacementFor = (name) => ({
  id: "asset-table-mountain",
  assetId: "asset-table-mountain",
  slug: "table-mountain",
  streamId: "postman-missing-stream",
  token: "postman-missing-token",
  caseId: "postman-missing-case",
  documentId: "postman-missing-document",
  exportId: "postman-missing-export",
  uploadId: "postman-missing-upload",
  licenceId: "postman-missing-licence",
  walletId: "postman-missing-wallet",
  jobId: "postman-missing-job",
  forumId: "postman-missing-forum",
  threadId: "postman-missing-thread",
  postId: "postman-missing-post",
}[name] ?? `postman-missing-${name}`);

function concretePath(routePath) {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, (_, name) => replacementFor(name));
}

function bodyFor(route) {
  const pathname = route.path;
  if (route.method === "POST" && pathname === "/api/auth/dev-login") return { role: "contributor" };
  if (route.method === "POST" && pathname === "/api/auth/demo-login") return { role: "contributor" };
  if (route.method === "POST" && pathname === "/api/auth/exchange") return { sessionTransport: "bearer" };
  if (route.method === "POST" && pathname === "/api/search/visual") return { query: "South Africa" };
  if (route.method === "POST" && pathname === "/api/checkout/validate") return { assetId: "asset-table-mountain", licenceProduct: "editorial" };
  if (route.method === "POST" && pathname === "/api/checkout") return { assetId: "asset-table-mountain", licenceProduct: "editorial" };
  if (route.method === "POST" && pathname === "/api/analytics/events") return { eventType: "postman_route_sweep", payload: {} };
  if (route.method === "POST" && pathname === "/api/security/turnstile") return { token: "postman-test-token" };
  if (route.method === "POST" && pathname.startsWith("/api/webhooks/")) return {};
  if (["POST", "PUT", "PATCH"].includes(route.method)) return {};
  return undefined;
}

const requestTest = `
pm.test("${routes.length} registered routes are being exercised", () => pm.expect(pm.collectionVariables.get("routeCount")).to.eql("${routes.length}"));
pm.test("route does not return an unhandled server error", () => {
  const status = pm.response.code;
  if (status >= 500) console.log(JSON.stringify({ route: pm.request.method + " " + pm.request.url.toString(), status, body: pm.response.text().slice(0, 500) }));
  pm.expect(status === 503 || status < 500, pm.request.method + " " + pm.request.url.toString()).to.eql(true);
});
if (pm.request.url.toString().includes('/api/auth/dev-login') || pm.request.url.toString().includes('/api/auth/demo-login')) {
  const body = pm.response.json();
  if (body.sessionToken) pm.collectionVariables.set('sessionToken', body.sessionToken);
  if (body.csrfToken) pm.collectionVariables.set('csrfToken', body.csrfToken);
}
`;

const routeItems = routes.map((route) => {
  const body = bodyFor(route);
  const headers = [{ key: "Accept", value: "application/json" }];
  if (body !== undefined) headers.push({ key: "Content-Type", value: "application/json" });
  if (route.method !== "GET" && route.method !== "HEAD" && route.method !== "OPTIONS") {
    headers.push({ key: "Authorization", value: "VeldSession {{sessionToken}}" });
    headers.push({ key: "X-CSRF-Token", value: "{{csrfToken}}" });
  }
  return {
    name: `${route.method} ${route.path}`,
    request: {
      method: route.method,
      header: headers,
      url: { raw: `{{baseUrl}}${concretePath(route.path)}`, host: ["{{baseUrl}}"], path: concretePath(route.path).split("/").filter(Boolean) },
      ...(body === undefined ? {} : { body: { mode: "raw", raw: JSON.stringify(body) } }),
    },
    event: [{ listen: "test", script: { type: "text/javascript", exec: requestTest.split("\n") } }],
  };
});

const desktopShellItem = {
  name: "Desktop web shell",
  request: {
    method: "GET",
    header: [{ key: "Accept", value: "text/html" }],
    url: { raw: "{{desktopUrl}}/", host: ["{{desktopUrl}}"], path: [] },
  },
  event: [{ listen: "test", script: { type: "text/javascript", exec: [
    "pm.test('desktop web shell is available', () => pm.expect(pm.response.code).to.be.below(500));",
    "pm.test('desktop web shell returns HTML', () => pm.expect(pm.response.headers.get('content-type') || '').to.include('text/html'));",
  ] } }],
};

const signupBoundaryItems = signupBoundaryEnabled ? [
    {
      name: "Supabase signup boundary",
      request: {
        method: "POST",
        header: [
          { key: "apikey", value: "{{supabasePublishableKey}}" },
          { key: "Authorization", value: "Bearer {{supabasePublishableKey}}" },
          { key: "Content-Type", value: "application/json" },
          { key: "Accept", value: "application/json" },
        ],
        body: { mode: "raw", raw: JSON.stringify({ email: "{{testEmail}}", password: "{{testPassword}}", data: { display_name: "Postman Route Sweep" } }) },
        url: { raw: "{{supabaseUrl}}/auth/v1/signup", host: ["{{supabaseUrl}}"], path: ["auth", "v1", "signup"] },
      },
      event: [{ listen: "test", script: { type: "text/javascript", exec: [
        "const status = pm.response.code;",
        "if (typeof status !== 'number' || status < 100) pm.test('Supabase signup returned an HTTP response', () => pm.expect.fail('No HTTP response: ' + (pm.request.error?.message || 'request failed')));",
        "else { pm.test('Supabase signup is not a gateway timeout', () => pm.expect(status).to.not.eql(504)); pm.test('Supabase signup returns JSON', () => pm.response.to.have.jsonBody()); const body = pm.response.json(); if (body.access_token) pm.collectionVariables.set('identityToken', body.access_token); console.log(JSON.stringify({ boundary: 'supabase-signup', status, error: body.error_description || body.msg || body.message || null, session: Boolean(body.access_token) })); }",
      ] } }],
    },
] : [];

const collection = {
  info: {
    name: "Veld Archive — Postman route and signup sweep",
    _postman_id: "veld-archive-route-sweep",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  event: [{ listen: "prerequest", script: { type: "text/javascript", exec: [
    "pm.collectionVariables.set('routeCount', '" + routes.length + "');",
    "if (!pm.collectionVariables.get('testEmail')) pm.collectionVariables.set('testEmail', 'postman-smoke-' + Date.now() + '@example.com');",
  ] } }],
  variable: [
    { key: "baseUrl", value: baseUrl },
    { key: "desktopUrl", value: desktopUrl },
    { key: "supabaseUrl", value: process.env.POSTMAN_SUPABASE_URL ?? (envValue("VITE_SUPABASE_URL") || envValue("EXPO_PUBLIC_SUPABASE_URL") || "https://fmqwymgmrkrnfkugogbw.supabase.co") },
    { key: "supabasePublishableKey", value: process.env.POSTMAN_SUPABASE_PUBLISHABLE_KEY ?? (envValue("VITE_SUPABASE_PUBLISHABLE_KEY") || envValue("VITE_SUPABASE_ANON_KEY") || envValue("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY") || envValue("EXPO_PUBLIC_SUPABASE_ANON_KEY")) },
    { key: "testEmail", value: "" },
    { key: "testPassword", value: process.env.POSTMAN_TEST_PASSWORD ?? "PostmanSmoke-ChangeMe-2026!" },
    { key: "sessionToken", value: "" },
    { key: "csrfToken", value: "" },
  ],
  item: [
    desktopShellItem,
    ...signupBoundaryItems,
    {
      name: "Veld identity exchange",
      request: {
        method: "POST",
        header: [
          { key: "Authorization", value: "Bearer {{identityToken}}" },
          { key: "Content-Type", value: "application/json" },
          { key: "Accept", value: "application/json" },
        ],
        body: { mode: "raw", raw: JSON.stringify({ sessionTransport: "bearer", accountIntent: "seller" }) },
        url: { raw: "{{baseUrl}}/api/auth/exchange", host: ["{{baseUrl}}"], path: ["api", "auth", "exchange"] },
      },
      event: [{ listen: "test", script: { type: "text/javascript", exec: [
        "pm.test('identity exchange has no gateway timeout', () => pm.expect(pm.response.code).to.not.eql(504));",
        "if (pm.response.code < 300) { const body = pm.response.json(); pm.collectionVariables.set('sessionToken', body.sessionToken || ''); pm.collectionVariables.set('csrfToken', body.csrfToken || ''); }",
      ] } }],
    },
    ...routeItems,
  ],
};

console.log(JSON.stringify({ baseUrl, desktopUrl, routeCount: routes.length, signupBoundary: signupBoundaryEnabled }, null, 2));
await new Promise((resolve, reject) => {
  newman.run({ collection, reporters: ["cli"], timeoutRequest: 20000, bail: false }, (error, summary) => {
    if (error) return reject(error);
    const failures = summary.run?.failures ?? [];
    if (failures.length) {
      console.error(JSON.stringify({ failures: failures.map((failure) => ({ name: failure.source?.name, error: failure.error?.message })) }, null, 2));
      process.exitCode = 1;
    }
    resolve();
  });
});
