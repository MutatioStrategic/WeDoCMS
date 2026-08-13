import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { archiveDomain } from "../shared";
import type { Asset, BuyerAnalytics, CommunityOverview, ContributorAnalytics, LicenceRequest, MonetizationModel, RightsCase, SearchResponse, TakedownReason } from "../shared";
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
import { IntegrationContainer } from "../integrations";
import { canonicalContract, ocrValidation, sanitizeOcrResult, sha256Hex } from "./seller-workflow";
import {
  enqueuePhotoJob,
  processPhotoJob,
  replayPhotoJob,
  retryQueuedPhotoJobs,
  searchPhotoIndex,
  type PhotoEnrichmentJob,
  type PhotoPipelineBindings,
} from "./photo-indexing";
import {
  createSession,
  csrfValid,
  getRequestUser,
  responseWithSession,
  responseWithoutSession,
  verifyExternalJwt,
  type RequestUser,
} from "./auth";
import { allowedOrigin, applySecurityHeaders, enforceRateLimit, scanMediaObject, type SecurityBindings } from "./security";
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
  paymentWebhookRequestSchema,
  searchResponseSchema,
  sessionResponseSchema,
  streamWebhookRequestSchema,
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
  CHAOS_TEST_TOKEN?: string;
  CHAOS_TESTING_ENABLED?: string;
  APP_ENV?: string;
  AUDIT_RETENTION_DAYS?: string;
  AUDIT_ALLOWED_RESIDENCIES?: string;
  KYC_PROVIDER?: string;
  KYC_WEBHOOK_SECRET?: string;
  STRIPE_SECRET_KEY?: string;
  PAYFAST_ENDPOINT?: string;
  PAYFAST_TOKEN?: string;
  ZA_BANK_ENDPOINT?: string;
  ZA_BANK_TOKEN?: string;
  PAYOUT_MIN_CENTS?: string;
  OCR_ENABLED?: string;
  OCR_MODEL?: string;
  PHOTO_VISION_MODEL?: string;
  PHOTO_EMBEDDING_MODEL?: string;
  PHOTO_INDEX_NAMESPACE?: string;
  FIRMA_VERIFY_URL?: string;
  FIRMA_API_TOKEN?: string;
  SESSION_SECRET?: string;
  AUTH_JWT_SECRET?: string;
  AUTH_ISSUER?: string;
  AUTH_AUDIENCE?: string;
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
  PAYMENT_PROVIDER?: string;
  PAYMENT_ENDPOINT?: string;
  PAYMENT_TOKEN?: string;
};
type WorkersAiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};
type Bindings = Omit<Cloudflare.Env, "AI"> & AuditBindings & SecretBindings & { AI?: WorkersAiBinding };

type Variables = { trace: TraceContext };
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

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

const devLoginSchema = z.object({ role: z.enum(["buyer", "contributor", "admin"]) });
const exchangeSchema = z.object({ organizationId: z.string().min(1).max(120).optional() });

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
  const claims = await verifyExternalJwt(c.env, token);
  if (!claims) return c.json({ error: "Verified identity token required" }, 401);
  const requested = exchangeSchema.parse(await c.req.json().catch(() => ({})));
  const organizationId = requested.organizationId ?? claims.org_id ?? c.env.DEFAULT_ORGANIZATION_ID;
  if (!organizationId) return c.json({ error: "An organization context is required" }, 422);
  let user = await c.env.DB.prepare("SELECT id, email FROM users WHERE auth_subject = ? AND status = 'active'").bind(claims.sub).first<{ id: string; email: string }>();
  if (!user) {
    const organization = await c.env.DB.prepare("SELECT id, name FROM organizations WHERE id = ? AND status = 'active'").bind(organizationId).first<{ id: string; name: string }>();
    if (!organization && String(c.env.AUTH_ALLOW_ORG_PROVISIONING) !== "true") return c.json({ error: "Organization is not provisioned" }, 403);
    const userId = crypto.randomUUID();
    await c.env.DB.prepare("INSERT INTO users (id, auth_subject, email, display_name, role, email_verified_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)")
      .bind(userId, claims.sub, claims.email ?? `${claims.sub}@identity.invalid`, claims.name ?? claims.email ?? claims.sub, claims.role ?? "buyer").run();
    if (!organization) await c.env.DB.prepare("INSERT INTO organizations (id, name, slug, created_by) VALUES (?, ?, ?, ?)").bind(organizationId, claims.org_name ?? "New organization", organizationId.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60), userId).run();
    await c.env.DB.prepare("INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), organizationId, userId, claims.role ?? "buyer").run();
    user = { id: userId, email: claims.email ?? `${claims.sub}@identity.invalid` };
  }
  const membership = await c.env.DB.prepare("SELECT organization_id FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND status = 'active'").bind(organizationId, user.id).first<{ organization_id: string }>();
  if (!membership) return c.json({ error: "User is not a member of the requested organization" }, 403);
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
  visualLocationType: (row.visual_location_type as Asset["visualLocationType"]) ?? "unknown",
  primaryCategory: (row.primary_category as Asset["primaryCategory"]) ?? "other",
  sceneAttributes: JSON.parse(String(row.scene_attributes ?? "[]")) as string[],
  visibleText: String(row.ocr_text ?? ""),
  detectedLanguage: String(row.detected_language ?? "none"),
  textReadability: (row.text_readability as Asset["textReadability"]) ?? "no_text",
  ocrConfidence: row.ocr_confidence == null ? null : Number(row.ocr_confidence),
  aiFieldConfidences: JSON.parse(String(row.ai_field_confidences ?? "{}")) as Record<string, number>,
  enrichmentValidation: JSON.parse(String(row.enrichment_validation_json ?? "{}")) as Asset["enrichmentValidation"],
  geographicLocationSource: (row.geographic_location_source as Asset["geographicLocationSource"]) ?? "none",
  assetRevision: Number(row.asset_revision ?? 1),
  enrichedRevision: row.enriched_revision == null ? null : Number(row.enriched_revision),
  reviewedRevision: row.reviewed_revision == null ? null : Number(row.reviewed_revision),
  approvedRevision: row.approved_revision == null ? null : Number(row.approved_revision),
  indexedRevision: row.indexed_revision == null ? null : Number(row.indexed_revision),
  vectorIndexStatus: (row.vector_index_status as Asset["vectorIndexStatus"]) ?? "not_indexed",
  curatorNotes: String(row.curator_notes ?? ""),
  metadataReviewStatus: row.metadata_review_status as Asset["metadataReviewStatus"] | undefined,
  metadataReviewNote: row.metadata_review_note as string | undefined,
  metadataProvenance: row.metadata_provenance as Asset["metadataProvenance"] | undefined,
  sourceFileName: (row.source_file_name as string | null) ?? null,
  sourceUrl: (row.source_url as string | null) ?? null,
  sourceLicense: (row.source_license as string | null) ?? null,
  sourceAttribution: (row.source_attribution as string | null) ?? null,
  monetizationModel: (row.monetization_model as MonetizationModel | undefined) ?? "membership",
  licensePriceCents: row.license_price_cents == null ? null : Number(row.license_price_cents),
});

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

