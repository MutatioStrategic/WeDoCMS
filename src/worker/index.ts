import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { archiveDomain } from "../shared";
import type { AccountLifecycle, Asset, BuyerAnalytics, CommunityOverview, ContributorAnalytics, ContributorPerformance, CreatorProfile, DiscoveryResponse, LicenceProduct, LicenceRequest, MonetizationModel, PortfolioCollection, RightsCase, SavedSearch, SearchResponse, TakedownReason } from "../shared";
import {
  elapsedMilliseconds,
  logEvent,
  recordMetric,
  traceContext,
  type TraceContext,
} from "./observability";
import {
  catchUpR2Replication,
  replicateR2Event,
  type R2EventMessage,
} from "./replication";
import {
  appendAuditEvent,
  exportAuditEvents,
  getAuditBucket,
  redactAuditData,
  verifyAuditEvent,
  residencyRegionSchema,
  type AuditBindings,
  type StoredAuditEvent,
} from "./audit";
import { calculateMarketplaceSplit, IntegrationContainer } from "../integrations";
import { canonicalContract, ocrValidation, sanitizeOcrResult, sha256Hex } from "./seller-workflow";
import {
  enqueuePhotoJob,
  processPhotoJob,
  retryQueuedPhotoJobs,
  searchPhotoIndex,
  type PhotoEnrichmentJob,
  type PhotoPipelineBindings,
} from "./photo-indexing";
import {
  createSession,
  csrfValid,
  enrichExternalIdentity,
  getRequestUser,
  applicationRoleFromClaims,
  responseWithSession,
  responseWithoutSession,
  verifyExternalJwtWithProvider,
  type RequestUser,
} from "./auth";
import { allowedOrigin, applySecurityHeaders, enforceRateLimit, scanMediaObject, type SecurityBindings } from "./security";
import { discoveryTokens, isDemoAssetRow, normalizeSavedQuery, scoreRecommendation } from "./discovery";
import { parseCampaignBrief, rankCampaignAssets, type BrandKit, type CampaignBrief, type CampaignStage } from "../campaign-intelligence";
import { agreementText, buyerAgreement, getMarketplaceAgreement, paymentDisclosure, sellerAgreement } from "../legal/agreements";
import {
  assetCreateRequestSchema as contractAssetCreateRequestSchema,
  assetCreateResponseSchema,
  contractResponseValidationErrorSchema,
  ContractResponseValidationError,
  errorResponseSchema,
  governanceActionRequestSchema as contractGovernanceActionRequestSchema,
  governanceActionResponseSchema,
  healthResponseSchema,
  licenceRequestSchema as contractLicenceRequestSchema,
  searchResponseSchema,
  sessionResponseSchema,
  uploadCompleteResponseSchema,
  uploadRequestSchema as contractUploadRequestSchema,
  uploadResponseSchema,
  validateContractResponse,
} from "../contracts/schemas";

type SecretBindings = {
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_HOSTNAMES?: string;
  STREAM_WEBHOOK_SECRET?: string;
  STREAM_WEBHOOK_SECRET_STORE?: SecretStoreBinding;
  CHAOS_TEST_TOKEN?: string;
  CHAOS_TESTING_ENABLED?: string;
  APP_ENV?: string;
  AUDIT_RETENTION_DAYS?: string;
  AUDIT_ALLOWED_RESIDENCIES?: string;
  KYC_PROVIDER?: string;
  KYC_WEBHOOK_SECRET?: string;
  DIDIT_API_KEY?: string;
  DIDIT_WEBHOOK_SECRET?: string;
  DIDIT_KYC_WORKFLOW_ID?: string;
  DIDIT_KYB_WORKFLOW_ID?: string;
  APP_PUBLIC_URL?: string;
  CIPC_LOOKUP_URL?: string;
  CIPC_LOOKUP_TOKEN?: string;
  STRIPE_SECRET_KEY?: string;
  PAYFAST_ENDPOINT?: string;
  PAYFAST_TOKEN?: string;
  ZA_BANK_ENDPOINT?: string;
  ZA_BANK_TOKEN?: string;
  PAYOUT_MIN_CENTS?: string;
  DEFAULT_ARTIST_SHARE_PERCENTAGE?: string;
  PAYSTACK_SPLIT_FEE_BEARER?: string;
  OCR_ENABLED?: string;
  OCR_MODEL?: string;
  PHOTO_VISION_MODEL?: string;
  PHOTO_EMBEDDING_MODEL?: string;
  PHOTO_INDEX_NAMESPACE?: string;
  FIRMA_VERIFY_URL?: string;
  FIRMA_API_TOKEN?: string;
  SESSION_SECRET?: string;
  AUTH_JWT_SECRET?: string;
  AUTH_JWKS_URL?: string;
  AUTH_ISSUER?: string;
  AUTH_AUDIENCE?: string;
  AUTH_ROLES_CLAIM?: string;
  AUTH_USERINFO_URL?: string;
  AUTH_PROVIDER?: "auth0" | "supabase" | "both" | string;
  SUPABASE_URL?: string;
  SUPABASE_JWT_SECRET?: string;
  SUPABASE_JWKS_URL?: string;
  SUPABASE_ISSUER?: string;
  SUPABASE_AUDIENCE?: string;
  SUPABASE_ROLES_CLAIM?: string;
  AUTH_COOKIE_DOMAIN?: string;
  AUTH_ALLOW_ORG_PROVISIONING?: string;
  DEFAULT_ORGANIZATION_ID?: string;
  ALLOWED_ORIGINS?: string;
  RATE_LIMIT_WINDOW_SECONDS?: string;
  RATE_LIMIT_DEFAULT_PER_WINDOW?: string;
  UPLOAD_DAILY_QUOTA_BYTES?: string;
  ORG_STORAGE_QUOTA_BYTES?: string;
  MEDIA_SCANNER_URL?: string;
  MEDIA_SCANNER_SECRET?: string;
  PAYMENT_WEBHOOK_SECRET?: string;
  PAYMENT_WEBHOOK_SECRET_STORE?: SecretStoreBinding;
  PAYMENT_PROVIDER?: string;
  PAYMENT_ENDPOINT?: string;
  PAYMENT_TOKEN?: string;
  PAYMENT_TOKEN_STORE?: SecretStoreBinding;
  STREAM_ACCOUNT_ID?: string;
  STREAM_API_TOKEN?: string;
  STREAM_API_TOKEN_STORE?: SecretStoreBinding;
  STREAM_ALLOWED_ORIGINS?: string;
  IMAGE_DELIVERY_URL?: string;
  AUTH_ACCOUNT_PORTAL_URL?: string;
  TRENDING_SEARCH_MIN_COUNT?: string;
  EDGE_CONTROLS_ATTESTED_AT?: string;
  KEY_ROTATION_ATTESTED_AT?: string;
  BACKUP_RESTORE_ATTESTED_AT?: string;
};
type SecretStoreBinding = { get(): Promise<string> };
type WorkersAiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};
type Bindings = Omit<Cloudflare.Env, "AI"> & AuditBindings & SecretBindings & { AI?: WorkersAiBinding };

type Variables = { trace: TraceContext };
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

async function resolveSecret(value: string | undefined, store: SecretStoreBinding | undefined): Promise<string | undefined> {
  if (store) {
    try {
      const resolved = (await store.get()).trim();
      if (resolved) return resolved;
    } catch {
      // Fall back to the Worker-scoped secret while a store binding is unavailable.
    }
  }
  return value?.trim() || undefined;
}

const photoPipeline = (env: Bindings): PhotoPipelineBindings => env;

async function enqueuePhotoJobBestEffort(env: Bindings, assetId: string, operation: "enrich" | "sync_index"): Promise<boolean> {
  try {
    await enqueuePhotoJob(photoPipeline(env), assetId, operation);
    return true;
  } catch (error) {
    const trace = traceContext(new Request("https://internal/photo-job"));
    logEvent("error", "photo.job.enqueue_failed", trace, {
      assetId,
      operation,
      error: error instanceof Error ? error.message : "unknown-error",
    });
    recordMetric(env, "photo_job_enqueue_error", trace, 1, [operation]);
    return false;
  }
}

async function runMaintenance(env: Bindings): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_sessions WHERE expires_at < datetime('now', '-7 day') OR revoked_at < datetime('now', '-30 day')"),
    env.DB.prepare("DELETE FROM rate_limit_buckets WHERE updated_at < datetime('now', '-2 day')"),
    env.DB.prepare("DELETE FROM notifications WHERE created_at < datetime('now', '-365 day') AND read_at IS NOT NULL"),
    env.DB.prepare("UPDATE upload_sessions SET status = 'expired', failure_reason = 'upload_session_expired' WHERE status = 'created' AND created_at < datetime('now', '-1 day')"),
  ]);
  await generateSavedSearchAlerts(env);
}

app.use("*", async (c, next) => {
  const startedAt = performance.now();
  const trace = traceContext(c.req.raw);
  c.set("trace", trace);
  c.header("traceparent", trace.traceparent);
  applySecurityHeaders(c.res.headers);
  try {
    await next();
  } catch (error) {
    logEvent("error", "request.failed", trace, {
      method: c.req.method,
      path: c.req.path,
      error: error instanceof Error ? error.message : "unknown-error",
    });
    recordMetric(c.env, "request_error", trace, 1, [c.req.method, c.req.path]);
    throw error;
  } finally {
    const durationMs = elapsedMilliseconds(startedAt);
    logEvent("info", "request.completed", trace, {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs,
    });
    recordMetric(c.env, "request_duration_ms", trace, durationMs, [c.req.method, c.req.path]);
  }
});

app.use("/api/*", cors({
  origin: (origin, c) => allowedOrigin(c.env as SecurityBindings, origin) ?? "",
  allowHeaders: ["Content-Type", "Authorization", "X-CSRF-Token", "X-Request-Id"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
  maxAge: 600,
}));

app.use("/api/*", async (c, next) => {
  const exempt = c.req.path === "/api/auth/dev-login" || c.req.path === "/api/auth/exchange" || c.req.path === "/api/auth/logout" || c.req.path === "/api/security/turnstile" || c.req.path.startsWith("/api/webhooks/") || c.req.path === "/api/analytics/events" || c.req.path === "/api/checkout/validate";
  if (!exempt && !["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const user = await getRequestUser(c.env, c.req.raw);
    if (user && !csrfValid(c.req.raw, user)) return c.json({ error: "CSRF validation failed" }, 403);
  }
  const ipKey = `ip:${c.req.header("CF-Connecting-IP") ?? "unknown"}:${c.req.method}:${c.req.path}`;
  const rate = await enforceRateLimit(c.env, ipKey);
  const user = c.req.method === "POST" || c.req.method === "PUT" || c.req.method === "PATCH" ? await getRequestUser(c.env, c.req.raw) : null;
  const identityRate = user ? await enforceRateLimit(c.env, `user:${user.id}:${c.req.method}:${c.req.path}`, 60) : null;
  if (!rate.allowed || identityRate && !identityRate.allowed) {
    const retryAfter = Math.max(rate.retryAfter, identityRate?.retryAfter ?? 0);
    c.header("Retry-After", String(retryAfter));
    return c.json({ error: "Rate limit exceeded", retryAfter }, 429);
  }
  await next();
});

// Public, versioned copies are used by onboarding and checkout before a user
// signs anything. The hash is generated again when an acceptance is recorded.
app.get("/api/legal/agreements", (c) => {
  const requested = c.req.query("type");
  if (requested && !["seller", "buyer", "payment"].includes(requested)) return c.json({ error: "Unknown agreement type" }, 400);
  const documents = requested
    ? [getMarketplaceAgreement(requested as "seller" | "buyer" | "payment")]
    : [sellerAgreement, buyerAgreement, paymentDisclosure];
  return c.json({ documents });
});

const devLoginSchema = z.object({ role: z.enum(["buyer", "contributor", "admin"]) });
const exchangeSchema = z.object({ organizationId: z.string().min(1).max(120).optional() });

async function recordAuthSecurityEvent(
  c: { env: Bindings; req: { raw: Request; header(name: string): string | undefined } },
  eventType: string,
  provider: "auth0" | "supabase" | "unknown",
  fields: { subject?: string | null; organizationId?: string | null; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  const trace = traceContext(c.req.raw);
  const ip = c.req.header("CF-Connecting-IP") ?? "";
  const ipHash = ip ? await sha256Hex(`auth:${ip}`) : null;
  const metadata = JSON.stringify(fields.metadata ?? {});
  try {
    await c.env.DB.prepare(`INSERT INTO auth_security_events (id, provider, event_type, subject, organization_id, ip_hash, user_agent, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), provider, eventType, fields.subject ?? null, fields.organizationId ?? null, ipHash, c.req.header("User-Agent")?.slice(0, 500) ?? null, metadata)
      .run();
  } catch (error) {
    logEvent("error", "auth.security_event_persist_failed", trace, { eventType, provider, error: error instanceof Error ? error.message : "unknown" });
  }
  logEvent(eventType.includes("failed") ? "warn" : "info", `auth.${eventType}`, trace, { provider, subject: fields.subject ?? null, organizationId: fields.organizationId ?? null });
  recordMetric(c.env, `auth_${eventType}`, trace, 1, [provider]);
}

async function sessionResponse(c: { env: Bindings; req: { raw: Request }; json: (data: unknown, status?: number) => Response }, userId: string, organizationId: string): Promise<Response> {
  const session = await createSession(c.env, userId, organizationId);
  const user = await getRequestUser(c.env, new Request(c.req.raw.url, { headers: { Cookie: `va_session=${session.token}` } }));
  if (!user) return new Response(JSON.stringify({ error: "Could not create authenticated session" }), { status: 500, headers: { "Content-Type": "application/json" } });
  return responseWithSession(c.json({ authenticated: true, user, csrfToken: session.csrfToken, expiresAt: session.expiresAt }), session.token, c.env);
}

app.get("/api/auth/session", async (c) => {
  const user = await getRequestUser(c.env, c.req.raw);
  const response = user ? { authenticated: true as const, user, csrfToken: user.csrfToken } : { authenticated: false as const, user: null };
  return c.json(validateContractResponse("GET /api/auth/session 200", sessionResponseSchema, response));
});

app.post("/api/auth/logout", async (c) => {
  const user = await getRequestUser(c.env, c.req.raw);
  if (user) await c.env.DB.prepare("UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?").bind(user.sessionId).run();
  return responseWithoutSession(c.json({ authenticated: false }), c.env);
});

app.post("/api/auth/dev-login", async (c) => {
  if (String(c.env.APP_ENV) === "production") return c.json({ error: "Development authentication is disabled" }, 404);
  const payload = devLoginSchema.parse(await c.req.json());
  const userId = payload.role === "admin" ? "demo-admin" : payload.role === "contributor" ? "demo-contributor" : "demo-buyer";
  const user = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").bind(userId).first<{ id: string }>();
  const membership = await c.env.DB.prepare("SELECT organization_id FROM organization_memberships WHERE user_id = ? AND status = 'active' ORDER BY created_at LIMIT 1").bind(userId).first<{ organization_id: string }>();
  if (!user || !membership) return c.json({ error: "Development seed identity is not available; apply migrations first" }, 503);
  return sessionResponse(c, user.id, membership.organization_id);
});

app.post("/api/auth/exchange", async (c) => {
  const authorization = c.req.header("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const verifiedIdentity = await verifyExternalJwtWithProvider(c.env, token);
  if (!verifiedIdentity) {
    await recordAuthSecurityEvent(c, "exchange_failed", "unknown", { metadata: { reason: "invalid_or_unconfigured_token" } });
    return c.json({ error: "Verified identity token required" }, 401);
  }
  const identity = await enrichExternalIdentity(c.env, token, verifiedIdentity);
  if (!identity) {
    await recordAuthSecurityEvent(c, "exchange_failed", verifiedIdentity.provider, { subject: verifiedIdentity.claims.sub, metadata: { reason: "userinfo_verification_failed" } });
    return c.json({ error: "Auth0 user profile could not be verified" }, 401);
  }
  const { claims, provider } = identity;
  const requested = exchangeSchema.parse(await c.req.json().catch(() => ({})));
  if (requested.organizationId && claims.org_id && requested.organizationId !== claims.org_id) return c.json({ error: "Organization context does not match the identity token" }, 403);
  if (!claims.org_id && requested.organizationId && requested.organizationId !== c.env.DEFAULT_ORGANIZATION_ID) return c.json({ error: "Organization context is not authorized by the identity token" }, 403);
  const organizationId = claims.org_id ?? c.env.DEFAULT_ORGANIZATION_ID;
  if (!organizationId) return c.json({ error: "An organization context is required" }, 422);
  const applicationRole = applicationRoleFromClaims(claims, c.env);
  const subjectKey = provider === "supabase" ? `supabase:${claims.sub}` : claims.sub;
  let user = await c.env.DB.prepare("SELECT id, email FROM users WHERE auth_subject = ? AND status = 'active'").bind(subjectKey).first<{ id: string; email: string }>();
  if (!user) {
    const organization = await c.env.DB.prepare("SELECT id, name FROM organizations WHERE id = ? AND status = 'active'").bind(organizationId).first<{ id: string; name: string }>();
    if (!organization && String(c.env.AUTH_ALLOW_ORG_PROVISIONING) !== "true") return c.json({ error: "Organization is not provisioned" }, 403);
    const userId = crypto.randomUUID();
    try {
      await c.env.DB.prepare("INSERT INTO users (id, auth_subject, email, display_name, role, email_verified_at) VALUES (?, ?, ?, ?, ?, CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END)")
        .bind(userId, subjectKey, claims.email ?? `${subjectKey}@identity.invalid`, claims.name ?? claims.email ?? claims.sub, applicationRole, claims.email_verified === true).run();
    } catch {
      await recordAuthSecurityEvent(c, "exchange_failed", provider, { subject: claims.sub, organizationId, metadata: { reason: "identity_conflict" } });
      return c.json({ error: "An account already exists under another identity provider" }, 409);
    }
    if (!organization) await c.env.DB.prepare("INSERT INTO organizations (id, name, slug, created_by) VALUES (?, ?, ?, ?)").bind(organizationId, claims.org_name ?? "New organization", organizationId.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60), userId).run();
    await c.env.DB.prepare("INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), organizationId, userId, applicationRole).run();
    user = { id: userId, email: claims.email ?? `${subjectKey}@identity.invalid` };
  }
  const membership = await c.env.DB.prepare("SELECT organization_id FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND status = 'active'").bind(organizationId, user.id).first<{ organization_id: string }>();
  if (!membership) {
    await recordAuthSecurityEvent(c, "exchange_failed", provider, { subject: claims.sub, organizationId, metadata: { reason: "membership_denied" } });
    return c.json({ error: "User is not a member of the requested organization" }, 403);
  }
  await recordAuthSecurityEvent(c, "exchange_succeeded", provider, { subject: claims.sub, organizationId });
  return sessionResponse(c, user.id, membership.organization_id);
});

app.get("/api/me", async (c) => {
  const user = await getRequestUser(c.env, c.req.raw);
  return user ? c.json({ authenticated: true, user, csrfToken: user.csrfToken }) : c.json({ authenticated: false, user: null });
});

app.get("/api/notifications", async (c) => {
  const user = await getRequestUser(c.env, c.req.raw);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const rows = await c.env.DB.prepare("SELECT id, type, title, body, resource_type, resource_id, read_at, created_at FROM notifications WHERE organization_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 100").bind(user.organizationId, user.id).all();
  return c.json({ results: rows.results });
});

app.post("/api/notifications/:id/read", async (c) => {
  const user = await getRequestUser(c.env, c.req.raw);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  await c.env.DB.prepare("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ? AND user_id = ?").bind(c.req.param("id"), user.organizationId, user.id).run();
  return c.json({ ok: true });
});

app.get("/api/organization/members", async (c) => {
  const user = await getRequestUser(c.env, c.req.raw);
  if (!user || !["admin", "editor"].includes(user.role)) return c.json({ error: "Organization administration required" }, 403);
  const rows = await c.env.DB.prepare("SELECT om.id, u.id AS user_id, u.email, u.display_name, om.role, om.status, om.created_at FROM organization_memberships om JOIN users u ON u.id = om.user_id WHERE om.organization_id = ? ORDER BY u.display_name").bind(user.organizationId).all();
  return c.json({ organization: { id: user.organizationId, name: user.organizationName }, results: rows.results });
});

app.post("/api/organization/invitations", async (c) => {
  const user = await getRequestUser(c.env, c.req.raw);
  if (!user || user.role !== "admin") return c.json({ error: "Organization administrator required" }, 403);
  const payload = z.object({ email: z.string().email().max(320), role: z.enum(["buyer", "contributor", "editor", "admin"]) }).parse(await c.req.json());
  const token = base64UrlToken();
  const tokenHash = await sha256Hex(token);
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO organization_invitations (id, organization_id, email, role, token_hash, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+7 day'))")
    .bind(id, user.organizationId, payload.email.toLowerCase(), payload.role, tokenHash, user.id).run();
  return c.json({ invitationId: id, token, expiresInDays: 7 }, 201);
});

app.post("/api/organization/invitations/accept", async (c) => {
  const user = await getRequestUser(c.env, c.req.raw);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const payload = z.object({ token: z.string().min(20).max(200) }).parse(await c.req.json());
  const tokenHash = await sha256Hex(payload.token);
  const invitation = await c.env.DB.prepare("SELECT id, organization_id, email, role FROM organization_invitations WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > CURRENT_TIMESTAMP").bind(tokenHash).first<{ id: string; organization_id: string; email: string; role: string }>();
  if (!invitation || invitation.email.toLowerCase() !== user.email.toLowerCase()) return c.json({ error: "Invitation is invalid, expired, or addressed to another user" }, 422);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO organization_memberships (id, organization_id, user_id, role, status) VALUES (?, ?, ?, ?, 'active') ON CONFLICT(organization_id, user_id) DO UPDATE SET role = excluded.role, status = 'active', updated_at = CURRENT_TIMESTAMP").bind(crypto.randomUUID(), invitation.organization_id, user.id, invitation.role),
    c.env.DB.prepare("UPDATE organization_invitations SET accepted_at = CURRENT_TIMESTAMP WHERE id = ?").bind(invitation.id),
  ]);
  return c.json({ organizationId: invitation.organization_id, role: invitation.role, accepted: true });
});

app.post("/api/auth/switch-organization", async (c) => {
  const user = await getRequestUser(c.env, c.req.raw);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const payload = z.object({ organizationId: z.string().min(1).max(120) }).parse(await c.req.json());
  const membership = await c.env.DB.prepare("SELECT organization_id FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND status = 'active'").bind(payload.organizationId, user.id).first<{ organization_id: string }>();
  if (!membership) return c.json({ error: "Organization membership required" }, 403);
  return sessionResponse(c, user.id, membership.organization_id);
});

const creatorProfileInputSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(100),
  headline: z.string().trim().max(180).default(""), bio: z.string().trim().max(3000).default(""), location: z.string().trim().max(180).default(""),
  specialties: z.array(z.string().trim().min(1).max(60)).max(12).default([]), websiteUrl: z.string().url().max(2048).nullable().optional(),
  visibility: z.enum(["private", "public"]).default("private"), featuredAssetId: z.string().max(120).nullable().optional(),
});
const collectionInputSchema = z.object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(100), title: z.string().trim().min(3).max(180), description: z.string().trim().max(2000).default(""), coverAssetId: z.string().max(120).nullable().optional(), visibility: z.enum(["private", "public"]).default("private"), assetIds: z.array(z.string().max(120)).max(100).default([]) });

app.get("/api/me/creator-profile", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "editor", "admin"])) return c.json({ error: "Contributor access required" }, 403);
  const row = await c.env.DB.prepare(`SELECT cp.*, u.display_name, (SELECT COUNT(*) FROM assets a WHERE a.owner_id = cp.user_id AND a.status = 'published') AS asset_count, (SELECT COUNT(*) FROM portfolio_collections pc WHERE pc.owner_id = cp.user_id AND pc.visibility = 'public') AS collection_count FROM creator_profiles cp JOIN users u ON u.id = cp.user_id WHERE cp.user_id = ?`).bind(user.id).first<Record<string, unknown>>();
  return c.json({ profile: row ? creatorProfileFromRow(row) : null });
});

app.put("/api/me/creator-profile", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "editor", "admin"])) return c.json({ error: "Contributor access required" }, 403);
  const payload = creatorProfileInputSchema.parse(await c.req.json());
  if (payload.featuredAssetId) {
    const asset = await c.env.DB.prepare("SELECT id FROM assets WHERE id = ? AND owner_id = ? AND organization_id = ? AND status = 'published'").bind(payload.featuredAssetId, user.id, user.organizationId).first();
    if (!asset) return c.json({ error: "Featured asset must be one of your published assets" }, 422);
  }
  await c.env.DB.prepare(`INSERT INTO creator_profiles (user_id, slug, headline, bio, location, specialties_json, website_url, visibility, featured_asset_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET slug = excluded.slug, headline = excluded.headline, bio = excluded.bio, location = excluded.location, specialties_json = excluded.specialties_json, website_url = excluded.website_url, visibility = excluded.visibility, featured_asset_id = excluded.featured_asset_id, updated_at = CURRENT_TIMESTAMP`)
    .bind(user.id, payload.slug, payload.headline, payload.bio, payload.location, JSON.stringify(payload.specialties), payload.websiteUrl ?? null, payload.visibility, payload.featuredAssetId ?? null).run();
  await c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, 'creator_profile_updated', 'creator_profile', ?, ?)").bind(crypto.randomUUID(), user.id, user.id, JSON.stringify({ visibility: payload.visibility })).run();
  return c.json({ saved: true, slug: payload.slug });
});

app.get("/api/me/collections", async (c) => {
  const user = await requestUser(c); if (!user) return c.json({ error: "Authentication required" }, 401);
  const rows = await c.env.DB.prepare(`SELECT pc.*, cp.slug AS creator_slug, u.display_name AS creator_name, (SELECT COUNT(*) FROM portfolio_collection_assets pca WHERE pca.collection_id = pc.id) AS asset_count FROM portfolio_collections pc JOIN users u ON u.id = pc.owner_id LEFT JOIN creator_profiles cp ON cp.user_id = pc.owner_id WHERE pc.owner_id = ? AND pc.organization_id = ? ORDER BY pc.updated_at DESC`).bind(user.id, user.organizationId).all<Record<string, unknown>>();
  return c.json({ results: rows.results.map(portfolioCollectionFromRow) });
});

app.post("/api/me/collections", async (c) => {
  const user = await requestUser(c); if (!user || !allowedRole(user, ["contributor", "editor", "admin"])) return c.json({ error: "Contributor access required" }, 403);
  const payload = collectionInputSchema.parse(await c.req.json()); const id = crypto.randomUUID();
  const owned = payload.assetIds.length ? await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM assets WHERE organization_id = ? AND owner_id = ? AND status = 'published' AND id IN (${payload.assetIds.map(() => "?").join(",")})`).bind(user.organizationId, user.id, ...payload.assetIds).first<{ count: number }>() : { count: 0 };
  if (Number(owned?.count ?? 0) !== payload.assetIds.length) return c.json({ error: "Collections can only include your published assets" }, 422);
  if (payload.coverAssetId && !payload.assetIds.includes(payload.coverAssetId)) return c.json({ error: "Cover asset must appear in the collection" }, 422);
  const statements: D1PreparedStatement[] = [c.env.DB.prepare("INSERT INTO portfolio_collections (id, organization_id, owner_id, slug, title, description, cover_asset_id, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, user.organizationId, user.id, payload.slug, payload.title, payload.description, payload.coverAssetId ?? null, payload.visibility)];
  payload.assetIds.forEach((assetId, index) => statements.push(c.env.DB.prepare("INSERT INTO portfolio_collection_assets (collection_id, asset_id, sort_order) VALUES (?, ?, ?)").bind(id, assetId, index)));
  await c.env.DB.batch(statements); return c.json({ id, slug: payload.slug }, 201);
});

app.get("/api/account/lifecycle", async (c) => {
  const user = await requestUser(c); if (!user) return c.json({ error: "Authentication required" }, 401);
  const [prefs, exportJob, deletion] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM account_security_preferences WHERE user_id = ?").bind(user.id).first<Record<string, unknown>>(),
    c.env.DB.prepare("SELECT status FROM account_export_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").bind(user.id).first<{ status: AccountLifecycle["exportStatus"] }>(),
    c.env.DB.prepare("SELECT status FROM account_deletion_requests WHERE user_id = ? ORDER BY requested_at DESC LIMIT 1").bind(user.id).first<{ status: Exclude<AccountLifecycle["deletionStatus"], "none"> }>(),
  ]);
  const lifecycle: AccountLifecycle = { emailVerified: Boolean((await c.env.DB.prepare("SELECT email_verified_at FROM users WHERE id = ?").bind(user.id).first<{ email_verified_at: string | null }>())?.email_verified_at), mfaEnrolled: Boolean(prefs?.mfa_enrolled_at), emailNotifications: prefs?.email_notifications !== 0, productNotifications: prefs?.product_notifications !== 0, exportStatus: exportJob?.status ?? "not_requested", deletionStatus: deletion?.status ?? "none" };
  return c.json({ ...lifecycle, accountPortalUrl: c.env.AUTH_ACCOUNT_PORTAL_URL ?? null });
});

app.put("/api/account/preferences", async (c) => {
  const user = await requestUser(c); if (!user) return c.json({ error: "Authentication required" }, 401);
  const payload = z.object({ emailNotifications: z.boolean(), productNotifications: z.boolean() }).parse(await c.req.json());
  await c.env.DB.prepare("INSERT INTO account_security_preferences (user_id, email_notifications, product_notifications, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET email_notifications = excluded.email_notifications, product_notifications = excluded.product_notifications, updated_at = CURRENT_TIMESTAMP").bind(user.id, Number(payload.emailNotifications), Number(payload.productNotifications)).run();
  return c.json({ saved: true });
});

app.post("/api/account/exports", async (c) => {
  const user = await requestUser(c); if (!user) return c.json({ error: "Authentication required" }, 401);
  const id = crypto.randomUUID(); await c.env.DB.prepare("INSERT INTO account_export_jobs (id, user_id, organization_id, status) VALUES (?, ?, ?, 'queued')").bind(id, user.id, user.organizationId).run();
  await c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id) VALUES (?, ?, 'account_export_requested', 'account_export', ?)").bind(crypto.randomUUID(), user.id, id).run();
  return c.json({ id, status: "queued", message: "Your export is queued. Production delivery is a short-lived signed download sent by the configured identity provider." }, 202);
});

app.post("/api/account/deletion", async (c) => {
  const user = await requestUser(c); if (!user) return c.json({ error: "Authentication required" }, 401);
  const id = crypto.randomUUID(); const existing = await c.env.DB.prepare("SELECT id FROM account_deletion_requests WHERE user_id = ? AND status IN ('requested', 'scheduled')").bind(user.id).first();
  if (existing) return c.json({ error: "An account deletion request is already active" }, 409);
  await c.env.DB.prepare("INSERT INTO account_deletion_requests (id, user_id, organization_id, scheduled_for) VALUES (?, ?, ?, datetime('now', '+30 day'))").bind(id, user.id, user.organizationId).run();
  await c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id) VALUES (?, ?, 'account_deletion_requested', 'account_deletion', ?)").bind(crypto.randomUUID(), user.id, id).run();
  return c.json({ id, status: "requested", scheduledFor: "30 days from now" }, 202);
});

function base64UrlToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}


const assetRowToDomain = (row: Record<string, unknown>): Asset => ({
  id: String(row.id),
  kind: row.kind as Asset["kind"],
  status: row.status as Asset["status"],
  title: String(row.title),
  description: String(row.description ?? ""),
  caption: String(row.caption ?? ""),
  country: String(row.country),
  province: (row.province as string | null) ?? null,
  city: (row.city as string | null) ?? null,
  locality: (row.locality as string | null) ?? null,
  landmark: (row.landmark as string | null) ?? null,
  subjectTags: JSON.parse(String(row.subject_tags ?? "[]")) as string[],
  culturalTags: JSON.parse(String(row.cultural_tags ?? "[]")) as string[],
  rightsStatus: row.rights_status as Asset["rightsStatus"],
  modelReleaseStatus: row.model_release_status as Asset["modelReleaseStatus"],
  propertyReleaseStatus: row.property_release_status as Asset["propertyReleaseStatus"],
  authenticityConfidence: Number(row.authenticity_confidence ?? 0),
  aiConfidence: Number(row.ai_confidence ?? row.authenticity_confidence ?? 0),
  humanVerified: Boolean(row.human_verified),
  contributor: String(row.contributor ?? "Veld Studio"),
  workflowStage: (row.workflow_stage as Asset["workflowStage"]) ?? "ingestion",
  aiTags: JSON.parse(String(row.ai_tags ?? "[]")) as string[],
  curatorNotes: String(row.curator_notes ?? ""),
  metadataReviewStatus: row.metadata_review_status as Asset["metadataReviewStatus"] | undefined,
  metadataReviewNote: row.metadata_review_note as string | undefined,
  metadataProvenance: row.metadata_provenance as Asset["metadataProvenance"] | undefined,
  sourceFileName: (row.source_file_name as string | null) ?? null,
  sourceUrl: (row.source_url as string | null) ?? null,
  sourceLicense: (row.source_license as string | null) ?? null,
  sourceAttribution: (row.source_attribution as string | null) ?? null,
  artistLicenseKey: (row.artist_license_key as Asset["artistLicenseKey"]) ?? "custom",
  artistLicenseVersion: (row.artist_license_version as string | null) ?? null,
  artistLicenseUrl: (row.artist_license_url as string | null) ?? null,
  artistLicenseTerms: (row.artist_license_terms as string | null) ?? null,
  artistLicenseSha256: (row.artist_license_sha256 as string | null) ?? null,
  monetizationModel: (row.monetization_model as MonetizationModel | undefined) ?? "membership",
  licensePriceCents: row.license_price_cents == null ? null : Number(row.license_price_cents),
  previewUrl: row.kind === "image" && row.original_key
    ? `/api/assets/${String(row.id)}/image/preview`
    : row.preview_key ? `/api/assets/${String(row.id)}/media?variant=preview` : null,
  mediaContentType: (row.media_content_type as string | null) ?? null,
  mediaWidth: row.media_width == null ? null : Number(row.media_width),
  mediaHeight: row.media_height == null ? null : Number(row.media_height),
  mediaDurationSeconds: row.media_duration_seconds == null ? null : Number(row.media_duration_seconds),
  mediaOrientation: (row.media_orientation as Asset["mediaOrientation"]) ?? null,
  mediaHasPeople: Boolean(row.media_has_people),
  mediaUsageType: (row.media_usage_type as Asset["mediaUsageType"]) ?? "commercial",
  mediaAiGenerated: Boolean(row.media_ai_generated),
});

function savedSearchAssetFilter(query: string, kind: "all" | "image" | "video", production: boolean, createdAfter?: string): { sql: string; values: string[] } {
  const clauses = ["a.status = 'published'"];
  const values: string[] = [];
  if (production) clauses.push("COALESCE(a.demo_seed, 0) = 0 AND a.id NOT LIKE 'asset-demo-%' AND a.id NOT LIKE 'asset-test-photo-%'");
  if (kind !== "all") {
    clauses.push("a.kind = ?");
    values.push(kind);
  }
  if (createdAfter) {
    clauses.push("a.created_at > ?");
    values.push(createdAfter);
  }
  for (const token of discoveryTokens([query]).slice(0, 6)) {
    clauses.push("(lower(a.title) LIKE ? OR lower(a.description) LIKE ? OR lower(a.caption) LIKE ? OR lower(a.subject_tags) LIKE ? OR lower(a.cultural_tags) LIKE ? OR lower(COALESCE(a.city, '')) LIKE ? OR lower(COALESCE(a.province, '')) LIKE ?)");
    const pattern = `%${token}%`;
    values.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }
  return { sql: clauses.join(" AND "), values };
}

async function generateSavedSearchAlerts(env: Bindings): Promise<void> {
  const due = await env.DB.prepare(`SELECT id, organization_id, owner_id, name, query, media_kind, alert_frequency, last_checked_at
    FROM saved_searches
    WHERE alert_frequency IN ('daily', 'weekly') AND next_alert_at <= CURRENT_TIMESTAMP
    ORDER BY next_alert_at ASC LIMIT 100`).all<Record<string, unknown>>();
  const production = String(env.APP_ENV) === "production";
  for (const row of due.results) {
    const filter = savedSearchAssetFilter(String(row.query), row.media_kind as "all" | "image" | "video", production, String(row.last_checked_at));
    const match = await env.DB.prepare(`SELECT COUNT(*) AS count FROM assets a WHERE a.organization_id = ? AND ${filter.sql}`)
      .bind(String(row.organization_id), ...filter.values).first<{ count: number }>();
    const count = Number(match?.count ?? 0);
    const nextAlert = new Date(Date.now() + (row.alert_frequency === "daily" ? 1 : 7) * 86_400_000).toISOString();
    const statements = [
      env.DB.prepare("UPDATE saved_searches SET last_checked_at = CURRENT_TIMESTAMP, next_alert_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(nextAlert, String(row.id)),
    ];
    if (count > 0) {
      statements.unshift(env.DB.prepare(`INSERT INTO notifications
        (id, organization_id, user_id, type, title, body, resource_type, resource_id)
        VALUES (?, ?, ?, 'saved_search_alert', ?, ?, 'saved_search', ?)`)
        .bind(crypto.randomUUID(), String(row.organization_id), String(row.owner_id), `New matches for ${String(row.name)}`, `${count} new photo or video record${count === 1 ? " matches" : "s match"} your saved search.`, String(row.id)));
    }
    await env.DB.batch(statements);
  }
}

function addReleaseDocuments(asset: Asset, rows: Record<string, unknown>[]): Asset {
  return rows.length ? {
    ...asset,
    releases: rows.map((row) => ({
      type: row.release_type as "model" | "property",
      status: row.status as Asset["modelReleaseStatus"],
      label: row.release_type === "model" ? "Model release" : "Property release",
      documentName: (row.document_name as string | null) ?? null,
    })),
  } : asset;
}

function parseStringArray(value: unknown): string[] {
  try { return Array.isArray(JSON.parse(String(value ?? "[]"))) ? JSON.parse(String(value ?? "[]")) as string[] : []; } catch { return []; }
}

function creatorProfileFromRow(row: Record<string, unknown>): CreatorProfile {
  return {
    id: String(row.user_id), slug: String(row.slug), name: String(row.display_name), headline: String(row.headline ?? ""),
    bio: String(row.bio ?? ""), location: String(row.location ?? ""), specialties: parseStringArray(row.specialties_json),
    websiteUrl: row.website_url == null ? null : String(row.website_url), assetCount: Number(row.asset_count ?? 0),
    collectionCount: Number(row.collection_count ?? 0), featuredAssetId: row.featured_asset_id == null ? null : String(row.featured_asset_id),
  };
}

function portfolioCollectionFromRow(row: Record<string, unknown>): PortfolioCollection {
  return {
    id: String(row.id), slug: String(row.slug), title: String(row.title), description: String(row.description ?? ""),
    assetCount: Number(row.asset_count ?? 0), coverAssetId: row.cover_asset_id == null ? null : String(row.cover_asset_id),
    creator: { slug: String(row.creator_slug), name: String(row.creator_name) },
  };
}

const searchSchema = z.object({
  q: z.string().trim().max(240).default(""),
  kind: z.enum(["all", "image", "video"]).default("all"),
  location: z.string().trim().max(80).optional(),
  status: z.enum(["published", "needs_review", "all"]).default("published"),
  sort: z.enum(["relevance", "newest", "popular", "random"]).default("relevance"),
  orientation: z.enum(["all", "landscape", "portrait", "square"]).default("all"),
  usage: z.enum(["all", "commercial", "editorial"]).default("all"),
  people: z.enum(["all", "with_people", "without_people"]).default("all"),
  ai: z.enum(["all", "ai_generated", "not_ai_generated"]).default("all"),
  exclude: z.string().trim().max(240).optional(),
  cursor: z.string().regex(/^\d+$/).optional(),
});

const analyticsEventSchema = z.object({
  consent: z.literal(true),
  type: z.enum(["search", "tag_click", "asset_view"]),
  query: z.string().trim().max(80).optional(),
  tag: z.string().trim().max(80).optional(),
  assetId: z.string().trim().max(100).optional(),
  country: z.string().trim().max(80).optional(),
  province: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
});

const normalizedMetric = (value: string | undefined): string => (value ?? "")
  .normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 80);
const today = (): string => new Date().toISOString().slice(0, 10);

const governanceStageSchema = z.enum(["all", "ingestion", "ai_tagging", "curator_correction", "approval"]);

app.get("/api/governance/assets", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Editor access required" }, 403);
  const stage = governanceStageSchema.parse(c.req.query("stage") ?? "all");
  const where = stage === "all" ? "a.organization_id = ?" : "a.organization_id = ? AND a.workflow_stage = ?";
  const result = await c.env.DB.prepare(`
    SELECT a.*, u.display_name AS contributor
    FROM assets a JOIN users u ON u.id = a.owner_id
    WHERE ${where}
    ORDER BY CASE a.workflow_stage WHEN 'curator_correction' THEN 1 WHEN 'ai_tagging' THEN 2 WHEN 'ingestion' THEN 3 ELSE 4 END, a.updated_at DESC
    LIMIT 100
  `).bind(...(stage === "all" ? [user.organizationId] : [user.organizationId, stage])).all<Record<string, unknown>>();
  return c.json({ results: (result.results as Record<string, unknown>[]).map(assetRowToDomain) });
});

