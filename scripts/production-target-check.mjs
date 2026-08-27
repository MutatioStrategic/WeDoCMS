import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const expectedWorkerName = "veld-archive-api-production";
const expectedWorkerOrigin = `https://${expectedWorkerName}.blewisorlando.workers.dev`;
const expectedPagesOrigin = "https://veld-archive.pages.dev";

const [wranglerSource, pagesProxySource, mobileConfigSource, packageSource] = await Promise.all([
  read("wrangler.jsonc"),
  read("functions/api/[[path]].ts"),
  read("apps/mobile/app.json"),
  read("package.json"),
]);

let wrangler;
let mobileConfig;
let packageJson;
try {
  wrangler = JSON.parse(wranglerSource);
  mobileConfig = JSON.parse(mobileConfigSource);
  packageJson = JSON.parse(packageSource);
} catch (error) {
  console.error(`Production target check could not parse configuration: ${error instanceof Error ? error.message : "invalid JSON"}`);
  process.exit(1);
}

const failures = [];
const requireValue = (actual, expected, label) => {
  if (actual !== expected) failures.push(`${label} must be ${expected}; received ${actual ?? "missing"}.`);
};

const production = wrangler.env?.production;
if (!production || typeof production !== "object") {
  failures.push("wrangler.jsonc must define a dedicated env.production block.");
} else {
  requireValue(production.name, expectedWorkerName, "env.production.name");
  requireValue(production.vars?.APP_ENV, "production", "env.production.vars.APP_ENV");
  requireValue(production.vars?.R2_BUCKET_NAME, "veld-archive-media", "env.production.vars.R2_BUCKET_NAME");
  requireValue(production.vars?.AUTH_AUDIENCE, expectedWorkerOrigin, "env.production.vars.AUTH_AUDIENCE");
  requireValue(production.vars?.PHOTO_AI_SOURCE_ORIGIN, expectedWorkerOrigin, "env.production.vars.PHOTO_AI_SOURCE_ORIGIN");

  const database = production.d1_databases?.find((binding) => binding.binding === "DB");
  requireValue(database?.database_name, "veld-archive", "the production DB binding");
  const mediaBucket = production.r2_buckets?.find((binding) => binding.binding === "MEDIA_BUCKET");
  requireValue(mediaBucket?.bucket_name, "veld-archive-media", "the production MEDIA_BUCKET binding");
}

if (!pagesProxySource.includes(`const defaultWorkerOrigin = "${expectedWorkerOrigin}"`)) {
  failures.push("The Pages API proxy must default to the canonical production Worker.");
}
requireValue(mobileConfig.expo?.extra?.apiBaseUrl, expectedPagesOrigin, "apps/mobile/app.json expo.extra.apiBaseUrl");

const workerDeploy = packageJson.scripts?.["worker:deploy"] ?? "";
if (!workerDeploy.includes("wrangler deploy --env production")) failures.push("worker:deploy must select env.production explicitly.");
if (!workerDeploy.includes("--dry-run")) failures.push("worker:deploy must run a Wrangler dry-run before publishing.");
if (!workerDeploy.includes("--keep-vars")) failures.push("worker:deploy must preserve dashboard-managed variables with --keep-vars.");
if (!packageJson.scripts?.["auth:check:remote"]?.includes("--remote")) failures.push("Production deployment must verify remote production secret names before publishing.");
if (!packageJson.scripts?.["test:production-media"]?.includes("production-media-smoke.mjs")) failures.push("Production deployment must run the catalogue and preview media smoke.");
if (!packageJson.scripts?.["pages:deploy"]?.includes("--branch main")) failures.push("pages:deploy must publish the desktop shell on the main branch.");

if (failures.length) {
  console.error("Production target check failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log(`Production target check passed: ${expectedWorkerName} -> ${expectedWorkerOrigin}; Pages -> ${expectedPagesOrigin}.`);