const searchSchema = z.object({
  q: z.string().trim().max(240).default(""),
  kind: z.enum(["all", "image", "video"]).default("all"),
  location: z.string().trim().max(80).optional(),
  locationType: z.enum(["urban_street", "coastal_landscape", "market_scene", "indoor", "residential", "rural_landscape", "industrial", "event", "transport", "nature", "sports", "food", "other", "unknown"]).optional(),
  category: z.enum(["people", "lifestyle", "travel", "nature", "architecture", "food", "business", "transport", "arts_culture", "sport", "news_editorial", "objects", "other"]).optional(),
  status: z.enum(["published", "needs_review", "all"]).default("published"),
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

function governancePayloadEditsMetadata(payload: z.infer<typeof governanceActionSchema>): boolean {
  return [payload.title, payload.caption, payload.subjectTags, payload.culturalTags, payload.aiTags,
    payload.curatorNotes, payload.rightsStatus, payload.modelReleaseStatus, payload.propertyReleaseStatus,
    payload.monetizationModel, payload.licensePriceCents, payload.visualLocationType,
    payload.primaryCategory, payload.sceneAttributes, payload.visibleText].some((value) => value !== undefined);
}

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
  let exists: { id: string; owner_id: string; organization_id: string; kind: "image" | "video"; status: string; asset_revision: number; reviewed_revision: number | null; metadata_review_status: string } | null;
  try {
    exists = await c.env.DB.prepare(`SELECT id, owner_id, organization_id, kind, status, asset_revision,
      reviewed_revision, metadata_review_status FROM assets WHERE id = ? AND organization_id = ?`)
      .bind(assetId, actor.organizationId).first<{ id: string; owner_id: string; organization_id: string; kind: "image" | "video"; status: string; asset_revision: number; reviewed_revision: number | null; metadata_review_status: string }>();
  } catch (error) {
    logEvent("error", "metadata.workflow_schema_unavailable", c.get("trace"), { assetId, error: error instanceof Error ? error.message : "unknown-error" });
    return c.json({ error: "Metadata workflow is unavailable until its database migration is applied", code: "metadata_schema_unavailable" }, 503);
  }
  if (!exists) return c.json({ error: "Asset not found" }, 404);
  if (exists.owner_id !== actor.id && !allowedRole(actor, ["editor", "admin"])) return c.json({ error: "Forbidden" }, 403);
  if (payload.action === "approve" && governancePayloadEditsMetadata(payload)) {
    return c.json({ error: "Save the metadata correction before approving this revision", code: "review_revision_required" }, 422);
  }
  if (payload.action === "approve" && !archiveDomain.canApproveMetadataRevision({ assetRevision: exists.asset_revision, reviewedRevision: exists.reviewed_revision, metadataReviewStatus: exists.metadata_review_status as Asset["metadataReviewStatus"] })) {
    return c.json({ error: "The current metadata revision must be reviewed before approval", code: "review_revision_required" }, 422);
  }
  const stage = payload.action === "run_ai_tagging" ? "ai_tagging" : payload.action === "approve" ? "approval" : "curator_correction";
  const status = payload.action === "approve" ? "published" : payload.action === "reject" ? "rejected" : "needs_review";
  if (payload.action === "run_ai_tagging") {
    await c.env.DB.prepare(`UPDATE assets SET status = 'needs_review', workflow_stage = 'ai_tagging',
      asset_revision = asset_revision + 1, enriched_revision = NULL, reviewed_revision = NULL, approved_revision = NULL,
      human_verified = 0, metadata_review_status = 'needs_context', metadata_provenance = 'ai_suggested',
      metadata_review_note = 'AI enrichment is queued for this media revision.', vector_index_status = 'pending',
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`).bind(assetId, actor.organizationId).run();
  } else if (payload.action === "save_correction") {
    await c.env.DB.prepare(`UPDATE assets SET status = 'needs_review', workflow_stage = 'curator_correction',
      title = COALESCE(?, title), caption = COALESCE(?, caption), subject_tags = COALESCE(?, subject_tags),
      cultural_tags = COALESCE(?, cultural_tags), ai_tags = COALESCE(?, ai_tags), curator_notes = COALESCE(?, curator_notes),
      rights_status = COALESCE(?, rights_status), model_release_status = COALESCE(?, model_release_status),
      property_release_status = COALESCE(?, property_release_status), monetization_model = COALESCE(?, monetization_model),
      license_price_cents = CASE WHEN ? = 'individual_license' THEN ? WHEN ? IN ('membership', 'custom_quote') THEN NULL ELSE license_price_cents END,
      visual_location_type = COALESCE(?, visual_location_type), primary_category = COALESCE(?, primary_category),
      scene_attributes = COALESCE(?, scene_attributes), ocr_text = COALESCE(?, ocr_text),
      asset_revision = asset_revision + 1, reviewed_revision = asset_revision + 1, approved_revision = NULL,
      human_verified = 0, metadata_review_status = 'reviewed', metadata_provenance = 'editor',
      metadata_review_note = 'Seller/editor confirmed the description, visible location type, category, attributes, visible text, and evidence-backed geographic context.',
      updated_at = CURRENT_TIMESTAMP, last_reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`)
      .bind(
        payload.title ?? null, payload.caption ?? null,
        payload.subjectTags ? JSON.stringify(payload.subjectTags) : null,
        payload.culturalTags ? JSON.stringify(payload.culturalTags) : null,
        payload.aiTags ? JSON.stringify(payload.aiTags) : null,
        payload.curatorNotes ?? null, payload.rightsStatus ?? null, payload.modelReleaseStatus ?? null,
        payload.propertyReleaseStatus ?? null, payload.monetizationModel ?? null,
        payload.monetizationModel ?? null, payload.licensePriceCents ?? null, payload.monetizationModel ?? null,
        payload.visualLocationType ?? null, payload.primaryCategory ?? null,
        payload.sceneAttributes ? JSON.stringify(payload.sceneAttributes) : null, payload.visibleText ?? null,
        assetId, actor.organizationId,
      ).run();
  } else if (payload.action === "approve") {
    await c.env.DB.prepare(`UPDATE assets SET status = 'published', workflow_stage = 'approval', human_verified = 1,
      approved_revision = asset_revision, metadata_review_status = 'reviewed', metadata_provenance = 'editor',
      vector_index_status = 'pending', index_terminal_reason = NULL, updated_at = CURRENT_TIMESTAMP,
      last_reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`).bind(assetId, actor.organizationId).run();
  } else {
    await c.env.DB.prepare(`UPDATE assets SET status = 'rejected', workflow_stage = 'curator_correction', human_verified = 0,
      asset_revision = asset_revision + 1, reviewed_revision = NULL, approved_revision = NULL,
      vector_index_status = 'pending', index_terminal_reason = 'rejected', updated_at = CURRENT_TIMESTAMP,
      last_reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`).bind(assetId, actor.organizationId).run();
  }
  const revisionRow = await c.env.DB.prepare("SELECT asset_revision FROM assets WHERE id = ? AND organization_id = ?")
    .bind(assetId, actor.organizationId).first<{ asset_revision: number }>();
  await c.env.DB.prepare("INSERT INTO metadata_events (id, asset_id, actor_id, event_type, payload) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), assetId, actor.id, payload.action === "run_ai_tagging" ? "ai_tagged" : payload.action === "save_correction" ? "curator_corrected" : payload.action === "approve" ? "approved" : "rejected", JSON.stringify({ ...payload, assetRevision: revisionRow?.asset_revision })).run();
  if (payload.action !== "run_ai_tagging") {
    await c.env.DB.prepare(`UPDATE photo_ai_provenance SET reviewed_by = ?, review_outcome = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = (SELECT id FROM photo_ai_provenance WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1)`)
      .bind(actor.id, payload.action === "save_correction" ? "reviewed" : payload.action, assetId).run();
  }
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
  ]);
  return c.json({ ok: true, status: payload.acceptTerms ? "submitted" : "in_progress" });
});