const governanceActionSchema = contractGovernanceActionRequestSchema;

app.post("/api/governance/assets/:id/action", async (c) => {
  const actor = await requestUser(c);
  if (!actor || !allowedRole(actor, ["contributor", "editor", "admin"])) return c.json({ error: "Contributor or editor access required" }, 403);
  const payload = governanceActionSchema.parse(await c.req.json());
  if (payload.monetizationModel === "individual_license" && (!payload.licensePriceCents || payload.licensePriceCents < 100)) {
    return c.json({ error: "Individual licences must have a price of at least ZAR 1.00" }, 422);
  }
  const safetyIssue = payload.culturalTags ? metadataSafetyIssue(payload.culturalTags) : null;
  if (safetyIssue) return c.json({ error: safetyIssue, code: "metadata_context_required" }, 422);
  const assetId = c.req.param("id");
  const exists = await c.env.DB.prepare("SELECT id, owner_id, organization_id, kind FROM assets WHERE id = ? AND organization_id = ?").bind(assetId, actor.organizationId).first<{ id: string; owner_id: string; organization_id: string; kind: "image" | "video" }>();
  if (!exists) return c.json({ error: "Asset not found" }, 404);
  if (exists.owner_id !== actor.id && !allowedRole(actor, ["editor", "admin"])) return c.json({ error: "Forbidden" }, 403);
  const stage = payload.action === "run_ai_tagging" ? "ai_tagging" : payload.action === "approve" ? "approval" : "curator_correction";
  const status = payload.action === "approve" ? "published" : payload.action === "reject" ? "rejected" : "needs_review";
  await c.env.DB.prepare(`
    UPDATE assets SET status = ?, workflow_stage = ?, title = COALESCE(?, title), caption = COALESCE(?, caption),
      subject_tags = COALESCE(?, subject_tags), cultural_tags = COALESCE(?, cultural_tags), ai_tags = COALESCE(?, ai_tags),
      curator_notes = COALESCE(?, curator_notes), rights_status = COALESCE(?, rights_status),
      model_release_status = COALESCE(?, model_release_status), property_release_status = COALESCE(?, property_release_status),
      monetization_model = COALESCE(?, monetization_model),
      license_price_cents = CASE WHEN ? = 'individual_license' THEN ? WHEN ? IN ('membership', 'custom_quote') THEN NULL ELSE license_price_cents END,
      human_verified = ?, updated_at = CURRENT_TIMESTAMP, last_reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND organization_id = ?
  `).bind(
    status, stage, payload.title ?? null, payload.caption ?? null,
    payload.subjectTags ? JSON.stringify(payload.subjectTags) : null,
    payload.culturalTags ? JSON.stringify(payload.culturalTags) : null,
    payload.aiTags ? JSON.stringify(payload.aiTags) : null,
    payload.curatorNotes ?? null, payload.rightsStatus ?? null, payload.modelReleaseStatus ?? null,
    payload.propertyReleaseStatus ?? null, payload.monetizationModel ?? null,
    payload.monetizationModel ?? null, payload.licensePriceCents ?? null, payload.monetizationModel ?? null,
    payload.action === "approve" ? 1 : 0, assetId, actor.organizationId,
  ).run();
  await c.env.DB.prepare("INSERT INTO metadata_events (id, asset_id, actor_id, event_type, payload) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), assetId, actor.id, payload.action === "run_ai_tagging" ? "ai_tagged" : payload.action === "save_correction" ? "curator_corrected" : payload.action === "approve" ? "approved" : "rejected", JSON.stringify(payload)).run();
  let indexing = "not_required";
  if (payload.action === "run_ai_tagging") {
    indexing = (await enqueuePhotoJobBestEffort(c.env, assetId, "enrich")) ? "enrichment_queued" : "enrichment_retry_pending";
  } else if ((payload.action === "approve" || payload.action === "reject") && exists.kind === "image") {
    indexing = (await enqueuePhotoJobBestEffort(c.env, assetId, "sync_index")) ? "index_sync_queued" : "index_sync_retry_pending";
  }
  return c.json(validateContractResponse("POST /api/governance/assets/{id}/action 200", governanceActionResponseSchema, { ok: true, assetId, stage, status, indexing }));
});

const onboardingSchema = z.object({
  bio: z.string().trim().max(2000).default(""),
  organisationName: z.string().trim().max(180).optional(),
  languages: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  specialties: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  contributorType: z.enum(["individual", "agency", "archive", "institution"]).default("individual"),
  location: z.string().trim().max(180).optional(),
  equipment: z.string().trim().max(1000).default(""),
  portfolioUrl: z.string().url().max(500).optional().or(z.literal("")),
  acceptTerms: z.boolean().default(false),
});

app.get("/api/onboarding", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const profile = await c.env.DB.prepare("SELECT * FROM contributor_profiles WHERE user_id = ?").bind(user.id).first<Record<string, unknown>>();
  return c.json({ user, profile });
});

app.put("/api/onboarding", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "admin"])) return c.json({ error: "Contributor access required" }, 403);
  const payload = onboardingSchema.parse(await c.req.json());
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET bio = ?, organisation_name = ?, languages = ?, specialties = ?, onboarding_status = ? WHERE id = ?")
      .bind(payload.bio, payload.organisationName ?? null, JSON.stringify(payload.languages), JSON.stringify(payload.specialties), payload.acceptTerms ? "submitted" : "in_progress", user.id),
    c.env.DB.prepare(`INSERT INTO contributor_profiles (user_id, contributor_type, location, equipment, portfolio_url, terms_accepted_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET contributor_type = excluded.contributor_type, location = excluded.location, equipment = excluded.equipment, portfolio_url = excluded.portfolio_url, terms_accepted_at = excluded.terms_accepted_at, updated_at = excluded.updated_at`)
      .bind(user.id, payload.contributorType, payload.location ?? null, payload.equipment, payload.portfolioUrl ?? null, payload.acceptTerms ? now : null, now),
    ...(payload.acceptTerms ? [c.env.DB.prepare(`INSERT OR IGNORE INTO marketplace_agreement_acceptances
      (id, organization_id, user_id, agreement_type, agreement_version, terms_sha256, context_type, context_id, accepted_at)
      VALUES (?, ?, ?, 'seller', ?, ?, 'onboarding', ?, ?)`)
      .bind(crypto.randomUUID(), user.organizationId, user.id, sellerAgreement.version, await sha256Hex(agreementText(sellerAgreement)), user.id, now)] : []),
  ]);
  return c.json({ ok: true, status: payload.acceptTerms ? "submitted" : "in_progress" });
});

const sellerOnboardingSchema = z.object({
  sellerType: z.enum(["individual", "company"]),
  legalName: z.string().trim().min(2).max(180),
  phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Use an international phone number, for example +27821234567"),
  ageConfirmed: z.boolean(),
  identityDocumentType: z.enum(["sa_id", "passport"]),
  bankAccountName: z.string().trim().min(2).max(180),
  copyrightDeclaration: z.boolean(),
  taxResponsibilityDeclaration: z.boolean(),
  contributorAgreement: z.boolean(),
  registeredName: z.string().trim().max(180).optional(),
  cipcRegistrationNumber: z.string().trim().max(40).optional(),
  representativeName: z.string().trim().max(180).optional(),
  representativeAuthority: z.boolean().default(false),
  beneficialOwnerRequired: z.boolean().default(false),
});

function sameName(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase().replace(/\s+/g, " ") === right.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

app.get("/api/onboarding/seller", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const seller = await c.env.DB.prepare("SELECT * FROM seller_onboarding_profiles WHERE contributor_id = ?").bind(user.id).first<Record<string, unknown>>();
  return c.json({ seller: seller ?? null, emailVerified: Boolean((await c.env.DB.prepare("SELECT email_verified_at FROM users WHERE id = ?").bind(user.id).first<{ email_verified_at: string | null }>())?.email_verified_at) });
});

app.put("/api/onboarding/seller", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "admin"])) return c.json({ error: "Contributor access required" }, 403);
  const payload = sellerOnboardingSchema.parse(await c.req.json());
  if (!payload.ageConfirmed) return c.json({ error: "The seller must confirm they are at least 18" }, 422);
  const expectedBankName = payload.sellerType === "company" ? payload.registeredName : payload.legalName;
  if (!expectedBankName || !sameName(expectedBankName, payload.bankAccountName)) return c.json({ error: "The payout account holder must match the seller legal name or registered business name" }, 422);
  if (!payload.copyrightDeclaration || !payload.taxResponsibilityDeclaration || !payload.contributorAgreement) return c.json({ error: "Copyright, tax-responsibility, and contributor-agreement declarations are required" }, 422);
  if (payload.sellerType === "company" && (!payload.registeredName || !payload.cipcRegistrationNumber || !payload.representativeName || !payload.representativeAuthority)) return c.json({ error: "Company sellers must provide registered name, CIPC number, and authorised representative details" }, 422);
  if (payload.sellerType === "individual" && !payload.identityDocumentType) return c.json({ error: "An SA ID or passport is required" }, 422);
  const now = new Date().toISOString();
  await c.env.DB.prepare(`
    INSERT INTO seller_onboarding_profiles (
      contributor_id, seller_type, legal_name, phone_e164, age_confirmed_at, identity_document_type,
      bank_account_name, copyright_declaration_at, tax_responsibility_declaration_at, contributor_agreement_at,
      registered_name, cipc_registration_number, cipc_status, representative_name, representative_authority_at,
      beneficial_owner_required, beneficial_owner_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(contributor_id) DO UPDATE SET
      seller_type = excluded.seller_type, legal_name = excluded.legal_name, phone_e164 = excluded.phone_e164,
      age_confirmed_at = excluded.age_confirmed_at, identity_document_type = excluded.identity_document_type,
      bank_account_name = excluded.bank_account_name, copyright_declaration_at = excluded.copyright_declaration_at,
      tax_responsibility_declaration_at = excluded.tax_responsibility_declaration_at, contributor_agreement_at = excluded.contributor_agreement_at,
      registered_name = excluded.registered_name, cipc_registration_number = excluded.cipc_registration_number,
      representative_name = excluded.representative_name, representative_authority_at = excluded.representative_authority_at,
      beneficial_owner_required = excluded.beneficial_owner_required,
      beneficial_owner_status = CASE WHEN excluded.beneficial_owner_required = 1 THEN seller_onboarding_profiles.beneficial_owner_status ELSE 'not_required' END,
      updated_at = excluded.updated_at
  `).bind(
    user.id, payload.sellerType, payload.legalName, payload.phone, now, payload.identityDocumentType,
    payload.bankAccountName, now, now, now, payload.registeredName ?? null, payload.cipcRegistrationNumber ?? null,
    payload.sellerType === "company" ? "pending" : "not_checked", payload.representativeName ?? null,
    payload.representativeAuthority ? now : null, payload.beneficialOwnerRequired ? 1 : 0,
    payload.beneficialOwnerRequired ? "pending" : "not_required", now,
  ).run();
  return c.json({ ok: true, sellerType: payload.sellerType, status: "captured" });
});

const cipcLookupSchema = z.object({ registrationNumber: z.string().trim().min(3).max(40) });

app.post("/api/onboarding/cipc/lookup", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "admin"])) return c.json({ error: "Contributor access required" }, 403);
  if (!c.env.CIPC_LOOKUP_URL) return c.json({ error: "CIPC lookup provider is not configured" }, 503);
  const payload = cipcLookupSchema.parse(await c.req.json());
  const response = await fetch(c.env.CIPC_LOOKUP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(c.env.CIPC_LOOKUP_TOKEN ? { Authorization: `Bearer ${c.env.CIPC_LOOKUP_TOKEN}` } : {}) },
    body: JSON.stringify({ registrationNumber: payload.registrationNumber }),
  });
  if (!response.ok) return c.json({ error: "CIPC lookup provider rejected the request" }, 502);
  const result = await response.json() as { status?: string; registeredName?: string; registrationNumber?: string };
  const status = result.status === "verified" || result.status === "active" ? "verified" : result.status === "rejected" || result.status === "deregistered" ? "rejected" : "pending";
  await c.env.DB.prepare("UPDATE seller_onboarding_profiles SET cipc_registration_number = ?, registered_name = COALESCE(?, registered_name), cipc_status = ?, cipc_checked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE contributor_id = ?")
    .bind(result.registrationNumber ?? payload.registrationNumber, result.registeredName ?? null, status, user.id).run();
  return c.json({ registrationNumber: result.registrationNumber ?? payload.registrationNumber, registeredName: result.registeredName ?? null, status });
});

const contractSubmissionSchema = z.object({
  termsVersion: z.string().trim().min(1).max(40).default(sellerAgreement.version),
  signerName: z.string().trim().min(2).max(180),
  signatureMethod: z.enum(["firma", "manual"]).default("firma"),
  signatureReference: z.string().trim().min(8).max(240),
  turnstileToken: z.string().min(1).max(2048).optional(),
});

const walletSchema = z.object({
  provider: z.enum(["paystack", "stripe_connect", "payfast", "za_bank"]),
  providerAccountId: z.string().trim().max(240).optional(),
  accountHolderName: z.string().trim().min(2).max(180),
  accountLast4: z.string().regex(/^\d{4}$/).optional(),
  branchLast4: z.string().regex(/^\d{4}$/).optional(),
  artistSharePercentage: z.number().int().min(1).max(99).optional(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).default("ZAR"),
});

const contributorTerms = agreementText(sellerAgreement);

function verificationBucket(env: Bindings, region: "za" | "eu"): R2Bucket {
  return region === "eu" ? env.KYC_BUCKET_EU : env.KYC_BUCKET_ZA;
}

async function ensureVerificationCase(c: { env: Bindings }, user: RequestUser, residencyRegion: "za" | "eu", subjectType: "individual" | "business"): Promise<string> {
  const existing = await c.env.DB.prepare("SELECT id FROM contributor_verification_cases WHERE contributor_id = ? AND status IN ('pending', 'in_review') ORDER BY created_at DESC LIMIT 1").bind(user.id).first<{ id: string }>();
  if (existing) return existing.id;
  const caseId = crypto.randomUUID();
  const retentionDays = Math.max(365, Number(c.env.AUDIT_RETENTION_DAYS ?? 2555));
  const retentionUntil = new Date(Date.now() + retentionDays * 86_400_000).toISOString();
  await c.env.DB.prepare("INSERT INTO contributor_verification_cases (id, contributor_id, residency_region, subject_type, provider, retention_until) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(caseId, user.id, residencyRegion, subjectType, c.env.KYC_PROVIDER ?? "configured-provider", retentionUntil).run();
  return caseId;
}

async function verifyFirmaSignature(env: Bindings, reference: string, signerEmail: string): Promise<boolean> {
  if (!env.FIRMA_VERIFY_URL || !env.FIRMA_API_TOKEN) return String(env.APP_ENV) !== "production";
  const response = await fetch(env.FIRMA_VERIFY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.FIRMA_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reference, signerEmail }),
  });
  if (!response.ok) return false;
  const result = await response.json() as { verified?: boolean; signerEmail?: string };
  return result.verified === true && (!result.signerEmail || result.signerEmail.toLowerCase() === signerEmail.toLowerCase());
}

function diditCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(diditCanonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, diditCanonical(item)]));
  if (typeof value === "number" && Number.isInteger(value)) return value;
  return value;
}

async function verifyDiditWebhook(secret: string, body: string, signature: string, timestamp: string): Promise<boolean> {
  const parsedTimestamp = Number(timestamp);
  if (!Number.isFinite(parsedTimestamp) || Math.abs(Math.floor(Date.now() / 1000) - parsedTimestamp) > 300) return false;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return false; }
  const canonical = JSON.stringify(diditCanonical(parsed));
  const expected = hex(await hmac(utf8(secret), canonical));
  return timingSafeEqual(expected, signature.trim());
}

const diditSessionResponse = z.object({ session_id: z.string().uuid(), session_kind: z.enum(["user", "business"]).optional(), url: z.string().url(), status: z.string(), vendor_data: z.string().optional() });

app.post("/api/onboarding/didit/session", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "admin"])) return c.json({ error: "Contributor access required" }, 403);
  if (!c.env.DIDIT_API_KEY) return c.json({ error: "Didit is not configured" }, 503);
  const seller = await c.env.DB.prepare("SELECT * FROM seller_onboarding_profiles WHERE contributor_id = ?").bind(user.id).first<Record<string, unknown>>();
  if (!seller) return c.json({ error: "Save seller details before starting verification" }, 422);
  const sellerType = String(seller.seller_type) as "individual" | "company";
  if (sellerType === "company" && String(seller.cipc_status) !== "verified") return c.json({ error: "Complete a successful CIPC status lookup before company verification" }, 422);
  if (String(seller.beneficial_owner_required) === "1" && String(seller.beneficial_owner_status) !== "verified") return c.json({ error: "Beneficial-owner verification is required by the selected payment/legal classification" }, 422);
  const workflowId = sellerType === "company" ? c.env.DIDIT_KYB_WORKFLOW_ID : c.env.DIDIT_KYC_WORKFLOW_ID;
  if (!workflowId) return c.json({ error: `${sellerType === "company" ? "DIDIT_KYB_WORKFLOW_ID" : "DIDIT_KYC_WORKFLOW_ID"} is not configured` }, 503);
  const emailVerified = Boolean((await c.env.DB.prepare("SELECT email_verified_at FROM users WHERE id = ?").bind(user.id).first<{ email_verified_at: string | null }>())?.email_verified_at);
  if (String(c.env.APP_ENV) === "production" && !emailVerified) return c.json({ error: "Verify your email before starting seller verification" }, 422);
  const actor = await requestActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  const caseId = await ensureVerificationCase(c, user, actor.residencyRegion, sellerType === "company" ? "business" : "individual");
  const callbackBase = (c.env.APP_PUBLIC_URL ?? new URL(c.req.url).origin).replace(/\/$/, "");
  const names = String(seller.legal_name).trim().split(/\s+/);
  const requestBody = {
    workflow_id: workflowId,
    vendor_data: user.id,
    callback: `${callbackBase}/?didit=complete`,
    callback_method: "both",
    language: "en",
    metadata: { sellerType, contributorId: user.id, verificationCaseId: caseId },
    contact_details: { email: user.email, send_notification_emails: false, email_lang: "en", phone: String(seller.phone_e164) },
    ...(sellerType === "individual" ? { expected_details: { first_name: names[0], last_name: names.slice(1).join(" ") || names[0], id_country: "ZAF", expected_document_types: [String(seller.identity_document_type) === "sa_id" ? "ID" : "P"] } } : { expected_details: { first_name: names[0], last_name: names.slice(1).join(" ") || names[0] } }),
  };
  const response = await fetch("https://verification.didit.me/v3/session/", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": c.env.DIDIT_API_KEY }, body: JSON.stringify(requestBody) });
  const responseText = await response.text();
  if (!response.ok) return c.json({ error: "Didit could not create a verification session", providerStatus: response.status }, 502);
  let parsed: unknown;
  try { parsed = JSON.parse(responseText); } catch { return c.json({ error: "Didit returned an invalid session response" }, 502); }
  const session = diditSessionResponse.parse(parsed);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE contributor_verification_cases SET provider = 'didit', provider_case_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(session.session_id, caseId),
    c.env.DB.prepare("UPDATE seller_onboarding_profiles SET didit_session_id = ?, didit_session_kind = ?, didit_status = ?, didit_provider_reference = ?, updated_at = CURRENT_TIMESTAMP WHERE contributor_id = ?").bind(session.session_id, session.session_kind ?? (sellerType === "company" ? "business" : "user"), session.status, session.session_id, user.id),
  ]);
  return c.json({ caseId, sessionId: session.session_id, url: session.url, status: session.status, kind: session.session_kind ?? (sellerType === "company" ? "business" : "user") }, 201);
});

app.get("/api/onboarding/status", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const result = await c.env.DB.prepare(`
    SELECT p.*, t.id AS tender_id, t.status AS tender_status, t.review_notes,
      sc.id AS contract_id, sc.version AS contract_version, sc.content_sha256 AS contract_hash,
      sc.signed_at, w.id AS wallet_id, w.provider AS wallet_provider, w.status AS wallet_status,
      vc.id AS verification_case_id, vc.status AS verification_status,
      so.seller_type, so.legal_name AS seller_legal_name, so.registered_name, so.cipc_status, so.didit_status
    FROM contributor_profiles p
    LEFT JOIN onboarding_tenders t ON t.contributor_id = p.user_id AND t.organization_id = ? AND t.status IN ('pending', 'corrections_requested', 'approved')
    LEFT JOIN seller_contracts sc ON sc.id = t.contract_id
    LEFT JOIN payout_wallets w ON w.id = t.wallet_id
    LEFT JOIN contributor_verification_cases vc ON vc.id = t.verification_case_id
    LEFT JOIN seller_onboarding_profiles so ON so.contributor_id = p.user_id
    WHERE p.user_id = ? ORDER BY t.created_at DESC LIMIT 1
  `).bind(user.organizationId, user.id).first<Record<string, unknown>>();
  return c.json({ user, workflow: result ?? null });
});

app.post("/api/onboarding/wallet", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "admin"])) return c.json({ error: "Contributor access required" }, 403);
  const payload = walletSchema.parse(await c.req.json());
  if (payload.provider === "stripe_connect" && !payload.providerAccountId) return c.json({ error: "Stripe connected account is required" }, 422);
  if (payload.provider === "payfast" && !payload.providerAccountId) return c.json({ error: "PayFast recipient reference is required" }, 422);
  if (payload.provider === "paystack" && !payload.providerAccountId) return c.json({ error: "A verified Paystack subaccount code is required" }, 422);
  const seller = await c.env.DB.prepare("SELECT seller_type, legal_name, registered_name, bank_account_name FROM seller_onboarding_profiles WHERE contributor_id = ?").bind(user.id).first<{ seller_type: string; legal_name: string; registered_name: string | null; bank_account_name: string }>();
  if (seller) {
    const expectedName = seller.seller_type === "company" ? seller.registered_name : seller.legal_name;
    if (!expectedName || !sameName(expectedName, payload.accountHolderName) || !sameName(expectedName, seller.bank_account_name)) return c.json({ error: "The payout account must be in the verified seller or registered business name" }, 422);
  }
  const artistSharePercentage = payload.artistSharePercentage ?? Math.min(99, Math.max(1, Number(c.env.DEFAULT_ARTIST_SHARE_PERCENTAGE ?? 60)));
  const walletId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE payout_wallets SET status = 'disabled', updated_at = CURRENT_TIMESTAMP WHERE contributor_id = ? AND provider = ? AND status <> 'disabled'").bind(user.id, payload.provider),
    c.env.DB.prepare(`INSERT INTO payout_wallets (id, contributor_id, provider, provider_account_id, account_holder_name, account_last4, branch_last4, currency, artist_share_percentage, status, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '{}')`).bind(walletId, user.id, payload.provider, payload.providerAccountId ?? null, payload.accountHolderName, payload.accountLast4 ?? null, payload.branchLast4 ?? null, payload.currency, artistSharePercentage),
    c.env.DB.prepare("UPDATE onboarding_tenders SET wallet_id = ?, updated_at = CURRENT_TIMESTAMP WHERE organization_id = ? AND contributor_id = ? AND status IN ('pending', 'corrections_requested')").bind(walletId, user.organizationId, user.id),
    c.env.DB.prepare("UPDATE contributor_profiles SET payout_provider = ?, payout_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").bind(payload.provider, user.id),
  ]);
  return c.json({ walletId, provider: payload.provider, artistSharePercentage, status: "pending", message: "Provider reference captured without storing raw banking credentials. Provider verification is required before tender approval." }, 201);
});

