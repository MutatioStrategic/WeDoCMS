const privateApiCacheControl = "private, no-store, max-age=0";

function appendVary(headers: Headers, value: string): void {
  const current = (headers.get("Vary") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!current.some((item) => item.toLowerCase() === value.toLowerCase())) current.push(value);
  headers.set("Vary", current.join(", "));
}

/** API responses are private unless a route intentionally opts into public caching. */
export function applyApiCachePolicy(request: Request, response: Response): Response {
  if (!new URL(request.url).pathname.startsWith("/api/")) return response;
  const configured = response.headers.get("Cache-Control") ?? "";
  if (!/^\s*public\b/i.test(configured)) response.headers.set("Cache-Control", privateApiCacheControl);
  appendVary(response.headers, "Cookie");
  appendVary(response.headers, "Authorization");
  return response;
}