const contractSubmissionSchema = z.object({
  termsVersion: z.string().trim().min(1).max(40).default("contributor-terms-v1"),
  signerName: z.string().trim().min(2).max(180),
  signatureMethod: z.enum(["firma", "manual"]).default("firma"),
  signatureReference: z.string().trim().min(8).max(240),
  turnstileToken: z.string().min(1).max(2048).optional(),
});

const walletSchema = z.object({
  provider: z.enum(["stripe_connect", "payfast", "za_bank"]),
  providerAccountId: z.string().trim().max(240).optional(),
  accountHolderName: z.string().trim().min(2).max(180),
  accountLast4: z.string().regex(/^\d{4}$/).optional(),
  branchLast4: z.string().regex(/^\d{4}$/).optional(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).default("ZAR"),
});

const contributorTerms = "Veld Archive Contributor Terms v1: the contributor grants the marketplace the rights necessary to host, review, market, license, and account for submitted media; confirms authority over submitted material; agrees to accurate identity and payout information; and accepts the published royalty schedule and dispute process. The complete legal terms must be versioned and reviewed before production launch.";

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

app.get("/api/onboarding/status", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const result = await c.env.DB.prepare(`
    SELECT p.*, t.id AS tender_id, t.status AS tender_status, t.review_notes,
      sc.id AS contract_id, sc.version AS contract_version, sc.content_sha256 AS contract_hash,
      sc.signed_at, w.id AS wallet_id, w.provider AS wallet_provider, w.status AS wallet_status,
      vc.id AS verification_case_id, vc.status AS verification_status
    FROM contributor_profiles p
    LEFT JOIN onboarding_tenders t ON t.contributor_id = p.user_id AND t.organization_id = ? AND t.status IN ('pending', 'corrections_requested', 'approved')
    LEFT JOIN seller_contracts sc ON sc.id = t.contract_id
    LEFT JOIN payout_wallets w ON w.id = t.wallet_id
    LEFT JOIN contributor_verification_cases vc ON vc.id = t.verification_case_id
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
  const walletId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE payout_wallets SET status = 'disabled', updated_at = CURRENT_TIMESTAMP WHERE contributor_id = ? AND provider = ? AND status <> 'disabled'").bind(user.id, payload.provider),
    c.env.DB.prepare(`INSERT INTO payout_wallets (id, contributor_id, provider, provider_account_id, account_holder_name, account_last4, branch_last4, currency, status, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', '{}')`).bind(walletId, user.id, payload.provider, payload.providerAccountId ?? null, payload.accountHolderName, payload.accountLast4 ?? null, payload.branchLast4 ?? null, payload.currency),
    c.env.DB.prepare("UPDATE onboarding_tenders SET wallet_id = ?, updated_at = CURRENT_TIMESTAMP WHERE organization_id = ? AND contributor_id = ? AND status IN ('pending', 'corrections_requested')").bind(walletId, user.organizationId, user.id),
    c.env.DB.prepare("UPDATE contributor_profiles SET payout_provider = ?, payout_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").bind(payload.provider, user.id),
  ]);
  return c.json({ walletId, provider: payload.provider, status: "pending", message: "Wallet captured without storing raw banking credentials. Provider verification is required before tender approval." }, 201);
});