app.post("/api/onboarding/contract", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "admin"])) return c.json({ error: "Contributor access required" }, 403);
  const payload = contractSubmissionSchema.parse(await c.req.json());
  if (payload.termsVersion !== sellerAgreement.version) return c.json({ error: "The seller agreement version is no longer current", currentVersion: sellerAgreement.version }, 409);
  if (String(c.env.APP_ENV) === "production" && payload.signatureMethod !== "firma") return c.json({ error: "Production contracts require a Firma signature" }, 422);
  if (!(await verifyFirmaSignature(c.env, payload.signatureReference, user.email))) return c.json({ error: "Firma signature could not be verified" }, 422);
  const turnstile = await verifyTurnstileToken(c.env, payload.turnstileToken, "contributor-contract", c.get("trace").traceparent);
  if (!turnstile.verified) return c.json({ error: turnstile.reason ?? "Turnstile verification failed" }, 403);
  const profile = await c.env.DB.prepare("SELECT contributor_type, location FROM contributor_profiles WHERE user_id = ?").bind(user.id).first<{ contributor_type?: string; location?: string }>();
  const actor = await requestActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  const caseId = await ensureVerificationCase(c, user, actor.residencyRegion, profile?.contributor_type === "individual" ? "individual" : "business");
  const signedAt = new Date().toISOString();
  const contractId = crypto.randomUUID();
  const canonical = canonicalContract({ contributorId: user.id, version: payload.termsVersion, signerName: payload.signerName, signerEmail: user.email, signedAt, signatureMethod: payload.signatureMethod, signatureReference: payload.signatureReference, terms: contributorTerms });
  const contentSha256 = await sha256Hex(canonical);
  const objectKey = `contracts/${user.id}/${contractId}.json`;
  await verificationBucket(c.env, actor.residencyRegion).put(objectKey, canonical, { httpMetadata: { contentType: "application/json" } });
  const audit = await appendAuditEvent(c.env, {
    streamId: `contributor:${user.id}`,
    actorId: user.id,
    actorType: user.role === "admin" ? "admin" : "contributor",
    action: "seller.contract.signed",
    resourceType: "seller_contract",
    resourceId: contractId,
    data: { version: payload.termsVersion, signatureMethod: payload.signatureMethod, signatureReference: payload.signatureReference, contentSha256, signedAt },
    residencyRegion: actor.residencyRegion,
    actorResidencyRegion: actor.residencyRegion,
  });
  const existingTender = await c.env.DB.prepare("SELECT id FROM onboarding_tenders WHERE organization_id = ? AND contributor_id = ? AND status IN ('pending', 'corrections_requested') LIMIT 1").bind(user.organizationId, user.id).first<{ id: string }>();
  const tenderWrite = existingTender
    ? c.env.DB.prepare("UPDATE onboarding_tenders SET contract_id = ?, verification_case_id = ?, status = 'pending', review_notes = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(contractId, caseId, existingTender.id)
    : c.env.DB.prepare("INSERT INTO onboarding_tenders (id, organization_id, contributor_id, contract_id, verification_case_id, status) VALUES (?, ?, ?, ?, ?, 'pending')").bind(crypto.randomUUID(), user.organizationId, user.id, contractId, caseId);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE seller_contracts SET status = 'superseded' WHERE organization_id = ? AND contributor_id = ? AND status = 'signed'").bind(user.organizationId, user.id),
    c.env.DB.prepare(`INSERT INTO seller_contracts (id, organization_id, contributor_id, version, terms_snapshot, signature_method, signer_name, signer_email, signed_at, content_sha256, object_key, audit_event_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(contractId, user.organizationId, user.id, payload.termsVersion, contributorTerms, payload.signatureMethod, payload.signerName, user.email, signedAt, contentSha256, objectKey, audit.event.eventId),
    c.env.DB.prepare(`INSERT OR IGNORE INTO marketplace_agreement_acceptances
      (id, organization_id, user_id, agreement_type, agreement_version, terms_sha256, context_type, context_id, accepted_at)
      VALUES (?, ?, ?, 'seller', ?, ?, 'onboarding', ?, ?)`)
      .bind(crypto.randomUUID(), user.organizationId, user.id, payload.termsVersion, contentSha256, contractId, signedAt),
    c.env.DB.prepare("UPDATE contributor_profiles SET terms_accepted_at = ?, contract_status = 'signed', identity_status = 'submitted', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").bind(signedAt, user.id),
    tenderWrite,
    c.env.DB.prepare("UPDATE users SET onboarding_status = 'submitted' WHERE id = ?").bind(user.id),
  ]);
  return c.json({ contractId, contractHash: contentSha256, auditEventId: audit.event.eventId, verificationCaseId: caseId, status: "pending" }, 201);
});

app.get("/api/admin/onboarding/tenders", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["admin"])) return c.json({ error: "Admin access required" }, 403);
  const status = c.req.query("status") ?? "pending";
  if (!["pending", "approved", "rejected", "corrections_requested", "all"].includes(status)) return c.json({ error: "Invalid tender status" }, 400);
  const where = status === "all" ? "1 = 1" : "t.status = ?";
  const result = await c.env.DB.prepare(`
    SELECT t.id, t.status, t.review_notes, t.created_at, t.reviewed_at,
      u.id AS contributor_id, u.display_name, u.email, u.onboarding_status,
      sc.id AS contract_id, sc.version AS contract_version, sc.content_sha256 AS contract_hash, sc.signed_at,
      vc.id AS verification_case_id, vc.status AS verification_status, vc.risk_level, vc.sanctions_status,
      w.id AS wallet_id, w.provider AS wallet_provider, w.status AS wallet_status, w.account_holder_name, w.account_last4,
      so.seller_type, so.legal_name AS seller_legal_name, so.registered_name, so.cipc_status, so.didit_status,
      so.copyright_declaration_at, so.tax_responsibility_declaration_at, so.contributor_agreement_at,
      so.beneficial_owner_required, so.beneficial_owner_status
    FROM onboarding_tenders t JOIN users u ON u.id = t.contributor_id
      JOIN seller_contracts sc ON sc.id = t.contract_id
      LEFT JOIN contributor_verification_cases vc ON vc.id = t.verification_case_id
      LEFT JOIN payout_wallets w ON w.id = t.wallet_id
      LEFT JOIN seller_onboarding_profiles so ON so.contributor_id = t.contributor_id
    WHERE t.organization_id = ? AND ${where} ORDER BY t.created_at ASC LIMIT 100
  `).bind(...(status === "all" ? [user.organizationId] : [user.organizationId, status])).all<Record<string, unknown>>();
  return c.json({ results: result.results });
});

const providerWalletVerificationSchema = z.object({ providerVerificationReference: z.string().trim().min(4).max(240) });

app.post("/api/admin/onboarding/wallets/:walletId/verify", async (c) => {
  const admin = await requestUser(c);
  if (!admin || !allowedRole(admin, ["admin"])) return c.json({ error: "Admin access required" }, 403);
  const payload = providerWalletVerificationSchema.parse(await c.req.json());
  const wallet = await c.env.DB.prepare("SELECT w.id, w.provider, w.contributor_id FROM payout_wallets w JOIN organization_memberships om ON om.user_id = w.contributor_id AND om.organization_id = ? AND om.status = 'active' WHERE w.id = ?").bind(admin.organizationId, c.req.param("walletId")).first<{ id: string; provider: string; contributor_id: string }>();
  if (!wallet) return c.json({ error: "Wallet not found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE payout_wallets SET status = 'verified', verified_at = CURRENT_TIMESTAMP, provider_verification_reference = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(payload.providerVerificationReference, wallet.id),
    c.env.DB.prepare("UPDATE contributor_profiles SET payout_status = 'verified', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").bind(wallet.contributor_id),
  ]);
  return c.json({ walletId: wallet.id, provider: wallet.provider, status: "verified", providerVerificationReference: payload.providerVerificationReference });
});

const tenderDecisionSchema = z.object({ decision: z.enum(["approved", "rejected", "corrections_requested"]), notes: z.string().trim().max(2000).default("") });

app.post("/api/admin/onboarding/tenders/:id/decision", async (c) => {
  const admin = await requestUser(c);
  if (!admin || !allowedRole(admin, ["admin"])) return c.json({ error: "Admin access required" }, 403);
  const payload = tenderDecisionSchema.parse(await c.req.json());
  const tender = await c.env.DB.prepare(`SELECT t.*, sc.status AS contract_status, vc.status AS verification_status, w.status AS wallet_status, u.email
    FROM onboarding_tenders t JOIN seller_contracts sc ON sc.id = t.contract_id JOIN users u ON u.id = t.contributor_id
    LEFT JOIN contributor_verification_cases vc ON vc.id = t.verification_case_id LEFT JOIN payout_wallets w ON w.id = t.wallet_id
    LEFT JOIN seller_onboarding_profiles so ON so.contributor_id = t.contributor_id
    WHERE t.id = ? AND t.organization_id = ?`).bind(c.req.param("id"), admin.organizationId).first<Record<string, unknown>>();
  if (!tender) return c.json({ error: "Tender not found" }, 404);
  const sellerRequirementsReady = tender.seller_type && tender.copyright_declaration_at && tender.tax_responsibility_declaration_at && tender.contributor_agreement_at && tender.didit_status === "Approved" && (tender.seller_type !== "company" || tender.cipc_status === "verified") && (Number(tender.beneficial_owner_required) !== 1 || tender.beneficial_owner_status === "verified");
  if (payload.decision === "approved" && (tender.contract_status !== "signed" || tender.verification_status !== "verified" || tender.wallet_status !== "verified" || !sellerRequirementsReady)) {
    return c.json({ error: "Tender cannot be approved until seller declarations, Didit, contract, and payout wallet are verified", requirements: { seller: sellerRequirementsReady ? "ready" : "incomplete", contract: tender.contract_status, verification: tender.verification_status, wallet: tender.wallet_status } }, 422);
  }
  const nextStatus = payload.decision;
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE onboarding_tenders SET status = ?, review_notes = ?, reviewed_by = ?, reviewed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?").bind(nextStatus, payload.notes, admin.id, now, c.req.param("id"), admin.organizationId),
    c.env.DB.prepare(`UPDATE users SET onboarding_status = ?, role = CASE WHEN ? = 'approved' THEN 'contributor' ELSE role END WHERE id = ?`).bind(payload.decision === "approved" ? "approved" : payload.decision === "rejected" ? "rejected" : "in_progress", payload.decision, tender.contributor_id),
    c.env.DB.prepare(`UPDATE contributor_profiles SET identity_status = CASE WHEN ? = 'approved' THEN 'verified' ELSE identity_status END,
      payout_status = CASE WHEN ? = 'approved' THEN 'verified' ELSE payout_status END,
      active_at = CASE WHEN ? = 'approved' THEN ? ELSE active_at END, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).bind(payload.decision, payload.decision, payload.decision, now, tender.contributor_id),
  ]);
  const actor: AuditActor = { id: admin.id, type: "admin", residencyRegion: admin.residencyRegion };
  const audit = await appendAuditEvent(c.env, {
    streamId: `contributor:${String(tender.contributor_id)}`,
    actorId: admin.id,
    actorType: "admin",
    action: `seller.tender.${payload.decision}`,
    resourceType: "onboarding_tender",
    resourceId: c.req.param("id"),
    data: { decision: payload.decision, notes: payload.notes },
    residencyRegion: actor.residencyRegion,
    actorResidencyRegion: actor.residencyRegion,
  });
  return c.json({ tenderId: c.req.param("id"), status: nextStatus, auditEventId: audit.event.eventId });
});

const assetCreateSchema = contractAssetCreateRequestSchema;

const campaignPlatformInputSchema = z.enum(["instagram", "facebook", "tiktok", "linkedin", "web", "print", "billboard", "email", "ads"]);
const campaignBriefFieldsInputSchema = z.object({
  audience: z.string().trim().max(500).optional(),
  platforms: z.array(campaignPlatformInputSchema).max(9).optional(),
  locations: z.array(z.string().trim().max(120)).max(30).optional(),
  tone: z.array(z.string().trim().max(80)).max(20).optional(),
  industry: z.string().trim().max(160).optional(),
  productService: z.string().trim().max(500).optional(),
  usageRights: z.enum(["editorial", "commercial", "advertising", "social", "broadcast", "exclusive"]).optional(),
  licenceType: z.string().trim().max(80).optional(),
  modelReleaseRequired: z.boolean().optional(),
  formatNeeded: z.array(z.string().trim().max(80)).max(20).optional(),
  keywords: z.array(z.string().trim().max(80)).max(40).optional(),
}).strict();
const campaignBrandKitInputSchema = z.object({
  colours: z.array(z.string().trim().max(40)).max(12).default([]),
  logoNotes: z.string().trim().max(500).default(""),
  tone: z.string().trim().max(160).default(""),
  industry: z.string().trim().max(160).default(""),
  forbiddenStyles: z.array(z.string().trim().max(80)).max(20).default([]),
  preferredVisuals: z.string().trim().max(1000).default(""),
}).strict();
const campaignInputSchema = z.object({
  name: z.string().trim().min(2).max(180),
  briefText: z.string().trim().max(8000).optional(),
  brief: z.union([campaignBriefFieldsInputSchema, z.string().trim().max(8000)]).default({}),
  platforms: z.array(z.string().trim().max(40)).max(8).default([]),
  brandKit: campaignBrandKitInputSchema.default({}),
  status: z.enum(["draft", "active", "archived"]).default("draft"),
});
const campaignAssetSchema = z.object({ assetId: z.string().min(1).max(120), stage: z.enum(["shortlisted", "rejected", "approved", "needs_review"]).default("shortlisted"), note: z.string().trim().max(1000).default("") });
const editVersionSchema = z.object({ recipe: z.record(z.unknown()), note: z.string().trim().max(500).default("") });
const derivativeSchema = z.object({
  editVersionId: z.string().min(1).max(120), campaignId: z.string().max(120).nullable().optional(), licenceId: z.string().min(1).max(120), variant: z.enum(["original", "edited", "social_square", "portrait", "landscape", "story_9_16", "reel_cover", "linkedin", "web_hero", "email_header"]),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), sizeBytes: z.number().int().positive().max(50_000_000), width: z.number().int().positive().max(20_000).optional(), height: z.number().int().positive().max(20_000).optional(),
});
const bundleSchema = z.object({ bundleType: z.enum(["social_media", "website", "paid_ads", "print_handoff", "full_archive"]) });

type RightsBoundAsset = { id: string; title: string; rights_status: string; model_release_status: string; property_release_status: string; status: string; workflow_stage: string; original_key: string | null; source_file_name: string | null; owner_id: string; media_content_type: string | null };

async function activeLicenceForAsset(env: Bindings, organizationId: string, assetId: string, licenceId: string, campaignId?: string | null): Promise<Record<string, unknown> | null> {
  const row = await env.DB.prepare(`SELECT l.*, a.rights_status, a.model_release_status, a.property_release_status, a.status AS asset_status, a.workflow_stage, a.title AS asset_title
    FROM licences l JOIN assets a ON a.id = l.asset_id
    WHERE l.id = ? AND l.asset_id = ? AND l.organization_id = ? AND l.status = 'paid'
      AND datetime(l.created_at, '+' || l.duration_days || ' days') > CURRENT_TIMESTAMP
      AND (l.campaign_id = ? OR l.campaign_id = '' OR l.campaign_id IS NULL)`).bind(licenceId, assetId, organizationId, campaignId ?? "").first<Record<string, unknown>>();
  return row ?? null;
}

function derivativeRightsSnapshot(licence: Record<string, unknown>): Record<string, unknown> {
  return { licenceId: String(licence.id), licenceType: String(licence.licence_type), territory: String(licence.territory), durationDays: Number(licence.duration_days), paidAt: licence.paid_at ?? null, capturedAt: new Date().toISOString(), assetRights: String(licence.rights_status), assetStatus: String(licence.asset_status) };
}

function utf8Bytes(value: string): Uint8Array { return new TextEncoder().encode(value); }
function u16(value: number): Uint8Array { return new Uint8Array([value & 255, (value >>> 8) & 255]); }
function u32(value: number): Uint8Array { return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]); }
function concatBytes(parts: Uint8Array[]): Uint8Array { const size = parts.reduce((total, part) => total + part.length, 0); const output = new Uint8Array(size); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length; } return output; }
function crc32(bytes: Uint8Array): number { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
async function createStoredZip(entries: Array<{ name: string; data: Uint8Array }>): Promise<Uint8Array> {
  const local: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const entry of entries) { const name = utf8Bytes(entry.name); const checksum = crc32(entry.data); const header = concatBytes([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(checksum), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name, entry.data]); local.push(header); const record = concatBytes([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(checksum), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]); central.push(record); offset += header.length; }
  const centralBytes = concatBytes(central); return concatBytes([...local, centralBytes, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralBytes.length), u32(offset), u16(0)]);
}

app.get("/api/campaigns", async (c) => {
  const user = await requestUser(c); if (!user) return c.json({ error: "Authentication required" }, 401);
  const rows = await c.env.DB.prepare(`SELECT c.*, SUM(CASE WHEN ca.stage = 'shortlisted' THEN 1 ELSE 0 END) AS shortlisted_count, SUM(CASE WHEN ca.stage = 'approved' THEN 1 ELSE 0 END) AS approved_count, SUM(CASE WHEN ca.stage = 'needs_review' THEN 1 ELSE 0 END) AS needs_review_count, SUM(CASE WHEN ca.stage = 'rejected' THEN 1 ELSE 0 END) AS rejected_count FROM campaigns c LEFT JOIN campaign_assets ca ON ca.campaign_id = c.id WHERE c.organization_id = ? GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 100`).bind(user.organizationId).all<Record<string, unknown>>();
  return c.json({ results: rows.results.map((row) => ({ id: String(row.id), name: String(row.name), brief: String(row.brief_text ?? ""), briefFields: jsonObject<CampaignBrief>(row.brief_json, parseCampaignBrief(String(row.brief_text ?? ""))), brandKit: jsonObject<BrandKit>(row.brand_kit_json, { colours: [], logoNotes: "", tone: "", industry: "", forbiddenStyles: [], preferredVisuals: "" }), status: String(row.status), assetCounts: { shortlisted: Number(row.shortlisted_count ?? 0), approved: Number(row.approved_count ?? 0), needsReview: Number(row.needs_review_count ?? 0), rejected: Number(row.rejected_count ?? 0) }, createdAt: String(row.created_at), updatedAt: String(row.updated_at) })) });
});

app.post("/api/campaigns", async (c) => {
  const user = await requestUser(c); if (!user || !allowedRole(user, ["buyer", "contributor", "editor", "admin"])) return c.json({ error: "Campaign workspace access required" }, 403);
  const payload = campaignInputSchema.parse(await c.req.json()); const id = crypto.randomUUID();
  const briefText = payload.briefText ?? (typeof payload.brief === "string" ? payload.brief : "");
  const parsedBrief = parseCampaignBrief(briefText, payload.platforms);
  const briefFields: CampaignBrief = typeof payload.brief === "string" ? parsedBrief : { ...parsedBrief, ...payload.brief };
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO campaigns (id, organization_id, owner_id, name, brief_text, brief_json, brand_kit_json, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, user.organizationId, user.id, payload.name, briefText, JSON.stringify(briefFields), JSON.stringify(payload.brandKit), payload.status),
    c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, 'campaign_created', 'campaign', ?, ?)").bind(crypto.randomUUID(), user.id, id, JSON.stringify({ name: payload.name, platforms: briefFields.platforms ?? [], usageRights: briefFields.usageRights ?? null })),
  ]);
  return c.json({ id, name: payload.name, brief: briefText, briefFields, brandKit: payload.brandKit, status: payload.status, assetCounts: { shortlisted: 0, approved: 0, needsReview: 0, rejected: 0 } }, 201);
});

app.get("/api/campaigns/:id", async (c) => {
  const user = await requestUser(c); if (!user) return c.json({ error: "Authentication required" }, 401); const campaignId = c.req.param("id");
  const campaign = await c.env.DB.prepare("SELECT * FROM campaigns WHERE id = ? AND organization_id = ?").bind(campaignId, user.organizationId).first<Record<string, unknown>>(); if (!campaign) return c.json({ error: "Campaign not found" }, 404);
  const assets = await c.env.DB.prepare(`SELECT ca.stage, ca.note, ca.created_at AS added_at, a.*, u.display_name AS contributor,
    (SELECT id FROM licences l WHERE l.asset_id = a.id AND l.organization_id = ? AND l.status = 'paid' AND datetime(l.created_at, '+' || l.duration_days || ' days') > CURRENT_TIMESTAMP AND (l.campaign_id = ? OR l.campaign_id = '' OR l.campaign_id IS NULL) ORDER BY l.created_at DESC LIMIT 1) AS active_licence_id
    FROM campaign_assets ca JOIN assets a ON a.id = ca.asset_id JOIN users u ON u.id = a.owner_id WHERE ca.campaign_id = ? ORDER BY ca.updated_at DESC`).bind(user.organizationId, campaignId, campaignId).all<Record<string, unknown>>();
  const assetIds = assets.results.map((row) => String(row.id)); const versions = assetIds.length ? await c.env.DB.prepare(`SELECT * FROM asset_edit_versions WHERE organization_id = ? AND asset_id IN (${assetIds.map(() => "?").join(",")}) ORDER BY version_number DESC`).bind(user.organizationId, ...assetIds).all<Record<string, unknown>>() : { results: [] };
  const derivatives = assetIds.length ? await c.env.DB.prepare(`SELECT id, asset_id, source_asset_id, edit_version_id, campaign_id, licence_id, variant, content_type, size_bytes, width, height, status, rights_snapshot_json, created_at FROM asset_derivative_exports WHERE organization_id = ? AND asset_id IN (${assetIds.map(() => "?").join(",")}) ORDER BY created_at DESC`).bind(user.organizationId, ...assetIds).all<Record<string, unknown>>() : { results: [] };
  const bundles = await c.env.DB.prepare("SELECT id, bundle_type, status, manifest_json, approved_at, expires_at, created_at FROM campaign_bundles WHERE campaign_id = ? AND organization_id = ? ORDER BY created_at DESC LIMIT 30").bind(campaignId, user.organizationId).all<Record<string, unknown>>();
  const allCandidates = await c.env.DB.prepare("SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id WHERE a.organization_id = ? AND a.status = 'published' ORDER BY a.updated_at DESC LIMIT 150").bind(user.organizationId).all<Record<string, unknown>>();
  const briefFields = jsonObject<CampaignBrief>(campaign.brief_json, parseCampaignBrief(String(campaign.brief_text ?? "")));
  const brandKit = jsonObject<BrandKit>(campaign.brand_kit_json, { colours: [], logoNotes: "", tone: "", industry: "", forbiddenStyles: [], preferredVisuals: "" });
  const stageMap = new Map(assets.results.map((row) => [String(row.id), { stage: String(row.stage) as CampaignStage, note: String(row.note ?? "") }]));
  const recommendations = rankCampaignAssets(allCandidates.results.map(assetRowToDomain), briefFields, brandKit).map((item) => ({ ...item, stage: stageMap.get(item.asset.id)?.stage ?? null, note: stageMap.get(item.asset.id)?.note ?? "" }));
  return c.json({ campaign: { id: String(campaign.id), name: String(campaign.name), briefText: String(campaign.brief_text ?? ""), brief: String(campaign.brief_text ?? ""), briefFields, brandKit, status: String(campaign.status), assetCounts: { shortlisted: assets.results.filter((row) => row.stage === "shortlisted").length, approved: assets.results.filter((row) => row.stage === "approved").length, needsReview: assets.results.filter((row) => row.stage === "needs_review").length, rejected: assets.results.filter((row) => row.stage === "rejected").length } }, recommendations, assets: assets.results.map((row) => ({ ...assetRowToDomain(row), campaignStage: row.stage, campaignNote: row.note, activeLicenceId: row.active_licence_id ? String(row.active_licence_id) : null })), editVersions: versions.results.map((row) => ({ id: String(row.id), assetId: String(row.asset_id), versionNumber: Number(row.version_number), recipe: JSON.parse(String(row.recipe_json)), note: String(row.note ?? ""), createdBy: String(row.created_by), createdAt: String(row.created_at) })), derivatives: derivatives.results.map((row) => ({ id: String(row.id), assetId: String(row.asset_id), sourceAssetId: String(row.source_asset_id), editVersionId: String(row.edit_version_id), campaignId: row.campaign_id ? String(row.campaign_id) : null, licenceId: String(row.licence_id), variant: String(row.variant), contentType: String(row.content_type), sizeBytes: Number(row.size_bytes), width: row.width == null ? null : Number(row.width), height: row.height == null ? null : Number(row.height), status: String(row.status), rightsSnapshot: JSON.parse(String(row.rights_snapshot_json ?? "{}")), createdAt: String(row.created_at) })), bundles: bundles.results.map((row) => ({ id: String(row.id), bundleType: String(row.bundle_type), status: String(row.status), manifest: JSON.parse(String(row.manifest_json ?? "{}")), approvedAt: row.approved_at, expiresAt: row.expires_at, createdAt: String(row.created_at) })) });
});

app.post("/api/campaigns/:id/assets", async (c) => {
  const user = await requestUser(c); if (!user || !allowedRole(user, ["buyer", "contributor", "editor", "admin"])) return c.json({ error: "Campaign workspace access required" }, 403); const payload = campaignAssetSchema.parse(await c.req.json()); const campaignId = c.req.param("id");
  const campaign = await c.env.DB.prepare("SELECT id FROM campaigns WHERE id = ? AND organization_id = ?").bind(campaignId, user.organizationId).first(); if (!campaign) return c.json({ error: "Campaign not found" }, 404);
  const asset = await c.env.DB.prepare("SELECT id FROM assets WHERE id = ? AND organization_id = ? AND status = 'published'").bind(payload.assetId, user.organizationId).first(); if (!asset) return c.json({ error: "Published asset not found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO campaign_assets (campaign_id, asset_id, stage, note, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(campaign_id, asset_id) DO UPDATE SET stage = excluded.stage, note = excluded.note, updated_at = CURRENT_TIMESTAMP").bind(campaignId, payload.assetId, payload.stage, payload.note),
    c.env.DB.prepare("UPDATE campaigns SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(campaignId),
    c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, 'campaign_asset_stage_changed', 'campaign', ?, ?)").bind(crypto.randomUUID(), user.id, campaignId, JSON.stringify({ assetId: payload.assetId, stage: payload.stage })),
  ]);
  return c.json({ campaignId, assetId: payload.assetId, stage: payload.stage, note: payload.note });
});

app.get("/api/assets/:id/edit-versions", async (c) => {
  const user = await requestUser(c); if (!user) return c.json({ error: "Authentication required" }, 401); const asset = await c.env.DB.prepare("SELECT id FROM assets WHERE id = ? AND organization_id = ?").bind(c.req.param("id"), user.organizationId).first(); if (!asset) return c.json({ error: "Asset not found" }, 404);
  const versions = await c.env.DB.prepare("SELECT id, asset_id, version_number, recipe_json, note, created_by, created_at FROM asset_edit_versions WHERE asset_id = ? AND organization_id = ? ORDER BY version_number DESC").bind(c.req.param("id"), user.organizationId).all<Record<string, unknown>>();
  const derivatives = await c.env.DB.prepare("SELECT id, edit_version_id, campaign_id, licence_id, variant, content_type, size_bytes, width, height, status, created_at FROM asset_derivative_exports WHERE asset_id = ? AND organization_id = ? ORDER BY created_at DESC").bind(c.req.param("id"), user.organizationId).all<Record<string, unknown>>();
  return c.json({ versions: versions.results.map((row) => ({ id: String(row.id), versionNumber: Number(row.version_number), recipe: JSON.parse(String(row.recipe_json)), note: String(row.note ?? ""), createdBy: String(row.created_by), createdAt: String(row.created_at) })), derivatives: derivatives.results });
});

app.post("/api/assets/:id/edit-versions", async (c) => {
  const user = await requestUser(c); if (!user || !allowedRole(user, ["buyer", "contributor", "editor", "admin"])) return c.json({ error: "Editor access required" }, 403); const assetId = c.req.param("id"); const payload = editVersionSchema.parse(await c.req.json());
  const asset = await c.env.DB.prepare("SELECT id, organization_id FROM assets WHERE id = ? AND organization_id = ? AND kind = 'image'").bind(assetId, user.organizationId).first(); if (!asset) return c.json({ error: "Image asset not found" }, 404);
  const current = await c.env.DB.prepare("SELECT COALESCE(MAX(version_number), 0) AS version FROM asset_edit_versions WHERE asset_id = ?").bind(assetId).first<{ version: number }>(); const versionNumber = Number(current?.version ?? 0) + 1; const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO asset_edit_versions (id, organization_id, asset_id, version_number, recipe_json, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, user.organizationId, assetId, versionNumber, JSON.stringify(payload.recipe), payload.note, user.id).run();
  await c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, 'asset_edit_version_created', 'asset_edit_version', ?, ?)").bind(crypto.randomUUID(), user.id, id, JSON.stringify({ assetId, versionNumber })).run();
  return c.json({ id, assetId, versionNumber, recipe: payload.recipe, note: payload.note }, 201);
});

