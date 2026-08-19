const base = process.argv[2] ?? process.env.QA_URL;
if (!base) throw new Error("Usage: npm run test:live -- https://your-deployment.example");

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
  }
}

const visualForm = new FormData();
visualForm.set("image", "missing-file");
const visual = await fetch(new URL("/api/search/visual", base), { method: "POST", body: visualForm });
if (visual.status === 404 || !(visual.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
  throw new Error(`/api/search/visual is not routed to the Worker (HTTP ${visual.status}).`);
}
console.log(`OK /api/search/visual route: ${visual.status} application/json`);
