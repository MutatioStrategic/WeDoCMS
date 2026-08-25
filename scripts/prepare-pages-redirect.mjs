import { mkdir, writeFile } from "node:fs/promises";

const target = new URL("../dist/_redirects", import.meta.url);
const apiOrigin = (process.env.VITE_WORKER_API_URL ?? "https://veld-archive-api-production.blewisorlando.workers.dev").replace(/\/$/, "");
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await writeFile(target, `/* ${apiOrigin}/:splat 302\n`, "utf8");
console.log(`Prepared dist/_redirects for Cloudflare Pages compatibility deploy: ${apiOrigin}`);