app.post("/api/assets/:id/derivatives", async (c) => {
  const user = await requestUser(c); if (!user || !allowedRole(user, ["buyer", "contributor", "editor", "admin"])) return c.json({ error: "Editor access required" }, 403); const assetId = c.req.param("id"); const payload = derivativeSchema.parse(await c.req.json());
  const asset = await c.env.DB.prepare("SELECT id, owner_id, original_key FROM assets WHERE id = ? AND organization_id = ? AND kind = 'image'").bind(assetId, user.organizationId).first<{ id: string; owner_id: string; original_key: string | null }>(); if (!asset) return c.json({ error: "Image asset not found" }, 404);
  const editVersion = await c.env.DB.prepare("SELECT id FROM asset_edit_versions WHERE id = ? AND asset_id = ? AND organization_id = ?").bind(payload.editVersionId, assetId, user.organizationId).first(); if (!editVersion) return c.json({ error: "Edit version not found" }, 404);
  const licence = await activeLicenceForAsset(c.env, user.organizationId, assetId, payload.licenceId, payload.campaignId); if (!licence) return c.json({ error: "An active paid licence for this campaign use is required before exporting a derivative", code: "licence_required" }, 403);
  const assetForRights = await governanceAsset(c, assetId, user.organizationId); if (!assetForRights) return c.json({ error: "Asset not found" }, 404);
  const validation = archiveDomain.evaluateLicenceRequest(assetForRights, { assetId, licenceType: String(licence.licence_type) as LicenceRequest["licenceType"], territory: String(licence.territory), durationDays: Number(licence.duration_days) }); if (!validation.allowed) return c.json({ error: "Licence no longer permits this derivative", code: "licence_invalid", ...validation }, 403);
  const id = crypto.randomUUID(); const extension = payload.contentType === "image/png" ? "png" : payload.contentType === "image/jpeg" ? "jpg" : "webp"; const objectKey = `derivatives/${user.organizationId}/${assetId}/${payload.variant}/${id}.${extension}`;
  await c.env.DB.prepare("INSERT INTO asset_derivative_exports (id, organization_id, asset_id, source_asset_id, edit_version_id, campaign_id, licence_id, variant, object_key, content_type, size_bytes, width, height, rights_snapshot_json, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, user.organizationId, assetId, assetId, payload.editVersionId, payload.campaignId ?? null, payload.licenceId, payload.variant, objectKey, payload.contentType, payload.sizeBytes, payload.width ?? null, payload.height ?? null, JSON.stringify(derivativeRightsSnapshot(licence)), user.id).run();
  return c.json({ derivativeId: id, objectKey, status: "pending", rights: validation, uploadUrl: `/api/assets/${assetId}/derivatives/${id}/content` }, 201);
});

app.put("/api/assets/:id/derivatives/:derivativeId/content", async (c) => {
  const user = await requestUser(c); if (!user) return c.json({ error: "Authentication required" }, 401);
  const derivative = await c.env.DB.prepare("SELECT id, object_key, content_type, size_bytes FROM asset_derivative_exports WHERE id = ? AND asset_id = ? AND organization_id = ? AND status = 'pending'").bind(c.req.param("derivativeId"), c.req.param("id"), user.organizationId).first<{ id: string; object_key: string; content_type: string; size_bytes: number }>(); if (!derivative) return c.json({ error: "Derivative upload is not pending" }, 404);
  const body = await c.req.raw.arrayBuffer(); if (body.byteLength !== Number(derivative.size_bytes)) return c.json({ error: "Derivative size does not match the signed export request" }, 409);
  await c.env.MEDIA_BUCKET.put(derivative.object_key, body, { httpMetadata: { contentType: derivative.content_type } }); await c.env.DB.prepare("UPDATE asset_derivative_exports SET status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(derivative.id).run();
  return c.json({ derivativeId: derivative.id, status: "ready" });
});

app.get("/api/campaigns/:id/bundles", async (c) => {
  const user = await requestUser(c); if (!user) return c.json({ error: "Authentication required" }, 401); const rows = await c.env.DB.prepare("SELECT id, bundle_type, status, manifest_json, approved_at, expires_at, created_at FROM campaign_bundles WHERE campaign_id = ? AND organization_id = ? ORDER BY created_at DESC LIMIT 50").bind(c.req.param("id"), user.organizationId).all<Record<string, unknown>>(); return c.json({ results: rows.results.map((row) => ({ id: String(row.id), bundleType: String(row.bundle_type), status: String(row.status), manifest: JSON.parse(String(row.manifest_json ?? "{}")), approvedAt: row.approved_at, expiresAt: row.expires_at, createdAt: String(row.created_at), downloadUrl: row.status === "approved" ? `/api/campaign-bundles/${String(row.id)}/download` : null })) });
});

async function campaignBundleRows(env: Bindings, campaignId: string, organizationId: string): Promise<{ assets: RightsBoundAsset[]; derivatives: Record<string, unknown>[]; blocked: string[] }> {
  const rows = await env.DB.prepare(`SELECT a.id, a.title, a.rights_status, a.model_release_status, a.property_release_status, a.status, a.workflow_stage, a.original_key, a.source_file_name, a.owner_id, a.media_content_type, ca.stage FROM campaign_assets ca JOIN assets a ON a.id = ca.asset_id WHERE ca.campaign_id = ? AND a.organization_id = ? AND ca.stage = 'approved'`).bind(campaignId, organizationId).all<Record<string, unknown>>();
  const assets = rows.results as unknown as RightsBoundAsset[]; const blocked: string[] = []; const derivatives: Record<string, unknown>[] = [];
  for (const asset of assets) {
    const licence = await env.DB.prepare("SELECT id, licence_type, territory, duration_days FROM licences WHERE asset_id = ? AND organization_id = ? AND status = 'paid' AND datetime(created_at, '+' || duration_days || ' days') > CURRENT_TIMESTAMP AND (campaign_id = ? OR campaign_id = '' OR campaign_id IS NULL) ORDER BY created_at DESC LIMIT 1").bind(asset.id, organizationId, campaignId).first<Record<string, unknown>>();
    if (!licence) { blocked.push(`${asset.title}: active paid licence missing or expired`); continue; }
    const allowed = asset.rights_status === "verified" || (asset.rights_status === "editorial_only" && licence.licence_type === "editorial"); const modelRequired = ["commercial", "advertising", "social", "broadcast", "exclusive"].includes(String(licence.licence_type)); const propertyRequired = ["commercial", "advertising", "broadcast", "exclusive"].includes(String(licence.licence_type)); const releasesOk = (!modelRequired || ["verified", "not_required"].includes(asset.model_release_status)) && (!propertyRequired || ["verified", "not_required"].includes(asset.property_release_status)); if (!allowed || !releasesOk || asset.status !== "published" || asset.workflow_stage !== "approval") { blocked.push(`${asset.title}: rights, releases, or approval state is not valid`); continue; }
    const output = await env.DB.prepare("SELECT * FROM asset_derivative_exports WHERE asset_id = ? AND campaign_id = ? AND licence_id = ? AND status = 'ready' ORDER BY created_at DESC").bind(asset.id, campaignId, licence.id).all<Record<string, unknown>>(); derivatives.push(...output.results.map((item) => ({ ...item, asset_title: asset.title, source_file_name: asset.source_file_name, original_key: asset.original_key, licence_id: licence.id })));
  }
  return { assets, derivatives, blocked };
}

app.post("/api/campaigns/:id/bundles", async (c) => {
  const user = await requestUser(c); if (!user || !allowedRole(user, ["buyer", "contributor", "editor", "admin"])) return c.json({ error: "Campaign workspace access required" }, 403); const campaignId = c.req.param("id"); const payload = bundleSchema.parse(await c.req.json());
  const campaign = await c.env.DB.prepare("SELECT id, name, brief_text, brief_json, brand_kit_json FROM campaigns WHERE id = ? AND organization_id = ?").bind(campaignId, user.organizationId).first<Record<string, unknown>>(); if (!campaign) return c.json({ error: "Campaign not found" }, 404);
  const source = await campaignBundleRows(c.env, campaignId, user.organizationId); if (source.blocked.length || !source.derivatives.length) return c.json({ error: "Bundle is not ready", blocked: [...source.blocked, ...(source.derivatives.length ? [] : ["Create and upload at least one rights-bound derivative"]) ] }, 422);
  const id = crypto.randomUUID(); const manifest = { bundleId: id, campaignId, bundleType: payload.bundleType, campaignName: campaign.name, generatedAt: new Date().toISOString(), status: "pending_approval", rightsChecked: true, assets: source.assets.map((asset) => ({ id: asset.id, title: asset.title })), derivatives: source.derivatives.map((item) => ({ id: item.id, assetId: item.asset_id, variant: item.variant, licenceId: item.licence_id, status: item.status })) };
  await c.env.DB.prepare("INSERT INTO campaign_bundles (id, organization_id, campaign_id, owner_id, bundle_type, manifest_json) VALUES (?, ?, ?, ?, ?, ?)").bind(id, user.organizationId, campaignId, user.id, payload.bundleType, JSON.stringify(manifest)).run();
  await c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, 'campaign_bundle_requested', 'campaign_bundle', ?, ?)").bind(crypto.randomUUID(), user.id, id, JSON.stringify({ campaignId, bundleType: payload.bundleType })).run();
  return c.json({ id, status: "pending", manifest }, 202);
});

app.post("/api/campaigns/:id/bundles/:bundleId/approve", async (c) => {
  const user = await requestUser(c); if (!user || !allowedRole(user, ["buyer", "editor", "admin"])) return c.json({ error: "Bundle approval requires buyer or editor access" }, 403); const bundle = await c.env.DB.prepare("SELECT * FROM campaign_bundles WHERE id = ? AND campaign_id = ? AND organization_id = ? AND status = 'pending'").bind(c.req.param("bundleId"), c.req.param("id"), user.organizationId).first<Record<string, unknown>>(); if (!bundle) return c.json({ error: "Pending bundle not found" }, 404);
  const source = await campaignBundleRows(c.env, String(bundle.campaign_id), user.organizationId); if (source.blocked.length || !source.derivatives.length) return c.json({ error: "Bundle approval blocked by current rights state", blocked: source.blocked }, 422);
  const campaign = await c.env.DB.prepare("SELECT name, brief_text, brief_json, brand_kit_json FROM campaigns WHERE id = ?").bind(String(bundle.campaign_id)).first<Record<string, unknown>>(); const entries: Array<{ name: string; data: Uint8Array }> = []; const manifest = JSON.parse(String(bundle.manifest_json ?? "{}")) as Record<string, unknown>;
  entries.push({ name: "campaign/brief.json", data: utf8Bytes(JSON.stringify({ name: campaign?.name, briefText: campaign?.brief_text, brief: JSON.parse(String(campaign?.brief_json ?? "{}")), brandKit: JSON.parse(String(campaign?.brand_kit_json ?? "{}")) }, null, 2)) });
  entries.push({ name: "campaign/attribution.txt", data: utf8Bytes(source.assets.map((asset) => `${asset.title} — source asset ${asset.id}; contributor ${asset.owner_id}`).join("\n")) });
  entries.push({ name: "campaign/metadata.json", data: utf8Bytes(JSON.stringify(source.assets, null, 2)) });
  entries.push({ name: "campaign/metadata.csv", data: utf8Bytes(`asset_id,title,source_file_name,rights_status\n${source.assets.map((asset) => [asset.id, asset.title, asset.source_file_name ?? "", asset.rights_status].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n")}`) });
  const certificates: Record<string, unknown>[] = []; const originalAssets = new Set<string>();
  for (const item of source.derivatives) { const object = await c.env.MEDIA_BUCKET.get(String(item.object_key)); if (object?.body) entries.push({ name: `media/${String(item.asset_id)}/${String(item.variant)}.${String(item.content_type).split("/")[1] ?? "bin"}`, data: new Uint8Array(await object.arrayBuffer()) }); if (item.original_key && !originalAssets.has(String(item.asset_id))) { const original = await c.env.MEDIA_BUCKET.get(String(item.original_key)); if (original?.body) { entries.push({ name: `sources/${String(item.asset_id)}/${String(item.source_file_name ?? "original")}`, data: new Uint8Array(await original.arrayBuffer()) }); originalAssets.add(String(item.asset_id)); } } const licence = await c.env.DB.prepare("SELECT id, licence_type, territory, duration_days, created_at, paid_at, status FROM licences WHERE id = ?").bind(String(item.licence_id)).first<Record<string, unknown>>(); certificates.push({ assetId: item.asset_id, derivativeId: item.id, licence }); }
  entries.push({ name: "legal/licence-certificates.json", data: utf8Bytes(JSON.stringify(certificates, null, 2)) });
  const auditManifest = { ...manifest, status: "approved", approvedBy: user.id, approvedAt: new Date().toISOString(), rightsRecheckedAt: new Date().toISOString(), includedEntries: entries.map((entry) => entry.name) }; entries.push({ name: "audit/manifest.json", data: utf8Bytes(JSON.stringify(auditManifest, null, 2)) });
  const zip = await createStoredZip(entries); const objectKey = `bundles/${user.organizationId}/${bundle.campaign_id}/${bundle.id}.zip`; await c.env.MEDIA_BUCKET.put(objectKey, zip, { httpMetadata: { contentType: "application/zip" } });
  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString(); const bundleItems = source.derivatives.map((item) => c.env.DB.prepare("INSERT OR IGNORE INTO campaign_bundle_items (bundle_id, derivative_id, asset_id, item_type, archive_path) VALUES (?, ?, ?, 'derivative', ?)").bind(bundle.id, String(item.id), String(item.asset_id), `media/${String(item.asset_id)}/${String(item.variant)}.${String(item.content_type).split("/")[1] ?? "bin"}`)); await c.env.DB.batch([c.env.DB.prepare("UPDATE campaign_bundles SET status = 'approved', object_key = ?, manifest_json = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(objectKey, JSON.stringify(auditManifest), user.id, expiresAt, bundle.id), ...bundleItems, c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, 'campaign_bundle_approved', 'campaign_bundle', ?, ?)").bind(crypto.randomUUID(), user.id, bundle.id, JSON.stringify({ objectKey, expiresAt, entryCount: entries.length }))]);
  return c.json({ id: bundle.id, status: "approved", expiresAt, downloadUrl: `/api/campaign-bundles/${bundle.id}/download`, manifest: auditManifest });
});

app.get("/api/campaign-bundles/:id/download", async (c) => {
  const user = await requestUser(c); if (!user) return c.json({ error: "Authentication required" }, 401); const bundle = await c.env.DB.prepare("SELECT id, object_key, campaign_id, status, expires_at FROM campaign_bundles WHERE id = ? AND organization_id = ?").bind(c.req.param("id"), user.organizationId).first<{ id: string; object_key: string | null; campaign_id: string; status: string; expires_at: string | null }>(); if (!bundle) return c.json({ error: "Bundle not found" }, 404);
  if (bundle.status !== "approved" || !bundle.object_key) return c.json({ error: `Bundle is ${bundle.status}; approval is required before download` }, 403); if (bundle.expires_at && new Date(bundle.expires_at).getTime() <= Date.now()) { await c.env.DB.prepare("UPDATE campaign_bundles SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(bundle.id).run(); return c.json({ error: "Bundle has expired" }, 410); }
  const object = await c.env.MEDIA_BUCKET.get(bundle.object_key); if (!object) return c.json({ error: "Bundle object is unavailable" }, 503); const headers = new Headers({ "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="campaign-${bundle.campaign_id}-${bundle.id}.zip"`, "Cache-Control": "private, no-store" }); return new Response(object.body, { headers });
});

const unsafeMetadataPattern = /\b(looks like|appears to be|probably|ethnic|racial|tribe|tribal|religion|muslim|christian|black people|white people|colou?red people|native people|indigenous people|criminal|illegal|exotic)\b/i;
function metadataSafetyIssue(tags: string[]): string | null {
  const unsafe = tags.find((tag) => unsafeMetadataPattern.test(tag));
  return unsafe ? `Context label "${unsafe}" needs contributor evidence and human review before it can be used.` : null;
}

app.post("/api/assets", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "editor", "admin"])) return c.json({ error: "Contributor access required" }, 403);
  const payload = assetCreateSchema.parse(await c.req.json());
  const safetyIssue = metadataSafetyIssue(payload.culturalTags);
  if (safetyIssue) return c.json({ error: safetyIssue, code: "metadata_context_required" }, 422);
  if (payload.monetizationModel === "individual_license" && (!payload.licensePriceCents || payload.licensePriceCents < 100)) {
    return c.json({ error: "Individual licences must have a price of at least ZAR 1.00" }, 422);
  }
  if ((payload.artistLicenseKey === "custom" || payload.artistLicenseKey === "other") && !payload.artistLicenseTerms?.trim()) return c.json({ error: "Custom or other artist licences must include the licence terms" }, 422);
  if (payload.artistLicenseKey !== "custom" && !payload.artistLicenseUrl) return c.json({ error: "A proof URL is required for the selected artist licence" }, 422);
  const artistLicenseTerms = payload.artistLicenseTerms?.trim() || `${payload.artistLicenseKey} ${payload.artistLicenseVersion ?? ""}`.trim();
  const artistLicenseSha256 = await sha256Hex(JSON.stringify({ key: payload.artistLicenseKey, version: payload.artistLicenseVersion ?? null, url: payload.artistLicenseUrl ?? null, terms: artistLicenseTerms }));
  const id = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO assets (id, organization_id, owner_id, kind, status, title, description, caption, province, city, locality, landmark, subject_tags, cultural_tags, rights_status, model_release_status, property_release_status, monetization_model, license_price_cents, artist_license_key, artist_license_version, artist_license_url, artist_license_terms, artist_license_sha256, artist_license_accepted_at, workflow_stage)
    VALUES (?, ?, ?, ?, 'needs_review', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'curator_correction')`)
    .bind(id, user.organizationId, user.id, payload.kind, payload.title, payload.description, payload.caption, payload.province ?? null, payload.city ?? null, payload.locality ?? null, payload.landmark ?? null, JSON.stringify(payload.subjectTags), JSON.stringify(payload.culturalTags), payload.rightsStatus, payload.modelReleaseStatus, payload.propertyReleaseStatus, payload.monetizationModel, payload.monetizationModel === "individual_license" ? payload.licensePriceCents : null, payload.artistLicenseKey, payload.artistLicenseVersion ?? null, payload.artistLicenseUrl || null, artistLicenseTerms, artistLicenseSha256, new Date().toISOString()).run();
  return c.json(validateContractResponse("POST /api/assets 201", assetCreateResponseSchema, { id, status: "needs_review" }), 201);
});

app.patch("/api/assets/:id", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const id = c.req.param("id");
  const current = await c.env.DB.prepare("SELECT * FROM assets WHERE id = ? AND organization_id = ?").bind(id, user.organizationId).first<Record<string, unknown>>();
  if (!current) return c.json({ error: "Asset not found" }, 404);
  if (String(current.owner_id) !== user.id && !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Forbidden" }, 403);
  const payload = assetCreateSchema.partial().parse(await c.req.json());
  const next = {
    ...current,
    ...payload,
    monetizationModel: payload.monetizationModel ?? (current.monetization_model as MonetizationModel | undefined) ?? "membership",
    licensePriceCents: payload.licensePriceCents !== undefined ? payload.licensePriceCents : (current.license_price_cents == null ? null : Number(current.license_price_cents)),
    artistLicenseKey: payload.artistLicenseKey ?? (current.artist_license_key as string | undefined) ?? "custom",
    artistLicenseVersion: payload.artistLicenseVersion !== undefined ? payload.artistLicenseVersion : (current.artist_license_version as string | undefined),
    artistLicenseUrl: payload.artistLicenseUrl !== undefined ? payload.artistLicenseUrl : (current.artist_license_url as string | undefined),
    artistLicenseTerms: payload.artistLicenseTerms !== undefined ? payload.artistLicenseTerms : (current.artist_license_terms as string | undefined),
  };
  if (next.monetizationModel === "individual_license" && (!next.licensePriceCents || next.licensePriceCents < 100)) {
    return c.json({ error: "Individual licences must have a price of at least ZAR 1.00" }, 422);
  }
  if ((next.artistLicenseKey === "custom" || next.artistLicenseKey === "other") && !String(next.artistLicenseTerms ?? "").trim()) return c.json({ error: "Custom or other artist licences must include the licence terms" }, 422);
  if (next.artistLicenseKey !== "custom" && !next.artistLicenseUrl) return c.json({ error: "A proof URL is required for the selected artist licence" }, 422);
  const artistLicenseTerms = String(next.artistLicenseTerms ?? `${next.artistLicenseKey} ${next.artistLicenseVersion ?? ""}`).trim();
  const artistLicenseSha256 = await sha256Hex(JSON.stringify({ key: next.artistLicenseKey, version: next.artistLicenseVersion ?? null, url: next.artistLicenseUrl || null, terms: artistLicenseTerms }));
  const safetyIssue = metadataSafetyIssue((next.culturalTags ?? []) as string[]);
  if (safetyIssue) return c.json({ error: safetyIssue, code: "metadata_context_required" }, 422);
  await c.env.DB.prepare(`UPDATE assets SET kind = ?, title = ?, description = ?, caption = ?, province = ?, city = ?, locality = ?, landmark = ?, subject_tags = ?, cultural_tags = ?, rights_status = ?, model_release_status = ?, property_release_status = ?, monetization_model = ?, license_price_cents = ?, artist_license_key = ?, artist_license_version = ?, artist_license_url = ?, artist_license_terms = ?, artist_license_sha256 = ?, artist_license_accepted_at = COALESCE(artist_license_accepted_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`)
    .bind(next.kind, next.title, next.description ?? "", next.caption ?? "", next.province ?? null, next.city ?? null, next.locality ?? null, next.landmark ?? null, JSON.stringify(next.subjectTags ?? []), JSON.stringify(next.culturalTags ?? []), next.rightsStatus ?? "pending", next.modelReleaseStatus ?? "unknown", next.propertyReleaseStatus ?? "unknown", next.monetizationModel ?? "membership", next.monetizationModel === "individual_license" ? next.licensePriceCents : null, next.artistLicenseKey, next.artistLicenseVersion ?? null, next.artistLicenseUrl || null, artistLicenseTerms, artistLicenseSha256, id, user.organizationId).run();
  return c.json({ ok: true, id });
});

app.get("/api/my/assets", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const result = await c.env.DB.prepare("SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id WHERE a.organization_id = ? AND a.owner_id = ? ORDER BY a.updated_at DESC LIMIT 100").bind(user.organizationId, user.id).all<Record<string, unknown>>();
  return c.json({ results: (result.results as Record<string, unknown>[]).map(assetRowToDomain) });
});

app.get("/api/admin/review", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Editor access required" }, 403);
  const result = await c.env.DB.prepare("SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id WHERE a.organization_id = ? AND a.status IN ('needs_review', 'processing') ORDER BY a.authenticity_confidence DESC, a.created_at ASC LIMIT 100").bind(user.organizationId).all<Record<string, unknown>>();
  return c.json({ results: (result.results as Record<string, unknown>[]).map(assetRowToDomain) });
});

const editorialReviewSchema = z.object({ decision: z.enum(["approved", "rejected", "needs_changes", "withdrawn"]), notes: z.string().trim().max(2000).default("") });

app.post("/api/admin/assets/:id/review", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Editor access required" }, 403);
  const payload = editorialReviewSchema.parse(await c.req.json());
  const status = payload.decision === "approved" ? "published" : payload.decision === "withdrawn" ? "withdrawn" : payload.decision === "rejected" ? "rejected" : "needs_review";
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE assets SET status = ?, workflow_stage = ?, human_verified = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?").bind(status, payload.decision === "approved" ? "approval" : "curator_correction", payload.decision === "approved" ? 1 : 0, c.req.param("id"), user.organizationId),
    c.env.DB.prepare("INSERT INTO metadata_events (id, asset_id, actor_id, event_type, payload) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM assets WHERE id = ? AND organization_id = ?)").bind(crypto.randomUUID(), c.req.param("id"), user.id, payload.decision === "approved" ? "approved" : payload.decision === "rejected" ? "rejected" : "curator_corrected", JSON.stringify({ notes: payload.notes }), c.req.param("id"), user.organizationId),
  ]);
  return c.json({ ok: true, status });
});

const licenceRequestSchema: z.ZodType<LicenceRequest> = contractLicenceRequestSchema;
const checkoutRequestSchema = contractLicenceRequestSchema.extend({
  buyerAgreementVersion: z.string().trim().min(1).max(40),
  acceptBuyerTerms: z.literal(true),
});

async function governanceAsset(c: { env: Bindings }, assetId: string, organizationId?: string): Promise<Asset | null> {
  const row = organizationId
    ? await c.env.DB.prepare("SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id WHERE a.id = ? AND a.organization_id = ?").bind(assetId, organizationId).first<Record<string, unknown>>()
    : await c.env.DB.prepare("SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id WHERE a.id = ?").bind(assetId).first<Record<string, unknown>>();
  if (!row) return null;
  const releases = await c.env.DB.prepare("SELECT release_type, status, document_name FROM contributor_releases WHERE asset_id = ?").bind(assetId).all<Record<string, unknown>>();
  return addReleaseDocuments(assetRowToDomain(row), releases.results as Record<string, unknown>[]);
}

function licencePriceCents(request: LicenceRequest, asset: Asset): number | null {
  if (request.productCode === "custom") return null;
  if (asset.monetizationModel === "custom_quote") return null;
  if (asset.monetizationModel === "individual_license" && asset.licensePriceCents && asset.licensePriceCents >= 100) {
    return asset.licensePriceCents * Math.max(1, Math.ceil(request.durationDays / 365));
  }
  const annualBase: Record<LicenceRequest["licenceType"], number> = { editorial: 25_000, social: 35_000, commercial: 75_000, advertising: 150_000, broadcast: 250_000, exclusive: 500_000 };
  return annualBase[request.licenceType] * Math.max(1, Math.ceil(request.durationDays / 365));
}

app.post("/api/checkout/validate", async (c) => {
  const request = licenceRequestSchema.parse(await c.req.json());
  const asset = await governanceAsset(c, request.assetId);
  if (!asset) return c.json({ error: "Asset not found" }, 404);
  const product = request.productCode ? await c.env.DB.prepare("SELECT code, name, terms_version, restrictions_json FROM licence_products WHERE code = ? AND active = 1").bind(request.productCode).first<Record<string, unknown>>() : null;
  if (request.productCode && !product) return c.json({ error: "Licence product is unavailable" }, 422);
  return c.json({ assetId: request.assetId, priceCents: licencePriceCents(request, asset), currency: "ZAR", monetizationModel: asset.monetizationModel ?? "membership", product: product ? { code: product.code, name: product.name, termsVersion: product.terms_version, restrictions: JSON.parse(String(product.restrictions_json)) } : null, ...archiveDomain.evaluateLicenceRequest(asset, request) });
});

app.post("/api/checkout", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["buyer", "contributor", "editor", "admin"])) return c.json({ error: "Authenticated buyer required" }, 401);
  const request = checkoutRequestSchema.parse(await c.req.json());
  if (request.buyerAgreementVersion !== buyerAgreement.version) return c.json({ error: "The buyer agreement version is no longer current", currentVersion: buyerAgreement.version }, 409);
  const asset = await governanceAsset(c, request.assetId, user.organizationId);
  if (!asset) return c.json({ error: "Asset not found" }, 404);
  const validation = archiveDomain.evaluateLicenceRequest(asset, request);
  if (!validation.allowed) return c.json({ blocked: true, ...validation }, 422);
  if (asset.monetizationModel === "custom_quote" || request.productCode === "custom") {
    return c.json({ blocked: true, error: "This asset is available by custom quote. Contact the contributor to request pricing.", monetizationModel: asset.monetizationModel }, 422);
  }
  const licenceId = crypto.randomUUID();
  const priceCents = licencePriceCents(request, asset);
  if (!priceCents) return c.json({ blocked: true, error: "A licence price is not configured for this asset." }, 422);
  const product = request.productCode ? await c.env.DB.prepare("SELECT code, terms_version, restrictions_json FROM licence_products WHERE code = ? AND active = 1").bind(request.productCode).first<Record<string, unknown>>() : null;
  if (request.productCode && !product) return c.json({ error: "Licence product is unavailable" }, 422);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO licences (id, organization_id, asset_id, buyer_id, licence_type, product_code, territory, duration_days, price_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(licenceId, user.organizationId, request.assetId, user.id, request.licenceType, request.productCode ?? null, request.territory, request.durationDays, priceCents),
    c.env.DB.prepare(`INSERT INTO marketplace_agreement_acceptances
      (id, organization_id, user_id, agreement_type, agreement_version, terms_sha256, context_type, context_id, accepted_at)
      VALUES (?, ?, ?, 'buyer', ?, ?, 'checkout', ?, ?)`)
      .bind(crypto.randomUUID(), user.organizationId, user.id, request.buyerAgreementVersion, await sha256Hex(agreementText(buyerAgreement)), "pending:" + licenceId, new Date().toISOString()),
    c.env.DB.prepare(`INSERT INTO marketplace_agreement_acceptances
      (id, organization_id, user_id, agreement_type, agreement_version, terms_sha256, context_type, context_id, accepted_at)
      VALUES (?, ?, ?, 'payment', ?, ?, 'checkout', ?, ?)`)
      .bind(crypto.randomUUID(), user.organizationId, user.id, paymentDisclosure.version, await sha256Hex(agreementText(paymentDisclosure)), "pending:" + licenceId, new Date().toISOString()),
    ...(product ? [c.env.DB.prepare("INSERT INTO licence_evidence (id, licence_id, event_type, payload_json, payload_sha256) VALUES (?, ?, 'issued', ?, ?)").bind(crypto.randomUUID(), licenceId, JSON.stringify({ productCode: product.code, termsVersion: product.terms_version, restrictions: JSON.parse(String(product.restrictions_json)), status: "pending_payment" }), await sha256Hex(`${licenceId}:${product.code}:${product.terms_version}:${product.restrictions_json}`))] : []),
  ]);
  return c.json({ blocked: false, licenceId, priceCents, currency: "ZAR", paymentRequired: true, ...validation }, 201);
});

const paymentSessionSchema = z.object({
  successUrl: z.string().url().max(2048),
  cancelUrl: z.string().url().max(2048),
});

app.post("/api/payments/:licenceId/session", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["buyer", "contributor", "editor", "admin"])) return c.json({ error: "Authenticated buyer required" }, 401);
  const paymentToken = await resolveSecret(c.env.PAYMENT_TOKEN, c.env.PAYMENT_TOKEN_STORE);
  if (!c.env.PAYMENT_PROVIDER || !c.env.PAYMENT_ENDPOINT || !paymentToken) return c.json({ error: "Payment provider is not configured" }, 503);
  const payload = paymentSessionSchema.parse(await c.req.json());
  const licence = await c.env.DB.prepare(`
    SELECT l.id, l.price_cents, l.status, l.payment_reference, l.asset_id, a.owner_id,
      u.email, w.provider AS wallet_provider, w.provider_account_id, w.status AS wallet_status,
      w.artist_share_percentage
    FROM licences l JOIN users u ON u.id = l.buyer_id JOIN assets a ON a.id = l.asset_id
      LEFT JOIN payout_wallets w ON w.contributor_id = a.owner_id AND w.provider = 'paystack' AND w.status <> 'disabled'
    WHERE l.id = ? AND l.organization_id = ? AND l.buyer_id = ?
  `).bind(c.req.param("licenceId"), user.organizationId, user.id).first<{ id: string; price_cents: number; status: string; payment_reference: string | null; asset_id: string; owner_id: string; email: string; wallet_provider: string | null; provider_account_id: string | null; wallet_status: string | null; artist_share_percentage: number | null }>();
  if (!licence) return c.json({ error: "Licence not found" }, 404);
  if (licence.status !== "pending") return c.json({ error: `Licence cannot be paid from status ${licence.status}` }, 409);
  if (String(c.env.PAYMENT_PROVIDER).toLowerCase() === "paystack" && (licence.wallet_provider !== "paystack" || licence.wallet_status !== "verified" || !licence.provider_account_id)) {
    return c.json({ error: "The artist does not yet have a verified Paystack subaccount; payment is unavailable" }, 422);
  }
  const artistSharePercentage = Math.min(99, Math.max(1, Number(licence.artist_share_percentage ?? c.env.DEFAULT_ARTIST_SHARE_PERCENTAGE ?? 60)));
  const allocation = calculateMarketplaceSplit(Number(licence.price_cents), artistSharePercentage);
  const artistAmountCents = allocation.artistAmountCents;
  const platformAmountCents = allocation.platformAmountCents;
  const integrations = new IntegrationContainer({ ...c.env, PAYMENT_TOKEN: paymentToken });
  try {
    const session = await integrations.payments.get(c.env.PAYMENT_PROVIDER).createCheckoutSession({
      idempotencyKey: `licence:${licence.id}`,
      licenceId: licence.id,
      amountCents: Number(licence.price_cents),
      currency: "ZAR",
      buyer: { id: user.id, email: licence.email },
      successUrl: payload.successUrl,
      cancelUrl: payload.cancelUrl,
      metadata: { organizationId: user.organizationId, userId: user.id },
      split: c.env.PAYMENT_PROVIDER.toLowerCase() === "paystack" ? {
        type: "percentage",
        bearerType: String(c.env.PAYSTACK_SPLIT_FEE_BEARER) === "subaccount" ? "subaccount" : "account",
        subaccounts: [{ subaccount: String(licence.provider_account_id), share: artistSharePercentage }],
      } : undefined,
    });
    await c.env.DB.prepare(`INSERT OR REPLACE INTO payment_split_allocations
      (id, licence_id, provider, provider_reference, contributor_id, provider_account_id, artist_share_percentage, artist_amount_cents, platform_amount_cents, currency, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZAR', 'configured')`)
      .bind(crypto.randomUUID(), licence.id, session.provider, session.providerReference ?? session.id, licence.owner_id, licence.provider_account_id ?? "", artistSharePercentage, artistAmountCents, platformAmountCents).run();
    await c.env.DB.prepare("UPDATE licences SET payment_provider = ?, payment_reference = COALESCE(payment_reference, ?) WHERE id = ? AND organization_id = ? AND status = 'pending'")
      .bind(c.env.PAYMENT_PROVIDER, session.providerReference ?? session.id, licence.id, user.organizationId).run();
    return c.json({ licenceId: licence.id, provider: session.provider, checkoutUrl: session.checkoutUrl, status: session.status, paymentFlow: { artistSharePercentage, artistAmountCents, platformAmountCents, currency: "ZAR", settlement: "Paystack split at checkout" } }, 201);
  } catch (error) {
    logEvent("error", "payment.checkout_session_failed", c.get("trace"), { licenceId: licence.id, provider: c.env.PAYMENT_PROVIDER, error: error instanceof Error ? error.message : "unknown" });
    return c.json({ error: "Payment provider could not create a checkout session" }, 503);
  }
});

const settlementSchema = z.object({
  amountCents: z.number().int().positive().max(100_000_000),
  currency: z.string().length(3).default("ZAR"),
  platformFeeCents: z.number().int().nonnegative().optional(),
  taxCents: z.number().int().nonnegative().default(0),
  royaltyCents: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().trim().min(8).max(160),
});

async function postSaleSettlement(env: Bindings, licenceId: string, payload: z.infer<typeof settlementSchema>): Promise<{ transactionId: string; idempotent: boolean }> {
  if (payload.currency.toUpperCase() !== "ZAR") throw new Error("Licences must settle in ZAR");
  const existing = await env.DB.prepare("SELECT id, licence_id, amount_cents, currency FROM ledger_transactions WHERE idempotency_key = ?").bind(payload.idempotencyKey).first<{ id: string; licence_id: string | null; amount_cents: number; currency: string }>();
  if (existing) {
    if (existing.licence_id !== licenceId || Number(existing.amount_cents) !== payload.amountCents || existing.currency !== payload.currency.toUpperCase()) throw new Error("Idempotency key was already used for a different settlement");
    return { transactionId: existing.id, idempotent: true };
  }
  const licence = await env.DB.prepare("SELECT l.id, l.asset_id, l.organization_id, l.buyer_id, l.licence_type, l.territory, l.duration_days, l.status, l.price_cents, a.owner_id FROM licences l JOIN assets a ON a.id = l.asset_id WHERE l.id = ?").bind(licenceId).first<{ id: string; asset_id: string; organization_id: string; buyer_id: string; licence_type: string; territory: string; duration_days: number; owner_id: string; status: string; price_cents: number }>();
  if (!licence) throw new Error("Licence not found");
  if (licence.status !== "pending") throw new Error(`Licence cannot be settled from status ${licence.status}`);
  if (Number(licence.price_cents) !== payload.amountCents) throw new Error("Settlement amount does not match the licence price");
  const split = await env.DB.prepare("SELECT artist_amount_cents, platform_amount_cents FROM payment_split_allocations WHERE licence_id = ?").bind(licenceId).first<{ artist_amount_cents: number; platform_amount_cents: number }>();
  const fee = payload.platformFeeCents ?? (split ? Number(split.platform_amount_cents) : Math.floor(payload.amountCents * 0.2));
  const royalty = payload.royaltyCents ?? (split ? Number(split.artist_amount_cents) : payload.amountCents - fee - payload.taxCents);
  if (fee + royalty + payload.taxCents !== payload.amountCents || royalty < 0) throw new Error("Sale postings must balance to the settled amount");
  const transactionId = crypto.randomUUID();
  const receiptPayload = JSON.stringify({ licenceId, assetId: licence.asset_id, buyerId: licence.buyer_id, licenceType: licence.licence_type, territory: licence.territory, durationDays: licence.duration_days, amountCents: payload.amountCents, currency: payload.currency.toUpperCase(), issuedAt: new Date().toISOString() });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO ledger_transactions (id, licence_id, transaction_type, idempotency_key, amount_cents, currency) VALUES (?, ?, 'sale', ?, ?, ?)").bind(transactionId, licenceId, payload.idempotencyKey, payload.amountCents, payload.currency.toUpperCase()),
    env.DB.prepare("INSERT INTO ledger_postings (id, transaction_id, account_code, debit_cents, credit_cents, metadata_json) VALUES (?, ?, 'cash_clearing', ?, 0, '{}')").bind(crypto.randomUUID(), transactionId, payload.amountCents),
    env.DB.prepare("INSERT INTO ledger_postings (id, transaction_id, account_code, contributor_id, debit_cents, credit_cents, metadata_json) VALUES (?, ?, 'contributor_payable', ?, 0, ?, ?)").bind(crypto.randomUUID(), transactionId, licence.owner_id, royalty, JSON.stringify({ licenceId })),
    env.DB.prepare("INSERT INTO ledger_postings (id, transaction_id, account_code, debit_cents, credit_cents, metadata_json) VALUES (?, ?, 'platform_revenue', 0, ?, '{}')").bind(crypto.randomUUID(), transactionId, fee),
    ...(payload.taxCents > 0 ? [env.DB.prepare("INSERT INTO ledger_postings (id, transaction_id, account_code, debit_cents, credit_cents, metadata_json) VALUES (?, ?, 'tax_payable', 0, ?, '{}')").bind(crypto.randomUUID(), transactionId, payload.taxCents)] : []),
    env.DB.prepare("INSERT INTO ledger_entries (id, licence_id, contributor_id, entry_type, amount_cents, currency) VALUES (?, ?, ?, 'sale', ?, ?), (?, ?, ?, 'platform_fee', ?, ?)").bind(crypto.randomUUID(), licenceId, licence.owner_id, royalty, payload.currency.toUpperCase(), crypto.randomUUID(), licenceId, licence.owner_id, -fee, payload.currency.toUpperCase()),
    env.DB.prepare("UPDATE licences SET status = 'paid', price_cents = ? WHERE id = ?").bind(payload.amountCents, licenceId),
    env.DB.prepare("INSERT INTO asset_events (id, organization_id, asset_id, actor_id, event_type, licence_id) VALUES (?, ?, ?, ?, 'licence', ?)").bind(crypto.randomUUID(), licence.organization_id, licence.asset_id, licence.buyer_id, licenceId),
    env.DB.prepare("INSERT INTO licence_evidence (id, licence_id, event_type, payload_json, payload_sha256) VALUES (?, ?, 'issued', ?, ?), (?, ?, 'receipt', ?, ?)").bind(crypto.randomUUID(), licenceId, receiptPayload, await sha256Hex(receiptPayload), crypto.randomUUID(), licenceId, receiptPayload, await sha256Hex(`receipt:${receiptPayload}`)),
  ]);
  return { transactionId, idempotent: false };
}

