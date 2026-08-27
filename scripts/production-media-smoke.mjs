const rawBaseUrl = process.argv[2] ?? process.env.PRODUCTION_WORKER_URL;
if (!rawBaseUrl) throw new Error("Usage: npm run test:production-media -- https://production-worker.example");

const baseUrl = new URL(rawBaseUrl);
if (baseUrl.protocol !== "https:") throw new Error("Production media smoke requires an HTTPS Worker URL.");
baseUrl.pathname = baseUrl.pathname.replace(/\/$/, "");

const expectedMinimum = Number(process.env.PRODUCTION_EXPECT_MIN_MEDIA ?? "5");
if (!Number.isInteger(expectedMinimum) || expectedMinimum < 5) {
  throw new Error("PRODUCTION_EXPECT_MIN_MEDIA must be an integer of at least 5.");
}

async function fetchJson(path) {
  const response = await fetch(new URL(path, baseUrl));
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.toLowerCase().includes("application/json")) {
    throw new Error(path + " returned " + response.status + " " + contentType + "; production API is not serving JSON.");
  }
  return response.json();
}

const health = await fetchJson("/api/health");
if (health.environment !== "production") {
  throw new Error("Production Worker reported environment " + (health.environment ?? "unknown") + ".");
}

const catalogue = await fetchJson("/api/assets?kind=image&status=published");
const results = Array.isArray(catalogue.results) ? catalogue.results : [];
const previewAssets = results.filter((asset) => {
  const id = String(asset?.id ?? "");
  return !id.startsWith("asset-demo-") && typeof asset?.previewUrl === "string" && asset.previewUrl.trim();
});

if (previewAssets.length < expectedMinimum) {
  throw new Error("Production catalogue has " + previewAssets.length + " usable non-demo previews; expected at least " + expectedMinimum + ".");
}

for (const asset of previewAssets.slice(0, 5)) {
  const previewUrl = new URL(asset.previewUrl, baseUrl);
  if (previewUrl.origin !== baseUrl.origin) {
    throw new Error("Preview " + asset.id + " resolved outside the production Worker origin.");
  }

  let response = await fetch(previewUrl, { method: "HEAD" });
  if (response.status === 405) response = await fetch(previewUrl);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!response.ok || !contentType.startsWith("image/")) {
    throw new Error("Preview " + asset.id + " returned " + response.status + " " + (contentType || "unknown content type") + ".");
  }
}

console.log(JSON.stringify({
  ok: true,
  workerOrigin: baseUrl.origin,
  catalogueCount: results.length,
  usablePreviewCount: previewAssets.length,
  checkedPreviewCount: Math.min(previewAssets.length, 5),
  expectedMinimum,
}, null, 2));
