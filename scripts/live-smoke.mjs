const base = process.argv[2] ?? process.env.QA_URL;
if (!base) throw new Error("Usage: npm run test:live -- https://your-deployment.example");

for (const path of ["/api/health", "/api/assets?q=&kind=all&status=published"]) {
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
  console.log(`✓ ${path}: ${response.status} ${contentType}`);
}