app.post("/api/payments/:licenceId/settled", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["admin"])) return c.json({ error: "Payment service or admin access required" }, 403);
  const payload = settlementSchema.parse(await c.req.json());
  try {
    const licence = await c.env.DB.prepare("SELECT id FROM licences WHERE id = ? AND organization_id = ?").bind(c.req.param("licenceId"), user.organizationId).first<{ id: string }>();
    if (!licence) return c.json({ error: "Licence not found" }, 404);
    const result = await postSaleSettlement(c.env, c.req.param("licenceId"), payload);
    return c.json(result, result.idempotent ? 200 : 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unable to post settlement" }, 422);
  }
});

const paymentWebhookSchema = z.object({
  provider: z.string().trim().min(2).max(80),
  eventId: z.string().trim().min(4).max(240),
  type: z.enum(["payment_succeeded", "payment_failed", "refund", "chargeback"]),
  licenceId: z.string().min(1).max(120),
  paymentReference: z.string().trim().max(240).optional(),
  amountCents: z.number().int().positive().max(100_000_000),
  currency: z.string().length(3),
});

async function verifyPaymentWebhook(secret: string, signature: string, body: string, provider: string): Promise<boolean> {
  const paystack = provider.toLowerCase() === "paystack";
  const expected = hex(await hmac(utf8(secret), body, paystack ? "SHA-512" : "SHA-256"));
  return timingSafeEqual(expected, signature.replace(paystack ? /^sha512=/ : /^sha256=/, ""));
}

function normalizePaymentWebhook(provider: string, raw: unknown): unknown | null {
  if (provider.toLowerCase() !== "paystack") return raw;
  if (!raw || typeof raw !== "object") return null;
  const event = String((raw as Record<string, unknown>).event ?? "");
  const data = ((raw as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
  if (!["charge.success", "refund.processed"].includes(event)) return null;
  const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata as Record<string, unknown> : {};
  const reference = String(data.reference ?? data.transaction_reference ?? "");
  const licenceId = String(metadata.licenceId ?? reference);
  return {
    provider: "paystack",
    eventId: String(data.id ?? data.refund_reference ?? `${event}:${reference}`),
    type: event === "charge.success" ? "payment_succeeded" : "refund",
    licenceId,
    paymentReference: reference,
    amountCents: Number(data.amount),
    currency: String(data.currency ?? "ZAR"),
  };
}

async function postPaymentReversal(env: Bindings, licenceId: string, payload: { amountCents: number; currency: string; idempotencyKey: string; type: "refund" | "chargeback" }): Promise<string> {
  if (payload.currency.toUpperCase() !== "ZAR") throw new Error("Licence reversals must settle in ZAR");
  const existing = await env.DB.prepare("SELECT id FROM ledger_transactions WHERE idempotency_key = ?").bind(payload.idempotencyKey).first<{ id: string }>();
  if (existing) return existing.id;
  const licence = await env.DB.prepare("SELECT l.id, l.organization_id, l.price_cents, a.owner_id FROM licences l JOIN assets a ON a.id = l.asset_id WHERE l.id = ? AND l.status = 'paid'").bind(licenceId).first<{ id: string; organization_id: string; price_cents: number; owner_id: string }>();
  if (!licence) throw new Error("Paid licence not found");
  const refunds = await env.DB.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM ledger_transactions WHERE licence_id = ? AND transaction_type = 'refund'").bind(licenceId).first<{ total: number }>();
  if (Number(refunds?.total ?? 0) + payload.amountCents > Number(licence.price_cents)) throw new Error("Refund exceeds the settled licence amount");
  const transactionId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO ledger_transactions (id, licence_id, transaction_type, idempotency_key, amount_cents, currency) VALUES (?, ?, 'refund', ?, ?, ?)").bind(transactionId, licenceId, payload.idempotencyKey, payload.amountCents, payload.currency.toUpperCase()),
    env.DB.prepare("INSERT INTO ledger_postings (id, transaction_id, account_code, debit_cents, credit_cents, metadata_json) VALUES (?, ?, ?, ?, 0, ?)").bind(crypto.randomUUID(), transactionId, payload.type === "chargeback" ? "chargeback_expense" : "refund_expense", payload.amountCents, JSON.stringify({ reason: payload.type })),
    env.DB.prepare("INSERT INTO ledger_postings (id, transaction_id, account_code, debit_cents, credit_cents, metadata_json) VALUES (?, ?, 'cash_clearing', 0, ?, '{}')").bind(crypto.randomUUID(), transactionId, payload.amountCents),
    env.DB.prepare("INSERT INTO ledger_entries (id, licence_id, contributor_id, entry_type, amount_cents, currency) VALUES (?, ?, ?, 'refund', ?, ?)").bind(crypto.randomUUID(), licenceId, licence.owner_id, -payload.amountCents, payload.currency.toUpperCase()),
    env.DB.prepare("UPDATE licences SET status = ?, refunded_at = CURRENT_TIMESTAMP WHERE id = ?").bind(payload.type === "chargeback" ? "cancelled" : "refunded", licenceId),
  ]);
  return transactionId;
}

app.post("/api/webhooks/payments", async (c) => {
  const paymentWebhookSecret = await resolveSecret(c.env.PAYMENT_WEBHOOK_SECRET, c.env.PAYMENT_WEBHOOK_SECRET_STORE);
  if (!paymentWebhookSecret) return c.json({ error: "Payment webhook secret is not configured" }, 503);
  const body = await c.req.text();
  const provider = c.env.PAYMENT_PROVIDER ?? "generic";
  const signature = provider.toLowerCase() === "paystack" ? c.req.header("x-paystack-signature") ?? "" : c.req.header("x-payment-signature") ?? "";
  if (!(await verifyPaymentWebhook(paymentWebhookSecret, signature, body, provider))) return c.json({ error: "Invalid payment webhook signature" }, 401);
  const normalized = normalizePaymentWebhook(provider, JSON.parse(body));
  if (!normalized) return c.json({ accepted: true, ignored: true }, 200);
  const payload = paymentWebhookSchema.parse(normalized);
  const duplicate = await c.env.DB.prepare("SELECT id, status FROM payment_webhook_events WHERE provider = ? AND provider_event_id = ?").bind(payload.provider, payload.eventId).first<{ id: string; status: string }>();
  if (duplicate) return c.json({ accepted: true, duplicate: true, status: duplicate.status });
  const eventId = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO payment_webhook_events (id, provider, provider_event_id, event_type, licence_id, amount_cents, currency, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(eventId, payload.provider, payload.eventId, payload.type, payload.licenceId, payload.amountCents, payload.currency.toUpperCase(), body).run();
  try {
    let transactionId: string | null = null;
    if (payload.type === "payment_succeeded") {
      const current = await c.env.DB.prepare("SELECT status, price_cents FROM licences WHERE id = ?").bind(payload.licenceId).first<{ status: string; price_cents: number }>();
      if (!current) throw new Error("Licence not found");
      if (Number(current.price_cents) !== payload.amountCents) throw new Error("Payment amount does not match the licence price");
      if (current.status === "paid") {
        const existingSale = await c.env.DB.prepare("SELECT id FROM ledger_transactions WHERE licence_id = ? AND transaction_type = 'sale' ORDER BY created_at DESC LIMIT 1").bind(payload.licenceId).first<{ id: string }>();
        transactionId = existingSale?.id ?? null;
      } else {
      transactionId = (await postSaleSettlement(c.env, payload.licenceId, { amountCents: payload.amountCents, currency: payload.currency, taxCents: 0, idempotencyKey: `${payload.provider}:${payload.eventId}` })).transactionId;
      await c.env.DB.prepare("UPDATE licences SET payment_provider = ?, payment_reference = ?, paid_at = CURRENT_TIMESTAMP, status = 'paid', price_cents = ? WHERE id = ? AND status = 'pending'").bind(payload.provider, payload.paymentReference ?? payload.eventId, payload.amountCents, payload.licenceId).run();
      await c.env.DB.prepare("UPDATE payment_split_allocations SET status = 'settled', provider_reference = COALESCE(?, provider_reference), updated_at = CURRENT_TIMESTAMP WHERE licence_id = ?").bind(payload.paymentReference ?? payload.eventId, payload.licenceId).run();
      }
    } else if (payload.type === "refund" || payload.type === "chargeback") {
      transactionId = await postPaymentReversal(c.env, payload.licenceId, { amountCents: payload.amountCents, currency: payload.currency, idempotencyKey: `${payload.provider}:${payload.eventId}`, type: payload.type });
      await c.env.DB.prepare("UPDATE payment_split_allocations SET status = 'reversed', updated_at = CURRENT_TIMESTAMP WHERE licence_id = ?").bind(payload.licenceId).run();
    }
    await c.env.DB.prepare("UPDATE payment_webhook_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP WHERE id = ?").bind(eventId).run();
    return c.json({ accepted: true, eventId, transactionId, type: payload.type });
  } catch (error) {
    await c.env.DB.prepare("UPDATE payment_webhook_events SET status = 'failed', failure_reason = ? WHERE id = ?").bind(error instanceof Error ? error.message : "payment_event_failed", eventId).run();
    return c.json({ error: "Payment event could not be applied", eventId }, 422);
  }
});

app.get("/api/ops/reconciliation/payments", async (c) => {
  const user = await requestUser(c);
  if (!user || user.role !== "admin") return c.json({ error: "Organization administrator required" }, 403);
  const rows = await c.env.DB.prepare(`
    SELECT l.id AS licence_id, l.status AS licence_status, l.price_cents,
      COALESCE(SUM(CASE WHEN t.transaction_type = 'sale' THEN t.amount_cents ELSE 0 END), 0) AS sale_ledger_cents,
      COALESCE(SUM(CASE WHEN t.transaction_type = 'refund' THEN t.amount_cents ELSE 0 END), 0) AS refund_ledger_cents
    FROM licences l LEFT JOIN ledger_transactions t ON t.licence_id = l.id
    WHERE l.organization_id = ? GROUP BY l.id ORDER BY l.created_at DESC LIMIT 500
  `).bind(user.organizationId).all<Record<string, unknown>>();
  const report = (rows.results as Record<string, unknown>[]).map((row) => ({ ...row, discrepancy: row.licence_status !== "pending" && (Number(row.price_cents ?? 0) !== Number(row.sale_ledger_cents ?? 0) || Number(row.refund_ledger_cents ?? 0) > Number(row.sale_ledger_cents ?? 0)) }));
  return c.json({ checkedAt: new Date().toISOString(), results: report, discrepancyCount: report.filter((row) => row.discrepancy).length });
});

const payoutBatchSchema = z.object({ periodStart: z.string().date(), periodEnd: z.string().date(), currency: z.string().length(3).default("ZAR") });

async function processPayoutBatch(env: Bindings, batchId: string): Promise<void> {
  const batch = await env.DB.prepare("SELECT * FROM payout_batches WHERE id = ?").bind(batchId).first<Record<string, unknown>>();
  if (!batch) return;
  const items = await env.DB.prepare(`SELECT i.id, i.contributor_id, i.wallet_id, i.contract_id, i.amount_cents, i.currency,
    w.provider, w.provider_account_id, w.account_holder_name, w.account_last4, u.display_name, u.email
    FROM payout_batch_items i JOIN payout_wallets w ON w.id = i.wallet_id JOIN users u ON u.id = i.contributor_id WHERE i.batch_id = ? AND i.status = 'pending'`).bind(batchId).all<Record<string, unknown>>();
  const registry = new IntegrationContainer(env).payouts;
  await env.DB.prepare("UPDATE payout_batches SET status = 'processing' WHERE id = ?").bind(batchId).run();
  for (const item of items.results as Record<string, unknown>[]) {
    const reference = `payout-${batchId}-${String(item.id)}`;
    try {
      const provider = registry.get(String(item.provider) as "stripe_connect" | "payfast" | "za_bank");
      const payout = await provider.createPayout({
        idempotencyKey: reference,
        reference,
        recipient: { id: String(item.contributor_id), name: String(item.account_holder_name), email: String(item.email), country: "ZA", providerAccountId: (item.provider_account_id as string | null) ?? undefined, stripeAccountId: String(item.provider) === "stripe_connect" ? String(item.provider_account_id) : undefined },
        money: { amountMinor: Number(item.amount_cents), currency: String(item.currency) },
        description: `Veld Archive royalty payout ${String(batch.period_start)} to ${String(batch.period_end)}`,
        metadata: { batchId, contractId: String(item.contract_id) },
      });
      const transactionId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO ledger_transactions (id, transaction_type, idempotency_key, amount_cents, currency) VALUES (?, 'payout', ?, ?, ?)").bind(transactionId, reference, item.amount_cents, item.currency),
        env.DB.prepare("INSERT INTO ledger_postings (id, transaction_id, account_code, contributor_id, debit_cents, credit_cents, metadata_json) VALUES (?, ?, 'contributor_payable', ?, ?, 0, ?)").bind(crypto.randomUUID(), transactionId, item.contributor_id, item.amount_cents, JSON.stringify({ batchId, contractId: item.contract_id, providerReference: payout.providerReference ?? null })),
        env.DB.prepare("INSERT INTO ledger_postings (id, transaction_id, account_code, debit_cents, credit_cents, metadata_json) VALUES (?, ?, 'cash_clearing', 0, ?, '{}')").bind(crypto.randomUUID(), transactionId, item.amount_cents),
        env.DB.prepare("UPDATE payout_batch_items SET status = ?, provider_reference = ?, ledger_transaction_id = ? WHERE id = ?").bind(payout.status === "paid" ? "paid" : "processing", payout.providerReference ?? null, transactionId, item.id),
      ]);
    } catch (error) {
      await env.DB.prepare("UPDATE payout_batch_items SET status = 'failed', failure_reason = ? WHERE id = ?").bind(error instanceof Error ? error.message : "Payout provider failure", item.id).run();
    }
  }
  await env.DB.prepare("UPDATE payout_batches SET status = CASE WHEN EXISTS (SELECT 1 FROM payout_batch_items WHERE batch_id = ? AND status = 'failed') THEN 'failed' ELSE 'paid' END, processed_at = CURRENT_TIMESTAMP WHERE id = ?").bind(batchId, batchId).run();
}

app.post("/api/admin/payout-batches", async (c) => {
  const admin = await requestUser(c);
  if (!admin || !allowedRole(admin, ["admin"])) return c.json({ error: "Admin access required" }, 403);
  const payload = payoutBatchSchema.parse(await c.req.json());
  const batchId = crypto.randomUUID();
  const minimum = Math.max(0, Number(c.env.PAYOUT_MIN_CENTS ?? 10000));
  const contributors = await c.env.DB.prepare(`
    SELECT p.contributor_id, SUM(p.credit_cents - p.debit_cents) AS balance_cents,
      w.id AS wallet_id, sc.id AS contract_id, w.currency
    FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.transaction_id
      JOIN payout_wallets w ON w.contributor_id = p.contributor_id AND w.status = 'verified' AND w.provider <> 'paystack'
      JOIN onboarding_tenders ot ON ot.contributor_id = p.contributor_id AND ot.organization_id = ? AND ot.status = 'approved'
      JOIN seller_contracts sc ON sc.id = ot.contract_id AND sc.status = 'signed'
    WHERE p.account_code = 'contributor_payable' AND t.created_at < datetime(?, '+1 day')
    GROUP BY p.contributor_id, w.id, sc.id, w.currency HAVING balance_cents >= ?`).bind(admin.organizationId, payload.periodEnd, minimum).all<Record<string, unknown>>();
  const total = (contributors.results as Record<string, unknown>[]).reduce((sum, row) => sum + Number(row.balance_cents), 0);
  await c.env.DB.prepare("INSERT INTO payout_batches (id, organization_id, period_start, period_end, currency, total_cents, triggered_by, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')").bind(batchId, admin.organizationId, payload.periodStart, payload.periodEnd, payload.currency.toUpperCase(), total, admin.id).run();
  for (const row of contributors.results as Record<string, unknown>[]) {
    await c.env.DB.prepare(`INSERT INTO payout_batch_items (id, batch_id, contributor_id, wallet_id, contract_id, amount_cents, currency)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), batchId, row.contributor_id, row.wallet_id, row.contract_id, row.balance_cents, row.currency).run();
  }
  c.executionCtx.waitUntil(processPayoutBatch(c.env, batchId));
  return c.json({ batchId, itemCount: contributors.results.length, totalCents: total, status: "processing" }, 202);
});

const utf8 = (value: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;

async function hmac(key: Uint8Array<ArrayBuffer>, value: string, hash: "SHA-256" | "SHA-512" = "SHA-256"): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, utf8(value))) as Uint8Array<ArrayBuffer>;
}

function hex(buffer: ArrayBuffer | Uint8Array<ArrayBuffer>): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Bytes(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function encodePath(path: string): string {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

async function createPresignedPutUrl(env: Bindings, objectKey: string): Promise<string | null> {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME) return null;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const region = "auto";
  const service = "s3";
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const credential = `${env.R2_ACCESS_KEY_ID}/${dateStamp}/${region}/${service}/aws4_request`;
  const query = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": "900",
    "X-Amz-SignedHeaders": "host",
  });
  const canonicalQuery = [...query.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  const canonicalUri = `/${encodeURIComponent(env.R2_BUCKET_NAME)}/${encodePath(objectKey)}`;
  const canonicalRequest = ["PUT", canonicalUri, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const canonicalRequestHash = hex(await crypto.subtle.digest("SHA-256", utf8(canonicalRequest)));
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, `${dateStamp}/${region}/${service}/aws4_request`, canonicalRequestHash].join("\n");
  const dateKey = await hmac(utf8(`AWS4${env.R2_SECRET_ACCESS_KEY}`), dateStamp);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, service);
  const signingKey = await hmac(serviceKey, "aws4_request");
  const signature = hex(await hmac(signingKey, stringToSign));
  query.set("X-Amz-Signature", signature);
  return `https://${host}${canonicalUri}?${query.toString()}`;
}

function chaosScenario(c: { env: Bindings; req: { header(name: string): string | undefined } }): string | null {
  const scenario = c.req.header("x-chaos-scenario");
  if (!scenario || String(c.env.CHAOS_TESTING_ENABLED) !== "true" || String(c.env.APP_ENV) === "production") return null;
  const supplied = c.req.header("x-chaos-token") ?? "";
  const expected = c.env.CHAOS_TEST_TOKEN ?? "";
  if (!expected || !timingSafeEqual(supplied, expected)) return null;
  return scenario;
}

function logChaos(c: { env: Bindings }, trace: TraceContext, scenario: string, point: string): void {
  logEvent("warn", "chaos.fault_injected", trace, { scenario, point });
  recordMetric(c.env, "chaos_fault_injected", trace, 1, [scenario, point]);
}

app.get("/api/health", (c) => c.json(validateContractResponse("GET /api/health 200", healthResponseSchema, {
  ok: true,
  service: "veld-archive-api",
  environment: c.env.APP_ENV ?? "unknown",
})));

app.get("/api/ops/readiness", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["admin"])) return c.json({ error: "Admin access required" }, 403);
  const configured = (value: unknown, rejected: RegExp = /^(|replace-|org-demo$)/i) => typeof value === "string" && !rejected.test(value.trim());
  const attestedWithin = (value: unknown, days: number) => {
    if (!configured(value)) return false;
    const timestamp = Date.parse(String(value));
    const age = Date.now() - timestamp;
    return Number.isFinite(timestamp) && age >= 0 && age <= days * 86_400_000;
  };
  const auth0Ready = [c.env.AUTH_JWKS_URL, c.env.AUTH_ISSUER, c.env.AUTH_AUDIENCE].every((value) => configured(value));
  const supabaseReady = [c.env.SUPABASE_URL, c.env.SUPABASE_ISSUER || (c.env.SUPABASE_URL ? `${c.env.SUPABASE_URL}/auth/v1` : undefined), c.env.SUPABASE_JWT_SECRET || c.env.SUPABASE_JWKS_URL].every((value) => configured(value));
  const providerMode = String(c.env.AUTH_PROVIDER ?? "both").toLowerCase();
  const identityProviderReady = providerMode === "auth0" ? auth0Ready : providerMode === "supabase" ? supabaseReady : auth0Ready || supabaseReady;
  const checks: Array<{ id: string; ready: boolean; detail: string }> = [
    { id: "production-environment", ready: String(c.env.APP_ENV) === "production", detail: "APP_ENV must be production." },
    { id: "identity", ready: Boolean(configured(c.env.SESSION_SECRET) && configured(c.env.AUTH_COOKIE_DOMAIN) && identityProviderReady), detail: "Session, secure-cookie domain, and at least one explicitly configured identity provider are required." },
    { id: "tenant", ready: c.env.AUTH_ALLOW_ORG_PROVISIONING === "false" && configured(c.env.DEFAULT_ORGANIZATION_ID), detail: "Automatic organisation provisioning must be disabled and the default demo tenant removed." },
    { id: "origins", ready: Boolean(c.env.ALLOWED_ORIGINS?.split(",").every((origin) => /^https:\/\//.test(origin.trim()))), detail: "Only explicit HTTPS browser origins are allowed." },
    { id: "r2-upload-and-scan", ready: [c.env.R2_ACCOUNT_ID, c.env.R2_ACCESS_KEY_ID, c.env.R2_SECRET_ACCESS_KEY, c.env.MEDIA_SCANNER_URL, c.env.MEDIA_SCANNER_SECRET].every((value) => configured(value)), detail: "Private upload credentials and the production malware scanner are required." },
    { id: "stream", ready: [c.env.STREAM_ACCOUNT_ID, c.env.STREAM_API_TOKEN || c.env.STREAM_API_TOKEN_STORE, c.env.STREAM_WEBHOOK_SECRET || c.env.STREAM_WEBHOOK_SECRET_STORE, c.env.STREAM_ALLOWED_ORIGINS].every((value) => configured(value)), detail: "Stream upload, playback-origin, and webhook configuration are required." },
    { id: "payments", ready: [c.env.PAYMENT_PROVIDER, c.env.PAYMENT_ENDPOINT, c.env.PAYMENT_TOKEN || c.env.PAYMENT_TOKEN_STORE, c.env.PAYMENT_WEBHOOK_SECRET || c.env.PAYMENT_WEBHOOK_SECRET_STORE].every((value) => configured(value)), detail: "A live payment adapter and signed webhook are required." },
    { id: "kyc", ready: [c.env.KYC_PROVIDER, c.env.KYC_WEBHOOK_SECRET].every((value) => configured(value)), detail: "A named KYC provider and signed webhook are required." },
    { id: "audit-keys", ready: [c.env.AUDIT_SIGNING_PRIVATE_JWK, c.env.AUDIT_SIGNING_PUBLIC_JWK].every((value) => configured(value)), detail: "Ed25519 audit signing keys are required." },
    { id: "vectorize", ready: Boolean(c.env.PHOTO_INDEX && c.env.AI && c.env.PHOTO_ENRICHMENT_QUEUE), detail: "Workers AI, Vectorize, and enrichment queue bindings are required." },
    { id: "waf-attestation", ready: attestedWithin(c.env.EDGE_CONTROLS_ATTESTED_AT, 90), detail: "Record a WAF, edge-rate-limit, and API-control live test from the last 90 days." },
    { id: "key-rotation-attestation", ready: attestedWithin(c.env.KEY_ROTATION_ATTESTED_AT, 90), detail: "Record a secret and signing-key rotation drill from the last 90 days." },
    { id: "restore-attestation", ready: attestedWithin(c.env.BACKUP_RESTORE_ATTESTED_AT, 180), detail: "Record a D1/R2 restore drill from the last 180 days." },
  ];
  const resourceChecks = await Promise.allSettled([
    c.env.MEDIA_BUCKET.head("__veld_readiness_probe__"),
    c.env.MEDIA_DR_BUCKET.head("__veld_readiness_probe__"),
    c.env.BACKUP_BUCKET.head("__veld_readiness_probe__"),
    c.env.DB.prepare("SELECT 1 AS ok").first(),
  ]);
  checks.push({ id: "bound-resources", ready: resourceChecks.every((result) => result.status === "fulfilled"), detail: "D1 and primary, DR, and backup R2 bindings must be reachable." });
  const [demoCount, discoveryTable] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM assets WHERE COALESCE(demo_seed, 0) = 1 OR id LIKE 'asset-demo-%' OR id LIKE 'asset-test-photo-%'").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'saved_searches'").first<{ count: number }>(),
  ]);
  checks.push({ id: "no-demo-assets", ready: Number(demoCount?.count ?? 0) === 0, detail: "Production D1 must not contain seeded or demo asset records." });
  checks.push({ id: "migrations", ready: Number(discoveryTable?.count ?? 0) === 1, detail: "The personalized-discovery migration must be applied." });
  return c.json({ ready: checks.every((check) => check.ready), checkedAt: new Date().toISOString(), checks });
});

type AuditActor = { id: string; type: "user" | "contributor" | "service" | "admin"; residencyRegion: "za" | "eu" };

async function requestUser(c: { env: Bindings; req: { raw: Request } }): Promise<RequestUser | null> {
  return getRequestUser(c.env, c.req.raw);
}

async function requestActor(c: { env: Bindings; req: { raw: Request; header(name: string): string | undefined } }): Promise<AuditActor | null> {
  const user = await requestUser(c);
  if (!user) return null;
  const requestedResidency = c.req.header("x-residency-region");
  if (requestedResidency && requestedResidency !== user.residencyRegion) return null;
  const type = user.role === "admin" ? "admin" : user.role === "contributor" ? "contributor" : "user";
  return { id: user.id, type, residencyRegion: user.residencyRegion };
}

function allowedRole(user: RequestUser | null, roles: string[]): boolean {
  return Boolean(user && roles.includes(user.role));
}

const auditEventRequestSchema = z.object({
  eventId: z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).optional(),
  streamId: z.string().regex(/^[A-Za-z0-9._:-]{1,120}$/),
  action: z.string().regex(/^[a-z0-9._:-]{2,120}$/),
  resourceType: z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/),
  resourceId: z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/),
  data: z.record(z.unknown()).default({}),
  residencyRegion: residencyRegionSchema.optional(),
});

app.post("/api/audit/events", async (c) => {
  const payload = auditEventRequestSchema.parse(await c.req.json());
  const actor = await requestActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  const residencyRegion = payload.residencyRegion ?? actor.residencyRegion;
  const allowed = new Set((c.env.AUDIT_ALLOWED_RESIDENCIES ?? "za,eu").split(",").map((value) => value.trim()).filter(Boolean));
  if (!allowed.has(residencyRegion)) return c.json({ error: "Residency region is not enabled" }, 400);
  try {
    const result = await appendAuditEvent(c.env, {
      ...payload,
      data: redactAuditData(payload.data),
      actorId: actor.id,
      actorType: actor.type,
      residencyRegion,
      actorResidencyRegion: actor.residencyRegion,
    });
    return c.json({ ...result, integrity: { algorithm: "SHA-256 + Ed25519", immutable: true } }, result.created ? 201 : 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AUDIT_WRITE_FAILED";
    const status = message === "RESIDENCY_POLICY_VIOLATION" ? 403 : message === "AUDIT_CHAIN_CONFLICT" ? 409 : 400;
    return c.json({ error: message }, status);
  }
});

app.get("/api/audit/events/:streamId", async (c) => {
  const actor = await requestActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  const streamId = c.req.param("streamId");
  if (actor.type !== "admin" && actor.type !== "service" && streamId !== `contributor:${actor.id}`) return c.json({ error: "Forbidden" }, 403);
  const residencyRegion = residencyRegionSchema.parse(c.req.query("residencyRegion") ?? "za");
  if (residencyRegion !== actor.residencyRegion) return c.json({ error: "Residency mismatch" }, 403);
  const parsedLimit = Number(c.req.query("limit") ?? 100);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 1000) : 100;
  const result = await c.env.DB.prepare("SELECT * FROM audit_log_events WHERE stream_id = ? AND residency_region = ? ORDER BY sequence DESC LIMIT ?")
    .bind(streamId, residencyRegion, limit).all<Record<string, unknown>>();
  const events: Array<StoredAuditEvent & { verification: { hashValid: boolean; signatureValid: boolean } }> = [];
  for (const row of result.results as Record<string, unknown>[]) {
    const event = {
      schemaVersion: 1 as const,
      eventId: String(row.event_id),
      streamId: String(row.stream_id),
      sequence: Number(row.sequence),
      occurredAt: String(row.occurred_at),
      actor: { id: String(row.actor_id), type: String(row.actor_type) as StoredAuditEvent["actor"]["type"] },
      action: String(row.action),
      resource: { type: String(row.resource_type), id: String(row.resource_id) },
      data: JSON.parse(String(row.data_json)) as Record<string, unknown>,
      residencyRegion,
      previousHash: String(row.previous_hash),
      hash: String(row.event_hash),
      signature: String(row.signature),
      signatureAlgorithm: "Ed25519" as const,
      keyId: String(row.key_id),
      publicKeyJwk: JSON.parse(String(row.public_key_jwk)) as JsonWebKey,
      r2Key: String(row.r2_key),
    } satisfies StoredAuditEvent;
    events.push({ ...event, verification: await verifyAuditEvent(c.env, event) });
  }
  return c.json({ streamId, residencyRegion, events });
});

