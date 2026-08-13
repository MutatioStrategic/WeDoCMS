import { z } from "zod";

export type AuthBindings = {
  DB: D1Database;
  APP_ENV?: string;
  SESSION_SECRET?: string;
  DEMO_AUTH_ENABLED?: string;
  AUTH_JWT_SECRET?: string;
  AUTH_ISSUER?: string;
  AUTH_AUDIENCE?: string;
  AUTH_COOKIE_DOMAIN?: string;
};

export type RequestUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  onboardingStatus: string;
  organizationId: string;
  organizationName: string;
  residencyRegion: "za" | "eu";
  sessionId: string;
  csrfToken: string;
};

type SessionRow = {
  session_id: string;
  csrf_token: string;
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  onboarding_status: string | null;
  organization_id: string;
  organization_name: string;
  residency_region: "za" | "eu";
  session_expires_at: string;
};

const jwtClaimsSchema = z.object({
  sub: z.string().min(1).max(200),
  email: z.string().email().max(320).optional(),
  name: z.string().trim().min(1).max(180).optional(),
  org_id: z.string().min(1).max(120).optional(),
  org_name: z.string().trim().min(1).max(180).optional(),
  role: z.enum(["buyer", "contributor", "editor", "admin"]).optional(),
  iss: z.string().optional(),
  aud: z.union([z.string(), z.array(z.string())]).optional(),
  exp: z.number().optional(),
  nbf: z.number().optional(),
});

const utf8 = (value: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

async function hmac(secret: string, value: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(value))) as Uint8Array<ArrayBuffer>;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function cookieValue(request: Request): string | null {
  const cookies = request.headers.get("Cookie")?.split(";") ?? [];
  const item = cookies.map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith("va_session="));
  return item ? decodeURIComponent(item.slice("va_session=".length)) : null;
}

function sessionCookie(value: string, env: AuthBindings, maxAge: number): string {
  const attributes = ["HttpOnly", "Path=/", `Max-Age=${maxAge}`, "SameSite=Lax"];
  if (String(env.APP_ENV) === "production") attributes.push("Secure");
  if (env.AUTH_COOKIE_DOMAIN) attributes.push(`Domain=${env.AUTH_COOKIE_DOMAIN}`);
  return `va_session=${encodeURIComponent(value)}; ${attributes.join("; ")}`;
}

function clearSessionCookie(env: AuthBindings): string {
  return sessionCookie("", env, 0);
}

export function responseWithSession(response: Response, token: string, env: AuthBindings, maxAge = 8 * 60 * 60): Response {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", sessionCookie(token, env, maxAge));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function responseWithoutSession(response: Response, env: AuthBindings): Response {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", clearSessionCookie(env));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function requiredSecret(env: AuthBindings): string {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 32) return env.SESSION_SECRET;
  if (String(env.DEMO_AUTH_ENABLED) === "true") return "veld-archive-demo-session-secret-replace-before-production-use";
  throw new Error("SESSION_SECRET must be configured with at least 32 characters");
}

export async function createSession(env: AuthBindings, userId: string, organizationId: string): Promise<{ token: string; csrfToken: string; sessionId: string; expiresAt: string }> {
  const secret = requiredSecret(env);
  const sessionId = crypto.randomUUID();
  const csrfToken = base64UrlEncode(crypto.getRandomValues(new Uint8Array(24)));
  const tokenSecret = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const token = `${sessionId}.${tokenSecret}`;
  const tokenHash = await sha256Hex(`${secret}:${token}`);
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(`INSERT INTO auth_sessions (id, user_id, organization_id, token_hash, csrf_token, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(sessionId, userId, organizationId, tokenHash, csrfToken, expiresAt).run();
  return { token, csrfToken, sessionId, expiresAt };
}

export async function getRequestUser(env: AuthBindings, request: Request): Promise<RequestUser | null> {
  const session = cookieValue(request);
  if (!session) return null;
  const separator = session.indexOf(".");
  if (separator < 1) return null;
  const sessionId = session.slice(0, separator);
  const secret = requiredSecret(env);
  const tokenHash = await sha256Hex(`${secret}:${session}`);
  const row = await env.DB.prepare(`
    SELECT s.id AS session_id, s.csrf_token, s.user_id, u.email, u.display_name, om.role,
      u.onboarding_status, u.residency_region, o.id AS organization_id, o.name AS organization_name, s.expires_at AS session_expires_at
    FROM auth_sessions s
    JOIN users u ON u.id = s.user_id
    JOIN organization_memberships om ON om.user_id = s.user_id AND om.organization_id = s.organization_id AND om.status = 'active'
    JOIN organizations o ON o.id = s.organization_id AND o.status = 'active'
    WHERE s.id = ? AND s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP
  `).bind(sessionId, tokenHash).first<SessionRow>();
  if (!row) return null;
  await env.DB.prepare("UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").bind(sessionId).run();
  return {
    id: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    onboardingStatus: row.onboarding_status ?? "not_started",
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    residencyRegion: row.residency_region,
    sessionId: row.session_id,
    csrfToken: row.csrf_token,
  };
}

export function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

export function csrfValid(request: Request, user: RequestUser): boolean {
  if (isSafeMethod(request.method)) return true;
  const origin = request.headers.get("Origin");
  const host = request.headers.get("Host");
  if (origin && host && new URL(origin).host === host) return true;
  return timingSafeEqual(request.headers.get("X-CSRF-Token") ?? "", user.csrfToken);
}

export async function verifyExternalJwt(env: AuthBindings, token: string): Promise<z.infer<typeof jwtClaimsSchema> | null> {
  if (!env.AUTH_JWT_SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: { alg?: string; typ?: string };
  let claims: z.infer<typeof jwtClaimsSchema>;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0]))) as { alg?: string; typ?: string };
    claims = jwtClaimsSchema.parse(JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1]))));
  } catch { return null; }
  if (header.alg !== "HS256") return null;
  const expected = base64UrlEncode(await hmac(env.AUTH_JWT_SECRET, `${parts[0]}.${parts[1]}`));
  if (!timingSafeEqual(expected, parts[2])) return null;
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp !== undefined && claims.exp <= now) return null;
  if (claims.nbf !== undefined && claims.nbf > now) return null;
  if (env.AUTH_ISSUER && claims.iss !== env.AUTH_ISSUER) return null;
  if (env.AUTH_AUDIENCE && !(Array.isArray(claims.aud) ? claims.aud.includes(env.AUTH_AUDIENCE) : claims.aud === env.AUTH_AUDIENCE)) return null;
  return claims;
}

export { clearSessionCookie };
