const base = process.argv[2] ?? process.env.QA_URL;
if (!base) throw new Error("Usage: npm run test:live -- https://your-deployment.example");

let visualSeed;
for (const path of ["/api/health", "/api/assets?q=forest&kind=image&status=published", "/api/creators", "/api/licence-products"]) {
  let response;
  try {
    response = await fetch(new URL(path, base));
  } catch (error) {
    throw new Error(`Could not reach ${base}${path}: ${error instanceof Error ? error.message : "network failure"}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.toLowerCase().includes("application/json")) {
    throw new Error(`${path} returned ${response.status} ${contentType}; deploy the Worker with its Assets binding so /api routes do not fall through to the SPA HTML.`);
  }
  console.log(`OK ${path}: ${response.status} ${contentType}`);
  if (path.startsWith("/api/assets?q=")) {
    const body = await response.json();
    if (body.mode === "keyword") throw new Error(`${path} fell back to keyword mode; Workers AI or Vectorize was not exercised successfully.`);
    visualSeed = body.results?.find((asset) => typeof asset.previewUrl === "string" && asset.previewUrl);
  }
}

if (!visualSeed) throw new Error("Semantic search returned no preview-backed image for the visual-search smoke.");
const preview = await fetch(new URL(visualSeed.previewUrl, base));
const previewType = preview.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
if (!preview.ok || !previewType.startsWith("image/")) throw new Error(`Visual-search seed preview returned ${preview.status} ${previewType}.`);
const visualForm = new FormData();
visualForm.set("image", new File([await preview.arrayBuffer()], `visual-smoke.${previewType.split("/")[1] || "jpg"}`, { type: previewType }));
const visual = await fetch(new URL("/api/search/visual", base), { method: "POST", body: visualForm });
const visualBody = await visual.json();
if (!visual.ok || visualBody.mode !== "visual-to-semantic" || visualBody.usedVectorIndex !== true) {
  throw new Error(`/api/search/visual did not complete visual-to-semantic search (HTTP ${visual.status}, mode ${visualBody.mode ?? "none"}).`);
}
console.log(`OK /api/search/visual: ${visual.status} ${visualBody.mode}`);