const auditExportSchema = z.object({
  streamId: z.string().regex(/^[A-Za-z0-9._:-]{1,120}$/),
  residencyRegion: residencyRegionSchema,
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

app.post("/api/audit/exports", async (c) => {
  const actor = await requestActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  if (actor.type !== "admin" && actor.type !== "service") return c.json({ error: "Admin or service identity required" }, 403);
  const filters = auditExportSchema.parse(await c.req.json());
  if (filters.residencyRegion !== actor.residencyRegion) return c.json({ error: "Export residency must match actor residency" }, 403);
  const result = await exportAuditEvents(c.env, filters);
  return c.json({ ...result, download: `/api/audit/exports/${result.exportId}` }, 201);
});

app.get("/api/audit/exports/:exportId", async (c) => {
  const actor = await requestActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  const row = await c.env.DB.prepare("SELECT * FROM audit_exports WHERE id = ?").bind(c.req.param("exportId")).first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Export not found" }, 404);
  if (String(row.residency_region) !== actor.residencyRegion) return c.json({ error: "Export residency mismatch" }, 403);
  const object = await getAuditBucket(c.env, actor.residencyRegion).get(String(row.object_key));
  if (!object) return c.json({ error: "Export object not found" }, 404);
  return new Response(object.body, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename=veld-audit-${c.req.param("exportId")}.json`, "Cache-Control": "no-store" } });
});

const verificationStartSchema = z.object({
  subjectType: z.enum(["individual", "business"]),
  residencyRegion: residencyRegionSchema,
  provider: z.string().min(2).max(80).default("configured-provider"),
});

app.post("/api/verification/cases", async (c) => {
  const actor = await requestActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  const payload = verificationStartSchema.parse(await c.req.json());
  if (actor.type !== "contributor" && actor.type !== "admin") return c.json({ error: "Contributor identity required" }, 403);
  if (payload.residencyRegion !== actor.residencyRegion) return c.json({ error: "Verification residency must match actor residency" }, 403);
  const caseId = crypto.randomUUID();
  const retentionDays = Math.max(365, Number(c.env.AUDIT_RETENTION_DAYS ?? 2555));
  const retentionUntil = new Date(Date.now() + retentionDays * 86_400_000).toISOString();
  await c.env.DB.prepare("INSERT INTO contributor_verification_cases (id, contributor_id, residency_region, subject_type, provider, retention_until) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(caseId, actor.id, payload.residencyRegion, payload.subjectType, payload.provider, retentionUntil).run();
  const audit = await appendAuditEvent(c.env, {
    streamId: `contributor:${actor.id}`,
    actorId: actor.id,
    actorType: actor.type,
    action: "verification.case.created",
    resourceType: "verification_case",
    resourceId: caseId,
    data: { subjectType: payload.subjectType, provider: payload.provider, retentionUntil },
    residencyRegion: payload.residencyRegion,
    actorResidencyRegion: actor.residencyRegion,
  });
  return c.json({ caseId, status: "pending", provider: payload.provider, retentionUntil, auditEventId: audit.event.eventId, next: ["collect consent", "submit identity and address documents to KYC provider", "complete liveness check", "screen sanctions, PEP and adverse media", "verify beneficial ownership for businesses"] }, 201);
});

app.get("/api/verification/cases/:caseId", async (c) => {
  const actor = await requestActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  const row = await c.env.DB.prepare("SELECT id, contributor_id, residency_region, subject_type, provider, status, risk_level, sanctions_status, pep_status, adverse_media_status, retention_until, created_at, updated_at FROM contributor_verification_cases WHERE id = ?")
    .bind(c.req.param("caseId")).first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Verification case not found" }, 404);
  if (String(row.contributor_id) !== actor.id && actor.type !== "admin") return c.json({ error: "Forbidden" }, 403);
  return c.json({ case: row, documents: await c.env.DB.prepare("SELECT id, document_type, content_sha256, issued_country, expires_at, created_at FROM verification_documents WHERE case_id = ?").bind(c.req.param("caseId")).all() });
});

const verificationDocumentSchema = z.object({
  documentType: z.enum(["government_id", "proof_of_address", "business_registration", "beneficial_owner_register", "bank_account_proof"]),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  issuedCountry: z.string().length(2).optional(),
  expiresAt: z.string().datetime().optional(),
});

app.post("/api/verification/cases/:caseId/documents", async (c) => {
  const actor = await requestActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  const payload = verificationDocumentSchema.parse(await c.req.json());
  const row = await c.env.DB.prepare("SELECT contributor_id, residency_region, retention_until FROM contributor_verification_cases WHERE id = ?").bind(c.req.param("caseId")).first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Verification case not found" }, 404);
  if (String(row.contributor_id) !== actor.id && actor.type !== "admin") return c.json({ error: "Forbidden" }, 403);
  if (String(row.residency_region) !== actor.residencyRegion) return c.json({ error: "Residency mismatch" }, 403);
  const documentId = crypto.randomUUID();
  const objectKey = `verification/${actor.id}/${c.req.param("caseId")}/${documentId}`;
  await c.env.DB.prepare("INSERT INTO verification_documents (id, case_id, document_type, object_key, content_sha256, issued_country, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(documentId, c.req.param("caseId"), payload.documentType, objectKey, payload.contentSha256, payload.issuedCountry ?? null, payload.expiresAt ?? null).run();
  await appendAuditEvent(c.env, {
    streamId: `contributor:${actor.id}`,
    actorId: actor.id,
    actorType: actor.type,
    action: "verification.document.registered",
    resourceType: "verification_document",
    resourceId: documentId,
    data: { caseId: c.req.param("caseId"), documentType: payload.documentType, contentSha256: payload.contentSha256 },
    residencyRegion: actor.residencyRegion,
    actorResidencyRegion: actor.residencyRegion,
  });
  return c.json({ documentId, objectKey, upload: "Use the configured KYC provider for document transfer. Raw identity documents are deliberately excluded from audit records.", retentionUntil: row.retention_until }, 201);
});

app.put("/api/verification/documents/:documentId/content", async (c) => {
  const actor = await requestActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  const document = await c.env.DB.prepare(`SELECT d.id, d.case_id, d.object_key, d.content_sha256, vc.contributor_id, vc.residency_region
    FROM verification_documents d JOIN contributor_verification_cases vc ON vc.id = d.case_id WHERE d.id = ?`)
    .bind(c.req.param("documentId")).first<Record<string, unknown>>();
  if (!document) return c.json({ error: "Verification document not found" }, 404);
  if (String(document.contributor_id) !== actor.id && actor.type !== "admin") return c.json({ error: "Forbidden" }, 403);
  if (String(document.residency_region) !== actor.residencyRegion) return c.json({ error: "Residency mismatch" }, 403);
  const claimedLength = Number(c.req.header("content-length") ?? 0);
  if (claimedLength > 12_000_000) return c.json({ error: "Verification document exceeds the 12 MB limit" }, 413);
  const bytes = await c.req.raw.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > 12_000_000) return c.json({ error: "Verification document is empty or too large" }, 413);
  const contentSha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  if (contentSha256 !== String(document.content_sha256)) return c.json({ error: "Document checksum does not match the registered metadata" }, 422);
  await verificationBucket(c.env, residencyRegionSchema.parse(String(document.residency_region))).put(String(document.object_key), bytes, { httpMetadata: { contentType: c.req.header("content-type") ?? "application/octet-stream" } });
  await c.env.DB.prepare("UPDATE verification_documents SET uploaded_at = CURRENT_TIMESTAMP, size_bytes = ? WHERE id = ?").bind(bytes.byteLength, String(document.id)).run();
  return c.json({ documentId: document.id, uploaded: true, sizeBytes: bytes.byteLength });
});

app.post("/api/verification/documents/:documentId/ocr", async (c) => {
  const actor = await requestActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  if (actor.type !== "admin") return c.json({ error: "Admin review required for OCR" }, 403);
  const model = c.env.OCR_MODEL?.trim() || "@cf/moondream/moondream3.1-9B-A2B";
  if (String(c.env.OCR_ENABLED ?? "false") !== "true") return c.json({ error: "OCR is disabled until explicitly enabled", code: "ocr_disabled", model }, 503);
  const ai = c.env.AI;
  if (!ai) return c.json({ error: "Workers AI binding is not configured", code: "ai_binding_missing", model }, 503);
  const document = await c.env.DB.prepare(`SELECT d.id, d.case_id, d.object_key, d.document_type, d.content_sha256, vc.contributor_id, vc.residency_region
    FROM verification_documents d JOIN contributor_verification_cases vc ON vc.id = d.case_id WHERE d.id = ?`)
    .bind(c.req.param("documentId")).first<Record<string, unknown>>();
  if (!document) return c.json({ error: "Verification document not found" }, 404);
  const residencyRegion = residencyRegionSchema.parse(String(document.residency_region));
  if (residencyRegion !== actor.residencyRegion) return c.json({ error: "Residency mismatch" }, 403);
  const object = await verificationBucket(c.env, residencyRegion).get(String(document.object_key));
  if (!object) return c.json({ error: "Document content has not been uploaded" }, 409);
  if (object.size > 12_000_000) return c.json({ error: "Verification document exceeds the OCR limit" }, 413);
  const contentType = object.httpMetadata?.contentType?.toLowerCase();
  if (!contentType?.startsWith("image/")) return c.json({ error: "Cloudflare OCR currently accepts image documents only", code: "ocr_image_required" }, 422);
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength > 12_000_000) return c.json({ error: "Verification document exceeds the OCR limit" }, 413);
  if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== String(document.content_sha256)) return c.json({ error: "Document checksum does not match the registered metadata", code: "ocr_content_hash_mismatch" }, 422);
  const documentType = String(document.document_type);
  const response = await ai.run(model, {
    task: "query",
    image: `data:${contentType};base64,${base64Bytes(bytes)}`,
    question: `Read only visible text from this ${documentType} document. Return JSON only with documentType, fullName, idNumberLast4, expiryDate, issuedCountry, confidence and any appropriate type-specific fields such as address, statementDate, registeredName, registrationNumber, entityName, ownerNames, accountHolderName, bankName, or accountNumberLast4. Never return a complete identity or bank account number. Do not infer identity, ethnicity, religion, biometrics, authenticity, risk, or validity. OCR is assistive and requires human and KYC-provider review.`,
    reasoning: false,
    stream: false,
    temperature: 0,
    max_tokens: 2048,
  });
  const responseObject = response && typeof response === "object" && !Array.isArray(response) ? response as Record<string, unknown> : null;
  const responseText = typeof response === "string" ? response : typeof responseObject?.answer === "string" ? responseObject.answer : typeof responseObject?.description === "string" ? responseObject.description : JSON.stringify(response);
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  let parsed: unknown = {};
  try { parsed = JSON.parse(jsonMatch?.[0] ?? "{}"); } catch { parsed = {}; }
  const extracted = sanitizeOcrResult(parsed, documentType);
  const validation = ocrValidation(extracted, documentType);
  const resultId = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO verification_ocr_results (id, document_id, case_id, model, status, extracted_json, validation_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(resultId, document.id, document.case_id, model, "needs_review", JSON.stringify(extracted), JSON.stringify(validation)).run();
  return c.json({ resultId, documentId: document.id, model, extracted, validation });
});

const kycWebhookSchema = z.object({
  caseId: z.string().uuid(),
  status: z.enum(["in_review", "verified", "rejected", "expired"]),
  riskLevel: z.enum(["unknown", "low", "medium", "high"]).default("unknown"),
  sanctionsStatus: z.enum(["not_checked", "clear", "potential_match", "blocked"]).default("not_checked"),
  pepStatus: z.enum(["not_checked", "clear", "potential_match"]).default("not_checked"),
  adverseMediaStatus: z.enum(["not_checked", "clear", "potential_match"]).default("not_checked"),
  checks: z.array(z.object({
    type: z.enum(["identity", "liveness", "sanctions", "pep", "adverse_media", "beneficial_ownership"]),
    result: z.enum(["pending", "clear", "potential_match", "failed", "not_applicable"]),
    providerReference: z.string().max(160).optional(),
    checkedAt: z.string().datetime().optional(),
  })).max(20).default([]),
});

const diditWebhookSchema = z.object({
  event_id: z.string().min(1).max(180),
  webhook_type: z.string().min(1).max(80).default("status.updated"),
  session_id: z.string().uuid().optional(),
  status: z.string().min(1).max(40),
  vendor_data: z.string().max(180).optional(),
  metadata: z.record(z.unknown()).optional(),
});

app.post("/api/webhooks/didit", async (c) => {
  if (!c.env.DIDIT_WEBHOOK_SECRET) return c.json({ error: "Didit webhook secret is not configured" }, 503);
  const body = await c.req.text();
  const signature = c.req.header("X-Signature-V2") ?? "";
  const timestamp = c.req.header("X-Timestamp") ?? "";
  if (!(await verifyDiditWebhook(c.env.DIDIT_WEBHOOK_SECRET, body, signature, timestamp))) return c.json({ error: "Invalid Didit webhook signature" }, 401);
  const payload = diditWebhookSchema.parse(JSON.parse(body));
  const inserted = await c.env.DB.prepare("INSERT OR IGNORE INTO didit_webhook_events (event_id, session_id, webhook_type, status) VALUES (?, ?, ?, ?)").bind(payload.event_id, payload.session_id ?? null, payload.webhook_type, payload.status).run();
  if (!inserted.meta.changes) return c.json({ received: true, duplicate: true });
  const sessionId = payload.session_id ?? null;
  const contributorId = payload.vendor_data ?? (sessionId ? (await c.env.DB.prepare("SELECT contributor_id FROM contributor_verification_cases WHERE provider = 'didit' AND provider_case_id = ?").bind(sessionId).first<{ contributor_id: string }>())?.contributor_id : null);
  if (!contributorId) return c.json({ received: true, ignored: true });
  const caseRow = await c.env.DB.prepare("SELECT id, residency_region FROM contributor_verification_cases WHERE contributor_id = ? AND provider = 'didit' AND (? IS NULL OR provider_case_id = ?) ORDER BY updated_at DESC LIMIT 1").bind(contributorId, sessionId, sessionId).first<{ id: string; residency_region: "za" | "eu" }>();
  if (!caseRow) return c.json({ received: true, ignored: true });
  const normalized = payload.status.toLowerCase();
  const caseStatus = normalized === "approved" ? "verified" : ["declined", "expired", "kyc expired", "abandoned"].includes(normalized) ? "rejected" : normalized === "in review" ? "in_review" : "pending";
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE contributor_verification_cases SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(caseStatus, caseRow.id),
    c.env.DB.prepare("UPDATE seller_onboarding_profiles SET didit_status = ?, didit_provider_reference = COALESCE(?, didit_provider_reference), beneficial_owner_status = CASE WHEN beneficial_owner_required = 1 AND ? = 'verified' THEN 'verified' ELSE beneficial_owner_status END, updated_at = CURRENT_TIMESTAMP WHERE contributor_id = ?").bind(payload.status, sessionId, caseStatus, contributorId),
    c.env.DB.prepare("UPDATE contributor_profiles SET identity_status = CASE WHEN ? = 'verified' THEN 'verified' WHEN ? = 'rejected' THEN 'rejected' ELSE 'submitted' END, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").bind(caseStatus, caseStatus, contributorId),
  ]);
  const audit = await appendAuditEvent(c.env, {
    streamId: `contributor:${contributorId}`,
    actorId: "didit",
    actorType: "service",
    action: "verification.didit.updated",
    resourceType: "verification_case",
    resourceId: caseRow.id,
    data: { eventId: payload.event_id, webhookType: payload.webhook_type, status: payload.status, sessionId },
    residencyRegion: caseRow.residency_region,
    actorResidencyRegion: caseRow.residency_region,
  });
  return c.json({ received: true, caseId: caseRow.id, status: caseStatus, auditEventId: audit.event.eventId });
});

async function verifyKycWebhook(secret: string, signature: string, body: string): Promise<boolean> {
  const expected = hex(await hmac(utf8(secret), body));
  return timingSafeEqual(expected, signature.replace(/^sha256=/, ""));
}

app.post("/api/webhooks/kyc", async (c) => {
  if (!c.env.KYC_WEBHOOK_SECRET) return c.json({ error: "KYC webhook secret is not configured" }, 503);
  const body = await c.req.text();
  if (!(await verifyKycWebhook(c.env.KYC_WEBHOOK_SECRET, c.req.header("x-kyc-signature") ?? "", body))) return c.json({ error: "Invalid KYC webhook signature" }, 401);
  const payload = kycWebhookSchema.parse(JSON.parse(body));
  const row = await c.env.DB.prepare("SELECT contributor_id, residency_region FROM contributor_verification_cases WHERE id = ?").bind(payload.caseId).first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Verification case not found" }, 404);
  await c.env.DB.prepare(`
    UPDATE contributor_verification_cases
    SET status = ?, risk_level = ?, sanctions_status = ?, pep_status = ?, adverse_media_status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(payload.status, payload.riskLevel, payload.sanctionsStatus, payload.pepStatus, payload.adverseMediaStatus, payload.caseId).run();
  for (const check of payload.checks) {
    await c.env.DB.prepare("INSERT INTO verification_checks (id, case_id, check_type, result, provider_reference, checked_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), payload.caseId, check.type, check.result, check.providerReference ?? null, check.checkedAt ?? new Date().toISOString()).run();
  }
  const residencyRegion = residencyRegionSchema.parse(String(row.residency_region));
  const audit = await appendAuditEvent(c.env, {
    streamId: `contributor:${String(row.contributor_id)}`,
    actorId: "kyc-provider",
    actorType: "service",
    action: "verification.case.updated",
    resourceType: "verification_case",
    resourceId: payload.caseId,
    data: { status: payload.status, riskLevel: payload.riskLevel, sanctionsStatus: payload.sanctionsStatus, pepStatus: payload.pepStatus, adverseMediaStatus: payload.adverseMediaStatus, checks: payload.checks.map((check) => ({ type: check.type, result: check.result })) },
    residencyRegion,
    actorResidencyRegion: residencyRegion,
  });
  return c.json({ accepted: true, caseId: payload.caseId, status: payload.status, auditEventId: audit.event.eventId });
});

const publicCreatorSearchSchema = z.object({ q: z.string().trim().max(120).default("") });

app.get("/api/creators", async (c) => {
  const { q } = publicCreatorSearchSchema.parse({ q: c.req.query("q") ?? "" });
  const query = `%${q}%`;
  const production = String(c.env.APP_ENV) === "production";
  const rows = await c.env.DB.prepare(`
    SELECT cp.*, u.display_name,
      (SELECT COUNT(*) FROM assets a WHERE a.owner_id = cp.user_id AND a.status = 'published' ${production ? "AND COALESCE(a.demo_seed, 0) = 0 AND a.id NOT LIKE 'asset-demo-%' AND a.id NOT LIKE 'asset-test-photo-%'" : ""}) AS asset_count,
      (SELECT COUNT(*) FROM portfolio_collections pc WHERE pc.owner_id = cp.user_id AND pc.visibility = 'public') AS collection_count
    FROM creator_profiles cp JOIN users u ON u.id = cp.user_id
    WHERE cp.visibility = 'public' ${production ? "AND u.id NOT LIKE 'demo-%'" : ""} AND (cp.slug LIKE ? OR u.display_name LIKE ? OR cp.headline LIKE ? OR cp.location LIKE ? OR cp.specialties_json LIKE ?)
    ORDER BY asset_count DESC, cp.updated_at DESC LIMIT 48
  `).bind(query, query, query, query, query).all<Record<string, unknown>>();
  return c.json({ results: rows.results.map(creatorProfileFromRow) });
});

app.get("/api/creators/:slug", async (c) => {
  const slug = z.string().regex(/^[a-z0-9-]{3,100}$/).parse(c.req.param("slug"));
  const production = String(c.env.APP_ENV) === "production";
  const row = await c.env.DB.prepare(`
    SELECT cp.*, u.display_name,
      (SELECT COUNT(*) FROM assets a WHERE a.owner_id = cp.user_id AND a.status = 'published') AS asset_count,
      (SELECT COUNT(*) FROM portfolio_collections pc WHERE pc.owner_id = cp.user_id AND pc.visibility = 'public') AS collection_count
    FROM creator_profiles cp JOIN users u ON u.id = cp.user_id WHERE cp.slug = ? AND cp.visibility = 'public' ${production ? "AND u.id NOT LIKE 'demo-%'" : ""}
  `).bind(slug).first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Creator not found" }, 404);
  const [assets, collections] = await Promise.all([
    c.env.DB.prepare(`SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id WHERE a.owner_id = ? AND a.status = 'published' ${production ? "AND COALESCE(a.demo_seed, 0) = 0 AND a.id NOT LIKE 'asset-demo-%' AND a.id NOT LIKE 'asset-test-photo-%'" : ""} ORDER BY a.human_verified DESC, a.updated_at DESC LIMIT 24`).bind(row.user_id).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT pc.*, cp.slug AS creator_slug, u.display_name AS creator_name, (SELECT COUNT(*) FROM portfolio_collection_assets pca WHERE pca.collection_id = pc.id) AS asset_count FROM portfolio_collections pc JOIN creator_profiles cp ON cp.user_id = pc.owner_id JOIN users u ON u.id = pc.owner_id WHERE pc.owner_id = ? AND pc.visibility = 'public' ORDER BY pc.updated_at DESC`).bind(row.user_id).all<Record<string, unknown>>(),
  ]);
  return c.json({ profile: creatorProfileFromRow(row), assets: assets.results.map(assetRowToDomain), collections: collections.results.map(portfolioCollectionFromRow) });
});

app.get("/api/collections/:creatorSlug/:collectionSlug", async (c) => {
  const creatorSlug = z.string().regex(/^[a-z0-9-]{3,100}$/).parse(c.req.param("creatorSlug"));
  const collectionSlug = z.string().regex(/^[a-z0-9-]{3,100}$/).parse(c.req.param("collectionSlug"));
  const collection = await c.env.DB.prepare(`
    SELECT pc.*, cp.slug AS creator_slug, u.display_name AS creator_name,
      (SELECT COUNT(*) FROM portfolio_collection_assets pca WHERE pca.collection_id = pc.id) AS asset_count
    FROM portfolio_collections pc JOIN creator_profiles cp ON cp.user_id = pc.owner_id JOIN users u ON u.id = pc.owner_id
    WHERE cp.slug = ? AND cp.visibility = 'public' AND pc.slug = ? AND pc.visibility = 'public'
  `).bind(creatorSlug, collectionSlug).first<Record<string, unknown>>();
  if (!collection) return c.json({ error: "Collection not found" }, 404);
  const assets = await c.env.DB.prepare(`SELECT a.*, u.display_name AS contributor FROM portfolio_collection_assets pca JOIN assets a ON a.id = pca.asset_id JOIN users u ON u.id = a.owner_id WHERE pca.collection_id = ? AND a.status = 'published' ORDER BY pca.sort_order, pca.added_at DESC`).bind(collection.id).all<Record<string, unknown>>();
  return c.json({ collection: portfolioCollectionFromRow(collection), assets: assets.results.map(assetRowToDomain) });
});

app.get("/api/assets/:id/related", async (c) => {
  const asset = await c.env.DB.prepare("SELECT id, owner_id, subject_tags FROM assets WHERE id = ? AND status = 'published'").bind(c.req.param("id")).first<{ id: string; owner_id: string; subject_tags: string }>();
  if (!asset) return c.json({ error: "Asset not found" }, 404);
  const rows = await c.env.DB.prepare(`SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id WHERE a.owner_id = ? AND a.id <> ? AND a.status = 'published' ORDER BY a.human_verified DESC, a.updated_at DESC LIMIT 12`).bind(asset.owner_id, asset.id).all<Record<string, unknown>>();
  return c.json({ results: rows.results.map(assetRowToDomain) });
});

// Reverse-image search uses the same factual vision-to-embedding path as photo
// enrichment. The uploaded bytes are held in memory only for this request and
// are never persisted as a user asset.
app.post("/api/search/visual", async (c) => {
  if (!c.env.AI || !c.env.PHOTO_INDEX) return c.json({ error: "Visual search is not configured", code: "visual_search_unavailable" }, 503);
  const form = await c.req.raw.formData();
  const file = form.get("image");
  if (!(file instanceof File) || !file.type.startsWith("image/")) return c.json({ error: "Upload an image file in the image field" }, 400);
  if (file.size > 10 * 1024 * 1024) return c.json({ error: "Visual search images must be 10 MB or smaller" }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const vision = await c.env.AI.run(c.env.PHOTO_VISION_MODEL ?? "@cf/moondream/moondream3.1-8b", {
    task: "query",
    image: `data:${file.type};base64,${base64Bytes(bytes)}`,
    question: "Return one short factual description of visible objects, activity, and setting for visual search. Do not infer identity, culture, location, or intent.",
    reasoning: false,
    stream: false,
    temperature: 0,
    max_tokens: 160,
  }) as { answer?: string; description?: string };
  const description = String(vision.answer ?? vision.description ?? "").trim().slice(0, 1000);
  if (!description) return c.json({ error: "The image could not be described for search" }, 422);
  const semantic = await searchPhotoIndex(photoPipeline(c.env), description, { kind: "image", status: "published" });
  return c.json({ query: description, mode: "visual-to-semantic", results: semantic.rows.map(assetRowToDomain), usedVectorIndex: semantic.usedVectorIndex });
});

app.get("/api/assets", async (c) => {
  const params = searchSchema.parse({
    q: c.req.query("q") ?? "",
    kind: c.req.query("kind") ?? "all",
    location: c.req.query("location"),
    status: c.req.query("status") ?? "published",
    sort: c.req.query("sort") ?? "relevance",
    orientation: c.req.query("orientation") ?? "all",
    usage: c.req.query("usage") ?? "all",
    people: c.req.query("people") ?? "all",
    ai: c.req.query("ai") ?? "all",
    exclude: c.req.query("exclude"),
    cursor: c.req.query("cursor"),
  });

  let rows: Record<string, unknown>[] = [];
  let usedVectorIndex = false;
  if (params.q && params.sort === "relevance" && params.orientation === "all" && params.usage === "all" && params.people === "all" && params.ai === "all" && !params.exclude && !params.cursor) {
    try {
      const semantic = await searchPhotoIndex(photoPipeline(c.env), params.q, params);
      rows = semantic.rows;
      usedVectorIndex = semantic.usedVectorIndex;
    } catch (error) {
      logEvent("error", "photo.search.vector_failed", c.get("trace"), { error: error instanceof Error ? error.message : "unknown-error" });
    }
  }

  if (String(c.env.APP_ENV) === "production" && rows.some(isDemoAssetRow)) {
    logEvent("error", "production.demo_asset_blocked", c.get("trace"), { route: "/api/assets", resultCount: rows.length });
    return c.json({ error: "Production content guard blocked demo media", code: "production_demo_asset_blocked" }, 503);
  }

  if (!usedVectorIndex) {
    const clauses = [params.status === "all" ? "1 = 1" : "a.status = ?"];
    const values: Array<string | number> = params.status === "all" ? [] : [params.status];

    if (String(c.env.APP_ENV) === "production") clauses.push("COALESCE(a.demo_seed, 0) = 0 AND a.id NOT LIKE 'asset-demo-%' AND a.id NOT LIKE 'asset-test-photo-%'");

    if (params.kind !== "all") {
      clauses.push("a.kind = ?");
      values.push(params.kind);
    }
    if (params.location) {
      clauses.push("(a.city LIKE ? OR a.province LIKE ? OR a.locality LIKE ? OR a.landmark LIKE ?)");
      const location = `%${params.location}%`;
      values.push(location, location, location, location);
    }
    if (params.orientation !== "all") { clauses.push("a.media_orientation = ?"); values.push(params.orientation); }
    if (params.usage !== "all") { clauses.push("a.media_usage_type = ?"); values.push(params.usage); }
    if (params.people === "with_people") clauses.push("a.media_has_people = 1");
    if (params.people === "without_people") clauses.push("a.media_has_people = 0");
    if (params.ai === "ai_generated") clauses.push("a.media_ai_generated = 1");
    if (params.ai === "not_ai_generated") clauses.push("a.media_ai_generated = 0");
    if (params.cursor) { clauses.push("CAST(a.rowid AS INTEGER) < ?"); values.push(Number(params.cursor)); }
    if (params.q) {
      clauses.push("(a.title LIKE ? OR a.description LIKE ? OR a.caption LIKE ? OR a.subject_tags LIKE ? OR a.cultural_tags LIKE ? OR a.ai_tags LIKE ? OR a.ocr_text LIKE ?)");
      const query = `%${params.q}%`;
      values.push(query, query, query, query, query, query, query);
    }
    if (params.exclude) {
      for (const term of params.exclude.split(/\s+/).map((value) => value.trim()).filter(Boolean).slice(0, 12)) {
        const excluded = `%${term}%`;
        clauses.push("NOT (a.title LIKE ? OR a.description LIKE ? OR a.caption LIKE ? OR a.subject_tags LIKE ? OR a.cultural_tags LIKE ? OR a.ai_tags LIKE ?)");
        values.push(excluded, excluded, excluded, excluded, excluded, excluded);
      }
    }
    const orderBy = params.sort === "newest"
      ? "a.created_at DESC, a.id DESC"
      : params.sort === "popular"
        ? "COALESCE((SELECT COUNT(*) FROM asset_events ae WHERE ae.asset_id = a.id AND ae.event_type IN ('view', 'download')), 0) DESC, a.created_at DESC"
        : params.sort === "random"
          ? "RANDOM()"
          : "a.human_verified DESC, a.authenticity_confidence DESC, a.created_at DESC";

    const result = await c.env.DB.prepare(`
      SELECT a.*, a.rowid AS asset_rowid, u.display_name AS contributor
      FROM assets a JOIN users u ON u.id = a.owner_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT 60
    `).bind(...values).all<Record<string, unknown>>();

    rows = result.results as Record<string, unknown>[];
  }
  const response: SearchResponse = {
    query: params.q,
    mode: usedVectorIndex ? "semantic-preview" : "keyword",
    results: rows.map(assetRowToDomain),
    facets: [...rows.reduce((map, row) => {
      const values = [
        row.province ? { label: String(row.province), value: String(row.province) } : null,
        row.city ? { label: String(row.city), value: String(row.city) } : null,
        Boolean(row.human_verified) ? { label: "Human verified", value: "verified" } : null,
        row.kind ? { label: row.kind === "image" ? "Photography" : "Film & video", value: String(row.kind) } : null,
      ];
      for (const facet of values) if (facet) {
        const current = map.get(facet.value);
        map.set(facet.value, { ...facet, count: (current?.count ?? 0) + 1 });
      }
      return map;
    }, new Map<string, { label: string; value: string; count: number }>()).values()],
    nextCursor: rows.length >= 60 ? String(rows[rows.length - 1]?.asset_rowid ?? "") || null : null,
    total: rows.length,
  };

  recordMetric(c.env, "asset_search", c.get("trace"), rows.length, [params.kind, params.status]);
  return c.json(validateContractResponse("GET /api/assets 200", searchResponseSchema, response));
});

app.post("/api/admin/photo-index/rebuild", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["admin", "editor"])) return c.json({ error: "Editor access required" }, 403);
  const assets = await c.env.DB.prepare("SELECT id FROM assets WHERE organization_id = ? AND kind = 'image' AND status = 'published' ORDER BY updated_at DESC LIMIT 500")
    .bind(user.organizationId).all<{ id: string }>();
  let queued = 0;
  for (const asset of assets.results) {
    if (await enqueuePhotoJobBestEffort(c.env, asset.id, "sync_index")) queued += 1;
  }
  return c.json({ queued, total: assets.results.length, message: "Published photos queued for idempotent re-indexing." }, 202);
});

app.post("/api/analytics/events", async (c) => {
  const payload = analyticsEventSchema.parse(await c.req.json());
  const metricKey = normalizedMetric(payload.type === "search" ? payload.query : payload.type === "tag_click" ? payload.tag : payload.assetId);
  if (!metricKey) return c.json({ accepted: false, reason: "A metric key is required." }, 400);
  await c.env.DB.prepare(`
    INSERT INTO analytics_daily (metric_date, metric_type, metric_key, asset_id, country, province, city, count)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(metric_date, metric_type, metric_key, asset_id, campaign_id, country, province, city)
    DO UPDATE SET count = count + 1, updated_at = CURRENT_TIMESTAMP
  `).bind(today(), payload.type, metricKey, payload.type === "asset_view" ? payload.assetId ?? "" : "", normalizedMetric(payload.country), normalizedMetric(payload.province), normalizedMetric(payload.city)).run();
  if (payload.type === "asset_view" && payload.assetId) {
    const asset = await c.env.DB.prepare("SELECT id, organization_id FROM assets WHERE id = ? AND status = 'published'").bind(payload.assetId).first<{ id: string; organization_id: string }>();
    if (asset) {
      const actor = await requestUser(c);
      await c.env.DB.prepare("INSERT INTO asset_events (id, organization_id, asset_id, actor_id, event_type) VALUES (?, ?, ?, ?, 'view')")
        .bind(crypto.randomUUID(), asset.organization_id, asset.id, actor?.id ?? null).run();
    }
  }
  return c.json({ accepted: true }, 202);
});

app.get("/api/analytics/contributor", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "admin"])) return c.json({ error: "Contributor analytics access required" }, 403);
  const ownerId = user.id;
  const [summary, trend, tags, geography] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN metric_type = 'search' THEN count ELSE 0 END), 0) AS searches, COALESCE((SELECT COUNT(*) FROM asset_events e JOIN assets a ON a.id = e.asset_id WHERE a.owner_id = ? AND a.organization_id = ? AND e.event_type = 'view' AND e.occurred_at >= datetime('now', '-30 day')), 0) AS views, COALESCE((SELECT COUNT(*) FROM asset_events e JOIN assets a ON a.id = e.asset_id WHERE a.owner_id = ? AND a.organization_id = ? AND e.event_type = 'save' AND e.occurred_at >= datetime('now', '-30 day')), 0) AS saves FROM analytics_daily WHERE metric_date >= date('now', '-30 day')`).bind(ownerId, user.organizationId, ownerId, user.organizationId),
    c.env.DB.prepare(`SELECT metric_date AS label, SUM(count) AS value FROM analytics_daily WHERE metric_type = 'search' AND metric_date >= date('now', '-30 day') GROUP BY metric_date ORDER BY metric_date ASC`),
    c.env.DB.prepare(`SELECT metric_key AS label, SUM(count) AS value FROM analytics_daily WHERE metric_type = 'tag_click' AND metric_date >= date('now', '-30 day') GROUP BY metric_key ORDER BY value DESC LIMIT 6`),
    c.env.DB.prepare(`SELECT city AS label, SUM(count) AS value, province AS detail FROM analytics_daily WHERE metric_type = 'search' AND city <> '' AND metric_date >= date('now', '-30 day') GROUP BY city, province ORDER BY value DESC LIMIT 5`),
  ]);
  const rows = (result: { results: unknown[] }): Record<string, unknown>[] => result.results as Record<string, unknown>[];
  const summaryRow = rows(summary)[0] ?? {};
  const response: ContributorAnalytics = {
    role: "contributor", range: "Last 30 days",
    summary: { searches: Number(summaryRow.searches ?? 0), views: Number(summaryRow.views ?? 0), saves: Number(summaryRow.saves ?? 0), demandChange: 18 },
    searchTrends: rows(trend).map((row) => ({ label: String(row.label), value: Number(row.value) })),
    popularTags: rows(tags).map((row) => ({ label: String(row.label), value: Number(row.value) })),
    geographicDemand: rows(geography).map((row) => ({ label: String(row.label), value: Number(row.value), detail: String(row.detail || "South Africa") })),
    opportunities: [{ title: "Cape Town / community", detail: "Demand is rising for everyday local stories, not landmarks alone.", tone: "warm" }, { title: "Garden Route road life", detail: "Travel briefs are looking for left-side traffic and right-hand-drive context.", tone: "cool" }, { title: "Braai culture", detail: "Add more seasonal, family, and neighbourhood variations.", tone: "warm" }],
  };
  return c.json(response);
});

app.get("/api/analytics/buyer", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const result = await c.env.DB.prepare(`SELECT l.campaign_id AS id, COALESCE(NULLIF(l.campaign_name, ''), 'Untitled campaign') AS name, a.title AS asset_title, a.id AS asset_id, l.price_cents AS spend_cents, l.status, COALESCE((SELECT SUM(count) FROM analytics_daily ad WHERE ad.metric_type = 'campaign_impression' AND ad.campaign_id = l.campaign_id), 0) AS impressions, COALESCE((SELECT SUM(count) FROM analytics_daily ad WHERE ad.metric_type = 'campaign_conversion' AND ad.campaign_id = l.campaign_id), 0) AS conversions FROM licences l JOIN assets a ON a.id = l.asset_id WHERE l.organization_id = ? AND l.buyer_id = ? AND l.status IN ('paid', 'expired') GROUP BY l.id ORDER BY l.created_at DESC`).bind(user.organizationId, user.id).all<Record<string, unknown>>();
  const campaigns = (result.results as Record<string, unknown>[]).map((row) => { const spendCents = Number(row.spend_cents ?? 0); const conversions = Number(row.conversions ?? 0); return { id: String(row.id), name: String(row.name), assetTitle: String(row.asset_title), assetId: String(row.asset_id), spendCents, impressions: Number(row.impressions ?? 0), conversions, roi: spendCents ? Math.round(((conversions * 420 - spendCents) / spendCents) * 100) : 0, status: String(row.status) }; });
  const spendCents = campaigns.reduce((sum, row) => sum + row.spendCents, 0); const impressions = campaigns.reduce((sum, row) => sum + row.impressions, 0); const conversions = campaigns.reduce((sum, row) => sum + row.conversions, 0); const roi = spendCents ? Math.round(((conversions * 420 - spendCents) / spendCents) * 100) : 0;
  const response: BuyerAnalytics = { role: "buyer", range: "Last 30 days", summary: { spendCents, licensedAssets: campaigns.length, impressions, conversions, roi }, campaigns, performance: campaigns.map((row) => ({ label: row.name, value: row.impressions })) };
  return c.json(response);
});

app.get("/api/analytics/contributor/performance", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "admin"])) return c.json({ error: "Contributor analytics access required" }, 403);
  const [summaryRow, assets, downloads] = await Promise.all([
    c.env.DB.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN e.event_type = 'view' THEN 1 ELSE 0 END), 0) AS views,
        COALESCE(SUM(CASE WHEN e.event_type = 'save' THEN 1 ELSE 0 END), 0) AS saves,
        COALESCE(SUM(CASE WHEN e.event_type = 'download' THEN 1 ELSE 0 END), 0) AS downloads,
        COALESCE(SUM(CASE WHEN e.event_type = 'licence' THEN 1 ELSE 0 END), 0) AS licences
      FROM asset_events e JOIN assets a ON a.id = e.asset_id
      WHERE a.owner_id = ? AND a.organization_id = ? AND e.occurred_at >= datetime('now', '-30 day')
    `).bind(user.id, user.organizationId).first<Record<string, unknown>>(),
    c.env.DB.prepare(`
      SELECT a.id AS asset_id, a.title,
        SUM(CASE WHEN e.event_type = 'view' THEN 1 ELSE 0 END) AS views,
        SUM(CASE WHEN e.event_type = 'save' THEN 1 ELSE 0 END) AS saves,
        SUM(CASE WHEN e.event_type = 'download' THEN 1 ELSE 0 END) AS downloads,
        SUM(CASE WHEN e.event_type = 'licence' THEN 1 ELSE 0 END) AS licences
      FROM assets a LEFT JOIN asset_events e ON e.asset_id = a.id AND e.occurred_at >= datetime('now', '-30 day')
      WHERE a.owner_id = ? AND a.organization_id = ? GROUP BY a.id ORDER BY licences DESC, downloads DESC, views DESC LIMIT 12
    `).bind(user.id, user.organizationId).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT e.id, e.asset_id, a.title AS asset_title, e.licence_id, e.occurred_at FROM asset_events e JOIN assets a ON a.id = e.asset_id WHERE a.owner_id = ? AND a.organization_id = ? AND e.event_type = 'download' ORDER BY e.occurred_at DESC LIMIT 30`).bind(user.id, user.organizationId).all<Record<string, unknown>>(),
  ]);
  const views = Number(summaryRow?.views ?? 0); const licences = Number(summaryRow?.licences ?? 0);
  const response: ContributorPerformance = {
    range: "Last 30 days", summary: { views, saves: Number(summaryRow?.saves ?? 0), downloads: Number(summaryRow?.downloads ?? 0), licences, conversionRate: views ? Number(((licences / views) * 100).toFixed(2)) : 0 },
    topAssets: assets.results.map((row) => { const assetViews = Number(row.views ?? 0); const assetLicences = Number(row.licences ?? 0); return { assetId: String(row.asset_id), title: String(row.title), views: assetViews, saves: Number(row.saves ?? 0), downloads: Number(row.downloads ?? 0), licences: assetLicences, conversionRate: assetViews ? Number(((assetLicences / assetViews) * 100).toFixed(2)) : 0 }; }),
    downloadHistory: downloads.results.map((row) => ({ id: String(row.id), assetId: String(row.asset_id), assetTitle: String(row.asset_title), licenceId: String(row.licence_id), occurredAt: String(row.occurred_at) })),
  };
  return c.json(response);
});

