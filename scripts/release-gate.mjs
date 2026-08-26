import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const forbidden = [
  { pattern: /Veld demo archive/i, label: "demo contributor" },
  { pattern: /Demo fallback record/i, label: "demo fallback metadata" },
  { pattern: /asset-demo-/i, label: "demo asset identifier" },
  { pattern: /replace-with-(your-)?/i, label: "placeholder configuration" },
  { pattern: /placeholder previews?/i, label: "placeholder preview copy" },
];
const textExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".svg"]);

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? filesUnder(join(directory, entry.name)) : [join(directory, entry.name)]));
  return nested.flat();
}

const failures = [];
let files = [];
try {
  files = await filesUnder(dist);
} catch {
  failures.push("dist/ is missing; run npm run build before the release gate.");
}

for (const file of files.filter((candidate) => textExtensions.has(extname(candidate)))) {
  const content = await readFile(file, "utf8");
  for (const check of forbidden) if (check.pattern.test(content)) failures.push(`${check.label} found in ${file.replaceAll("\\", "/")}`);
}

const mainSource = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
const sharedSource = await readFile(new URL("../src/shared.ts", import.meta.url), "utf8");
const workerSource = await readFile(new URL("../src/worker/index.ts", import.meta.url), "utf8");
const demoSmokeSource = await readFile(new URL("../scripts/demo-screen-smoke.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
if (!sharedSource.includes('export type AssetKind = "image" | "video"')) failures.push("The declared product boundary must remain photo/video only.");
if (!mainSource.includes("No substitute image is shown.")) failures.push("Missing the explicit unavailable-preview state; visual cards must not fabricate substitute media.");
const hasDemoFallback = /filterDemoAssets|demoAssets/.test(mainSource);
if (hasDemoFallback && !mainSource.includes("import.meta.env.DEV")) failures.push("Demo fallback is not restricted to development builds.");
if (/MEDIA_LIBRARY_BUCKET\s*\.\s*(?:put|delete|createMultipartUpload|resumeMultipartUpload)\s*\(/.test(workerSource)) failures.push("The production media library fallback must remain read-only in Worker code.");
if (!demoSmokeSource.includes("expectedMediaMinimum") || !demoSmokeSource.includes("previewUrl") || !demoSmokeSource.includes("page.request.fetch")) failures.push("The live demo smoke must verify catalogue media counts and real preview responses.");
if (!packageJson.scripts?.["worker:deploy"]?.includes("wrangler deploy --env production")) failures.push("Production deployment must target the explicit production Wrangler environment.");
if (!packageJson.scripts?.["worker:deploy:demo"]?.includes("wrangler deploy --env demo")) failures.push("Demo deployment must target the explicit demo Wrangler environment.");

const wrangler = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const demoStart = wrangler.search(/"demo"\s*:\s*\{/);
const productionStart = wrangler.search(/"production"\s*:\s*\{/);
const demoConfig = demoStart >= 0 ? wrangler.slice(demoStart, productionStart > demoStart ? productionStart : wrangler.length) : "";
if (demoStart >= 0 && !/"binding"\s*:\s*"MEDIA_LIBRARY_BUCKET"\s*,\s*"bucket_name"\s*:\s*"veld-archive-media"/.test(demoConfig)) failures.push("The demo Worker must retain its read-only production media library binding.");
if (demoStart >= 0 && /"binding"\s*:\s*"MEDIA_BUCKET"\s*,\s*"bucket_name"\s*:\s*"veld-archive-media"/.test(demoConfig)) failures.push("The demo primary media bucket must remain isolated from the production bucket.");

if (process.argv.includes("--production")) {
  const productionConfig = productionStart >= 0 ? wrangler.slice(productionStart) : "";
  if (productionStart < 0) failures.push("wrangler.jsonc has no dedicated production environment; root development bindings cannot be promoted.");
  if (!/"APP_ENV"\s*:\s*"production"/.test(productionConfig)) failures.push("The production Wrangler environment must set APP_ENV to production.");
  if (/"cache"\s*:\s*\{\s*"enabled"\s*:\s*true/s.test(productionConfig)) failures.push("Worker-wide production caching must remain disabled for cookie-authenticated API responses.");
  if (/"AUTH_PROVIDER"\s*:\s*"(?:auth0|both)"/.test(productionConfig) && !/"AUTH_AUDIENCE"\s*:\s*"[^"]+"/.test(productionConfig)) failures.push("Auth0 is selected in production but AUTH_AUDIENCE is missing.");
  if (!/"PAYSTACK_SUBSCRIPTION_PLAN_CODE"\s*:\s*"PLN_[^"]+"/.test(productionConfig)) failures.push("The canonical Paystack subscription plan code is missing.");
  if (!/"binding"\s*:\s*"MEDIA_BUCKET"\s*,\s*"bucket_name"\s*:\s*"veld-archive-media"/.test(productionConfig)) failures.push("The production Worker must remain bound to the production media bucket.");
  if (!/"R2_BUCKET_NAME"\s*:\s*"veld-archive-media"/.test(productionConfig)) failures.push("Production R2 signing must target the production media bucket.");
  if (/replace-with-|org-demo|localhost|127\.0\.0\.1/i.test(productionConfig)) failures.push("The production Wrangler environment contains demo, localhost, or placeholder configuration.");
}

if (failures.length) {
  console.error("Release gate failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log(`Release gate passed: ${files.length} built files contain no demo assets, placeholder configuration, or placeholder preview copy.`);