app.post("/api/onboarding/contract", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "admin"])) return c.json({ error: "Contributor access required" }, 403);
  const payload = contractSubmissionSchema.parse(await c.req.json());
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
      w.id AS wallet_id, w.provider AS wallet_provider, w.status AS wallet_status, w.account_holder_name, w.account_last4
    FROM onboarding_tenders t JOIN users u ON u.id = t.contributor_id
      JOIN seller_contracts sc ON sc.id = t.contract_id
      LEFT JOIN contributor_verification_cases vc ON vc.id = t.verification_case_id
      LEFT JOIN payout_wallets w ON w.id = t.wallet_id
    WHERE t.organization_id = ? AND ${where} ORDER BY t.created_at ASC LIMIT 100
  `).bind(...(status === "all" ? [user.organizationId] : [user.organizationId, status])).all<Record<string, unknown>>();
  return c.json({ results: result.results });
});

app.post("/api/admin/onboarding/wallets/:walletId/verify", async (c) => {
  const admin = await requestUser(c);
  if (!admin || !allowedRole(admin, ["admin"])) return c.json({ error: "Admin access required" }, 403);
  const wallet = await c.env.DB.prepare("SELECT w.id, w.contributor_id FROM payout_wallets w JOIN organization_memberships om ON om.user_id = w.contributor_id AND om.organization_id = ? AND om.status = 'active' WHERE w.id = ?").bind(admin.organizationId, c.req.param("walletId")).first<{ id: string; contributor_id: string }>();
  if (!wallet) return c.json({ error: "Wallet not found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE payout_wallets SET status = 'verified', verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(wallet.id),
    c.env.DB.prepare("UPDATE contributor_profiles SET payout_status = 'verified', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").bind(wallet.contributor_id),
  ]);
  return c.json({ walletId: wallet.id, status: "verified" });
});

const tenderDecisionSchema = z.object({ decision: z.enum(["approved", "rejected", "corrections_requested"]), notes: z.string().trim().max(2000).default("") });

app.post("/api/admin/onboarding/tenders/:id/decision", async (c) => {
  const admin = await requestUser(c);
  if (!admin || !allowedRole(admin, ["admin"])) return c.json({ error: "Admin access required" }, 403);
  const payload = tenderDecisionSchema.parse(await c.req.json());
  const tender = await c.env.DB.prepare(`SELECT t.*, sc.status AS contract_status, vc.status AS verification_status, w.status AS wallet_status, u.email
    FROM onboarding_tenders t JOIN seller_contracts sc ON sc.id = t.contract_id JOIN users u ON u.id = t.contributor_id
    LEFT JOIN contributor_verification_cases vc ON vc.id = t.verification_case_id LEFT JOIN payout_wallets w ON w.id = t.wallet_id
    WHERE t.id = ? AND t.organization_id = ?`).bind(c.req.param("id"), admin.organizationId).first<Record<string, unknown>>();
  if (!tender) return c.json({ error: "Tender not found" }, 404);
  if (payload.decision === "approved" && (tender.contract_status !== "signed" || tender.verification_status !== "verified" || tender.wallet_status !== "verified")) {
    return c.json({ error: "Tender cannot be approved until the contract, KYC case, and payout wallet are verified", requirements: { contract: tender.contract_status, verification: tender.verification_status, wallet: tender.wallet_status } }, 422);
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
  const id = crypto.randomUUID();
  const geographicLocationSource = payload.province || payload.city || payload.locality || payload.landmark ? "seller" : "none";
  await c.env.DB.prepare(`INSERT INTO assets (id, organization_id, owner_id, kind, status, title, description, caption, province, city, locality, landmark, subject_tags, cultural_tags, rights_status, model_release_status, property_release_status, monetization_model, license_price_cents, workflow_stage, geographic_location_source)
    VALUES (?, ?, ?, ?, 'needs_review', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'curator_correction', ?)`)
    .bind(id, user.organizationId, user.id, payload.kind, payload.title, payload.description, payload.caption, payload.province ?? null, payload.city ?? null, payload.locality ?? null, payload.landmark ?? null, JSON.stringify(payload.subjectTags), JSON.stringify(payload.culturalTags), payload.rightsStatus, payload.modelReleaseStatus, payload.propertyReleaseStatus, payload.monetizationModel, payload.monetizationModel === "individual_license" ? payload.licensePriceCents : null, geographicLocationSource).run();
  return c.json(validateContractResponse("POST /api/assets 201", assetCreateResponseSchema, { id, status: "needs_review" }), 201, { Location: `/api/assets/${id}` });
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
  };
  if (next.monetizationModel === "individual_license" && (!next.licensePriceCents || next.licensePriceCents < 100)) {
    return c.json({ error: "Individual licences must have a price of at least ZAR 1.00" }, 422);
  }
  const safetyIssue = metadataSafetyIssue((next.culturalTags ?? []) as string[]);
  if (safetyIssue) return c.json({ error: safetyIssue, code: "metadata_context_required" }, 422);
  const locationWasEdited = payload.province !== undefined || payload.city !== undefined || payload.locality !== undefined || payload.landmark !== undefined;
  await c.env.DB.prepare(`UPDATE assets SET kind = ?, title = ?, description = ?, caption = ?, province = ?, city = ?, locality = ?, landmark = ?, subject_tags = ?, cultural_tags = ?, rights_status = ?, model_release_status = ?, property_release_status = ?, monetization_model = ?, license_price_cents = ?,
    geographic_location_source = CASE WHEN ? = 1 THEN 'seller' ELSE geographic_location_source END,
    asset_revision = asset_revision + 1, reviewed_revision = NULL, approved_revision = NULL, human_verified = 0,
    status = 'needs_review', workflow_stage = 'curator_correction', metadata_review_status = 'needs_context',
    metadata_review_note = 'Seller metadata changed; review the current revision before publication.',
    vector_index_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`)
    .bind(next.kind, next.title, next.description ?? "", next.caption ?? "", next.province ?? null, next.city ?? null, next.locality ?? null, next.landmark ?? null, JSON.stringify(next.subjectTags ?? []), JSON.stringify(next.culturalTags ?? []), next.rightsStatus ?? "pending", next.modelReleaseStatus ?? "unknown", next.propertyReleaseStatus ?? "unknown", next.monetizationModel ?? "membership", next.monetizationModel === "individual_license" ? next.licensePriceCents : null, locationWasEdited ? 1 : 0, id, user.organizationId).run();
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
  const asset = await c.env.DB.prepare(`SELECT id, kind, asset_revision, reviewed_revision, metadata_review_status
    FROM assets WHERE id = ? AND organization_id = ?`).bind(c.req.param("id"), user.organizationId)
    .first<{ id: string; kind: "image" | "video"; asset_revision: number; reviewed_revision: number | null; metadata_review_status: string }>();
  if (!asset) return c.json({ error: "Asset not found" }, 404);
  if (payload.decision === "approved" && !archiveDomain.canApproveMetadataRevision({ assetRevision: asset.asset_revision, reviewedRevision: asset.reviewed_revision, metadataReviewStatus: asset.metadata_review_status as Asset["metadataReviewStatus"] })) {
    return c.json({ error: "Save a correction for the current metadata revision before approval", code: "review_revision_required" }, 422);
  }
  const status = payload.decision === "approved" ? "published" : payload.decision === "withdrawn" ? "withdrawn" : payload.decision === "rejected" ? "rejected" : "needs_review";
  if (payload.decision === "approved") {
    await c.env.DB.prepare(`UPDATE assets SET status = 'published', workflow_stage = 'approval', human_verified = 1,
      approved_revision = asset_revision, vector_index_status = 'pending', index_terminal_reason = NULL,
      curator_notes = ?, updated_at = CURRENT_TIMESTAMP, last_reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`).bind(payload.notes, asset.id, user.organizationId).run();
  } else {
    await c.env.DB.prepare(`UPDATE assets SET status = ?, workflow_stage = 'curator_correction', human_verified = 0,
      asset_revision = asset_revision + 1, reviewed_revision = NULL, approved_revision = NULL,
      vector_index_status = 'pending', index_terminal_reason = ?, curator_notes = ?, updated_at = CURRENT_TIMESTAMP,
      last_reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`)
      .bind(status, status, payload.notes, asset.id, user.organizationId).run();
  }
  await c.env.DB.prepare("INSERT INTO metadata_events (id, asset_id, actor_id, event_type, payload) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), asset.id, user.id, payload.decision === "approved" ? "approved" : payload.decision === "rejected" || payload.decision === "withdrawn" ? "rejected" : "curator_corrected", JSON.stringify({ notes: payload.notes, decision: payload.decision })).run();
  await c.env.DB.prepare(`UPDATE photo_ai_provenance SET reviewed_by = ?, review_outcome = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = (SELECT id FROM photo_ai_provenance WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1)`)
    .bind(user.id, payload.decision, asset.id).run();
  const indexing = asset.kind === "image" && payload.decision !== "needs_changes"
    ? (await enqueuePhotoJobBestEffort(c.env, asset.id, "sync_index") ? "index_sync_queued" : "index_sync_retry_pending")
    : "not_required";
  return c.json({ ok: true, status, indexing });
});

const licenceRequestSchema: z.ZodType<LicenceRequest> = contractLicenceRequestSchema;

async function governanceAsset(c: { env: Bindings }, assetId: string, organizationId?: string): Promise<Asset | null> {
  const row = organizationId
    ? await c.env.DB.prepare("SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id WHERE a.id = ? AND a.organization_id = ?").bind(assetId, organizationId).first<Record<string, unknown>>()
    : await c.env.DB.prepare("SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id WHERE a.id = ?").bind(assetId).first<Record<string, unknown>>();
  if (!row) return null;
  const releases = await c.env.DB.prepare("SELECT release_type, status, document_name FROM contributor_releases WHERE asset_id = ?").bind(assetId).all<Record<string, unknown>>();
  return addReleaseDocuments(assetRowToDomain(row), releases.results as Record<string, unknown>[]);
}

function licencePriceCents(request: LicenceRequest, asset: Asset): number | null {
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
  return c.json({ assetId: request.assetId, priceCents: licencePriceCents(request, asset), currency: "ZAR", monetizationModel: asset.monetizationModel ?? "membership", ...archiveDomain.evaluateLicenceRequest(asset, request) });
});

app.post("/api/checkout", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["buyer", "contributor", "editor", "admin"])) return c.json({ error: "Authenticated buyer required" }, 401);
  const request = licenceRequestSchema.parse(await c.req.json());
  const asset = await governanceAsset(c, request.assetId, user.organizationId);
  if (!asset) return c.json({ error: "Asset not found" }, 404);
  const validation = archiveDomain.evaluateLicenceRequest(asset, request);
  if (!validation.allowed) return c.json({ blocked: true, ...validation }, 422);
  if (asset.monetizationModel === "custom_quote") {
    return c.json({ blocked: true, error: "This asset is available by custom quote. Contact the contributor to request pricing.", monetizationModel: asset.monetizationModel }, 422);
  }
  const licenceId = crypto.randomUUID();
  const priceCents = licencePriceCents(request, asset);
  if (!priceCents) return c.json({ blocked: true, error: "A licence price is not configured for this asset." }, 422);
  await c.env.DB.prepare("INSERT INTO licences (id, organization_id, asset_id, buyer_id, licence_type, territory, duration_days, price_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(licenceId, user.organizationId, request.assetId, user.id, request.licenceType, request.territory, request.durationDays, priceCents).run();
  return c.json({ blocked: false, licenceId, priceCents, currency: "ZAR", paymentRequired: true, ...validation }, 201);
});

const paymentSessionSchema = z.object({
  successUrl: z.string().url().max(2048),
  cancelUrl: z.string().url().max(2048),
});

app.post("/api/payments/:licenceId/session", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["buyer", "contributor", "editor", "admin"])) return c.json({ error: "Authenticated buyer required" }, 401);
  if (!c.env.PAYMENT_PROVIDER || !c.env.PAYMENT_ENDPOINT || !c.env.PAYMENT_TOKEN) return c.json({ error: "Payment provider is not configured" }, 503);
  const payload = paymentSessionSchema.parse(await c.req.json());
  const licence = await c.env.DB.prepare(`
    SELECT l.id, l.price_cents, l.status, l.payment_reference, u.email
    FROM licences l JOIN users u ON u.id = l.buyer_id
    WHERE l.id = ? AND l.organization_id = ? AND l.buyer_id = ?
  `).bind(c.req.param("licenceId"), user.organizationId, user.id).first<{ id: string; price_cents: number; status: string; payment_reference: string | null; email: string }>();
  if (!licence) return c.json({ error: "Licence not found" }, 404);
  if (licence.status !== "pending") return c.json({ error: `Licence cannot be paid from status ${licence.status}` }, 409);
  const integrations = new IntegrationContainer(c.env);
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
    });
    await c.env.DB.prepare("UPDATE licences SET payment_provider = ?, payment_reference = COALESCE(payment_reference, ?) WHERE id = ? AND organization_id = ? AND status = 'pending'")
      .bind(c.env.PAYMENT_PROVIDER, session.providerReference ?? session.id, licence.id, user.organizationId).run();
    return c.json({ licenceId: licence.id, provider: session.provider, checkoutUrl: session.checkoutUrl, status: session.status }, 201, { Location: `/api/payments/${licence.id}/session` });
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
  const licence = await env.DB.prepare("SELECT l.id, l.asset_id, l.status, l.price_cents, a.owner_id FROM licences l JOIN assets a ON a.id = l.asset_id WHERE l.id = ?").bind(licenceId).first<{ id: string; owner_id: string; status: string; price_cents: number }>();
  if (!licence) throw new Error("Licence not found");
  if (licence.status !== "pending") throw new Error(`Licence cannot be settled from status ${licence.status}`);
  if (Number(licence.price_cents) !== payload.amountCents) throw new Error("Settlement amount does not match the licence price");
  const fee = payload.platformFeeCents ?? Math.floor(payload.amountCents * 0.2);
  const royalty = payload.royaltyCents ?? payload.amountCents - fee - payload.taxCents;
  if (fee + royalty + payload.taxCents !== payload.amountCents || royalty < 0) throw new Error("Sale postings must balance to the settled amount");
  const transactionId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO ledger_transactions (id, licence_id, transaction_type, idempotency_key, amount_cents, currency) VALUES (?, ?, 'sale', ?, ?, ?)").bind(transactionId, licenceId, payload.idempotencyKey, payload.amountCents, payload.currency.toUpperCase()),
    env.DB.prepare("INSERT INTO ledger_postings (id, transaction_id, account_code, debit_cents, credit_cents, metadata_json) VALUES (?, ?, 'cash_clearing', ?, 0, '{}')").bind(crypto.randomUUID(), transactionId, payload.amountCents),
    env.DB.prepare("INSERT INTO ledger_postings (id, transaction_id, account_code, contributor_id, debit_cents, credit_cents, metadata_json) VALUES (?, ?, 'contributor_payable', ?, 0, ?, ?)").bind(crypto.randomUUID(), transactionId, licence.owner_id, royalty, JSON.stringify({ licenceId })),
    env.DB.prepare("INSERT INTO ledger_postings (id, transaction_id, account_code, debit_cents, credit_cents, metadata_json) VALUES (?, ?, 'platform_revenue', 0, ?, '{}')").bind(crypto.randomUUID(), transactionId, fee),
    ...(payload.taxCents > 0 ? [env.DB.prepare("INSERT INTO ledger_postings (id, transaction_id, account_code, debit_cents, credit_cents, metadata_json) VALUES (?, ?, 'tax_payable', 0, ?, '{}')").bind(crypto.randomUUID(), transactionId, payload.taxCents)] : []),
    env.DB.prepare("INSERT INTO ledger_entries (id, licence_id, contributor_id, entry_type, amount_cents, currency) VALUES (?, ?, ?, 'sale', ?, ?), (?, ?, ?, 'platform_fee', ?, ?)").bind(crypto.randomUUID(), licenceId, licence.owner_id, royalty, payload.currency.toUpperCase(), crypto.randomUUID(), licenceId, licence.owner_id, -fee, payload.currency.toUpperCase()),
    env.DB.prepare("UPDATE licences SET status = 'paid', price_cents = ? WHERE id = ?").bind(payload.amountCents, licenceId),
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

const paymentWebhookSchema = paymentWebhookRequestSchema;

async function verifyPaymentWebhook(secret: string, signature: string, body: string): Promise<boolean> {
  const expected = hex(await hmac(utf8(secret), body));
  return timingSafeEqual(expected, signature.replace(/^sha256=/, ""));
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
  if (!c.env.PAYMENT_WEBHOOK_SECRET) return c.json({ error: "Payment webhook secret is not configured" }, 503);
  const body = await c.req.text();
  if (!(await verifyPaymentWebhook(c.env.PAYMENT_WEBHOOK_SECRET, c.req.header("x-payment-signature") ?? "", body))) return c.json({ error: "Invalid payment webhook signature" }, 401);
  const payload = paymentWebhookSchema.parse(JSON.parse(body));
  const duplicate = await c.env.DB.prepare("SELECT id, status FROM payment_webhook_events WHERE provider = ? AND provider_event_id = ?").bind(payload.provider, payload.eventId).first<{ id: string; status: string }>();
  if (duplicate) return c.json({ accepted: true, duplicate: true, status: duplicate.status });
  const eventId = crypto.randomUUID();
  try {
    await c.env.DB.prepare("INSERT INTO payment_webhook_events (id, provider, provider_event_id, event_type, licence_id, amount_cents, currency, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(eventId, payload.provider, payload.eventId, payload.type, payload.licenceId, payload.amountCents, payload.currency.toUpperCase(), body).run();
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
      }
    } else if (payload.type === "refund" || payload.type === "chargeback") {
      transactionId = await postPaymentReversal(c.env, payload.licenceId, { amountCents: payload.amountCents, currency: payload.currency, idempotencyKey: `${payload.provider}:${payload.eventId}`, type: payload.type });
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
      JOIN payout_wallets w ON w.contributor_id = p.contributor_id AND w.status = 'verified'
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

async function hmac(key: Uint8Array<ArrayBuffer>, value: string): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
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

app.get("/api/assets", async (c) => {
  const params = searchSchema.parse({
    q: c.req.query("q") ?? "",
    kind: c.req.query("kind") ?? "all",
    location: c.req.query("location"),
    locationType: c.req.query("locationType"),
    category: c.req.query("category"),
    status: c.req.query("status") ?? "published",
  });

  let rows: Record<string, unknown>[] = [];
  let searchHandled = false;
  let searchMode: SearchResponse["mode"] = "keyword";
  if (params.q && params.status === "published") {
    try {
      const semantic = await searchPhotoIndex(photoPipeline(c.env), params.q, params);
      rows = semantic.rows;
      searchMode = semantic.mode;
      searchHandled = true;
    } catch (error) {
      logEvent("error", "photo.search.hybrid_failed", c.get("trace"), { error: error instanceof Error ? error.message : "unknown-error" });
    }
  }

  if (!searchHandled) {
    const clauses = [params.status === "all" ? "1 = 1" : "a.status = ?"];
    const values: string[] = params.status === "all" ? [] : [params.status];

    if (params.kind !== "all") {
      clauses.push("a.kind = ?");
      values.push(params.kind);
    }
    if (params.location) {
      clauses.push("(a.country LIKE ? OR a.city LIKE ? OR a.province LIKE ? OR a.locality LIKE ? OR a.landmark LIKE ?)");
      const location = `%${params.location}%`;
      values.push(location, location, location, location, location);
    }
    if (params.locationType) { clauses.push("a.visual_location_type = ?"); values.push(params.locationType); }
    if (params.category) { clauses.push("a.primary_category = ?"); values.push(params.category); }
    if (params.q) {
      clauses.push("(a.title LIKE ? OR a.description LIKE ? OR a.caption LIKE ? OR a.subject_tags LIKE ? OR a.cultural_tags LIKE ? OR a.ai_tags LIKE ? OR a.ocr_text LIKE ? OR a.visual_location_type LIKE ? OR a.primary_category LIKE ? OR a.scene_attributes LIKE ?)");
      const query = `%${params.q}%`;
      values.push(query, query, query, query, query, query, query, query, query, query);
    }

    const result = await c.env.DB.prepare(`
      SELECT a.*, u.display_name AS contributor
      FROM assets a JOIN users u ON u.id = a.owner_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY a.human_verified DESC, a.authenticity_confidence DESC, a.created_at DESC
      LIMIT 60
    `).bind(...values).all<Record<string, unknown>>();

    rows = result.results as Record<string, unknown>[];
  }
  const response: SearchResponse = {
    query: params.q,
    mode: searchMode,
    results: rows.map(assetRowToDomain),
    facets: [
      { label: "South Africa", value: "South Africa", count: rows.length },
      { label: "Human verified", value: "verified", count: rows.filter((row) => Boolean(row.human_verified)).length },
      { label: "Western Cape", value: "Western Cape", count: rows.filter((row) => row.province === "Western Cape").length },
    ],
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

const photoJobStatusSchema = z.enum(["all", "queued", "running", "completed", "needs_review", "failed", "dead_lettered", "skipped"]);

app.get("/api/admin/photo-jobs", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["admin", "editor"])) return c.json({ error: "Editor access required" }, 403);
  const status = photoJobStatusSchema.parse(c.req.query("status") ?? "all");
  const result = await c.env.DB.prepare(`SELECT j.*, a.title, a.status AS asset_status, a.workflow_stage,
      a.asset_revision AS current_asset_revision, a.approved_revision, a.indexed_revision
    FROM photo_ai_jobs j JOIN assets a ON a.id = j.asset_id
    WHERE a.organization_id = ? AND (? = 'all' OR j.status = ?)
    ORDER BY CASE j.status WHEN 'dead_lettered' THEN 1 WHEN 'failed' THEN 2 WHEN 'needs_review' THEN 3 ELSE 4 END,
      j.updated_at DESC LIMIT 200`)
    .bind(user.organizationId, status, status).all<Record<string, unknown>>();
  return c.json({ status, results: result.results });
});

app.get("/api/admin/photo-jobs/:jobId/provenance", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["admin", "editor"])) return c.json({ error: "Editor access required" }, 403);
  const result = await c.env.DB.prepare(`SELECT p.* FROM photo_ai_provenance p
    JOIN assets a ON a.id = p.asset_id WHERE p.job_id = ? AND a.organization_id = ? ORDER BY p.attempt ASC, p.created_at ASC`)
    .bind(c.req.param("jobId"), user.organizationId).all<Record<string, unknown>>();
  return c.json({ jobId: c.req.param("jobId"), results: result.results });
});

app.post("/api/admin/photo-jobs/:jobId/replay", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["admin", "editor"])) return c.json({ error: "Editor access required" }, 403);
  const job = await c.env.DB.prepare(`SELECT j.id FROM photo_ai_jobs j JOIN assets a ON a.id = j.asset_id
    WHERE j.id = ? AND a.organization_id = ? AND j.status IN ('failed', 'dead_lettered', 'needs_review', 'skipped')`)
    .bind(c.req.param("jobId"), user.organizationId).first<{ id: string }>();
  if (!job) return c.json({ error: "Replayable photo job not found" }, 404);
  const replayedJobId = await replayPhotoJob(photoPipeline(c.env), job.id);
  if (!replayedJobId) return c.json({ error: "Photo queue is unavailable", code: "photo_queue_unavailable" }, 503);
  return c.json({ jobId: replayedJobId, status: "queued", replayed: true }, 202);
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
  return c.json({ accepted: true }, 202);
});

app.get("/api/analytics/contributor", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "admin"])) return c.json({ error: "Contributor analytics access required" }, 403);
  const ownerId = user.id;
  const [summary, trend, tags, geography] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN metric_type = 'search' THEN count ELSE 0 END), 0) AS searches, COALESCE(SUM(CASE WHEN metric_type = 'asset_view' AND asset_id IN (SELECT id FROM assets WHERE owner_id = ? AND organization_id = ?) THEN count ELSE 0 END), 0) AS views, 0 AS saves FROM analytics_daily WHERE metric_date >= date('now', '-30 day')`).bind(ownerId, user.organizationId),
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