app.get("/api/licence-products", async (c) => {
  const rows = await c.env.DB.prepare("SELECT code, name, description, terms_version, restrictions_json FROM licence_products WHERE active = 1 ORDER BY CASE code WHEN 'standard' THEN 1 WHEN 'enhanced' THEN 2 WHEN 'editorial' THEN 3 ELSE 4 END").all<Record<string, unknown>>();
  const results: LicenceProduct[] = rows.results.map((row) => ({ code: String(row.code) as LicenceProduct["code"], name: String(row.name), description: String(row.description), termsVersion: String(row.terms_version), restrictions: JSON.parse(String(row.restrictions_json)) as LicenceProduct["restrictions"] }));
  return c.json({ results });
});

app.get("/api/licences/history", async (c) => {
  const user = await requestUser(c); if (!user) return c.json({ error: "Authentication required" }, 401);
  const rows = await c.env.DB.prepare(`SELECT l.id, l.asset_id, a.title AS asset_title, l.licence_type, l.territory, l.duration_days, l.price_cents, l.status, l.created_at, l.paid_at, (SELECT COUNT(*) FROM licence_evidence le WHERE le.licence_id = l.id) AS evidence_count, (SELECT COUNT(*) FROM licence_downloads ld WHERE ld.licence_id = l.id) AS download_count FROM licences l JOIN assets a ON a.id = l.asset_id WHERE l.organization_id = ? AND l.buyer_id = ? ORDER BY l.created_at DESC LIMIT 100`).bind(user.organizationId, user.id).all<Record<string, unknown>>();
  return c.json({ results: rows.results.map((row) => ({ ...row, download_url: `/api/licences/${String(row.id)}/download` })) });
});

app.get("/api/licences/:id/evidence", async (c) => {
  const user = await requestUser(c); if (!user) return c.json({ error: "Authentication required" }, 401);
  const licence = await c.env.DB.prepare("SELECT id FROM licences WHERE id = ? AND organization_id = ? AND buyer_id = ?").bind(c.req.param("id"), user.organizationId, user.id).first();
  if (!licence) return c.json({ error: "Licence not found" }, 404);
  const rows = await c.env.DB.prepare("SELECT id, event_type, payload_json, payload_sha256, created_at FROM licence_evidence WHERE licence_id = ? ORDER BY created_at DESC").bind(c.req.param("id")).all<Record<string, unknown>>();
  return c.json({ licenceId: c.req.param("id"), evidence: rows.results.map((row) => ({ id: row.id, type: row.event_type, payload: JSON.parse(String(row.payload_json)), sha256: row.payload_sha256, createdAt: row.created_at })) });
});

app.post("/api/licences/:id/download", async (c) => {
  const user = await requestUser(c); if (!user) return c.json({ error: "Authentication required" }, 401);
  const licence = await c.env.DB.prepare("SELECT l.id, l.asset_id, l.organization_id, l.duration_days, l.created_at, a.original_key, a.source_file_name, a.stream_uid, a.media_content_type FROM licences l JOIN assets a ON a.id = l.asset_id WHERE l.id = ? AND l.organization_id = ? AND l.buyer_id = ? AND l.status = 'paid' AND datetime(l.created_at, '+' || l.duration_days || ' days') > CURRENT_TIMESTAMP").bind(c.req.param("id"), user.organizationId, user.id).first<{ id: string; asset_id: string; organization_id: string; duration_days: number; created_at: string; original_key: string | null; source_file_name: string | null; stream_uid: string | null; media_content_type: string | null }>();
  if (!licence) return c.json({ error: "Paid licence not found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO asset_events (id, organization_id, asset_id, actor_id, event_type, licence_id) VALUES (?, ?, ?, ?, 'download', ?)").bind(crypto.randomUUID(), user.organizationId, licence.asset_id, user.id, licence.id),
    c.env.DB.prepare("INSERT INTO licence_downloads (id, organization_id, licence_id, asset_id, buyer_id, variant, object_key, content_type) VALUES (?, ?, ?, ?, ?, 'original', ?, ?)").bind(crypto.randomUUID(), user.organizationId, licence.id, licence.asset_id, user.id, licence.original_key ?? licence.stream_uid ?? "stream", licence.media_content_type ?? null),
    c.env.DB.prepare("INSERT INTO licence_evidence (id, licence_id, event_type, payload_json, payload_sha256) VALUES (?, ?, 'download', ?, ?)").bind(crypto.randomUUID(), licence.id, JSON.stringify({ assetId: licence.asset_id, downloadedBy: user.id, at: new Date().toISOString() }), await sha256Hex(`download:${licence.id}:${user.id}:${Date.now()}`)),
  ]);
  if (licence.stream_uid) return c.json({ licenceId: licence.id, type: "stream", streamUid: licence.stream_uid, message: "Request a short-lived signed Stream playback token from the configured media delivery service." }, 202);
  if (!licence.original_key) return c.json({ error: "Licensed media is not available" }, 409);
  const object = await c.env.MEDIA_BUCKET.get(licence.original_key);
  if (!object) return c.json({ error: "Licensed media object is unavailable" }, 503);
  const filename = (licence.source_file_name ?? "veld-archive-download").replace(/[\r\n"]/g, "-");
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" } });
});

app.get("/api/assets/:id/media", async (c) => {
  const asset = await c.env.DB.prepare("SELECT id, organization_id, owner_id, kind, status, original_key, preview_key, stream_uid, demo_seed, updated_at FROM assets WHERE id = ? AND status IN ('published', 'processing', 'needs_review')").bind(c.req.param("id")).first<{ id: string; organization_id: string; owner_id: string; kind: string; status: string; original_key: string | null; preview_key: string | null; stream_uid: string | null; demo_seed: number; updated_at: string }>();
  if (!asset) return c.json({ error: "Asset not found" }, 404);
  if (String(c.env.APP_ENV) === "production" && (asset.demo_seed === 1 || asset.id.startsWith("asset-demo-") || asset.id.startsWith("asset-test-photo-"))) return c.json({ error: "Production content guard blocked demo media" }, 404);
  if (asset.status !== "published") {
    const user = await requestUser(c);
    if (!user || user.organizationId !== asset.organization_id || (user.id !== asset.owner_id && !allowedRole(user, ["editor", "admin"]))) return c.json({ error: "Asset not found" }, 404);
  }
  const variants = await c.env.DB.prepare("SELECT variant, object_key, provider_uid, width, height, fps, duration_seconds, content_type, status FROM media_derivatives WHERE asset_id = ? ORDER BY variant").bind(asset.id).all<Record<string, unknown>>();
  const requestedVariant = c.req.query("variant");
  if (requestedVariant) {
    if (!["thumb", "card", "preview", "download"].includes(requestedVariant)) return c.json({ error: "Unsupported media variant" }, 400);
    if (requestedVariant === "download") {
      const user = await requestUser(c);
      if (!user) return c.json({ error: "Authentication required" }, 401);
      const licence = await c.env.DB.prepare("SELECT id FROM licences WHERE asset_id = ? AND organization_id = ? AND buyer_id = ? AND status = 'paid' AND datetime(created_at, '+' || duration_days || ' days') > CURRENT_TIMESTAMP").bind(asset.id, user.organizationId, user.id).first<{ id: string }>();
      if (!licence) return c.json({ error: "An active paid licence is required for the download variant" }, 403);
    }
    const derivative = variants.results.find((row) => row.variant === requestedVariant && row.status === "ready");
    const objectKey = String(derivative?.object_key ?? (requestedVariant === "preview" ? asset.preview_key : ""));
    if (!objectKey) return c.json({ error: "Media derivative is not ready" }, 404);
    const object = await c.env.MEDIA_BUCKET.get(objectKey);
    if (!object) return c.json({ error: "Media derivative is unavailable" }, 503);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Cache-Control", asset.status === "published" ? "public, max-age=300, stale-while-revalidate=86400" : "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    if (object.httpEtag) headers.set("ETag", object.httpEtag);
    return new Response(object.body, { headers });
  }
  const version = encodeURIComponent(asset.updated_at);
  const imageVariants = asset.kind === "image" && asset.original_key ? [
    { variant: "thumb", width: 320, height: 240, status: "ready", contentType: "image/auto", url: `/api/assets/${asset.id}/image/thumb?v=${version}` },
    { variant: "card", width: 800, height: 600, status: "ready", contentType: "image/auto", url: `/api/assets/${asset.id}/image/card?v=${version}` },
    { variant: "preview", width: 1600, height: null, status: "ready", contentType: "image/auto", url: `/api/assets/${asset.id}/image/preview?v=${version}` },
  ] : [];
  return c.json({ assetId: asset.id, status: asset.status, processing: asset.status === "processing", variants: asset.kind === "image" ? imageVariants : variants.results.map((row) => ({ variant: row.variant, width: row.width, height: row.height, fps: row.fps, durationSeconds: row.duration_seconds, status: row.status, contentType: row.content_type, url: null, providerUid: row.provider_uid })), processingContract: asset.kind === "image" ? { variants: ["thumb", "card", "preview"], crop: "cover for card/thumb; scale-down for preview", format: "accept-negotiated AVIF/WebP/JPEG", cache: "public immutable by source version", original: "private licence-gated R2 delivery" } : { provider: "Cloudflare Stream", signedPlayback: true, webhook: "required" } });
});

const imageVariantSchema = z.enum(["thumb", "card", "preview"]);
const imageVariantOptions = {
  thumb: { width: 320, height: 240, fit: "cover" as const },
  card: { width: 800, height: 600, fit: "cover" as const },
  preview: { width: 1600, fit: "scale-down" as const },
};

app.get("/api/assets/:id/image/:variant", async (c) => {
  const variant = imageVariantSchema.parse(c.req.param("variant"));
  const cache = await caches.open("veld-archive-image-variants-v1");
  const cacheKey = new Request(c.req.url, { headers: { Accept: c.req.header("Accept") ?? "image/webp" } });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  const asset = await c.env.DB.prepare("SELECT id, original_key, demo_seed FROM assets WHERE id = ? AND kind = 'image' AND status = 'published'").bind(c.req.param("id")).first<{ id: string; original_key: string | null; demo_seed: number }>();
  if (!asset?.original_key || (String(c.env.APP_ENV) === "production" && (asset.demo_seed === 1 || asset.id.startsWith("asset-demo-") || asset.id.startsWith("asset-test-photo-")))) return c.json({ error: "Published image not found" }, 404);
  const original = await c.env.MEDIA_BUCKET.get(asset.original_key);
  if (!original?.body) return c.json({ error: "Image original is unavailable" }, 503);
  const accept = c.req.header("Accept") ?? "";
  const format = accept.includes("image/avif") ? "image/avif" : accept.includes("image/webp") ? "image/webp" : "image/jpeg";
  const quality = variant === "thumb" ? 76 : variant === "card" ? 82 : 88;
  const transformed = (await c.env.IMAGES.input(original.body).transform(imageVariantOptions[variant]).output({ format, quality })).response();
  const headers = new Headers(transformed.headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Vary", "Accept");
  headers.set("X-Content-Type-Options", "nosniff");
  const response = new Response(transformed.body, { status: transformed.status, headers });
  await cache.put(cacheKey, response.clone());
  return response;
});

app.get("/api/community/overview", async (c) => {
  const [forums, threads, showcases, showcaseAssets, collections, collectionAssets] = await Promise.all([
    c.env.DB.prepare(`SELECT f.*, COUNT(DISTINCT t.id) AS topic_count, COUNT(p.id) AS post_count FROM community_forums f LEFT JOIN forum_threads t ON t.forum_id = f.id AND t.status = 'open' LEFT JOIN forum_posts p ON p.thread_id = t.id AND p.status = 'visible' WHERE f.status = 'open' GROUP BY f.id ORDER BY f.created_at ASC`).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT t.*, u.display_name AS author, COUNT(p.id) AS replies FROM forum_threads t JOIN users u ON u.id = t.author_id LEFT JOIN forum_posts p ON p.thread_id = t.id AND p.status = 'visible' WHERE t.status = 'open' GROUP BY t.id ORDER BY t.featured DESC, t.updated_at DESC LIMIT 12`).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT s.*, u.display_name AS curator FROM showcases s JOIN users u ON u.id = s.curator_id WHERE s.status = 'published' ORDER BY s.created_at DESC LIMIT 12`).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT showcase_id, asset_id FROM showcase_assets ORDER BY sort_order ASC`).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT c.*, COUNT(DISTINCT ca.asset_id) AS asset_count, COUNT(DISTINCT a.owner_id) AS contributor_count FROM featured_collections c LEFT JOIN collection_assets ca ON ca.collection_id = c.id LEFT JOIN assets a ON a.id = ca.asset_id WHERE c.status = 'published' GROUP BY c.id ORDER BY c.created_at DESC LIMIT 12`).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT collection_id, asset_id FROM collection_assets ORDER BY sort_order ASC`).all<Record<string, unknown>>(),
  ]);

  const showcaseAssetMap = new Map<string, string[]>();
  for (const row of showcaseAssets.results) {
    const id = String(row.showcase_id);
    showcaseAssetMap.set(id, [...(showcaseAssetMap.get(id) ?? []), String(row.asset_id)]);
  }
  const collectionAssetMap = new Map<string, string[]>();
  for (const row of collectionAssets.results) {
    const id = String(row.collection_id);
    collectionAssetMap.set(id, [...(collectionAssetMap.get(id) ?? []), String(row.asset_id)]);
  }

  const overview: CommunityOverview = {
    forums: forums.results.map((row) => ({ id: String(row.id), name: String(row.name), description: String(row.description), topicCount: Number(row.topic_count ?? 0), postCount: Number(row.post_count ?? 0), moderationPolicy: String(row.moderation_policy) })),
    threads: threads.results.map((row) => ({ id: String(row.id), forumId: String(row.forum_id), title: String(row.title), excerpt: String(row.body), author: String(row.author), replies: Number(row.replies ?? 0), lastActivity: String(row.updated_at), featured: Boolean(row.featured) })),
    showcases: showcases.results.map((row) => ({ id: String(row.id), title: String(row.title), description: String(row.description), curator: `Curated by ${String(row.curator)}`, theme: String(row.theme), assetIds: showcaseAssetMap.get(String(row.id)) ?? [] })),
    collections: collections.results.map((row) => ({ id: String(row.id), title: String(row.title), description: String(row.description), location: String(row.location), assetCount: Number(row.asset_count ?? 0), contributorCount: Number(row.contributor_count ?? 0), featuredLabel: String(row.featured_label) })),
  };
  return c.json(overview);
});

const savedSearchSchema = z.object({
  name: z.string().trim().min(1).max(120),
  query: z.string().transform(normalizeSavedQuery).pipe(z.string().min(2).max(240)),
  mediaKind: z.enum(["all", "image", "video"]).default("all"),
  alertFrequency: z.enum(["none", "daily", "weekly"]).default("none"),
});

function savedSearchRow(row: Record<string, unknown>): SavedSearch {
  return {
    id: String(row.id),
    name: String(row.name),
    query: String(row.query),
    mediaKind: row.media_kind as SavedSearch["mediaKind"],
    alertFrequency: row.alert_frequency as SavedSearch["alertFrequency"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

app.get("/api/discovery", async (c) => {
  const minimumCount = Math.max(3, Number(c.env.TRENDING_SEARCH_MIN_COUNT ?? 3) || 3);
  const trendingRows = await c.env.DB.prepare(`SELECT metric_key AS query, SUM(count) AS search_count
    FROM analytics_daily WHERE metric_type = 'search' AND metric_date >= date('now', '-30 day')
    GROUP BY metric_key HAVING SUM(count) >= ? ORDER BY search_count DESC, metric_key ASC LIMIT 8`)
    .bind(minimumCount).all<Record<string, unknown>>();
  const user = await requestUser(c);
  if (!user) {
    const response: DiscoveryResponse = {
      trending: trendingRows.results.map((row) => ({ query: String(row.query), searchCount: Number(row.search_count) })),
      savedSearches: [],
      recommendations: [],
      personalized: false,
    };
    return c.json(response);
  }

  const [searches, savedAssets, candidates] = await Promise.all([
    c.env.DB.prepare("SELECT id, name, query, media_kind, alert_frequency, created_at, updated_at FROM saved_searches WHERE organization_id = ? AND owner_id = ? ORDER BY updated_at DESC LIMIT 50")
      .bind(user.organizationId, user.id).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT a.id, a.title, a.description, a.caption, a.subject_tags, a.cultural_tags, a.city, a.province
      FROM user_lightbox_assets la JOIN user_lightboxes l ON l.id = la.lightbox_id JOIN assets a ON a.id = la.asset_id
      WHERE l.organization_id = ? AND l.owner_id = ? ORDER BY la.added_at DESC LIMIT 50`)
      .bind(user.organizationId, user.id).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id
      WHERE a.organization_id = ? AND a.status = 'published' ${String(c.env.APP_ENV) === "production" ? "AND COALESCE(a.demo_seed, 0) = 0 AND a.id NOT LIKE 'asset-demo-%' AND a.id NOT LIKE 'asset-test-photo-%'" : ""}
      ORDER BY a.human_verified DESC, a.updated_at DESC LIMIT 100`)
      .bind(user.organizationId).all<Record<string, unknown>>(),
  ]);
  const explicitSearches = searches.results.map(savedSearchRow);
  const preferenceValues = [
    ...explicitSearches.map((search) => search.query),
    ...savedAssets.results.flatMap((row) => [String(row.title ?? ""), String(row.subject_tags ?? ""), String(row.cultural_tags ?? ""), String(row.city ?? ""), String(row.province ?? "")]),
  ];
  const tokens = discoveryTokens(preferenceValues);
  const savedIds = new Set(savedAssets.results.map((row) => String(row.id)));
  const recommendations = candidates.results
    .filter((row) => !savedIds.has(String(row.id)) && !(String(c.env.APP_ENV) === "production" && isDemoAssetRow(row)))
    .map((row) => {
      const asset = assetRowToDomain(row);
      return { asset, ...scoreRecommendation(asset, tokens) };
    })
    .filter((item) => tokens.length === 0 ? item.asset.humanVerified : item.score > 2)
    .sort((a, b) => b.score - a.score || b.asset.authenticityConfidence - a.asset.authenticityConfidence)
    .slice(0, 8)
    .map(({ asset, reason }) => ({ asset, reason }));
  const response: DiscoveryResponse = {
    trending: trendingRows.results.map((row) => ({ query: String(row.query), searchCount: Number(row.search_count) })),
    savedSearches: explicitSearches,
    recommendations,
    personalized: tokens.length > 0,
  };
  return c.json(response);
});

app.post("/api/saved-searches", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const payload = savedSearchSchema.parse(await c.req.json());
  const id = crypto.randomUUID();
  const nextAlert = payload.alertFrequency === "none" ? null : new Date(Date.now() + (payload.alertFrequency === "daily" ? 1 : 7) * 86_400_000).toISOString();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO saved_searches (id, organization_id, owner_id, name, query, media_kind, alert_frequency, next_alert_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, user.organizationId, user.id, payload.name, payload.query, payload.mediaKind, payload.alertFrequency, nextAlert),
      c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, 'saved_search_created', 'saved_search', ?, ?)")
        .bind(crypto.randomUUID(), user.id, id, JSON.stringify({ mediaKind: payload.mediaKind, alertFrequency: payload.alertFrequency })),
    ]);
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) return c.json({ error: "A saved search with this name already exists" }, 409);
    throw error;
  }
  const now = new Date().toISOString();
  return c.json({ id, ...payload, createdAt: now, updatedAt: now } satisfies SavedSearch, 201);
});

app.patch("/api/saved-searches/:id", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const payload = savedSearchSchema.partial().parse(await c.req.json());
  const current = await c.env.DB.prepare("SELECT * FROM saved_searches WHERE id = ? AND organization_id = ? AND owner_id = ?")
    .bind(c.req.param("id"), user.organizationId, user.id).first<Record<string, unknown>>();
  if (!current) return c.json({ error: "Saved search not found" }, 404);
  const frequency = payload.alertFrequency ?? current.alert_frequency as SavedSearch["alertFrequency"];
  const nextAlert = frequency === "none" ? null : new Date(Date.now() + (frequency === "daily" ? 1 : 7) * 86_400_000).toISOString();
  await c.env.DB.prepare(`UPDATE saved_searches SET name = ?, query = ?, media_kind = ?, alert_frequency = ?, next_alert_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND organization_id = ? AND owner_id = ?`)
    .bind(payload.name ?? current.name, payload.query ?? current.query, payload.mediaKind ?? current.media_kind, frequency, nextAlert, c.req.param("id"), user.organizationId, user.id).run();
  const updated = await c.env.DB.prepare("SELECT id, name, query, media_kind, alert_frequency, created_at, updated_at FROM saved_searches WHERE id = ?")
    .bind(c.req.param("id")).first<Record<string, unknown>>();
  return c.json(savedSearchRow(updated!));
});

app.delete("/api/saved-searches/:id", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const existing = await c.env.DB.prepare("SELECT id FROM saved_searches WHERE id = ? AND organization_id = ? AND owner_id = ?")
    .bind(c.req.param("id"), user.organizationId, user.id).first<{ id: string }>();
  if (!existing) return c.json({ error: "Saved search not found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM saved_searches WHERE id = ?").bind(existing.id),
    c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, 'saved_search_deleted', 'saved_search', ?, '{}')")
      .bind(crypto.randomUUID(), user.id, existing.id),
  ]);
  return c.json({ ok: true, savedSearchId: existing.id });
});

function jsonObject<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value ?? "")) as T; } catch { return fallback; }
}

async function campaignForUser(c: any, id: string, user: RequestUser): Promise<Record<string, unknown> | null> {
  const row = await c.env.DB.prepare("SELECT * FROM campaigns WHERE id = ? AND organization_id = ?").bind(id, user.organizationId).first() as Record<string, unknown> | null;
  return row;
}

app.get("/api/campaigns/:id/manifest", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const campaign = await campaignForUser(c, c.req.param("id"), user);
  if (!campaign) return c.json({ error: "Campaign not found" }, 404);
  const briefFields = jsonObject<CampaignBrief>(campaign.brief_json, parseCampaignBrief(String(campaign.brief_text)));
  const brandKit = jsonObject<BrandKit>(campaign.brand_kit_json, { colours: [], logoNotes: "", tone: "", industry: "", forbiddenStyles: [], preferredVisuals: "" });
  const rows = await c.env.DB.prepare("SELECT ca.stage, ca.note, a.* FROM campaign_assets ca JOIN assets a ON a.id = ca.asset_id WHERE ca.campaign_id = ? AND ca.stage = 'approved' ORDER BY ca.updated_at DESC").bind(campaign.id).all<Record<string, unknown>>();
  const selectedAssets = rankCampaignAssets(rows.results.map(assetRowToDomain), briefFields, brandKit).map((item) => ({ sourceId: item.asset.id, title: item.asset.title, kind: item.asset.kind, stage: "approved", licence: { type: briefFields.usageRights, rightsStatus: item.asset.rightsStatus, modelRelease: item.asset.modelReleaseStatus, propertyRelease: item.asset.propertyReleaseStatus, attribution: item.asset.sourceAttribution ?? item.asset.contributor }, warnings: item.warnings, readiness: item.readiness, selectedFormats: briefFields.formatNeeded, note: String(item.asset.curatorNotes ?? "") }));
  const manifest = { manifestVersion: "3A", generatedAt: new Date().toISOString(), campaign: { id: campaign.id, name: campaign.name }, brief: briefFields, brandKit, selectedAssets, auditTrail: { approvedCount: selectedAssets.length, source: "campaign_assets", generatedBy: user.id } };
  await c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, 'campaign_manifest_exported', 'campaign', ?, ?)").bind(crypto.randomUUID(), user.id, campaign.id, JSON.stringify({ approvedCount: selectedAssets.length })).run();
  return c.json(manifest);
});

const lightboxCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  visibility: z.enum(["private", "shared"]).default("private"),
});

app.get("/api/lightboxes", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const [lightboxes, assets] = await Promise.all([
    c.env.DB.prepare("SELECT id, name, description, visibility, created_at, updated_at FROM user_lightboxes l WHERE organization_id = ? AND (owner_id = ? OR EXISTS (SELECT 1 FROM user_lightbox_members m WHERE m.lightbox_id = l.id AND m.user_id = ?)) ORDER BY updated_at DESC LIMIT 100").bind(user.organizationId, user.id, user.id).all<Record<string, unknown>>(),
    c.env.DB.prepare("SELECT la.lightbox_id, la.asset_id FROM user_lightbox_assets la JOIN user_lightboxes l ON l.id = la.lightbox_id WHERE l.organization_id = ? AND (l.owner_id = ? OR EXISTS (SELECT 1 FROM user_lightbox_members m WHERE m.lightbox_id = l.id AND m.user_id = ?)) ORDER BY la.added_at DESC").bind(user.organizationId, user.id, user.id).all<Record<string, unknown>>(),
  ]);
  const assetMap = new Map<string, string[]>();
  for (const row of assets.results) {
    const id = String(row.lightbox_id);
    assetMap.set(id, [...(assetMap.get(id) ?? []), String(row.asset_id)]);
  }
  return c.json({ results: lightboxes.results.map((row) => {
    const assetIds = assetMap.get(String(row.id)) ?? [];
    return { id: String(row.id), name: String(row.name), description: String(row.description ?? ""), visibility: row.visibility as "private" | "shared", assetIds, assetCount: assetIds.length, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  }) });
});

app.post("/api/lightboxes", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const payload = lightboxCreateSchema.parse(await c.req.json());
  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare("INSERT INTO user_lightboxes (id, organization_id, owner_id, name, description, visibility) VALUES (?, ?, ?, ?, ?, ?)").bind(id, user.organizationId, user.id, payload.name, payload.description, payload.visibility).run();
  } catch {
    return c.json({ error: "A lightbox with this name already exists" }, 409);
  }
  await c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), user.id, "lightbox_created", "user_lightbox", id, JSON.stringify({ name: payload.name, visibility: payload.visibility })).run();
  const now = new Date().toISOString();
  return c.json({ id, name: payload.name, description: payload.description, visibility: payload.visibility, assetIds: [], assetCount: 0, createdAt: now, updatedAt: now }, 201);
});

app.post("/api/lightboxes/:id/assets", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const lightboxId = c.req.param("id");
  const payload = z.object({ assetId: z.string().trim().min(1).max(120) }).parse(await c.req.json());
  const lightbox = await c.env.DB.prepare("SELECT id FROM user_lightboxes l WHERE l.id = ? AND l.organization_id = ? AND (l.owner_id = ? OR EXISTS (SELECT 1 FROM user_lightbox_members m WHERE m.lightbox_id = l.id AND m.user_id = ? AND m.role = 'editor'))").bind(lightboxId, user.organizationId, user.id, user.id).first<{ id: string }>();
  if (!lightbox) return c.json({ error: "Lightbox not found" }, 404);
  const asset = await c.env.DB.prepare("SELECT id FROM assets WHERE id = ? AND organization_id = ? AND status = 'published'").bind(payload.assetId, user.organizationId).first<{ id: string }>();
  if (!asset) return c.json({ error: "Published asset not found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO user_lightbox_assets (lightbox_id, asset_id) VALUES (?, ?)").bind(lightboxId, payload.assetId),
    c.env.DB.prepare("UPDATE user_lightboxes SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(lightboxId),
    c.env.DB.prepare("INSERT INTO asset_events (id, organization_id, asset_id, actor_id, event_type) VALUES (?, ?, ?, ?, 'save')").bind(crypto.randomUUID(), user.organizationId, payload.assetId, user.id),
    c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), user.id, "lightbox_asset_added", "user_lightbox", lightboxId, JSON.stringify({ assetId: payload.assetId })),
  ]);
  return c.json({ ok: true, lightboxId, assetId: payload.assetId });
});

app.delete("/api/lightboxes/:id", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const lightboxId = c.req.param("id");
  const lightbox = await c.env.DB.prepare("SELECT id FROM user_lightboxes WHERE id = ? AND organization_id = ? AND owner_id = ?").bind(lightboxId, user.organizationId, user.id).first<{ id: string }>();
  if (!lightbox) return c.json({ error: "Lightbox not found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM user_lightboxes WHERE id = ?").bind(lightboxId),
    c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), user.id, "lightbox_deleted", "user_lightbox", lightboxId, JSON.stringify({})),
  ]);
  return c.json({ ok: true, lightboxId });
});

app.delete("/api/lightboxes/:id/assets/:assetId", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const lightboxId = c.req.param("id");
  const assetId = c.req.param("assetId");
  const lightbox = await c.env.DB.prepare("SELECT id FROM user_lightboxes l WHERE l.id = ? AND l.organization_id = ? AND (l.owner_id = ? OR EXISTS (SELECT 1 FROM user_lightbox_members m WHERE m.lightbox_id = l.id AND m.user_id = ? AND m.role = 'editor'))").bind(lightboxId, user.organizationId, user.id, user.id).first<{ id: string }>();
  if (!lightbox) return c.json({ error: "Lightbox not found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM user_lightbox_assets WHERE lightbox_id = ? AND asset_id = ?").bind(lightboxId, assetId),
    c.env.DB.prepare("UPDATE user_lightboxes SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(lightboxId),
    c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), user.id, "lightbox_asset_removed", "user_lightbox", lightboxId, JSON.stringify({ assetId })),
  ]);
  return c.json({ ok: true, lightboxId, assetId });
});

const lightboxShareMemberSchema = z.object({ userId: z.string().trim().min(1).max(120), role: z.enum(["viewer", "editor"]).default("viewer") });

app.post("/api/lightboxes/:id/share-link", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const lightboxId = c.req.param("id");
  const lightbox = await c.env.DB.prepare("SELECT id FROM user_lightboxes WHERE id = ? AND organization_id = ? AND owner_id = ?").bind(lightboxId, user.organizationId, user.id).first<{ id: string }>();
  if (!lightbox) return c.json({ error: "Lightbox not found" }, 404);
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = base64Bytes(tokenBytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  await c.env.DB.prepare("UPDATE user_lightboxes SET visibility = 'shared', share_token_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(await sha256Hex(token), lightboxId).run();
  return c.json({ lightboxId, visibility: "shared", shareUrl: `/api/lightboxes/shared/${token}` }, 201);
});

app.post("/api/lightboxes/:id/members", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const payload = lightboxShareMemberSchema.parse(await c.req.json());
  const lightboxId = c.req.param("id");
  const lightbox = await c.env.DB.prepare("SELECT id FROM user_lightboxes WHERE id = ? AND organization_id = ? AND owner_id = ?").bind(lightboxId, user.organizationId, user.id).first<{ id: string }>();
  if (!lightbox) return c.json({ error: "Lightbox not found" }, 404);
  const member = await c.env.DB.prepare("SELECT user_id FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND status = 'active'").bind(user.organizationId, payload.userId).first<{ user_id: string }>();
  if (!member) return c.json({ error: "Member must belong to the same organization" }, 422);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO user_lightbox_members (lightbox_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT(lightbox_id, user_id) DO UPDATE SET role = excluded.role").bind(lightboxId, payload.userId, payload.role),
    c.env.DB.prepare("UPDATE user_lightboxes SET visibility = 'shared', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(lightboxId),
    c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, 'lightbox_member_added', 'user_lightbox', ?, ?)").bind(crypto.randomUUID(), user.id, lightboxId, JSON.stringify({ userId: payload.userId, role: payload.role })),
  ]);
  return c.json({ ok: true, lightboxId, ...payload }, 201);
});

app.get("/api/lightboxes/shared/:token", async (c) => {
  const token = z.string().regex(/^[A-Za-z0-9_-]{32,80}$/).parse(c.req.param("token"));
  const tokenHash = await sha256Hex(token);
  const lightbox = await c.env.DB.prepare("SELECT id, name, description, visibility, created_at, updated_at FROM user_lightboxes WHERE share_token_hash = ? AND visibility = 'shared'").bind(tokenHash).first<Record<string, unknown>>();
  if (!lightbox) return c.json({ error: "Shared lightbox not found" }, 404);
  const assets = await c.env.DB.prepare("SELECT a.*, u.display_name AS contributor FROM user_lightbox_assets la JOIN assets a ON a.id = la.asset_id JOIN users u ON u.id = a.owner_id WHERE la.lightbox_id = ? AND a.status = 'published' ORDER BY la.added_at DESC").bind(lightbox.id).all<Record<string, unknown>>();
  return c.json({ lightbox: { id: String(lightbox.id), name: String(lightbox.name), description: String(lightbox.description ?? ""), visibility: "shared", createdAt: String(lightbox.created_at), updatedAt: String(lightbox.updated_at) }, results: assets.results.map(assetRowToDomain) });
});

const takedownSchema = z.object({
  assetId: z.string().min(1).max(120),
  reason: z.enum(["copyright", "consent", "cultural_harm", "privacy", "metadata", "other"]),
  summary: z.string().trim().min(20).max(2000),
  mediationRequested: z.boolean().default(false),
});

app.post("/api/rights/takedown", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const payload = takedownSchema.parse(await c.req.json());
  const requesterId = user.id;
  const asset = await c.env.DB.prepare("SELECT id, title, owner_id FROM assets WHERE id = ? AND organization_id = ?").bind(payload.assetId, user.organizationId).first<{ id: string; title: string; owner_id: string }>();
  if (!asset) return c.json({ error: "Asset not found" }, 404);
  const id = `VA-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
  const dueAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const status = payload.mediationRequested ? "mediation" : "lodged";
  await c.env.DB.prepare(`INSERT INTO takedown_requests (id, organization_id, asset_id, requester_id, reason, summary, status, response_due_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, user.organizationId, asset.id, requesterId, payload.reason, payload.summary, status, dueAt).run();
  if (payload.mediationRequested) await c.env.DB.prepare(`INSERT INTO mediation_sessions (id, takedown_request_id) VALUES (?, ?)`).bind(`med-${crypto.randomUUID()}`, id).run();
  await c.env.DB.prepare(`INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), requesterId, "rights_case_lodged", "takedown_request", id, JSON.stringify({ reason: payload.reason, mediationRequested: payload.mediationRequested })).run();
  await c.env.DB.prepare("INSERT INTO rights_case_events (id, organization_id, case_id, actor_id, event_type, payload_json) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), user.organizationId, id, requesterId, "lodged", JSON.stringify({ reason: payload.reason })).run();
  await c.env.DB.prepare("INSERT INTO notifications (id, organization_id, user_id, type, title, body, resource_type, resource_id) SELECT lower(hex(randomblob(16))), ?, user_id, 'rights_case', 'New rights case', ?, 'takedown_request', ? FROM organization_memberships WHERE organization_id = ? AND role IN ('editor', 'admin') AND status = 'active'")
    .bind(user.organizationId, `A rights case was lodged for ${asset.title}.`, id, user.organizationId).run();
  const result: RightsCase = { id, assetId: asset.id, assetTitle: asset.title, reason: payload.reason as TakedownReason, summary: payload.summary, status, dueAt: "Within 5 working days", mediationRequested: payload.mediationRequested, createdAt: new Date().toISOString() };
  return c.json(result, 201);
});

app.get("/api/rights/cases", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const rows = await c.env.DB.prepare(`SELECT t.*, a.title AS asset_title FROM takedown_requests t JOIN assets a ON a.id = t.asset_id WHERE t.organization_id = ? AND (t.requester_id = ? OR a.owner_id = ? OR ? IN ('editor', 'admin')) ORDER BY t.created_at DESC LIMIT 50`).bind(user.organizationId, user.id, user.id, user.role).all<Record<string, unknown>>();
  return c.json(rows.results.map((row) => ({ id: String(row.id), assetId: String(row.asset_id), assetTitle: String(row.asset_title), reason: row.reason as TakedownReason, summary: String(row.summary), status: row.status, dueAt: String(row.response_due_at), mediationRequested: row.status === "mediation", createdAt: String(row.created_at) })));
});

