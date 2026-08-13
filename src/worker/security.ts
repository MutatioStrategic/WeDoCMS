export type SecurityBindings = {
  DB: D1Database;
  APP_ENV?: string;
  ALLOWED_ORIGINS?: string;
  RATE_LIMIT_WINDOW_SECONDS?: string;
  RATE_LIMIT_DEFAULT_PER_WINDOW?: string;
  MEDIA_SCANNER_URL?: string;
  MEDIA_SCANNER_SECRET?: string;
};

export function allowedOrigin(env: SecurityBindings, origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  const configured = (env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!configured.length && String(env.APP_ENV) !== "production") {
    return ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8787", "http://127.0.0.1:8787"].includes(origin) ? origin : undefined;
  }
  return configured.includes(origin) ? origin : undefined;
}

export function applySecurityHeaders(headers: Headers): void {
  headers.set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://challenges.cloudflare.com; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
}

export async function enforceRateLimit(env: SecurityBindings, bucketKey: string, limit?: number, windowSeconds?: number): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
  const window = Math.max(1, windowSeconds ?? Number(env.RATE_LIMIT_WINDOW_SECONDS ?? 60));
  const max = Math.max(1, limit ?? Number(env.RATE_LIMIT_DEFAULT_PER_WINDOW ?? 120));
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / window) * window;
  await env.DB.prepare(`
    INSERT INTO rate_limit_buckets (bucket_key, window_start, request_count)
    VALUES (?, ?, 1)
    ON CONFLICT(bucket_key) DO UPDATE SET
      request_count = CASE WHEN rate_limit_buckets.window_start < excluded.window_start THEN 1 ELSE rate_limit_buckets.request_count + 1 END,
      window_start = CASE WHEN rate_limit_buckets.window_start < excluded.window_start THEN excluded.window_start ELSE rate_limit_buckets.window_start END,
      updated_at = CURRENT_TIMESTAMP
  `).bind(bucketKey, windowStart).run();
  const row = await env.DB.prepare("SELECT request_count, window_start FROM rate_limit_buckets WHERE bucket_key = ?").bind(bucketKey).first<{ request_count: number; window_start: number }>();
  const count = Number(row?.request_count ?? max + 1);
  const retryAfter = Math.max(1, Number(row?.window_start ?? windowStart) + window - now);
  return { allowed: count <= max, remaining: Math.max(0, max - count), retryAfter };
}

function startsWith(bytes: Uint8Array, values: number[]): boolean {
  return values.every((value, index) => bytes[index] === value);
}

function hasAscii(bytes: Uint8Array, value: string, offset: number): boolean {
  return [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

function signatureLooksValid(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === "image/jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (contentType === "image/png") return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (contentType === "image/gif") return hasAscii(bytes, "GIF8", 0);
  if (contentType === "image/webp") return hasAscii(bytes, "RIFF", 0) && hasAscii(bytes, "WEBP", 8);
  if (contentType === "image/avif" || contentType === "image/heic") return hasAscii(bytes, "ftyp", 4);
  if (contentType.startsWith("video/")) return (hasAscii(bytes, "ftyp", 4) || (hasAscii(bytes, "RIFF", 0) && hasAscii(bytes, "AVI ", 8)) || startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]) || startsWith(bytes, [0x00, 0x00, 0x01, 0xba]) || startsWith(bytes, [0x00, 0x00, 0x01, 0xb3]));
  return false;
}

export async function scanMediaObject(
  env: SecurityBindings,
  bucket: R2Bucket,
  objectKey: string,
  contentType: string,
): Promise<{ status: "passed" | "blocked" | "error"; scanner: string; checksum?: string; findings?: Record<string, unknown> }> {
  const object = await bucket.get(objectKey, { range: { offset: 0, length: 512 } });
  if (!object) return { status: "blocked", scanner: "r2", findings: { reason: "object_missing" } };
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (!signatureLooksValid(bytes, contentType)) return { status: "blocked", scanner: "magic-bytes", findings: { reason: "content_type_signature_mismatch" } };
  if (env.MEDIA_SCANNER_URL) {
    const response = await fetch(env.MEDIA_SCANNER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(env.MEDIA_SCANNER_SECRET ? { Authorization: `Bearer ${env.MEDIA_SCANNER_SECRET}` } : {}) },
      body: JSON.stringify({ objectKey, contentType }),
    });
    if (!response.ok) return { status: "error", scanner: "external", findings: { reason: "scanner_unavailable", status: response.status } };
    const result = await response.json() as { clean?: boolean; checksum?: string; findings?: Record<string, unknown> };
    return { status: result.clean === true ? "passed" : "blocked", scanner: "external", checksum: result.checksum, findings: result.findings ?? {} };
  }
  if (String(env.APP_ENV) === "production") return { status: "error", scanner: "signature-only-disabled-in-production", findings: { reason: "MEDIA_SCANNER_URL_required" } };
  return { status: "passed", scanner: "magic-bytes", findings: { warning: "signature-only-development-scan" } };
}