app.post("/api/uploads", async (c) => {
  const trace = c.get("trace");
  const chaos = chaosScenario(c);
  if (chaos === "db-failure" || chaos === "fail-before-session") {
    logChaos(c, trace, chaos, "before-db");
    return c.json({ error: "Injected upload-session failure" }, 503);
  }

  const payload = uploadSchema.parse(await c.req.json());
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
  }), 201, { Location: `/api/uploads/${id}/complete` });
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
    ? c.env.DB.prepare(`UPDATE assets SET original_key = ?, source_file_name = ?, source_etag = ?,
        status = 'needs_review', workflow_stage = 'ai_tagging', asset_revision = asset_revision + 1,
        enriched_revision = NULL, reviewed_revision = NULL, approved_revision = NULL, human_verified = 0,
        metadata_review_status = 'needs_context', metadata_review_note = 'Uploaded media is queued for AI enrichment and human review.',
        vector_index_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`)
      .bind(session.object_key, session.filename, object.etag, assetId, session.organization_id)
    : c.env.DB.prepare("INSERT INTO assets (id, organization_id, owner_id, kind, status, title, source_file_name, original_key, source_etag, workflow_stage) VALUES (?, ?, ?, ?, 'needs_review', ?, ?, ?, ?, 'ai_tagging')")
      .bind(assetId, session.organization_id, session.owner_id, session.content_type.startsWith("video/") ? "video" : "image", session.filename, session.filename, session.object_key, object.etag);
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

