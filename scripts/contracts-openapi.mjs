import { readFile } from "node:fs/promises";
import Enforcer from "openapi-enforcer";
import { parse } from "yaml";

const specPath = new URL("../docs/openapi.yaml", import.meta.url);
const spec = parse(await readFile(specPath, "utf8"));
for (const Schema of [Enforcer.v2_0.Schema, Enforcer.v3_0.Schema]) {
  Schema.defineDataTypeFormat("string", "uri", null);
  Schema.defineDataTypeFormat("string", "email", null);
}
// Several action endpoints create a provider session or async workflow rather
// than a dereferenceable resource, so no stable Location URI exists to return.
const openapi = await Enforcer(spec, { hideWarnings: false, componentOptions: { apiSuggestions: false } });

const cases = [
  {
    method: "GET",
    path: "/api/health",
    response: [200, { ok: true, service: "stockvel-api", environment: "test" }],
  },
  {
    method: "GET",
    path: "/api/auth/session",
    response: [200, { authenticated: false, user: null }],
  },
  {
    method: "GET",
    path: "/api/auth/config",
    response: [200, { provider: "supabase", supabaseUrl: "https://tenant.supabase.co", publishableKey: "sb_publishable_contract_test", redirectUrl: "https://archive.example.com" }],
  },
  {
    method: "POST",
    path: "/api/auth/exchange",
    request: { headers: { authorization: "Bearer consumer-contract-invalid-token", "content-type": "application/json" }, body: { organizationId: "org-demo" } },
    response: [401, { error: "Verified identity token required" }],
  },
  {
    method: "POST",
    path: "/api/assets",
    request: { headers: { "content-type": "application/json" }, body: { kind: "image", title: "Contract sample asset", subjectTags: ["test"], culturalTags: ["South African archive"], rightsStatus: "pending", modelReleaseStatus: "unknown", propertyReleaseStatus: "unknown", monetizationModel: "membership", licensePriceCents: null } },
    response: [403, { error: "Contributor access required" }],
  },
  {
    method: "GET",
    path: "/api/notifications",
    response: [401, { error: "Authentication required" }],
  },
];

for (const testCase of cases) {
  const [request, requestError] = openapi.request({ method: testCase.method, path: testCase.path, ...(testCase.request ?? {}) });
  if (requestError) throw new Error(`OpenAPI request mismatch for ${testCase.method} ${testCase.path}: ${requestError}`);
  const [response, responseError] = request.response(testCase.response[0], testCase.response[1], { "content-type": "application/json" });
  if (responseError) throw new Error(`OpenAPI response mismatch for ${testCase.method} ${testCase.path}: ${responseError}`);
  if (!response) throw new Error(`OpenAPI response was empty for ${testCase.method} ${testCase.path}`);
}

console.log(`Validated ${cases.length} Pact examples against ${specPath.pathname}`);
