import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const read = (path) => readFile(new URL(path, root), "utf8");
const [workerSource, frontendSource, schemaSource, openapi, wrangler, packageJson] = await Promise.all([
  read("src/worker/index.ts"),
  read("src/main.tsx"),
  read("src/contracts/schemas.ts"),
  read("docs/openapi.yaml"),
  read("wrangler.jsonc"),
  read("package.json").then(JSON.parse),
]);

const failures = [];
const requireText = (text, pattern, message) => { if (!pattern.test(text)) failures.push(message); };
requireText(workerSource, /app\.get\("\/api\/auth\/config"/, "Worker auth config route is missing.");
requireText(workerSource, /isSupabasePublicKey/, "Worker does not validate that the browser key is publishable/anon.");
requireText(workerSource, /SUPABASE_ANON_KEY/, "Worker does not consume the Supabase publishable secret.");
requireText(frontendSource, /fetch\("\/api\/auth\/config"/, "Frontend does not load auth configuration from the Worker.");
requireText(frontendSource, /function AuthBootstrap/, "Frontend auth bootstrap component is missing.");
requireText(frontendSource, /parseRuntimeAuthConfig/, "Frontend does not validate the auth configuration response.");
requireText(schemaSource, /authConfigResponseSchema/, "Auth configuration contract schema is missing.");
requireText(openapi, /\/api\/auth\/config:/, "OpenAPI is missing the auth configuration route.");
requireText(openapi, /AuthConfigResponse:/, "OpenAPI is missing AuthConfigResponse.");

const productionStart = wrangler.search(/"production"\s*:\s*\{/);
const production = productionStart >= 0 ? wrangler.slice(productionStart) : "";
requireText(production, /"APP_ENV"\s*:\s*"production"/, "Production Wrangler environment is missing APP_ENV=production.");
requireText(production, /"AUTH_PROVIDER"\s*:\s*"(?:supabase|both)"/, "Production Wrangler environment does not enable Supabase authentication.");
requireText(production, /"SUPABASE_URL"\s*:\s*"https:\/\/[^"/]+\.supabase\.co"/, "Production Wrangler environment is missing its HTTPS Supabase URL.");
requireText(production, /"SUPABASE_AUDIENCE"\s*:\s*"[^"}]+"/, "Production Wrangler environment is missing SUPABASE_AUDIENCE.");
requireText(production, /"SUPABASE_ANON_KEY"/, "Production Wrangler secrets do not require SUPABASE_ANON_KEY.");
if (/(^|\n)\s*"AUTH_COOKIE_DOMAIN"\s*:/.test(production)) failures.push("Production must use host-only auth cookies unless the domain exactly matches the serving host.");
if (!packageJson.scripts?.["auth:check"]?.includes("verify-auth-wiring.mjs")) failures.push("package.json is missing the auth:check wiring invariant.");
if (!packageJson.scripts?.["worker:deploy"]?.includes("--keep-vars")) failures.push("Production Worker deployment must preserve dashboard-managed variables and secrets with --keep-vars.");

if (process.argv.includes("--remote")) {
  try {
    const wranglerCli = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
    const result = await execFileAsync(process.execPath, [wranglerCli, "secret", "list", "--env", "production"], { cwd: rootPath, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    if (!/SUPABASE_ANON_KEY/.test(result.stdout)) failures.push("Remote production secret list does not contain SUPABASE_ANON_KEY.");
  } catch {
    failures.push("Remote production secret check failed; authenticate Wrangler and retry without exposing secret values.");
  }
}

if (failures.length) {
  console.error("Auth wiring check failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log(`Auth wiring check passed${process.argv.includes("--remote") ? " (including remote secret name check)" : ""}.`);