type StreamWebhookPayload = z.infer<typeof streamWebhookRequestSchema>;

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
  if (!c.env.STREAM_WEBHOOK_SECRET) return c.json({ error: "Stream webhook secret is not configured" }, 503);
  const body = await c.req.text();
  const signature = c.req.header("Webhook-Signature") ?? "";
  if (!(await verifyStreamWebhook(c.env.STREAM_WEBHOOK_SECRET, signature, body))) {
    recordMetric(c.env, "stream_webhook_rejected", trace, 1, ["signature"]);
    return c.json({ error: "Invalid Stream webhook signature" }, 401);
  }

  const payload: StreamWebhookPayload = streamWebhookRequestSchema.parse(JSON.parse(body));
  const streamUid = payload.uid ?? "unknown";
  const state = payload.status?.state ?? "unknown";
  const providerEventId = hex(await crypto.subtle.digest("SHA-256", utf8(body)));
  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO stream_events (id, provider_event_id, stream_uid, event_type, state, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), providerEventId, streamUid, "video-status", state, body).run();

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
  const malformedJson = error instanceof SyntaxError && /JSON|json|Unexpected token/i.test(error.message);
  const validation = error instanceof z.ZodError || malformedJson;
  logEvent(validation ? "warn" : "error", "request.error_handled", c.get("trace"), {
    method: c.req.method,
    path: c.req.path,
    error: validation ? "validation_error" : error instanceof Error ? error.message : "unknown-error",
  });
  const body = {
    error: validation ? "Invalid request" : "Internal server error",
    ...(validation ? {
      ...(malformedJson ? { code: "invalid_json" } : {}),
      issues: malformedJson ? [{ path: [], code: "invalid_json" }] : (error as z.ZodError).issues.map((issue) => ({ path: issue.path, code: issue.code })),
    } : {}),
  };
  return c.json(validateContractResponse("error response", errorResponseSchema, body), validation ? 400 : 500);
});

