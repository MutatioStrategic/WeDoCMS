import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const baseUrl = (process.env.E2E_BASE_URL ?? "https://veld-archive-api.blewisorlando.workers.dev").replace(/\/$/, "");
const libraryDir = resolve(process.env.PHOTO_LIBRARY_DIR ?? "fixtures/test-photo-library");
const manifestPath = join(libraryDir, "manifest.json");
const statePath = join(libraryDir, "upload-state.json");
const resume = process.argv.includes("--resume");
const dryRun = process.argv.includes("--dry-run");

const manifest = JSON.parse((await readFile(manifestPath, "utf8")).replace(/^\uFEFF/, ""));
if (!Array.isArray(manifest) || manifest.length !== 100) throw new Error("Expected a manifest containing exactly 100 images.");

let state = {};
if (resume) {
  try { state = JSON.parse(await readFile(statePath, "utf8")); } catch { state = {}; }
}

if (dryRun) {
  const totalBytes = manifest.reduce((sum, item) => sum + Number(item.sizeBytes ?? 0), 0);
  console.log(JSON.stringify({ ok: true, count: manifest.length, totalBytes, libraryDir }, null, 2));
  process.exit(0);
}

let cookie = "";
let csrfToken = "";

function rememberCookie(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  const session = values.find((value) => value.startsWith("va_session="));
  if (session) cookie = session.split(";", 1)[0];
}

async function call(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (cookie) headers.set("Cookie", cookie);
  if (csrfToken && init.method && init.method !== "GET") headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  rememberCookie(response);
  return response;
}

const login = await call("/api/auth/dev-login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ role: "contributor" }),
});
if (!login.ok) throw new Error(`Demo login failed with HTTP ${login.status}.`);
const loginBody = await login.json();
csrfToken = String(loginBody.csrfToken ?? "");
if (!csrfToken) throw new Error("Demo login did not return a CSRF token.");

for (const item of manifest) {
  if (state[item.sequence]?.assetId) {
    console.log(`[skip ${item.sequence}/100] ${item.fileName}`);
    continue;
  }
  const file = await readFile(join(libraryDir, item.fileName));
  const sha256 = createHash("sha256").update(file).digest("hex");
  const idempotencyKey = `photo-library:${item.sequence}:${sha256}`;
  const session = await call("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: item.fileName, contentType: item.contentType, sizeBytes: file.byteLength, idempotencyKey, sha256 }),
  });
  const sessionBody = await session.json();
  if (!session.ok) {
    if (session.status === 503) {
      throw new Error(`Upload session failed with HTTP 503. Configure R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY as Worker secrets, then rerun with --resume. Response: ${JSON.stringify(sessionBody)}`);
    }
    throw new Error(`Upload session failed for ${item.fileName}: HTTP ${session.status} ${JSON.stringify(sessionBody)}`);
  }

  let put;
  let lastPutError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      put = await fetch(sessionBody.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": item.contentType },
        body: file,
        signal: controller.signal,
      });
      if (put.ok || (put.status < 500 && put.status !== 429)) break;
      lastPutError = new Error(`HTTP ${put.status}`);
    } catch (error) {
      lastPutError = error;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < 4) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 2000));
  }
  if (!put) throw new Error(`R2 PUT failed for ${item.fileName}: ${lastPutError?.message ?? "no response"}`);
  if (!put.ok) {
    const errorBody = await put.text();
    const requestId = put.headers.get("x-amz-request-id") ?? put.headers.get("cf-ray") ?? "unknown";
    throw new Error(`R2 PUT failed for ${item.fileName}: HTTP ${put.status}, request=${requestId}, body=${errorBody.slice(0, 1000)}`);
  }

  const complete = await call(`/api/uploads/${encodeURIComponent(sessionBody.uploadId)}/complete`, { method: "POST" });
  const completeBody = await complete.json();
  if (!complete.ok) throw new Error(`Upload completion failed for ${item.fileName}: HTTP ${complete.status} ${JSON.stringify(completeBody)}`);
  state[item.sequence] = {
    assetId: completeBody.assetId,
    uploadId: completeBody.uploadId,
    objectKey: completeBody.objectKey,
    previewKey: String(completeBody.objectKey).replace(/^originals\//, "previews/").replace(/\.[^.\/]+$/, ".webp"),
    fileName: item.fileName,
    sourceTitle: item.sourceTitle,
  };
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
  console.log(`[uploaded ${item.sequence}/100] ${item.fileName} -> ${completeBody.assetId}`);
}

console.log(`Uploaded ${Object.keys(state).length}/100 images through the authenticated upload pipeline.`);
