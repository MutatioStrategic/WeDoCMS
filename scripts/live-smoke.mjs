const base = process.argv[2] ?? process.env.QA_URL;
if (!base) throw new Error("Usage: npm run test:live -- https://your-deployment.example");

for (const path of ["/api/health", "/api/auth/config", "/api/search?q=forest&kind=image&status=published", "/api/creators", "/api/licence-products"]) {
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
  if (path === "/api/auth/config") {
    const auth = await response.json();
    if (!["supabase", "demo", "unavailable"].includes(auth.provider) || typeof auth.redirectUrl !== "string") throw new Error("Auth configuration response was malformed.");
    if (auth.provider === "supabase" && (typeof auth.supabaseUrl !== "string" || typeof auth.publishableKey !== "string" || !auth.publishableKey)) throw new Error("Supabase auth configuration did not include a publishable key.");
    if (process.env.LIVE_EXPECTED_AUTH_PROVIDER && auth.provider !== process.env.LIVE_EXPECTED_AUTH_PROVIDER) throw new Error(`Expected ${process.env.LIVE_EXPECTED_AUTH_PROVIDER} auth but received ${auth.provider}.`);
    console.log(`OK ${path}: provider=${auth.provider}, publishableKeyPresent=${auth.provider === "supabase"}`);
  }
  if (path.startsWith("/api/search?q=")) {
    const body = await response.json();
    if (body.mode !== "keyword") throw new Error(`${path} did not return deterministic metadata mode.`);
  }
}

const visual = await fetch(new URL("/api/search/visual", base), { method: "POST" });
const visualBody = await visual.json();
if (visual.status !== 503 || visualBody.code !== "visual_search_disabled") {
  throw new Error(`/api/search/visual did not report the intentional metadata-only disablement (HTTP ${visual.status}, code ${visualBody.code ?? "none"}).`);
}
console.log(`OK /api/search/visual: ${visual.status} ${visualBody.code}`);