type QueueMessage = R2EventMessage | PhotoEnrichmentJob;

function isPhotoEnrichmentJob(message: QueueMessage): message is PhotoEnrichmentJob {
  if (!("type" in message)) return false;
  const candidate = message as { type?: unknown; jobId?: unknown; assetId?: unknown; operation?: unknown; assetRevision?: unknown; sourceEtag?: unknown };
  return candidate.type === "photo.enrich" && typeof candidate.jobId === "string" && typeof candidate.assetId === "string"
    && (candidate.operation === "enrich" || candidate.operation === "sync_index")
    && Number.isInteger(candidate.assetRevision)
    && (candidate.sourceEtag === null || typeof candidate.sourceEtag === "string");
}

async function normalizePhotoEnrichmentJob(env: Bindings, message: QueueMessage): Promise<PhotoEnrichmentJob | null> {
  if (isPhotoEnrichmentJob(message)) return message;
  const candidate = message as { type?: unknown; jobId?: unknown; assetId?: unknown; operation?: unknown };
  if (candidate.type !== "photo.enrich" || typeof candidate.jobId !== "string" || typeof candidate.assetId !== "string"
    || (candidate.operation !== "enrich" && candidate.operation !== "sync_index")) return null;
  const persisted = await env.DB.prepare("SELECT asset_revision, source_etag FROM photo_ai_jobs WHERE id = ? AND asset_id = ? AND operation = ?")
    .bind(candidate.jobId, candidate.assetId, candidate.operation).first<{ asset_revision: number; source_etag: string | null }>();
  return persisted ? {
    type: "photo.enrich",
    jobId: candidate.jobId,
    assetId: candidate.assetId,
    operation: candidate.operation,
    assetRevision: persisted.asset_revision,
    sourceEtag: persisted.source_etag,
  } : null;
}

function isR2EventMessage(message: QueueMessage): message is R2EventMessage {
  const candidate = message as { action?: unknown; bucket?: unknown; object?: { key?: unknown } };
  return typeof candidate.action === "string" && typeof candidate.bucket === "string" && typeof candidate.object?.key === "string";
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
        const photoJob = await normalizePhotoEnrichmentJob(env, message.body);
        if (photoJob) {
          await processPhotoJob(photoPipeline(env), photoJob, trace);
        } else if (isR2EventMessage(message.body)) {
          await replicateR2Event(env, message.body, trace);
        } else {
          logEvent("warn", "queue.message.invalid", trace, { messageId: message.id });
          recordMetric(env, "queue_invalid_message", trace, 1, ["unsupported-payload"]);
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
