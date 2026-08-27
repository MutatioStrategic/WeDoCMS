import { mkdir, writeFile } from "node:fs/promises";

const target = new URL("../dist/_redirects", import.meta.url);
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await writeFile(target, "/* https://veld-archive-api-production.blewisorlando.workers.dev/:splat 302\n", "utf8");
console.log("Prepared dist/_redirects for Cloudflare Pages compatibility deploy.");
