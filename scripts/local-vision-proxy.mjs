import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const token = process.env.VISION_PROXY_TOKEN?.trim();
if (!token) throw new Error("VISION_PROXY_TOKEN is required");
const port = Number(process.env.VISION_PROXY_PORT ?? 11437);
const ollamaUrl = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11436/api/generate").replace(/\/$/, "");

function authorized(value) {
  const supplied = String(value ?? "").replace(/^Bearer\s+/i, "");
  const left = Buffer.from(supplied);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "local-vision-proxy" }));
    return;
  }
  if (request.method !== "POST" || request.url !== "/api/generate") {
    response.writeHead(404); response.end(); return;
  }
  if (!authorized(request.headers.authorization)) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) {
      response.writeHead(413); response.end(); return;
    }
    chunks.push(chunk);
  }
  try {
    const upstream = await fetch(ollamaUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Buffer.concat(chunks),
      signal: AbortSignal.timeout(300_000),
    });
    response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "local vision upstream unavailable" }));
  }
});

server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ ok: true, port, upstream: ollamaUrl })));
