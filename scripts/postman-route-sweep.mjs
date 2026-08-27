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
const exportOnly = process.argv.includes("--export-only");
const desktopUrl = (process.env.POSTMAN_DESKTOP_URL ?? "https://veld-archive.pages.dev").replace(/\/$/, "");
const configuredApiBaseUrl = envValue("VITE_API_BASE_URL");
const defaultApiBaseUrl = exportOnly ? "https://veld-archive-api-demo.blewisorlando.workers.dev" : "https://veld-archive-api-production.blewisorlando.workers.dev";
const baseUrl = (process.env.POSTMAN_BASE_URL ?? (configuredApiBaseUrl.startsWith("http") ? configuredApiBaseUrl : defaultApiBaseUrl)).replace(/\/$/, "");
const assertRunnableUrl = (name, value) => {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${name} is not a valid URL: ${value}`); }
  const hostname = parsed.hostname.toLowerCase();
  const local = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  if (!local && parsed.protocol !== "https:") throw new Error(`${name} must use HTTPS outside local development: ${value}`);
  if (hostname === "archive.example.com" || hostname.endsWith(".example.com") || hostname.endsWith(".example")) {
    throw new Error(`${name} still points at a placeholder host (${hostname}). Select a real Postman environment or set POSTMAN_${name === "POSTMAN_BASE_URL" ? "BASE" : "DESKTOP"}_URL.`);
  }
};
assertRunnableUrl("POSTMAN_BASE_URL", baseUrl);
assertRunnableUrl("POSTMAN_DESKTOP_URL", desktopUrl);
const signupBoundaryEnabled = !exportOnly && process.env.POSTMAN_SKIP_SUPABASE !== "true" && process.env.POSTMAN_RUN_EXTERNAL_WRITES === "true";
const supabasePublishableKey = exportOnly
  ? ""
  : process.env.POSTMAN_SUPABASE_PUBLISHABLE_KEY ?? (envValue("VITE_SUPABASE_PUBLISHABLE_KEY") || envValue("VITE_SUPABASE_ANON_KEY") || envValue("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY") || envValue("EXPO_PUBLIC_SUPABASE_ANON_KEY"));
const testPassword = exportOnly ? "" : process.env.POSTMAN_TEST_PASSWORD ?? "PostmanSmoke-ChangeMe-2026!";
const runWrites = exportOnly ? "false" : process.env.POSTMAN_RUN_WRITES ?? "false";
const runExternalWrites = process.env.POSTMAN_RUN_EXTERNAL_WRITES ?? "false";
const runDemoAuth = process.env.POSTMAN_RUN_DEMO_AUTH ?? (/(-demo\.|localhost|127\.0\.0\.1)/.test(new URL(baseUrl).hostname) ? "true" : "false");
const demoRole = process.env.POSTMAN_DEMO_ROLE ?? "contributor";
const maxResponseTimeMs = process.env.POSTMAN_MAX_RESPONSE_TIME_MS ?? "20000";
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
  if (route.method === "POST" && pathname === "/api/auth/dev-login") return { role: "{{demoRole}}" };
  if (route.method === "POST" && pathname === "/api/auth/demo-login") return { role: "{{demoRole}}" };
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

const sessionRoutes = new Set([
  "/api/auth/dev-login",
  "/api/auth/demo-login",
  "/api/auth/logout",
  "/api/auth/switch-organization",
  "/api/search/visual",
  "/api/checkout/validate",
]);
const sideEffectReadRoutes = new Set([
  "/api/assets/:id/original",
  "/api/demo/payments/:licenceId/complete",
]);

function runModeFor(route) {
  const pathname = route.path;
  if (pathname === "/api/auth/exchange" || pathname.startsWith("/api/webhooks/") || pathname.startsWith("/api/integrations/") || pathname.startsWith("/api/ops/") || pathname === "/api/security/turnstile") return "external";
  if (pathname.startsWith("/api/payments/") || pathname.startsWith("/api/subscription/")) return "external";
  if (sessionRoutes.has(pathname)) return "session";
  if (["GET", "HEAD", "OPTIONS"].includes(route.method) && !sideEffectReadRoutes.has(pathname)) return "read";
  return "write";
}

function groupFor(route) {
  const pathname = route.path;
  if (pathname.startsWith("/api/auth/") || ["/api/me", "/api/notifications", "/api/organization/members", "/api/organization/invitations"].some((prefix) => pathname.startsWith(prefix))) return "01 - Identity and session";
  if (pathname.startsWith("/api/admin/") || pathname.startsWith("/api/governance/") || pathname.startsWith("/api/ops/") || pathname.startsWith("/api/audit/") || pathname.startsWith("/api/verification/")) return "05 - Editorial, governance and administration";
  if (pathname.startsWith("/api/buyer/") || pathname.startsWith("/api/checkout") || pathname.startsWith("/api/payments/") || pathname.startsWith("/api/subscription") || pathname.startsWith("/api/my/licences") || pathname.startsWith("/api/my/purchases") || pathname.startsWith("/api/my/free-downloads") || pathname.startsWith("/api/lightboxes") || pathname.startsWith("/api/licence-products") || pathname.startsWith("/api/analytics/buyer")) return "03 - Buyer, licensing and payments";
  if (pathname.startsWith("/api/onboarding") || pathname.startsWith("/api/uploads") || pathname.startsWith("/api/my/assets") || pathname.startsWith("/api/creators") || pathname.startsWith("/api/analytics/contributor")) return "04 - Contributor and media workflow";
  if (pathname.startsWith("/api/rights/") || pathname.startsWith("/api/community/") || pathname.startsWith("/api/campaign") || pathname.startsWith("/api/forums") || pathname.startsWith("/api/showcases") || pathname.startsWith("/api/collections")) return "06 - Rights, community and campaigns";
  if (pathname.startsWith("/api/integrations/") || pathname.startsWith("/api/webhooks/") || pathname.startsWith("/api/security/") || pathname.includes("/stream-") || pathname.startsWith("/api/stream")) return "07 - Integrations, security and webhooks";
  if (pathname.startsWith("/api/assets") || pathname.startsWith("/api/search") || pathname.startsWith("/api/discovery") || pathname.startsWith("/api/legal") || pathname === "/api/health") return "02 - Catalogue, search and public information";
  return "08 - Other API coverage";
}

function runModeDescription(runMode) {
  if (runMode === "read") return "Runs in the default safe mode.";
  if (runMode === "session") return "Runs in the default safe mode and only changes the demo session or performs a read-only validation.";
  if (runMode === "external") return "Skipped unless runExternalWrites is set to true; it can call an external provider, webhook, payment, or security boundary.";
  return "Skipped unless runWrites is set to true; it can create, update, delete, download an entitlement, or otherwise change demo data.";
}

function routeDescription(route, runMode) {
  return [
    `Route: ${route.method} ${route.path}`,
    "",
    "Automated test points:",
    "- The API returns an HTTP response within the configured response-time budget.",
    "- The route does not return an unhandled 500, 502, or 504 response.",
    "- JSON responses parse successfully; JSON 4xx responses provide an error or recovery message.",
    "- Demo session responses refresh the CSRF token for follow-on mutations.",
    "",
    `Safety gate: ${runModeDescription(runMode)}`,
  ].join("\n");
}

function preRequestFor(runMode) {
  if (runMode === "write") return [
    "if (pm.collectionVariables.get('runWrites') !== 'true') {",
    "  console.warn('Skipped write request. Set collection variable runWrites=true to execute it.');",
    "  pm.execution.skipRequest();",
    "}",
  ];
  if (runMode === "external") return [
    "if (pm.collectionVariables.get('runExternalWrites') !== 'true') {",
    "  console.warn('Skipped external-boundary request. Set collection variable runExternalWrites=true only with safe test credentials and signatures.');",
    "  pm.execution.skipRequest();",
    "}",
  ];
  return [];
}

function demoAuthPreRequestFor(routePath) {
  if (!["/api/auth/dev-login", "/api/auth/demo-login"].includes(routePath)) return [];
  return [
    "if (pm.variables.get('runDemoAuth') !== 'true') {",
    "  console.warn('Skipped demo authentication on this target. Set runDemoAuth=true only for an isolated demo or local Worker.');",
    "  pm.execution.skipRequest();",
    "}",
  ];
}

function requestTests(route, runMode) {
  const routeId = `${route.method} ${route.path}`;
  const tracksSession = ["/api/auth/dev-login", "/api/auth/demo-login", "/api/auth/session", "/api/me"].includes(route.path);
  return [
    `const routeId = ${JSON.stringify(routeId)};`,
    `const runMode = ${JSON.stringify(runMode)};`,
    "const status = pm.response.code;",
    "const contentType = (pm.response.headers.get('content-type') || '').toLowerCase();",
    `pm.test(${JSON.stringify(`${routes.length} registered routes are in this collection`)}, () => pm.expect(pm.collectionVariables.get('routeCount')).to.eql('${routes.length}'));`,
    "pm.test('API returned an HTTP response', () => pm.expect(status).to.be.within(100, 599));",
    "pm.test('response completed within the configured budget', () => { const budget = Number(pm.collectionVariables.get('maxResponseTimeMs') || '20000'); pm.expect(pm.response.responseTime).to.be.at.most(budget); });",
    "pm.test('route has no unhandled server error', () => { if ([500, 502, 504].includes(status)) console.error(JSON.stringify({ route: routeId, status, body: pm.response.text().slice(0, 500) })); pm.expect([500, 502, 504], routeId).to.not.include(status); });",
    "if (status === 503) console.warn(JSON.stringify({ route: routeId, status, note: 'The route is reachable but a configured dependency is unavailable.' }));",
    "if (contentType.includes('application/json') && pm.response.text().trim()) {",
    "  pm.test('JSON response parses', () => pm.response.to.have.jsonBody());",
    "  if (status >= 400 && status < 500) { const body = pm.response.json(); pm.test('client error explains the next step', () => pm.expect(Boolean(body.error || body.message || body.errors), routeId).to.eql(true)); }",
    "}",
    "console.info(JSON.stringify({ route: routeId, status, responseTimeMs: pm.response.responseTime, runMode }));",
    ...(tracksSession ? [
      "if (status < 300 && contentType.includes('application/json')) { const body = pm.response.json(); if (body.sessionToken) pm.collectionVariables.set('sessionToken', body.sessionToken); if (body.csrfToken) pm.collectionVariables.set('csrfToken', body.csrfToken); }",
    ] : []),
  ];
}

function routeItemFor(route) {
  const body = bodyFor(route);
  const runMode = runModeFor(route);
  const headers = [{ key: "Accept", value: "application/json" }];
  if (body !== undefined) headers.push({ key: "Content-Type", value: "application/json" });
  if (route.method !== "GET" && route.method !== "HEAD" && route.method !== "OPTIONS") {
    headers.push({ key: "Authorization", value: "VeldSession {{sessionToken}}" });
    headers.push({ key: "X-CSRF-Token", value: "{{csrfToken}}" });
  }
  return {
    name: `${route.method} ${route.path}`,
    description: routeDescription(route, runMode),
    request: {
      method: route.method,
      header: headers,
      url: { raw: `{{baseUrl}}${concretePath(route.path)}`, host: ["{{baseUrl}}"], path: concretePath(route.path).split("/").filter(Boolean) },
      ...(body === undefined ? {} : { body: { mode: "raw", raw: JSON.stringify(body), options: { raw: { language: "json" } } } }),
    },
    event: [
      ...(demoAuthPreRequestFor(route.path).length ? [{ listen: "prerequest", script: { type: "text/javascript", exec: demoAuthPreRequestFor(route.path) } }] : []),
      ...(preRequestFor(runMode).length ? [{ listen: "prerequest", script: { type: "text/javascript", exec: preRequestFor(runMode) } }] : []),
      { listen: "test", script: { type: "text/javascript", exec: requestTests(route, runMode) } },
    ],
  };
}

const routeItems = routes.map(routeItemFor);
const groupedRouteItems = routeItems.reduce((groups, item, index) => {
  const group = groupFor(routes[index]);
  (groups.get(group) ?? groups.set(group, []).get(group)).push(item);
  return groups;
}, new Map());

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

const startDemoSessionItem = {
  name: "Start demo session for {{demoRole}}",
  description: "Run this first. Change demoRole at collection level to buyer, contributor, editor, or admin and rerun this request before testing that role's endpoints.",
  request: {
    method: "POST",
    header: [
      { key: "Accept", value: "application/json" },
      { key: "Content-Type", value: "application/json" },
    ],
    body: { mode: "raw", raw: JSON.stringify({ role: "{{demoRole}}" }), options: { raw: { language: "json" } } },
    url: { raw: "{{baseUrl}}/api/auth/demo-login", host: ["{{baseUrl}}"], path: ["api", "auth", "demo-login"] },
  },
  event: [{ listen: "prerequest", script: { type: "text/javascript", exec: [
    "if (pm.variables.get('runDemoAuth') !== 'true') {",
    "  console.warn('Skipped demo login. Set runDemoAuth=true only for an isolated demo or local Worker.');",
    "  pm.execution.skipRequest();",
    "}",
  ] } }, { listen: "test", script: { type: "text/javascript", exec: [
    "pm.test('demo login succeeds', () => pm.expect(pm.response.code).to.eql(200));",
    "const body = pm.response.json();",
    "pm.test('selected demo role is active', () => pm.expect(body.user?.role).to.eql(pm.collectionVariables.get('demoRole')));",
    "pm.test('CSRF token is available for mutations', () => pm.expect(body.csrfToken).to.be.a('string').and.not.empty);",
    "if (body.csrfToken) pm.collectionVariables.set('csrfToken', body.csrfToken);",
  ] } }],
};

const verifyDemoSessionItem = {
  name: "Verify selected demo session",
  description: "Confirms that Postman's cookie jar retained the session created by the setup request.",
  request: {
    method: "GET",
    header: [{ key: "Accept", value: "application/json" }],
    url: { raw: "{{baseUrl}}/api/auth/session", host: ["{{baseUrl}}"], path: ["api", "auth", "session"] },
  },
  event: [{ listen: "prerequest", script: { type: "text/javascript", exec: [
    "if (pm.variables.get('runDemoAuth') !== 'true') {",
    "  console.warn('Skipped demo session verification. Set runDemoAuth=true only for an isolated demo or local Worker.');",
    "  pm.execution.skipRequest();",
    "}",
  ] } }, { listen: "test", script: { type: "text/javascript", exec: [
    "pm.test('session endpoint succeeds', () => pm.expect(pm.response.code).to.eql(200));",
    "const body = pm.response.json();",
    "pm.test('demo session is authenticated', () => pm.expect(body.authenticated).to.eql(true));",
    "pm.test('session role matches demoRole', () => pm.expect(body.user?.role).to.eql(pm.collectionVariables.get('demoRole')));",
    "if (body.csrfToken) pm.collectionVariables.set('csrfToken', body.csrfToken);",
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
    name: "Veld Archive — endpoint test plan",
    _postman_id: "veld-archive-route-sweep",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    description: "Generated from the API route declarations in src/worker/index.ts. Start with the setup folder, select a demoRole, and run the collection. The export mode omits the external Supabase signup boundary, skips data-changing and external requests by default, and leaves credential-like variables blank.",
  },
  event: [{ listen: "prerequest", script: { type: "text/javascript", exec: [
    "pm.collectionVariables.set('routeCount', '" + routes.length + "');",
    "if (!pm.collectionVariables.get('testEmail')) pm.collectionVariables.set('testEmail', 'postman-smoke-' + Date.now() + '@example.com');",
  ] } }],
  variable: [
    { key: "baseUrl", value: baseUrl },
    { key: "desktopUrl", value: desktopUrl },
    { key: "supabaseUrl", value: process.env.POSTMAN_SUPABASE_URL ?? (envValue("VITE_SUPABASE_URL") || envValue("EXPO_PUBLIC_SUPABASE_URL") || "https://fmqwymgmrkrnfkugogbw.supabase.co") },
    { key: "supabasePublishableKey", value: supabasePublishableKey },
    { key: "testEmail", value: "" },
    { key: "testPassword", value: testPassword },
    { key: "demoRole", value: demoRole, description: "Set to buyer, contributor, editor, or admin before running the collection." },
    { key: "runDemoAuth", value: runDemoAuth, description: "Enable only for the isolated demo or local Worker. Production must use real controlled identities instead." },
    { key: "runWrites", value: runWrites, description: "Set to true only when the target is an isolated demo/test database. Controls data-changing requests." },
    { key: "runExternalWrites", value: runExternalWrites, description: "Set to true only with safe provider credentials/signatures. Controls payment, webhook, integration, and security-boundary requests." },
    { key: "maxResponseTimeMs", value: maxResponseTimeMs, description: "Maximum response time used by every endpoint test." },
    { key: "identityToken", value: "", description: "Optional verified external identity token for the identity-exchange request." },
    { key: "sessionToken", value: "" },
    { key: "csrfToken", value: "" },
  ],
  item: [
    {
      name: "00 - Start here",
      description: "Run the demo session request first. Change demoRole and rerun the setup request when switching buyer, contributor (seller-facing), editor, or admin coverage.",
      item: [startDemoSessionItem, verifyDemoSessionItem, desktopShellItem],
    },
    ...(signupBoundaryItems.length ? [{ name: "00 - Optional external signup", description: "Only present during a Newman run with Supabase configured; never included by the safe export.", item: signupBoundaryItems }] : []),
    {
      name: "00 - Optional identity exchange",
      description: "Set identityToken and runExternalWrites=true only when a verified external JWT is available.",
      item: [{
        name: "Veld identity exchange",
        request: {
          method: "POST",
          header: [
            { key: "Authorization", value: "Bearer {{identityToken}}" },
            { key: "Content-Type", value: "application/json" },
            { key: "Accept", value: "application/json" },
          ],
          body: { mode: "raw", raw: JSON.stringify({ sessionTransport: "bearer", accountIntent: "seller" }), options: { raw: { language: "json" } } },
          url: { raw: "{{baseUrl}}/api/auth/exchange", host: ["{{baseUrl}}"], path: ["api", "auth", "exchange"] },
        },
        event: [{ listen: "prerequest", script: { type: "text/javascript", exec: [
          "if (pm.collectionVariables.get('runExternalWrites') !== 'true' || !pm.collectionVariables.get('identityToken')) {",
          "  console.warn('Skipped identity exchange. Set identityToken and runExternalWrites=true only for a controlled test.');",
          "  pm.execution.skipRequest();",
          "}",
        ] } }, { listen: "test", script: { type: "text/javascript", exec: [
          "pm.test('identity exchange returns a non-error response', () => pm.expect(pm.response.code).to.be.below(300));",
          "const body = pm.response.json();",
          "if (body.sessionToken) pm.collectionVariables.set('sessionToken', body.sessionToken);",
          "if (body.csrfToken) pm.collectionVariables.set('csrfToken', body.csrfToken);",
        ] } }],
      }],
    },
    ...Array.from(groupedRouteItems, ([name, items]) => ({
      name,
      description: `Generated endpoint coverage for ${name.toLowerCase()}. Every request carries route, latency, server-error, JSON, and client-error test points.`,
      item: items,
    })),
  ],
};

if (exportOnly) {
  const configuredExportPath = process.env.POSTMAN_EXPORT_PATH?.trim();
  const exportPath = configuredExportPath
    ? path.resolve(root, configuredExportPath)
    : path.join(root, "postman", "veld-archive-route-sweep.postman_collection.json");
  await fs.mkdir(path.dirname(exportPath), { recursive: true });
  await fs.writeFile(exportPath, `${JSON.stringify(collection, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    exportPath: path.relative(root, exportPath),
    baseUrl,
    desktopUrl,
    routeCount: routes.length,
    signupBoundary: signupBoundaryEnabled,
  }, null, 2));
} else {
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
}