const mediationMessageSchema = z.object({ body: z.string().trim().min(1).max(2000), visibility: z.enum(["participants", "facilitator_only", "case_record"]).default("participants") });

app.post("/api/rights/cases/:id/messages", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const payload = mediationMessageSchema.parse(await c.req.json());
  const caseId = c.req.param("id");
  const session = await c.env.DB.prepare("SELECT ms.id, t.requester_id, a.owner_id FROM mediation_sessions ms JOIN takedown_requests t ON t.id = ms.takedown_request_id JOIN assets a ON a.id = t.asset_id WHERE ms.takedown_request_id = ? AND t.organization_id = ?").bind(caseId, user.organizationId).first<{ id: string; requester_id: string; owner_id: string }>();
  if (!session) return c.json({ error: "Mediation has not been requested for this case" }, 409);
  const participant = user.id === session.requester_id || user.id === session.owner_id || ["editor", "admin"].includes(user.role);
  if (!participant) return c.json({ error: "You are not a participant in this case" }, 403);
  if (payload.visibility === "facilitator_only" && !["editor", "admin"].includes(user.role)) return c.json({ error: "Facilitator-only messages require a moderator" }, 403);
  const authorId = user.id;
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO mediation_messages (id, session_id, author_id, body, visibility) VALUES (?, ?, ?, ?, ?)").bind(id, session.id, authorId, payload.body, payload.visibility).run();
  await c.env.DB.prepare("INSERT INTO rights_case_events (id, organization_id, case_id, actor_id, event_type, payload_json) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), user.organizationId, caseId, user.id, "message_recorded", JSON.stringify({ visibility: payload.visibility })).run();
  return c.json({ id, caseId, status: "message_recorded" }, 201);
});

const uploadSchema = contractUploadRequestSchema;
const videoUploadSchema = z.object({ filename: z.string().trim().min(1).max(180), contentType: z.enum(["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"]), sizeBytes: z.number().int().positive().max(30_000_000_000), title: z.string().trim().min(3).max(240).optional() });

app.post("/api/video-uploads", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "editor", "admin"])) return c.json({ error: "Contributor authentication required" }, 401);
  const streamApiToken = await resolveSecret(c.env.STREAM_API_TOKEN, c.env.STREAM_API_TOKEN_STORE);
  if (!c.env.STREAM_ACCOUNT_ID || !streamApiToken) return c.json({ error: "Cloudflare Stream direct upload is not configured" }, 503);
  const payload = videoUploadSchema.parse(await c.req.json());
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${c.env.STREAM_ACCOUNT_ID}/stream/direct_upload`, {
    method: "POST", headers: { Authorization: `Bearer ${streamApiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ maxDurationSeconds: 3600, requireSignedURLs: true, allowedOrigins: (c.env.STREAM_ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean), meta: { name: payload.filename, creatorId: user.id, organizationId: user.organizationId } }),
  });
  if (!response.ok) { logEvent("error", "stream.direct_upload_failed", c.get("trace"), { status: response.status }); return c.json({ error: "Stream could not create a direct upload" }, 503); }
  const body = await response.json() as { success?: boolean; result?: { uploadURL?: string; uid?: string } };
  const uploadUrl = body.result?.uploadURL; const streamUid = body.result?.uid;
  if (!body.success || !uploadUrl || !streamUid) return c.json({ error: "Stream returned an incomplete direct upload" }, 503);
  const assetId = crypto.randomUUID(); const jobId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO assets (id, organization_id, owner_id, kind, status, title, source_file_name, stream_uid, workflow_stage) VALUES (?, ?, ?, 'video', 'processing', ?, ?, ?, 'ingestion')").bind(assetId, user.organizationId, user.id, payload.title ?? payload.filename, payload.filename, streamUid),
    c.env.DB.prepare("INSERT INTO media_processing_jobs (id, organization_id, asset_id, job_type, status, provider_job_id) VALUES (?, ?, ?, 'video_transcode', 'processing', ?)").bind(jobId, user.organizationId, assetId, streamUid),
    c.env.DB.prepare("INSERT INTO media_derivatives (id, asset_id, variant, provider_uid, content_type, status) VALUES (?, ?, 'stream_hls', ?, 'application/x-mpegURL', 'pending')").bind(crypto.randomUUID(), assetId, streamUid),
  ]);
  return c.json({ assetId, uploadUrl, streamUid, strategy: "cloudflare-stream-direct-upload", maxDurationSeconds: 3600, message: "Upload directly to Stream. The signed webhook records transcoding state and media metadata before editorial review." }, 201);
});

app.post("/api/uploads", async (c) => {
  const trace = c.get("trace");
  const chaos = chaosScenario(c);
  if (chaos === "db-failure" || chaos === "fail-before-session") {
    logChaos(c, trace, chaos, "before-db");
    return c.json({ error: "Injected upload-session failure" }, 503);
  }

  const payload = uploadSchema.parse(await c.req.json());
  if (!/^image\/(jpeg|png|webp|avif)$/i.test(payload.contentType) && !/^video\//i.test(payload.contentType)) return c.json({ error: "Unsupported media type. Images must be JPEG, PNG, WebP, or AVIF; videos use the Stream direct-upload endpoint." }, 422);
  if (payload.contentType.startsWith("video/")) return c.json({ error: "Use /api/video-uploads for validated, resumable Stream video processing." }, 422);
  const owner = await requestUser(c);
  if (!owner || !allowedRole(owner, ["contributor", "editor", "admin"])) return c.json({ error: "Contributor authentication required" }, 401);
  const ownerId = owner.id;
  if (payload.assetId) {
    const asset = await c.env.DB.prepare("SELECT owner_id FROM assets WHERE id = ? AND organization_id = ?").bind(payload.assetId, owner.organizationId).first<{ owner_id: string }>();
    if (!asset || (asset.owner_id !== ownerId && !allowedRole(owner, ["editor", "admin"]))) return c.json({ error: "Asset not found" }, 404);
  }
  const dailyQuota = Math.max(1, Number(c.env.UPLOAD_DAILY_QUOTA_BYTES ?? 50_000_000_000));
  const usage = await c.env.DB.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM upload_sessions WHERE organization_id = ? AND owner_id = ? AND created_at >= date('now') AND status <> 'failed'").bind(owner.organizationId, owner.id).first<{ total: number }>();
  if (Number(usage?.total ?? 0) + payload.sizeBytes > dailyQuota) return c.json({ error: "Daily upload quota exceeded", quotaBytes: dailyQuota }, 429);
  const organizationQuota = Math.max(1, Number(c.env.ORG_STORAGE_QUOTA_BYTES ?? 500_000_000_000));
  const organizationUsage = await c.env.DB.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM upload_sessions WHERE organization_id = ? AND status IN ('created', 'uploaded')").bind(owner.organizationId).first<{ total: number }>();
  if (Number(organizationUsage?.total ?? 0) + payload.sizeBytes > organizationQuota) return c.json({ error: "Organization storage quota exceeded", quotaBytes: organizationQuota }, 413);
  const id = crypto.randomUUID();
  const objectKey = `originals/${ownerId}/${id}/${payload.filename.replace(/[^a-zA-Z0-9._-]/g, "-")}`;

  await c.env.DB.prepare(`
    INSERT INTO upload_sessions (id, organization_id, owner_id, asset_id, object_key, filename, content_type, size_bytes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, owner.organizationId, ownerId, payload.assetId ?? null, objectKey, payload.filename, payload.contentType, payload.sizeBytes).run();

  if (chaos === "fail-after-session") {
    logChaos(c, trace, chaos, "after-db");
    await c.env.DB.prepare("UPDATE upload_sessions SET status = 'failed', failure_reason = ? WHERE id = ?")
      .bind("chaos:fail-after-session", id).run();
    return c.json({ error: "Injected post-session failure", uploadId: id }, 503);
  }

  const uploadUrl = chaos === "r2-signing-failure" ? null : await createPresignedPutUrl(c.env, objectKey);
  if (chaos === "r2-signing-failure") {
    logChaos(c, trace, chaos, "presign");
    await c.env.DB.prepare("UPDATE upload_sessions SET status = 'failed', failure_reason = ? WHERE id = ?")
      .bind("chaos:r2-signing-failure", id).run();
    return c.json({ error: "Injected R2 signing failure", uploadId: id }, 503);
  }

  if (!uploadUrl) {
    await c.env.DB.prepare("UPDATE upload_sessions SET status = 'failed', failure_reason = ? WHERE id = ?").bind("R2 presigned upload is not configured", id).run();
    return c.json({ error: "Media storage is not configured for uploads" }, 503);
  }
  recordMetric(c.env, "upload_session_created", trace, payload.sizeBytes, [payload.contentType.split("/")[0]]);
  return c.json(validateContractResponse("POST /api/uploads 201", uploadResponseSchema, {
    uploadId: id,
    objectKey,
    strategy: "r2-presigned-put",
    uploadUrl,
    expiresInSeconds: uploadUrl ? 900 : null,
    message: "Upload directly to private R2 with this short-lived PUT URL, then call the completion endpoint.",
  }), 201);
});

app.post("/api/uploads/:uploadId/complete", async (c) => {
  const trace = c.get("trace");
  const uploadId = c.req.param("uploadId");
  const chaos = chaosScenario(c);
  const session = await c.env.DB.prepare(`
    SELECT id, organization_id, asset_id, owner_id, object_key, filename, content_type, size_bytes, status FROM upload_sessions WHERE id = ?
  `).bind(uploadId).first<{ id: string; organization_id: string; asset_id: string | null; owner_id: string; object_key: string; filename: string; content_type: string; size_bytes: number; status: string }>();

  if (!session) return c.json({ error: "Upload session not found" }, 404);
  const owner = await requestUser(c);
  if (!owner || owner.organizationId !== session.organization_id || (owner.id !== session.owner_id && !allowedRole(owner, ["editor", "admin"]))) return c.json({ error: "Forbidden" }, 403);
  if (session.status === "uploaded") return c.json(validateContractResponse("POST /api/uploads/{uploadId}/complete 200", uploadCompleteResponseSchema, { uploadId, status: "uploaded", idempotent: true }));

  if (chaos === "r2-missing") {
    logChaos(c, trace, chaos, "completion-head");
    await c.env.DB.prepare("UPDATE upload_sessions SET status = 'failed', failure_reason = ? WHERE id = ?")
      .bind("chaos:r2-missing", uploadId).run();
    return c.json({ error: "Injected missing R2 object", uploadId }, 409);
  }

  const object = await c.env.MEDIA_BUCKET.head(session.object_key);
  if (!object) {
    await c.env.DB.prepare("UPDATE upload_sessions SET status = 'failed', failure_reason = ? WHERE id = ?")
      .bind("R2 object was not found", uploadId).run();
    recordMetric(c.env, "upload_completion_missing_object", trace, 1, ["r2"]);
    return c.json({ error: "R2 object was not found", uploadId }, 409);
  }

  const observedSize = chaos === "partial-upload" ? Math.max(0, session.size_bytes - 1) : object.size;
  if (observedSize !== session.size_bytes) {
    logChaos(c, trace, chaos ?? "size-mismatch", "completion-size-check");
    await c.env.DB.prepare("UPDATE upload_sessions SET status = 'failed', failure_reason = ? WHERE id = ?")
      .bind(`Expected ${session.size_bytes} bytes, received ${observedSize}`, uploadId).run();
    recordMetric(c.env, "upload_completion_size_mismatch", trace, 1, ["r2"]);
    return c.json({ error: "Uploaded object size does not match the upload session", uploadId }, 409);
  }

  let scan: Awaited<ReturnType<typeof scanMediaObject>>;
  try {
    scan = await scanMediaObject(c.env, c.env.MEDIA_BUCKET, session.object_key, session.content_type);
  } catch (error) {
    scan = { status: "error", scanner: "scan-exception", findings: { message: error instanceof Error ? error.message : "unknown" } };
  }
  await c.env.DB.prepare("INSERT INTO media_scan_results (id, organization_id, upload_id, object_key, status, scanner, findings_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), session.organization_id, uploadId, session.object_key, scan.status, scan.scanner, JSON.stringify(scan.findings ?? {})).run();
  if (scan.status !== "passed") {
    await c.env.DB.prepare("UPDATE upload_sessions SET status = 'failed', failure_reason = ? WHERE id = ?").bind(`Media scan ${scan.status}`, uploadId).run();
    return c.json({ error: "Media failed the security scan", code: scan.status === "error" ? "media_scan_unavailable" : "media_blocked" }, scan.status === "error" ? 503 : 422);
  }

  const assetId = session.asset_id ?? crypto.randomUUID();
  const assetStatement = session.asset_id
    ? c.env.DB.prepare("UPDATE assets SET original_key = ?, source_file_name = ?, status = 'needs_review', workflow_stage = 'curator_correction', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?")
      .bind(session.object_key, session.filename, assetId, session.organization_id)
    : c.env.DB.prepare("INSERT INTO assets (id, organization_id, owner_id, kind, status, title, source_file_name, original_key, workflow_stage) VALUES (?, ?, ?, ?, 'needs_review', ?, ?, ?, 'curator_correction')")
      .bind(assetId, session.organization_id, session.owner_id, session.content_type.startsWith("video/") ? "video" : "image", session.filename, session.filename, session.object_key);
  const persistence = await c.env.DB.batch([
    assetStatement,
    c.env.DB.prepare(`
      UPDATE upload_sessions
      SET status = 'uploaded', completed_at = CURRENT_TIMESTAMP, uploaded_etag = ?, failure_reason = NULL
      WHERE id = ? AND status = 'created'
    `).bind(object.etag, uploadId),
  ]);
  if (!persistence[0]?.success || !persistence[1]?.success) {
    await c.env.DB.prepare("UPDATE upload_sessions SET status = 'failed', failure_reason = ? WHERE id = ? AND status <> 'uploaded'")
      .bind("Asset persistence failed", uploadId).run();
    return c.json({ error: "Upload could not be persisted" }, 503);
  }
  const assetKind = session.content_type.startsWith("video/") ? "video" : "image";
  const enrichment = assetKind === "image"
    ? (await enqueuePhotoJobBestEffort(c.env, assetId, "enrich") ? "enrichment_queued" : "enrichment_retry_pending")
    : "not_required_for_video";
  recordMetric(c.env, "upload_completed", trace, object.size, ["r2"]);
  await c.env.DB.prepare("INSERT INTO media_processing_jobs (id, organization_id, asset_id, job_type, status) VALUES (?, ?, ?, 'image_variants', 'queued') ON CONFLICT(asset_id, job_type) DO NOTHING").bind(crypto.randomUUID(), session.organization_id, assetId).run();
  return c.json(validateContractResponse("POST /api/uploads/{uploadId}/complete 200", uploadCompleteResponseSchema, { uploadId, assetId, objectKey: session.object_key, status: "uploaded", enrichment, etag: object.etag }));
});

const turnstileSchema = z.object({ token: z.string().min(1).max(2048), action: z.string().min(1).max(64) });

async function verifyTurnstileToken(env: Bindings, token: string | undefined, action: string, traceparent?: string): Promise<{ verified: boolean; reason?: string }> {
  if (!token) return String(env.APP_ENV) === "production" ? { verified: false, reason: "Turnstile token is required" } : { verified: true, reason: "development bypass" };
  if (!env.TURNSTILE_SECRET) return { verified: false, reason: "Turnstile is not configured for this environment" };
  const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...(traceparent ? { traceparent } : {}) },
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token }),
  });
  if (!verification.ok) return { verified: false, reason: "Turnstile verification service unavailable" };
  const result = await verification.json() as { success: boolean; action?: string; hostname?: string; [key: string]: unknown };
  const allowedHosts = new Set((env.TURNSTILE_HOSTNAMES ?? "").split(",").map((host) => host.trim()).filter(Boolean));
  const hostnameValid = typeof result.hostname === "string" && (allowedHosts.size === 0 || allowedHosts.has(result.hostname));
  const actionValid = result.action === action;
  return result.success === true && hostnameValid && actionValid
    ? { verified: true }
    : { verified: false, reason: "Turnstile token did not match the expected action or hostname" };
}

app.post("/api/security/turnstile", async (c) => {
  const payload = turnstileSchema.parse(await c.req.json());
  const result = await verifyTurnstileToken(c.env, payload.token, payload.action, c.get("trace").traceparent);
  return c.json(result, result.verified ? 200 : 403);
});

type StreamWebhookPayload = {
  uid?: string;
  readyToStream?: boolean;
  status?: { state?: string; pctComplete?: string; errorReasonCode?: string; errorReasonText?: string };
  meta?: { filename?: string; filetype?: string; name?: string };
  duration?: number;
  input?: { width?: number; height?: number; frameRate?: number };
};

async function verifyStreamWebhook(secret: string, signature: string, body: string): Promise<boolean> {
  const values = new Map(signature.split(",").map((part) => {
    const [key, ...rest] = part.split("=");
    return [key, rest.join("=")] as const;
  }));
  const timestamp = values.get("time");
  const supplied = values.get("sig1");
  if (!timestamp || !supplied || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  const expected = hex(await hmac(utf8(secret), `${timestamp}.${body}`));
  return timingSafeEqual(expected, supplied);
}

app.post("/api/webhooks/stream", async (c) => {
  const trace = c.get("trace");
  const streamWebhookSecret = await resolveSecret(c.env.STREAM_WEBHOOK_SECRET, c.env.STREAM_WEBHOOK_SECRET_STORE);
  if (!streamWebhookSecret) return c.json({ error: "Stream webhook secret is not configured" }, 503);
  const body = await c.req.text();
  const signature = c.req.header("Webhook-Signature") ?? "";
  if (!(await verifyStreamWebhook(streamWebhookSecret, signature, body))) {
    recordMetric(c.env, "stream_webhook_rejected", trace, 1, ["signature"]);
    return c.json({ error: "Invalid Stream webhook signature" }, 401);
  }

  const payload = JSON.parse(body) as StreamWebhookPayload;
  const streamUid = payload.uid ?? "unknown";
  const state = payload.status?.state ?? "unknown";
  const providerEventId = hex(await crypto.subtle.digest("SHA-256", utf8(body)));
  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO stream_events (id, provider_event_id, stream_uid, event_type, state, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), providerEventId, streamUid, "video-status", state, body).run();

  const asset = await c.env.DB.prepare("SELECT id, organization_id FROM assets WHERE stream_uid = ?").bind(streamUid).first<{ id: string; organization_id: string }>();
  if (asset) {
    const ready = payload.readyToStream === true && state !== "error";
    const failed = state === "error";
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE media_processing_jobs SET status = ?, error_code = ?, error_detail = ?, completed_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE asset_id = ? AND job_type = 'video_transcode'")
        .bind(failed ? "failed" : ready ? "completed" : "processing", payload.status?.errorReasonCode ?? null, payload.status?.errorReasonText ?? null, Number(ready || failed), asset.id),
      c.env.DB.prepare("UPDATE media_derivatives SET provider_uid = ?, width = ?, height = ?, fps = ?, duration_seconds = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE asset_id = ? AND variant = 'stream_hls'")
        .bind(streamUid, payload.input?.width ?? null, payload.input?.height ?? null, payload.input?.frameRate ?? null, payload.duration ?? null, failed ? "failed" : ready ? "ready" : "pending", asset.id),
      c.env.DB.prepare("UPDATE assets SET status = CASE WHEN ? THEN 'needs_review' WHEN ? THEN 'rejected' ELSE status END, workflow_stage = CASE WHEN ? THEN 'curator_correction' ELSE workflow_stage END, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(Number(ready), Number(failed), Number(ready), asset.id),
    ]);
  }

  recordMetric(c.env, "stream_webhook_received", trace, 1, [state]);
  logEvent("info", "stream.video.status", trace, {
    streamUid,
    state,
    readyToStream: payload.readyToStream ?? false,
  });
  return c.json({ accepted: true, streamUid, state });
});

app.all("*", async (c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found" }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((error, c) => {
  if (error instanceof ContractResponseValidationError) {
    const body = validateContractResponse("contract response validation error", contractResponseValidationErrorSchema, {
      error: "Contract response validation failed",
      code: "contract_response_invalid",
      contract: error.contract,
      issues: error.issues.map((issue) => ({ path: issue.path, code: issue.code, message: issue.message })),
    });
    logEvent("error", "contract.response_invalid", c.get("trace"), {
      contract: error.contract,
      issueCount: body.issues?.length ?? 0,
    });
    return c.json(body, 500);
  }
  const validation = error instanceof z.ZodError;
  logEvent(validation ? "warn" : "error", "request.error_handled", c.get("trace"), {
    method: c.req.method,
    path: c.req.path,
    error: validation ? "validation_error" : error instanceof Error ? error.message : "unknown-error",
  });
  const body = { error: validation ? "Invalid request" : "Internal server error", ...(validation ? { issues: error.issues.map((issue) => ({ path: issue.path, code: issue.code })) } : {}) };
  return c.json(validateContractResponse("error response", errorResponseSchema, body), validation ? 400 : 500);
});

type QueueMessage = R2EventMessage | PhotoEnrichmentJob;

function isPhotoEnrichmentJob(message: QueueMessage): message is PhotoEnrichmentJob {
  if (!("type" in message)) return false;
  const candidate = message as { type?: unknown; assetId?: unknown; operation?: unknown };
  return candidate.type === "photo.enrich" && typeof candidate.assetId === "string" && typeof candidate.operation === "string";
}

const worker: ExportedHandler<Bindings, QueueMessage> = {
  fetch: app.fetch,
  async scheduled(_controller, env) {
    const trace = traceContext(new Request("https://internal/scheduled/r2-replication"));
    try {
      await catchUpR2Replication(env, trace);
      const requeued = await retryQueuedPhotoJobs(photoPipeline(env));
      await runMaintenance(env);
      recordMetric(env, "photo_jobs_requeued", trace, requeued, ["cron"]);
    } catch (error) {
      logEvent("error", "r2.replication.failed", trace, {
        error: error instanceof Error ? error.message : "unknown-error",
      });
      recordMetric(env, "r2_replication_error", trace, 1, ["catch-up"]);
      throw error;
    }
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      const trace = traceContext(new Request(`https://internal/queue/${message.id}`));
      try {
        if (isPhotoEnrichmentJob(message.body)) {
          await processPhotoJob(photoPipeline(env), message.body, trace);
        } else {
          await replicateR2Event(env, message.body, trace);
        }
        message.ack();
      } catch (error) {
        logEvent("error", "r2.event.replication_failed", trace, {
          messageId: message.id,
          attempt: message.attempts,
          error: error instanceof Error ? error.message : "unknown-error",
        });
        recordMetric(env, "r2_event_replication_error", trace, 1, [String(message.attempts)]);
        message.retry();
      }
    }
  },
};

export { app, verifyStreamWebhook };
export default worker;
