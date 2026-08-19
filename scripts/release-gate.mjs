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
if (!sharedSource.includes('export type AssetKind = "image" | "video"')) failures.push("The declared product boundary must remain photo/video only.");
if (!mainSource.includes("No substitute image is shown.")) failures.push("Missing the explicit unavailable-preview state; visual cards must not fabricate substitute media.");
const hasDemoFallback = /filterDemoAssets|demoAssets/.test(mainSource);
if (hasDemoFallback && !mainSource.includes("import.meta.env.DEV")) failures.push("Demo fallback is not restricted to development builds.");

if (process.argv.includes("--production")) {
  const wrangler = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const productionStart = wrangler.search(/"production"\s*:\s*\{/);
  const productionConfig = productionStart >= 0 ? wrangler.slice(productionStart, productionStart + 20_000) : "";
  if (productionStart < 0) failures.push("wrangler.jsonc has no dedicated production environment; root development bindings cannot be promoted.");
  if (!/"APP_ENV"\s*:\s*"production"/.test(productionConfig)) failures.push("The production Wrangler environment must set APP_ENV to production.");
  if (/"cache"\s*:\s*\{\s*"enabled"\s*:\s*true/s.test(productionConfig)) failures.push("Worker-wide production caching must remain disabled for cookie-authenticated API responses.");
  if (/"AUTH_PROVIDER"\s*:\s*"(?:auth0|both)"/.test(productionConfig) && !/"AUTH_AUDIENCE"\s*:\s*"[^"]+"/.test(productionConfig)) failures.push("Auth0 is selected in production but AUTH_AUDIENCE is missing.");
  if (!/"PAYSTACK_SUBSCRIPTION_PLAN_CODE"\s*:\s*"PLN_[^"]+"/.test(productionConfig)) failures.push("The canonical Paystack subscription plan code is missing.");
  if (/replace-with-|org-demo|localhost|127\.0\.0\.1/i.test(productionConfig)) failures.push("The production Wrangler environment contains demo, localhost, or placeholder configuration.");
}

if (failures.length) {
  console.error("Release gate failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log(`Release gate passed: ${files.length} built files contain no demo assets, placeholder configuration, or placeholder preview copy.`);
