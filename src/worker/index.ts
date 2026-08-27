import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { archiveDomain } from "../shared";
import type { Asset, BuyerAnalytics, CommunityOverview, ContributorAnalytics, CreatorProfile, DiscoveryResponse, LicenceProduct, LicenceRequest, MonetizationModel, PortfolioCollection, RightsCase, SavedSearch, SearchResponse, TakedownReason, UserLightbox } from "../shared";
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
import {
  auditAnalyticsStatus,
  searchR2AuditCatalog,
  type AuditAnalyticsConfig,
  type AuditCatalogRow,
} from "./audit-analytics";
import { IntegrationContainer } from "../integrations";
import { calculateMarketplaceSplit } from "../integrations/paystack-splits";
import { normalizePaystackPaymentEvent, verifyPaystackWebhook } from "../integrations/paystack-webhooks";
import { normalizeDiditStatus, verifyDiditWebhook } from "../integrations/didit";
import { agreementText, buyerAgreement, paymentDisclosure, sellerAgreement } from "../legal/agreements";
import { isPayFastIp, payfastAmountCents, verifyPayFastSignature } from "../integrations/payfast";
import { CREDIT_UNIT_CENTS, creditPurchaseAmountCents } from "./buyer-finance";
import { monthlyPayoutSchedule } from "./payout-schedule";
import { buildStatementCsv, buildStatementPdf } from "./statement-export";
import { canonicalContract, ocrValidation, sanitizeOcrResult, sha256Hex } from "./seller-workflow";
import {
  enqueuePhotoJob,
  classifyVisionResult,
  processPhotoJob,
  repairPendingPhotoPipeline,
  replayPhotoJob,
  requeuePhotoEnrichment,
  runPhotoVision,
  retryQueuedPhotoJobs,
  searchPhotoIndex,
  type PhotoEnrichmentJob,
  type PhotoJobOperation,
  type PhotoPipelineBindings,
} from "./photo-indexing";
import {
  createSession,
  applicationRoleFromClaims,
  csrfValid,
  getRequestUser,
  identityDisplayNameForClaims,
  identityEmailForClaims,
  isDemoEnvironment,
  roleForNewAccount,
  responseWithSession,
  responseWithoutSession,
  verifyExternalJwt,
  type RequestUser,
} from "./auth";
import { allowedOrigin, applySecurityHeaders, enforceRateLimit, scanMediaObject, type SecurityBindings } from "./security";
import { applyApiCachePolicy } from "./http-cache";
import { createPresignedR2Url } from "./r2-presign";
import { decidePayoutBatch } from "./payout-decision";
import { AUTO_APPROVAL_SCOPE, AUTO_APPROVAL_TERMS_VERSION, autoApprovalIsActive, licenceApprovalStatus } from "./licence-approval";
import { discoveryTokens, normalizeSavedQuery, scoreRecommendation } from "./discovery";
import { parseCampaignBrief, rankCampaignAssets, type BrandKit, type CampaignBrief, type CampaignStage } from "../campaign-intelligence";
import { decideRightsTransition, isRightsReviewer } from "./rights-transition";
import { createStoredZip, type ZipEntry } from "./zip";
import { settlementAmounts } from "./payment-settlement";
import { enqueueZohoOutbox, dispatchDueZohoOutbox, dispatchZohoOutboxJob, type ZohoOutboxJobMessage } from "./zoho-outbox";
import type { ZohoSocialDraft } from "../integrations/zoho";
import { bearerToken, normalizeWordPressSiteUrl, WORDPRESS_SCOPES, wordPressApiBaseUrl } from "../integrations/wordpress";
import {
  assetCreateRequestSchema as contractAssetCreateRequestSchema,
  assetCreateResponseSchema,
  authConfigResponseSchema,
  contractResponseValidationErrorSchema,
  ContractResponseValidationError,
  derivativeRequestSchema,
  derivativeResponseSchema,
  editVersionRequestSchema,
  editVersionResponseSchema,
  errorResponseSchema,
  bundleRequestSchema,
  bundleResponseSchema,
  governanceActionRequestSchema as contractGovernanceActionRequestSchema,
  governanceActionResponseSchema,
  healthResponseSchema,
  licenceRequestSchema as contractLicenceRequestSchema,
  paymentWebhookRequestSchema,
  searchResponseSchema,
  sessionResponseSchema,
  rightsTransitionRequestSchema,
  rightsTransitionResponseSchema,
  streamPlaybackResponseSchema,
  streamUploadRequestSchema,
  streamUploadResponseSchema,
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
  R2_ANALYTICS_BUCKET?: string;
  R2_ANALYTICS_NAMESPACE?: string;
  R2_ANALYTICS_TABLE?: string;
  R2_SQL_ENDPOINT?: string;
  R2_SQL_AUTH_TOKEN?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_HOSTNAMES?: string;
  STREAM_WEBHOOK_SECRET?: string;
  STREAM_ACCOUNT_ID?: string;
  STREAM_ALLOWED_ORIGINS?: string;
  STREAM_API_TOKEN?: string;
  STREAM_CUSTOMER_CODE?: string;
  STREAM_PUBLIC_PLAYBACK_ENABLED?: string;
  CHAOS_TEST_TOKEN?: string;
  CHAOS_TESTING_ENABLED?: string;
  APP_ENV?: string;
  AUDIT_RETENTION_DAYS?: string;
  AUDIT_ALLOWED_RESIDENCIES?: string;
  KYC_PROVIDER?: string;
  KYC_WEBHOOK_SECRET?: string;
  DIDIT_API_KEY?: string;
  DIDIT_API_SECRET?: string;
  DIDIT_WEBHOOK_SECRET?: string;
  DIDIT_SIGNING_SECRET?: string;
  DIDIT_KYC_WORKFLOW_ID?: string;
  DIDIT_KYB_WORKFLOW_ID?: string;
  DIDIT_API_URL?: string;
  DIDIT_URL?: string;
  CIPC_LOOKUP_URL?: string;
  CIPC_API_TOKEN?: string;
  APP_PUBLIC_URL?: string;
  AUTH_REDIRECT_URL?: string;
  AUTH_PROVIDER?: string;
  SUPABASE_URL?: string;
  SUPABASE_AUDIENCE?: string;
  STRIPE_SECRET_KEY?: string;
  PAYFAST_ENDPOINT?: string;
  PAYFAST_TOKEN?: string;
  ZA_BANK_ENDPOINT?: string;
  ZA_BANK_TOKEN?: string;
  PAYOUT_MIN_CENTS?: string;
  PHOTOGRAPHER_SUBSCRIPTION_PRICE_CENTS?: string;
  PLATFORM_SUBSCRIPTION_PRICE_CENTS?: string;
  OCR_ENABLED?: string;
  OCR_MODEL?: string;
  PHOTO_VISION_MODEL?: string;
  PHOTO_VISION_PROVIDER?: string;
  LOCAL_VISION_URL?: string;
  LOCAL_VISION_MODEL?: string;
  REMOTE_VISION_URL?: string;
  REMOTE_VISION_TOKEN?: string;
  PHOTO_EMBEDDING_MODEL?: string;
  PHOTO_INDEX_NAMESPACE?: string;
  PHOTO_CANDIDATE_INDEX_NAMESPACE?: string;
  PHOTO_AI_SOURCE_ORIGIN?: string;
  FIRMA_VERIFY_URL?: string;
  FIRMA_API_TOKEN?: string;
  SESSION_SECRET?: string;
  AUTH_JWT_SECRET?: string;
  AUTH_ISSUER?: string;
  AUTH_AUDIENCE?: string;
  AUTH_COOKIE_DOMAIN?: string;
  AUTH_ALLOW_ORG_PROVISIONING?: string;
  DEMO_AUTH_ENABLED?: string;
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
  PAYSTACK_SUBSCRIPTION_PLAN_CODE?: string;
  PAYSTACK_ANNUAL_SUBSCRIPTION_PLAN_CODE?: string;
  BUYER_SUBSCRIPTION_AMOUNT_CENTS?: string;
  BUYER_ANNUAL_SUBSCRIPTION_AMOUNT_CENTS?: string;
  BUYER_SUBSCRIPTION_INTERVAL?: string;
  INTRODUCTORY_FREE_DOWNLOAD_LIMIT?: string;
  DEFAULT_ARTIST_SHARE_PERCENTAGE?: string;
  PAYSTACK_SPLIT_FEE_BEARER?: string;
  MARKETPLACE_TERMS_APPROVED?: string;
  EDGE_CONTROLS_ATTESTED_AT?: string;
  KEY_ROTATION_ATTESTED_AT?: string;
  BACKUP_RESTORE_ATTESTED_AT?: string;
  PAYFAST_MERCHANT_ID?: string;
  PAYFAST_MERCHANT_KEY?: string;
  PAYFAST_PASSPHRASE?: string;
  PAYFAST_NOTIFY_URL?: string;
  PAYFAST_PAYMENT_ENDPOINT?: string;
  EMAIL_PROVIDER?: string;
  EMAIL_ENDPOINT?: string;
  EMAIL_TOKEN?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  EMAIL?: SendEmail;
};
type WorkersAiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};
type MediaBinding = {
  input(source: ReadableStream): {
    transform(options: Record<string, unknown>): {
      output(options: Record<string, unknown>): { media(): Promise<ReadableStream> };
    };
  };
};
type MediaReadBindings = {
  MEDIA_BUCKET: Pick<R2Bucket, "get" | "head">;
  MEDIA_LIBRARY_BUCKET?: Pick<R2Bucket, "get" | "head">;
};
type Bindings = Omit<Cloudflare.Env, "AI" | "PAYMENT_PROVIDER"> & AuditBindings & SecretBindings & {
  // These bindings are required by every deployed Worker environment. The
  // generated Wrangler base type is optional when a lightweight environment
  // (such as env.demo) overrides only vars, so keep the runtime contract strict
  // at the application seam.
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  MEDIA_LIBRARY_BUCKET?: Pick<R2Bucket, "get" | "head">;
  MEDIA_DR_BUCKET: R2Bucket;
  BACKUP_BUCKET: R2Bucket;
  KYC_BUCKET_ZA: R2Bucket;
  KYC_BUCKET_EU: R2Bucket;
  IMAGES: ImagesBinding;
  AI?: WorkersAiBinding;
  MEDIA?: MediaBinding;
  SUPABASE_ANON_KEY?: string;
};

type Variables = { trace: TraceContext };
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const diditApiKey = (env: Pick<Bindings, "DIDIT_API_KEY" | "DIDIT_API_SECRET">): string | undefined => env.DIDIT_API_KEY?.trim() || env.DIDIT_API_SECRET?.trim();
const diditWebhookSecret = (env: Pick<Bindings, "DIDIT_WEBHOOK_SECRET" | "DIDIT_SIGNING_SECRET">): string | undefined => env.DIDIT_WEBHOOK_SECRET?.trim() || env.DIDIT_SIGNING_SECRET?.trim();
const diditApiUrl = (env: Pick<Bindings, "DIDIT_API_URL" | "DIDIT_URL">): string | undefined => env.DIDIT_API_URL?.trim() || env.DIDIT_URL?.trim();

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
    env.DB.prepare("UPDATE campaign_bundles SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE status = 'approved' AND expires_at IS NOT NULL AND datetime(expires_at) <= CURRENT_TIMESTAMP"),
    env.DB.prepare("UPDATE campaign_bundle_builds SET status = 'failed', error_text = 'bundle_build_timeout', updated_at = CURRENT_TIMESTAMP WHERE status = 'building' AND started_at < datetime('now', '-1 hour')"),
    env.DB.prepare("UPDATE stream_uploads SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE status IN ('created', 'uploading') AND datetime(expires_at) <= CURRENT_TIMESTAMP"),
    env.DB.prepare("UPDATE photographer_subscriptions SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP"),
  ]);
}

/** Best-effort transactional email. Never throws into the caller's request path. */
async function dispatchEmailBestEffort(env: Bindings, to: string, subject: string, text: string, idempotencyKey: string): Promise<void> {
  const provider = new IntegrationContainer(env).email.get();
  if (!provider) return;
  try {
    await provider.send({ to, subject, text, idempotencyKey });
  } catch (error) {
    logEvent("warn", "email.send_failed", traceContext(new Request("https://internal/email")), { error: error instanceof Error ? error.message : "unknown-error" });
  }
}

/** Records an in-app notification and best-effort emails the recipient. */
async function notify(env: Bindings, organizationId: string, userId: string, content: { type: string; title: string; body: string; resourceType?: string; resourceId?: string }): Promise<void> {
  await env.DB.prepare("INSERT INTO notifications (id, organization_id, user_id, type, title, body, resource_type, resource_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), organizationId, userId, content.type, content.title, content.body, content.resourceType ?? null, content.resourceId ?? null).run();
  const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first<{ email: string }>();
  if (user?.email) await dispatchEmailBestEffort(env, user.email, content.title, content.body, `notify:${userId}:${content.type}:${content.resourceId ?? content.title}:${today()}`);
}

/** Delivers a signed webhook to every subscription in the organization listening for this event. */
async function dispatchWebhookEvent(env: Bindings, organizationId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
  const subscriptions = await env.DB.prepare("SELECT id, target_url, secret, events FROM webhook_subscriptions WHERE organization_id = ? AND status = 'active'").bind(organizationId).all<{ id: string; target_url: string; secret: string; events: string }>();
  for (const subscription of subscriptions.results) {
    let events: string[];
    try { events = JSON.parse(subscription.events); } catch { events = []; }
    if (!events.includes(eventType) && !events.includes("*")) continue;
    const deliveryId = crypto.randomUUID();
    const body = JSON.stringify({ event: eventType, data: payload, deliveryId, timestamp: new Date().toISOString() });
    const signature = hex(await hmac(utf8(subscription.secret), body));
    await env.DB.prepare("INSERT INTO webhook_deliveries (id, subscription_id, event_type, payload_json, status, attempts) VALUES (?, ?, ?, ?, 'pending', 1)").bind(deliveryId, subscription.id, eventType, body).run();
    try {
      const response = await fetch(subscription.target_url, { method: "POST", headers: { "Content-Type": "application/json", "X-Veld-Signature": signature, "X-Veld-Delivery": deliveryId }, body });
      await env.DB.prepare("UPDATE webhook_deliveries SET status = ?, response_status = ?, delivered_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = ?")
        .bind(response.ok ? "delivered" : "failed", response.status, response.ok ? 1 : 0, deliveryId).run();
    } catch (error) {
      await env.DB.prepare("UPDATE webhook_deliveries SET status = 'failed' WHERE id = ?").bind(deliveryId).run();
      logEvent("warn", "webhook.delivery_failed", traceContext(new Request("https://internal/webhook")), { subscriptionId: subscription.id, eventType, error: error instanceof Error ? error.message : "unknown-error" });
    }
  }
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
    applyApiCachePolicy(c.req.raw, c.res);
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
  const exempt = c.req.path === "/api/auth/dev-login" || c.req.path === "/api/auth/demo-login" || c.req.path === "/api/auth/exchange" || c.req.path === "/api/auth/logout" || c.req.path === "/api/security/turnstile" || c.req.path.startsWith("/api/webhooks/") || c.req.path === "/api/analytics/events" || c.req.path === "/api/checkout/validate";
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

const devLoginSchema = z.object({ role: z.enum(["buyer", "contributor", "editor", "admin"]) });
const exchangeSchema = z.object({
  organizationId: z.string().min(1).max(120).optional(),
  sessionTransport: z.enum(["cookie", "bearer"]).optional(),
  accountIntent: z.literal("seller").optional(),
});
type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;
type DemoRole = z.infer<typeof devLoginSchema>["role"];

export function isSupabasePublicKey(value: string | undefined): boolean {
  const key = value?.trim();
  if (!key) return false;
  if (key.startsWith("sb_publishable_")) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parts[1].length / 4) * 4, "="))) as { role?: unknown };
    return payload.role === "anon";
  } catch {
    return false;
  }
}

function authRedirectUrlForRequest(request: Request, env: Bindings): string {
  const configured = env.AUTH_REDIRECT_URL?.trim() || env.APP_PUBLIC_URL?.trim() || (String(env.APP_ENV) === "production" ? "https://veld-archive.pages.dev" : new URL(request.url).origin);
  try {
    const url = new URL(configured);
    if (!/^https?:$/i.test(url.protocol)) throw new Error("unsupported redirect protocol");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return String(env.APP_ENV) === "production" ? "https://veld-archive.pages.dev" : new URL(request.url).origin;
  }
}

export function publicAuthConfig(request: Request, env: Bindings): unknown {
  const redirectUrl = authRedirectUrlForRequest(request, env);
  if (isDemoEnvironment(env)) return { provider: "demo", redirectUrl };
  const provider = String(env.AUTH_PROVIDER ?? "both").trim().toLowerCase();
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_ANON_KEY?.trim();
  if (!["supabase", "both"].includes(provider) || !supabaseUrl || !key) {
    return { provider: "unavailable", redirectUrl, reason: "identity_provider_not_configured" };
  }
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:" || !isSupabasePublicKey(key)) throw new Error("invalid Supabase public configuration");
  } catch {
    return { provider: "unavailable", redirectUrl, reason: "identity_provider_key_invalid" };
  }
  return { provider: "supabase", supabaseUrl, publishableKey: key, redirectUrl };
}

/**
 * Marketplace terms are intentionally readable before sign-in so a buyer or
 * seller can understand the contract before creating an account or starting
 * checkout. The checkout and onboarding routes still verify the exact
 * version and persist an acceptance hash server-side.
 */
app.get("/api/legal/agreements", (c) => c.json({ documents: [sellerAgreement, buyerAgreement, paymentDisclosure] }));

async function sessionResponse(c: { env: Bindings; req: { raw: Request }; json: (data: unknown, status?: number) => Response }, userId: string, organizationId: string, transport: "cookie" | "bearer" = "cookie"): Promise<Response> {
  const session = await createSession(c.env, userId, organizationId);
  const user = await getRequestUser(c.env, new Request(c.req.raw.url, { headers: { Cookie: `va_session=${session.token}` } }));
  if (!user) return new Response(JSON.stringify({ error: "Could not create authenticated session" }), { status: 500, headers: { "Content-Type": "application/json" } });
  const response = c.json({ authenticated: true, user, csrfToken: session.csrfToken, expiresAt: session.expiresAt, ...(transport === "bearer" ? { sessionToken: session.token } : {}) });
  response.headers.set("Cache-Control", "no-store");
  return responseWithSession(response, session.token, c.env);
}

async function seedSessionForRole(c: AppContext, role: DemoRole): Promise<Response> {
  const userId = role === "admin" ? "demo-admin" : role === "editor" ? "demo-editor" : role === "contributor" ? "demo-contributor" : "demo-buyer";
  if (role === "editor") {
    const adminMembership = await c.env.DB.prepare("SELECT organization_id FROM organization_memberships WHERE user_id = 'demo-admin' AND status = 'active' ORDER BY created_at LIMIT 1")
      .first<{ organization_id: string }>();
    if (!adminMembership) return c.json({ error: "Demo seed identity is not available; apply migrations first" }, 503);
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT OR IGNORE INTO users (id, email, display_name, role) VALUES ('demo-editor', 'review.editor@veldarchive.local', 'Veld Review Editor', 'editor')"),
      c.env.DB.prepare("INSERT INTO organization_memberships (id, organization_id, user_id, role, status) VALUES (?, ?, 'demo-editor', 'editor', 'active') ON CONFLICT(organization_id, user_id) DO UPDATE SET role = 'editor', status = 'active', updated_at = CURRENT_TIMESTAMP")
        .bind(crypto.randomUUID(), adminMembership.organization_id),
    ]);
  }
  const user = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").bind(userId).first<{ id: string }>();
  const membership = await c.env.DB.prepare("SELECT organization_id FROM organization_memberships WHERE user_id = ? AND status = 'active' ORDER BY created_at LIMIT 1").bind(userId).first<{ organization_id: string }>();
  if (!user || !membership) return c.json({ error: "Demo seed identity is not available; apply migrations first" }, 503);
  return sessionResponse(c, user.id, membership.organization_id);
}

app.get("/api/auth/session", async (c) => {
  const user = await getRequestUser(c.env, c.req.raw);
  const response = user ? { authenticated: true as const, user, csrfToken: user.csrfToken } : { authenticated: false as const, user: null };
  return c.json(validateContractResponse("GET /api/auth/session 200", sessionResponseSchema, response));
});

app.get("/api/auth/config", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(validateContractResponse("GET /api/auth/config 200", authConfigResponseSchema, publicAuthConfig(c.req.raw, c.env)));
});

app.post("/api/auth/logout", async (c) => {
  const user = await getRequestUser(c.env, c.req.raw);
  if (user) await c.env.DB.prepare("UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?").bind(user.sessionId).run();
  return responseWithoutSession(c.json({ authenticated: false }), c.env);
});

app.post("/api/auth/dev-login", async (c) => {
  if (String(c.env.APP_ENV) === "production") return c.json({ error: "Development authentication is disabled" }, 404);
  const payload = devLoginSchema.parse(await c.req.json());
  return seedSessionForRole(c, payload.role);
});

app.post("/api/auth/demo-login", async (c) => {
  if (!isDemoEnvironment(c.env)) return c.json({ error: "Demo authentication is disabled" }, 404);
  const payload = devLoginSchema.parse(await c.req.json());
  return seedSessionForRole(c, payload.role);
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
    const role = roleForNewAccount(applicationRoleFromClaims(claims, c.env), requested.accountIntent);
    const identityEmail = await identityEmailForClaims(claims);
    const displayName = identityDisplayNameForClaims(claims);
    await c.env.DB.prepare("INSERT INTO users (id, auth_subject, email, display_name, role, email_verified_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)")
      .bind(userId, claims.sub, identityEmail, displayName, role).run();
    if (!organization) await c.env.DB.prepare("INSERT INTO organizations (id, name, slug, created_by) VALUES (?, ?, ?, ?)").bind(organizationId, claims.org_name ?? "New organization", organizationId.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60), userId).run();
    await c.env.DB.prepare("INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), organizationId, userId, role).run();
    user = { id: userId, email: identityEmail };
  }
  const membership = await c.env.DB.prepare("SELECT organization_id FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND status = 'active'").bind(organizationId, user.id).first<{ organization_id: string }>();
  if (!membership) return c.json({ error: "User is not a member of the requested organization" }, 403);
  return sessionResponse(c, user.id, membership.organization_id, requested.sessionTransport ?? "cookie");
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

const wordpressPairingSchema = z.object({ siteUrl: z.string().trim().min(8).max(2048), siteName: z.string().trim().max(180).default("") });
const wordpressExchangeSchema = wordpressPairingSchema.extend({ pairingCode: z.string().regex(/^wpc_[A-Za-z0-9_-]{40,180}$/), pluginVersion: z.string().trim().max(40).default("") });
type WordPressConnectionRow = { id: string; organization_id: string; created_by: string; site_url: string; site_name: string; plugin_version: string; status: "active" | "revoked" };

async function requestWordPressConnection(c: { env: Bindings; req: { raw: Request } }): Promise<WordPressConnectionRow | null> {
  const token = bearerToken(c.req.raw);
  if (!token) return null;
  const connection = await c.env.DB.prepare("SELECT id, organization_id, created_by, site_url, site_name, plugin_version, status FROM wordpress_connections WHERE token_hash = ? AND status = 'active'").bind(await sha256Hex(token)).first<WordPressConnectionRow>();
  if (!connection) return null;
  await c.env.DB.prepare("UPDATE wordpress_connections SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'").bind(connection.id).run();
  return connection;
}

function wordpressConnectionResponse(request: Request, env: Bindings, connection: WordPressConnectionRow): Record<string, unknown> {
  return { connectionId: connection.id, siteUrl: connection.site_url, siteName: connection.site_name, status: connection.status, pluginVersion: connection.plugin_version, scopes: [...WORDPRESS_SCOPES], apiBaseUrl: wordPressApiBaseUrl(request, env.APP_PUBLIC_URL) };
}

function wordpressAssetResponse(request: Request, env: Bindings, row: Record<string, unknown>): Record<string, unknown> {
  const asset = assetRowToDomain(row, env);
  return { id: asset.id, kind: asset.kind, title: asset.title, description: asset.description, caption: asset.caption, country: asset.country, province: asset.province, city: asset.city, locality: asset.locality, landmark: asset.landmark, rightsStatus: asset.rightsStatus, modelReleaseStatus: asset.modelReleaseStatus, propertyReleaseStatus: asset.propertyReleaseStatus, sourceAttribution: asset.sourceAttribution, tags: [...asset.subjectTags, ...asset.culturalTags], previewUrl: `${wordPressApiBaseUrl(request, env.APP_PUBLIC_URL)}/api/assets/${encodeURIComponent(asset.id)}/preview`, licenceRequired: true };
}

app.post("/api/integrations/wordpress/pairing", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["buyer", "editor", "admin"])) return c.json({ error: "WordPress connection requires buyer, editor, or admin access" }, 403);
  const payload = wordpressPairingSchema.parse(await c.req.json());
  const siteUrl = normalizeWordPressSiteUrl(payload.siteUrl, String(c.env.APP_ENV) === "production");
  if (!siteUrl) return c.json({ error: "A valid HTTPS WordPress site URL is required" }, 422);
  const pairingCode = `wpc_${base64UrlToken()}`;
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO wordpress_pairing_codes (id, organization_id, created_by, code_hash, site_url, site_name, expires_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+10 minutes'))").bind(id, user.organizationId, user.id, await sha256Hex(pairingCode), siteUrl, payload.siteName).run();
  return c.json({ pairingId: id, pairingCode, siteUrl, expiresInSeconds: 600, apiBaseUrl: wordPressApiBaseUrl(c.req.raw, c.env.APP_PUBLIC_URL) }, 201);
});

app.post("/api/integrations/wordpress/pairing/exchange", async (c) => {
  const payload = wordpressExchangeSchema.parse(await c.req.json());
  const siteUrl = normalizeWordPressSiteUrl(payload.siteUrl, String(c.env.APP_ENV) === "production");
  if (!siteUrl) return c.json({ error: "A valid HTTPS WordPress site URL is required" }, 422);
  const pairing = await c.env.DB.prepare("SELECT id, organization_id, created_by, site_url, site_name FROM wordpress_pairing_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP").bind(await sha256Hex(payload.pairingCode)).first<{ id: string; organization_id: string; created_by: string; site_url: string; site_name: string }>();
  if (!pairing || pairing.site_url !== siteUrl) return c.json({ error: "Pairing code is invalid, expired, already used, or bound to another site" }, 401);
  const accessToken = `wpa_${base64UrlToken()}`;
  const connectionId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO wordpress_connections (id, organization_id, created_by, site_url, site_name, token_hash, token_prefix, plugin_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(connectionId, pairing.organization_id, pairing.created_by, siteUrl, payload.siteName || pairing.site_name, await sha256Hex(accessToken), accessToken.slice(0, 12), payload.pluginVersion),
    c.env.DB.prepare("UPDATE wordpress_pairing_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL").bind(pairing.id),
    c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, 'wordpress_connection_created', 'wordpress_connection', ?, ?)").bind(crypto.randomUUID(), pairing.created_by, connectionId, JSON.stringify({ siteUrl, pluginVersion: payload.pluginVersion })),
  ]);
  const connection: WordPressConnectionRow = { id: connectionId, organization_id: pairing.organization_id, created_by: pairing.created_by, site_url: siteUrl, site_name: payload.siteName || pairing.site_name, plugin_version: payload.pluginVersion, status: "active" };
  return c.json({ ...wordpressConnectionResponse(c.req.raw, c.env, connection), accessToken, tokenWarning: "Store this token securely. It will not be shown again." }, 201);
});

app.post("/api/integrations/wordpress/connections/:id/revoke", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["admin", "editor"])) return c.json({ error: "Organisation administration required" }, 403);
  const connection = await c.env.DB.prepare("SELECT id FROM wordpress_connections WHERE id = ? AND organization_id = ? AND status = 'active'").bind(c.req.param("id"), user.organizationId).first<{ id: string }>();
  if (!connection) return c.json({ error: "Active WordPress connection not found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE wordpress_connections SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP WHERE id = ?").bind(c.req.param("id")),
    c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id) VALUES (?, ?, 'wordpress_connection_revoked', 'wordpress_connection', ?)").bind(crypto.randomUUID(), user.id, c.req.param("id")),
  ]);
  return c.json({ connectionId: c.req.param("id"), status: "revoked" });
});

app.get("/api/integrations/wordpress/v1/me", async (c) => {
  const connection = await requestWordPressConnection(c);
  if (!connection) return c.json({ error: "WordPress connection is invalid or revoked" }, 401);
  return c.json(wordpressConnectionResponse(c.req.raw, c.env, connection));
});

app.get("/api/integrations/wordpress/v1/assets", async (c) => {
  const connection = await requestWordPressConnection(c);
  if (!connection) return c.json({ error: "WordPress connection is invalid or revoked" }, 401);
  const query = String(c.req.query("q") ?? "").trim().slice(0, 180);
  const clauses = ["a.organization_id = ?", "a.status = 'published'", "a.kind = 'image'"];
  const values: unknown[] = [connection.organization_id];
  for (const token of discoveryTokens([query]).slice(0, 6)) {
    clauses.push("(lower(a.title) LIKE ? OR lower(a.description) LIKE ? OR lower(a.caption) LIKE ? OR lower(a.subject_tags) LIKE ? OR lower(COALESCE(a.city, '')) LIKE ? OR lower(COALESCE(a.province, '')) LIKE ?)");
    const pattern = `%${token}%`;
    values.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }
  const rows = await c.env.DB.prepare(`SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id WHERE ${clauses.join(" AND ")} ORDER BY a.human_verified DESC, a.updated_at DESC LIMIT 40`).bind(...values).all<Record<string, unknown>>();
  return c.json({ query, page: 1, limit: 40, total: rows.results.length, results: rows.results.map((row) => wordpressAssetResponse(c.req.raw, c.env, row)) });
});

function base64UrlToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}


function streamEmbedUrl(row: Record<string, unknown>, env?: Pick<SecretBindings, "STREAM_CUSTOMER_CODE" | "STREAM_PUBLIC_PLAYBACK_ENABLED">): string | null {
  const uid = typeof row.stream_uid === "string" ? row.stream_uid.trim() : "";
  const customerCode = env?.STREAM_CUSTOMER_CODE?.trim();
  if (!uid || !customerCode || env?.STREAM_PUBLIC_PLAYBACK_ENABLED !== "true") return null;
  return `https://customer-${encodeURIComponent(customerCode)}.cloudflarestream.com/${encodeURIComponent(uid)}/iframe`;
}

export function publicMediaKey(row: Record<string, unknown>): string | null {
  const previewKey = typeof row.preview_key === "string" ? row.preview_key.trim() : "";
  return previewKey || null;
}

export function previewMediaKey(row: Record<string, unknown>, unwatermarked = false, width?: 640 | 1200 | 1800): string | null {
  if (!unwatermarked) return publicMediaKey(row);
  const originalKey = typeof row.original_key === "string" ? row.original_key.trim() : "";
  return originalKey || publicMediaKey(row);
}

function responsivePreviewKey(row: Record<string, unknown>, width?: number): string | null {
  if (width === 640 && typeof row.preview_640_key === "string" && row.preview_640_key.trim()) return row.preview_640_key.trim();
  if (width === 1200 && typeof row.preview_1200_key === "string" && row.preview_1200_key.trim()) return row.preview_1200_key.trim();
  return publicMediaKey(row);
}

export function previewObjectKey(originalKey: string, contentType?: string): string {
  const relative = originalKey.startsWith("originals/") ? originalKey.slice("originals/".length) : originalKey;
  if (contentType?.startsWith("image/")) return `previews/${relative.replace(/\.[^.\/]+$/, ".webp")}`;
  return `previews/${relative}`;
}

function previewVariantKey(originalKey: string, width: number): string {
  const relative = originalKey.startsWith("originals/") ? originalKey.slice("originals/".length) : originalKey;
  return `previews/${width}/${relative.replace(/\.[^.\/]+$/, ".webp")}`;
}

const PREVIEW_MAX_DIMENSION = 1800;
const PREVIEW_QUALITY = 78;

async function buildWatermarkedPreview(env: Bindings, source: ReadableStream<Uint8Array>, width: number, alreadyOptimized = false): Promise<{ body: ReadableStream<Uint8Array>; contentType: string }> {
  const input = env.IMAGES.input(source);
  const base = alreadyOptimized ? input : input.transform({
    width,
    height: width,
    fit: "scale-down",
    sharpen: 1,
  });
  const watermarkResponse = await env.ASSETS.fetch(new Request("https://assets.internal/watermark.png"));
  if (!watermarkResponse.ok || !watermarkResponse.body) throw new Error("Watermark asset is unavailable");
  const watermark = env.IMAGES.input(watermarkResponse.body).transform({ width: 560, height: 180, fit: "contain" });
  const output = await base.draw(watermark, { repeat: true, opacity: 0.24 }).output({ format: "image/webp", quality: PREVIEW_QUALITY });
  const contentType = output.contentType() || "image/webp";
  return { body: output.image(), contentType };
}

async function writeWatermarkedPreview(env: Bindings, originalKey: string, previousPreviewKey?: string | null): Promise<{ key: string; contentType: string; variants: { preview640Key: string; preview1200Key: string; preview1800Key: string } }> {
  const source = await getReadableMedia(env, originalKey);
  if (!source) throw new Error("R2 original disappeared before preview creation");
  const widths = [640, 1200, PREVIEW_MAX_DIMENSION];
  const sourceBytes = source.size <= 20 * 1024 * 1024 ? await source.arrayBuffer() : null;
  const outputs: { width: number; key: string; body: ReadableStream<Uint8Array>; contentType: string }[] = [];
  for (const width of widths) {
    let preview: { body: ReadableStream<Uint8Array>; contentType: string };
    if (sourceBytes) {
      preview = await buildWatermarkedPreview(env, new Response(sourceBytes).body!, width);
    } else {
      const expires = Math.floor(Date.now() / 1000) + 300;
      const signingSecret = env.R2_SECRET_ACCESS_KEY;
      const origin = env.PHOTO_AI_SOURCE_ORIGIN?.replace(/\/$/, "");
      if (!signingSecret || !origin) throw new Error("Large image preview requires an internal source signer");
      const signature = hex(await hmac(utf8(signingSecret), `${originalKey}.${expires}`));
      const sourceUrl = `${origin}/internal/media-preview-source?key=${encodeURIComponent(originalKey)}&expires=${expires}&signature=${signature}`;
      const transformed = await fetch(sourceUrl, { cf: { image: { fit: "scale-down", width, height: width, format: "webp", quality: PREVIEW_QUALITY, metadata: "none" } } });
      if (!transformed.ok || !transformed.body) throw new Error(`Large image resize failed with HTTP ${transformed.status}`);
      preview = await buildWatermarkedPreview(env, transformed.body, width, true);
    }
    outputs.push({ width, key: width === PREVIEW_MAX_DIMENSION ? previewObjectKey(originalKey, "image/*") : previewVariantKey(originalKey, width), ...preview });
  }
  for (const output of outputs) {
    await env.MEDIA_BUCKET.put(output.key, output.body, { httpMetadata: { contentType: output.contentType, cacheControl: "public, max-age=3600, stale-while-revalidate=86400" }, customMetadata: { sourceKey: originalKey, purpose: "watermarked-preview", transformation: `webp-${output.width}-q${PREVIEW_QUALITY}` } });
  }
  if (previousPreviewKey && previousPreviewKey !== outputs[2].key) await env.MEDIA_BUCKET.delete(previousPreviewKey);
  return { key: outputs[2].key, contentType: outputs[2].contentType, variants: { preview640Key: outputs[0].key, preview1200Key: outputs[1].key, preview1800Key: outputs[2].key } };
}

async function writeVideoPoster(env: Bindings, originalKey: string, previousPosterKey?: string | null): Promise<string> {
  if (!env.MEDIA) throw new Error("Cloudflare Media binding is not configured");
  const source = await getReadableMedia(env, originalKey);
  if (!source) throw new Error("R2 video original disappeared before poster creation");
  const frame = env.MEDIA.input(source.body).transform({ width: 1200, height: 675, fit: "contain" }).output({ mode: "frame", time: "1s", format: "jpg" });
  const frameStream = await frame.media();
  const poster = await buildWatermarkedPreview(env, frameStream, 1200, true);
  const key = `previews/posters/${originalKey.replace(/^originals\//, "").replace(/\.[^.\/]+$/, ".webp")}`;
  await env.MEDIA_BUCKET.put(key, poster.body, { httpMetadata: { contentType: poster.contentType, cacheControl: "public, max-age=3600, stale-while-revalidate=86400" }, customMetadata: { sourceKey: originalKey, purpose: "watermarked-video-poster", transformation: "frame-1s-webp-1200" } });
  if (previousPosterKey && previousPosterKey !== key) await env.MEDIA_BUCKET.delete(previousPosterKey);
  return key;
}

async function listR2Keys(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    keys.push(...page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

const assetRowToDomain = (row: Record<string, unknown>, env?: Pick<SecretBindings, "STREAM_CUSTOMER_CODE" | "STREAM_PUBLIC_PLAYBACK_ENABLED">): Asset => ({
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
  aiSuggestedMetadata: JSON.parse(String(row.ai_metadata_suggestion_json ?? "{}")) as Asset["aiSuggestedMetadata"],
  visualLocationType: (row.visual_location_type as Asset["visualLocationType"]) ?? "unknown",
  sceneContext: (row.scene_context as Asset["sceneContext"]) ?? "unknown",
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
  previewUrl: publicMediaKey(row) ? `/api/assets/${encodeURIComponent(String(row.id))}/preview` : null,
  posterUrl: row.kind === "video" && row.video_poster_key ? `/api/assets/${encodeURIComponent(String(row.id))}/poster` : null,
  streamUid: (row.stream_uid as string | null) ?? null,
  streamEmbedUrl: streamEmbedUrl(row, env),
  streamStatus: (row.stream_status as Asset["streamStatus"]) ?? "not_configured",
  monetizationModel: (row.monetization_model as MonetizationModel | undefined) ?? "membership",
  licensePriceCents: row.license_price_cents == null ? null : Number(row.license_price_cents),
  freeDownloadEnabled: Number(row.free_download_enabled) === 1,
});

function previewContentType(row: Record<string, unknown>): string {
  const fileName = String(row.preview_key ?? row.source_file_name ?? "").toLowerCase();
  if (row.kind === "video") return fileName.endsWith(".webm") ? "video/webm" : "video/mp4";
  if (fileName.endsWith(".png")) return "image/png";
  if (fileName.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function originalContentType(row: Record<string, unknown>): string {
  const fileName = String(row.source_file_name ?? row.original_key ?? "").toLowerCase();
  if (row.kind === "video") return fileName.endsWith(".webm") ? "video/webm" : "video/mp4";
  if (fileName.endsWith(".png")) return "image/png";
  if (fileName.endsWith(".webp")) return "image/webp";
  return imageContentTypeFromFilename(fileName);
}

function imageContentTypeFromFilename(fileName: string): string {
  if (fileName.endsWith(".gif")) return "image/gif";
  if (fileName.endsWith(".avif")) return "image/avif";
  return "image/jpeg";
}

export function createMediaResponse(request: Request, object: R2ObjectBody, fallbackContentType: string): Response {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", fallbackContentType);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, max-age=60");
  headers.set("ETag", object.httpEtag);

  let status = 200;
  if (request.headers.has("Range") && object.range && "offset" in object.range) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - offset;
    const partial = offset > 0 || length < object.size;
    headers.set("Content-Length", String(length));
    if (partial) {
      headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
      status = 206;
    }
  } else {
    headers.set("Content-Length", String(object.size));
  }

  return new Response(request.method === "HEAD" ? null : object.body, { status, headers });
}

type ReadableMediaSource = { source: "primary" | "library"; object: R2Object };

export async function resolveReadableMediaHead(env: MediaReadBindings, key: string): Promise<ReadableMediaSource | null> {
  const primary = await env.MEDIA_BUCKET.head(key);
  if (primary) return { source: "primary", object: primary };
  if (!env.MEDIA_LIBRARY_BUCKET) return null;
  const library = await env.MEDIA_LIBRARY_BUCKET.head(key);
  return library ? { source: "library", object: library } : null;
}

export async function headReadableMedia(env: MediaReadBindings, key: string): Promise<R2Object | null> {
  return (await resolveReadableMediaHead(env, key))?.object ?? null;
}

export async function getReadableMedia(env: MediaReadBindings, key: string, options?: R2GetOptions): Promise<R2ObjectBody | null> {
  const primary = await env.MEDIA_BUCKET.get(key, options);
  if (primary || !env.MEDIA_LIBRARY_BUCKET) return primary;
  return env.MEDIA_LIBRARY_BUCKET.get(key, options);
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
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function resolveHumanReviewedPhotoJobs(env: Bindings, assetId: string, reviewedRevision: number): Promise<void> {
  await env.DB.prepare(`UPDATE photo_ai_jobs SET status = 'completed', error_class = NULL, last_error = NULL,
    completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
    WHERE asset_id = ? AND operation = 'enrich' AND status = 'needs_review' AND asset_revision <= ?`)
    .bind(assetId, reviewedRevision).run();
}

function creatorProfileFromRow(row: Record<string, unknown>): CreatorProfile {
  return {
    id: String(row.user_id),
    slug: String(row.slug),
    name: String(row.display_name),
    headline: String(row.headline ?? ""),
    bio: String(row.bio ?? ""),
    location: String(row.location ?? ""),
    specialties: parseStringArray(row.specialties_json),
    websiteUrl: row.website_url == null ? null : String(row.website_url),
    assetCount: Number(row.asset_count ?? 0),
    publishedImageCount: Number(row.published_image_count ?? 0),
    reviewCount: Number(row.review_count ?? 0),
    collectionCount: Number(row.collection_count ?? 0),
    featuredAssetId: row.featured_asset_id == null ? null : String(row.featured_asset_id),
  };
}

function portfolioCollectionFromRow(row: Record<string, unknown>): PortfolioCollection {
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    description: String(row.description ?? ""),
    assetCount: Number(row.asset_count ?? 0),
    coverAssetId: row.cover_asset_id == null ? null : String(row.cover_asset_id),
    creator: { slug: String(row.creator_slug), name: String(row.creator_name) },
  };
}

const searchSchema = z.object({
  q: z.string().trim().max(240).default(""),
  kind: z.enum(["all", "image", "video"]).default("all"),
  location: z.string().trim().max(80).optional(),
  locationType: z.enum(["urban_street", "coastal_landscape", "market_scene", "indoor", "residential", "rural_landscape", "industrial", "event", "transport", "nature", "sports", "food", "other", "unknown"]).optional(),
  category: z.enum(["people", "lifestyle", "travel", "nature", "architecture", "food", "business", "transport", "arts_culture", "sport", "news_editorial", "objects", "other"]).optional(),
  verified: z.enum(["true"]).optional(),
  status: z.enum(["published", "needs_review", "all"]).default("published"),
});

const curationSchema = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().min(10).max(2000),
  theme: z.string().trim().min(2).max(100).default("Editorial selection"),
  location: z.string().trim().min(2).max(120).default("South Africa"),
  featuredLabel: z.string().trim().min(2).max(80).default("EDITOR'S PICK"),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  assetIds: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
});

const buyerApiKeySchema = z.object({ label: z.string().trim().min(3).max(120) });

async function publicBuyerOrganization(env: Bindings, request: Request): Promise<string | null> {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token || !token.startsWith("va_buyer_")) return null;
  const tokenHash = await sha256Hex(token);
  const key = await env.DB.prepare("SELECT id, organization_id FROM buyer_api_keys WHERE token_hash = ? AND status = 'active'").bind(tokenHash).first<{ id: string; organization_id: string }>();
  if (!key) return null;
  await env.DB.prepare("UPDATE buyer_api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").bind(key.id).run();
  return key.organization_id;
}

async function replaceCurationAssets(env: Bindings, table: "showcase_assets" | "collection_assets", parentColumn: "showcase_id" | "collection_id", parentId: string, organizationId: string, assetIds: string[]) {
  const uniqueIds = [...new Set(assetIds)];
  if (uniqueIds.length) {
    const placeholders = uniqueIds.map(() => "?").join(", ");
    const found = await env.DB.prepare(`SELECT id FROM assets WHERE organization_id = ? AND status = 'published' AND id IN (${placeholders})`).bind(organizationId, ...uniqueIds).all<{ id: string }>();
    if (found.results.length !== uniqueIds.length) throw new Error("Every curated asset must be a published asset in this organisation.");
  }
  const statements = [env.DB.prepare(`DELETE FROM ${table} WHERE ${parentColumn} = ?`).bind(parentId)];
  uniqueIds.forEach((assetId, sortOrder) => statements.push(env.DB.prepare(`INSERT INTO ${table} (${parentColumn}, asset_id, sort_order) VALUES (?, ?, ?)`).bind(parentId, assetId, sortOrder + 1)));
  await env.DB.batch(statements);
}

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
  return c.json({ results: (result.results as Record<string, unknown>[]).map((row) => assetRowToDomain(row, c.env)) });
});

const governanceActionSchema = contractGovernanceActionRequestSchema;

function governancePayloadEditsMetadata(payload: z.infer<typeof governanceActionSchema>): boolean {
  return [payload.title, payload.caption, payload.subjectTags, payload.culturalTags, payload.aiTags,
    payload.curatorNotes, payload.rightsStatus, payload.modelReleaseStatus, payload.propertyReleaseStatus,
    payload.monetizationModel, payload.licensePriceCents, payload.freeDownloadEnabled, payload.visualLocationType,
    payload.sceneContext, payload.primaryCategory, payload.sceneAttributes, payload.visibleText].some((value) => value !== undefined);
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
  if (payload.freeDownloadEnabled && exists.kind === "video") return c.json({ error: "Introductory free downloads are currently available for photos only" }, 422);
  if (payload.action === "run_ai_tagging") {
    return c.json({
      error: "AI enrichment runs once when a new image upload completes. Save a manual metadata correction for later changes.",
      code: "ai_enrichment_upload_only",
    }, 409);
  }
  if (payload.action === "approve" && governancePayloadEditsMetadata(payload)) {
    return c.json({ error: "Save the metadata correction before approving this revision", code: "review_revision_required" }, 422);
  }
  if (payload.action === "approve" && !archiveDomain.canApproveMetadataRevision({ assetRevision: exists.asset_revision, reviewedRevision: exists.reviewed_revision, metadataReviewStatus: exists.metadata_review_status as Asset["metadataReviewStatus"] })) {
    return c.json({ error: "The current metadata revision must be reviewed before approval", code: "review_revision_required" }, 422);
  }
  const stage = payload.action === "approve" ? "approval" : "curator_correction";
  const status = payload.action === "approve" ? "published" : payload.action === "reject" ? "rejected" : "needs_review";
  if (payload.action === "save_correction") {
    await c.env.DB.prepare(`UPDATE assets SET status = 'needs_review', workflow_stage = 'curator_correction',
      title = COALESCE(?, title), caption = COALESCE(?, caption), subject_tags = COALESCE(?, subject_tags),
      cultural_tags = COALESCE(?, cultural_tags), ai_tags = COALESCE(?, ai_tags), curator_notes = COALESCE(?, curator_notes),
      rights_status = COALESCE(?, rights_status), model_release_status = COALESCE(?, model_release_status),
      property_release_status = COALESCE(?, property_release_status), monetization_model = COALESCE(?, monetization_model),
      license_price_cents = CASE WHEN ? = 'individual_license' THEN ? WHEN ? IN ('membership', 'custom_quote') THEN NULL ELSE license_price_cents END,
      free_download_enabled = CASE WHEN ? IS NULL THEN free_download_enabled WHEN ? = 1 AND kind = 'image' THEN 1 ELSE 0 END,
      visual_location_type = COALESCE(?, visual_location_type), scene_context = COALESCE(?, scene_context), primary_category = COALESCE(?, primary_category),
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
         payload.freeDownloadEnabled === undefined ? null : payload.freeDownloadEnabled ? 1 : 0,
         payload.freeDownloadEnabled === undefined ? null : payload.freeDownloadEnabled ? 1 : 0,
        payload.visualLocationType ?? null, payload.sceneContext ?? null, payload.primaryCategory ?? null,
        payload.sceneAttributes ? JSON.stringify(payload.sceneAttributes) : null, payload.visibleText ?? null,
        assetId, actor.organizationId,
      ).run();
  } else if (payload.action === "approve") {
    await c.env.DB.prepare(`UPDATE assets SET status = 'published', workflow_stage = 'approval', human_verified = 1,
      description = CASE WHEN trim(description) = '' THEN COALESCE(json_extract(ai_metadata_suggestion_json, '$.description'), description) ELSE description END,
      caption = CASE WHEN trim(caption) = '' THEN COALESCE(json_extract(ai_metadata_suggestion_json, '$.description'), caption) ELSE caption END,
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
    .bind(crypto.randomUUID(), assetId, actor.id, payload.action === "save_correction" ? "curator_corrected" : payload.action === "approve" ? "approved" : "rejected", JSON.stringify({ ...payload, assetRevision: revisionRow?.asset_revision })).run();
  const auditAction = payload.action === "save_correction"
      ? "asset.metadata.reviewed"
      : payload.action === "approve"
        ? "asset.approved"
        : "asset.rejected";
  await appendAssetApprovalAudit(c, actor, {
    assetId,
    ownerId: exists.owner_id,
    action: auditAction,
    decision: payload.action,
    status,
    stage,
    assetRevision: revisionRow?.asset_revision ?? null,
    notes: payload.curatorNotes ?? null,
  });
  await c.env.DB.prepare(`UPDATE photo_ai_provenance SET reviewed_by = ?, review_outcome = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = (SELECT id FROM photo_ai_provenance WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1)`)
    .bind(actor.id, payload.action === "save_correction" ? "reviewed" : payload.action, assetId).run();
  await resolveHumanReviewedPhotoJobs(c.env, assetId, revisionRow?.asset_revision ?? exists.asset_revision);
  let indexing = "not_required";
  if ((payload.action === "approve" || payload.action === "reject") && exists.kind === "image") {
    indexing = (await enqueuePhotoJobBestEffort(c.env, assetId, "sync_index")) ? "index_sync_queued" : "index_sync_retry_pending";
  }
  if (payload.action === "approve" && exists.owner_id !== actor.id) {
    c.executionCtx.waitUntil(notify(c.env, actor.organizationId, exists.owner_id, { type: "asset_published", title: "Asset published", body: "Your submission was approved and is now published to the archive.", resourceType: "asset", resourceId: assetId }));
    c.executionCtx.waitUntil(dispatchWebhookEvent(c.env, actor.organizationId, "asset.published", { assetId }));
  } else if (payload.action === "reject" && exists.owner_id !== actor.id) {
    c.executionCtx.waitUntil(notify(c.env, actor.organizationId, exists.owner_id, { type: "asset_rejected", title: "Asset rejected", body: "Your submission was rejected during governance review.", resourceType: "asset", resourceId: assetId }));
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
  provider: z.enum(["paystack", "stripe_connect", "payfast", "za_bank"]),
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
  const existing = await c.env.DB.prepare("SELECT id FROM contributor_verification_cases WHERE contributor_id = ? AND organization_id = ? AND residency_region = ? AND status IN ('pending', 'in_review') ORDER BY created_at DESC LIMIT 1").bind(user.id, user.organizationId, residencyRegion).first<{ id: string }>();
  if (existing) return existing.id;
  const caseId = crypto.randomUUID();
  const retentionDays = Math.max(365, Number(c.env.AUDIT_RETENTION_DAYS ?? 2555));
  const retentionUntil = new Date(Date.now() + retentionDays * 86_400_000).toISOString();
  await c.env.DB.prepare("INSERT INTO contributor_verification_cases (id, organization_id, contributor_id, residency_region, subject_type, provider, retention_until) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(caseId, user.organizationId, user.id, residencyRegion, subjectType, c.env.KYC_PROVIDER ?? "configured-provider", retentionUntil).run();
  return caseId;
}

async function verifyFirmaSignature(env: Bindings, reference: string, signerEmail: string): Promise<boolean> {
  if (!env.FIRMA_VERIFY_URL || !env.FIRMA_API_TOKEN) return String(env.APP_ENV) !== "production";
  try {
    const response = await fetch(env.FIRMA_VERIFY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.FIRMA_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reference, signerEmail }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return false;
    const result = await response.json() as { verified?: boolean; signerEmail?: string };
    return result.verified === true && (!result.signerEmail || result.signerEmail.toLowerCase() === signerEmail.toLowerCase());
  } catch {
    return false;
  }
}

app.get("/api/onboarding/status", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const result = await c.env.DB.prepare(`
    SELECT p.*, sp.seller_type, sp.legal_name, sp.phone_e164, sp.identity_document_type,
      sp.bank_account_name, sp.cipc_status, sp.didit_status,
      t.id AS tender_id, t.status AS tender_status, t.review_notes,
      sc.id AS contract_id, sc.version AS contract_version, sc.content_sha256 AS contract_hash,
      sc.signed_at, w.id AS wallet_id, w.provider AS wallet_provider, w.status AS wallet_status,
      vc.id AS verification_case_id, vc.status AS verification_status
    FROM contributor_profiles p
    LEFT JOIN seller_onboarding_profiles sp ON sp.contributor_id = p.user_id
    LEFT JOIN onboarding_tenders t ON t.contributor_id = p.user_id AND t.organization_id = ? AND t.status IN ('pending', 'corrections_requested', 'approved')
    LEFT JOIN seller_contracts sc ON sc.id = t.contract_id
    LEFT JOIN payout_wallets w ON w.id = t.wallet_id
      LEFT JOIN contributor_verification_cases vc ON vc.id = t.verification_case_id AND vc.organization_id = t.organization_id AND vc.residency_region = ?
      WHERE p.user_id = ? ORDER BY t.created_at DESC LIMIT 1
  `).bind(user.organizationId, user.residencyRegion, user.id).first<Record<string, unknown>>();
  return c.json({ user, workflow: result ?? null });
});

app.post("/api/onboarding/wallet", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "admin"])) return c.json({ error: "Contributor access required" }, 403);
  const payload = walletSchema.parse(await c.req.json());
  if (payload.provider === "paystack" && (!payload.providerAccountId || !/^ACCT_[A-Za-z0-9]+$/.test(payload.providerAccountId))) return c.json({ error: "A valid Paystack subaccount code is required" }, 422);
  if (payload.provider === "stripe_connect" && !payload.providerAccountId) return c.json({ error: "Stripe connected account is required" }, 422);
  if (payload.provider === "payfast" && !payload.providerAccountId) return c.json({ error: "PayFast recipient reference is required" }, 422);
  const walletId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE payout_wallets SET status = 'disabled', updated_at = CURRENT_TIMESTAMP WHERE contributor_id = ? AND provider = ? AND status <> 'disabled'").bind(user.id, payload.provider),
    c.env.DB.prepare(`INSERT INTO payout_wallets (id, contributor_id, provider, provider_account_id, account_holder_name, account_last4, branch_last4, currency, artist_share_percentage, status, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '{}')`).bind(walletId, user.id, payload.provider, payload.providerAccountId ?? null, payload.accountHolderName, payload.accountLast4 ?? null, payload.branchLast4 ?? null, payload.currency, Math.min(99, Math.max(1, Number(c.env.DEFAULT_ARTIST_SHARE_PERCENTAGE ?? 60)))),
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
  const turnstile = await verifyTurnstileToken(c.env, payload.turnstileToken, "contributor-contract", c.get("trace").traceparent, c.req.header("CF-Connecting-IP"));
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
    organizationId: user.organizationId,
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
      LEFT JOIN contributor_verification_cases vc ON vc.id = t.verification_case_id AND vc.organization_id = t.organization_id AND vc.residency_region = ?
      LEFT JOIN payout_wallets w ON w.id = t.wallet_id
      WHERE t.organization_id = ? AND ${where} ORDER BY t.created_at ASC LIMIT 100
  `).bind(...(status === "all" ? [user.residencyRegion, user.organizationId] : [user.residencyRegion, user.organizationId, status])).all<Record<string, unknown>>();
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
    LEFT JOIN contributor_verification_cases vc ON vc.id = t.verification_case_id AND vc.organization_id = t.organization_id AND vc.residency_region = ? LEFT JOIN payout_wallets w ON w.id = t.wallet_id
    WHERE t.id = ? AND t.organization_id = ?`).bind(admin.residencyRegion, c.req.param("id"), admin.organizationId).first<Record<string, unknown>>();
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
  const actor: AuditActor = { id: admin.id, organizationId: admin.organizationId, type: "admin", residencyRegion: admin.residencyRegion };
  const audit = await appendAuditEvent(c.env, {
    streamId: `contributor:${String(tender.contributor_id)}`,
    actorId: admin.id,
    actorType: "admin",
    action: `seller.tender.${payload.decision}`,
    resourceType: "onboarding_tender",
    resourceId: c.req.param("id"),
    data: { decision: payload.decision, notes: payload.notes },
    organizationId: admin.organizationId,
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
  if (payload.freeDownloadEnabled && payload.kind !== "image") {
    return c.json({ error: "Introductory free downloads are currently available for photos only" }, 422);
  }
  const safetyIssue = metadataSafetyIssue(payload.culturalTags);
  if (safetyIssue) return c.json({ error: safetyIssue, code: "metadata_context_required" }, 422);
  if (payload.monetizationModel === "individual_license" && (!payload.licensePriceCents || payload.licensePriceCents < 100)) {
    return c.json({ error: "Individual licences must have a price of at least ZAR 1.00" }, 422);
  }
  const id = crypto.randomUUID();
  const geographicLocationSource = payload.province || payload.city || payload.locality || payload.landmark ? "seller" : "none";
  await c.env.DB.prepare(`INSERT INTO assets (id, organization_id, owner_id, kind, status, title, description, caption, province, city, locality, landmark, subject_tags, cultural_tags, rights_status, model_release_status, property_release_status, monetization_model, license_price_cents, free_download_enabled, workflow_stage, geographic_location_source)
    VALUES (
      ?, ?, ?, ?, 'needs_review',
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      'curator_correction', ?
    )`)
    .bind(id, user.organizationId, user.id, payload.kind, payload.title, payload.description, payload.caption, payload.province ?? null, payload.city ?? null, payload.locality ?? null, payload.landmark ?? null, JSON.stringify(payload.subjectTags), JSON.stringify(payload.culturalTags), payload.rightsStatus, payload.modelReleaseStatus, payload.propertyReleaseStatus, payload.monetizationModel, payload.monetizationModel === "individual_license" ? payload.licensePriceCents : null, payload.kind === "image" && payload.freeDownloadEnabled ? 1 : 0, geographicLocationSource).run();
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
    freeDownloadEnabled: payload.freeDownloadEnabled !== undefined ? payload.freeDownloadEnabled : Boolean(current.free_download_enabled),
  };
  if (next.monetizationModel === "individual_license" && (!next.licensePriceCents || next.licensePriceCents < 100)) {
    return c.json({ error: "Individual licences must have a price of at least ZAR 1.00" }, 422);
  }
  if (next.freeDownloadEnabled && next.kind !== "image") return c.json({ error: "Introductory free downloads are currently available for photos only" }, 422);
  const safetyIssue = metadataSafetyIssue((next.culturalTags ?? []) as string[]);
  if (safetyIssue) return c.json({ error: safetyIssue, code: "metadata_context_required" }, 422);
  const locationWasEdited = payload.province !== undefined || payload.city !== undefined || payload.locality !== undefined || payload.landmark !== undefined;
  await c.env.DB.prepare(`UPDATE assets SET kind = ?, title = ?, description = ?, caption = ?, province = ?, city = ?, locality = ?, landmark = ?, subject_tags = ?, cultural_tags = ?, rights_status = ?, model_release_status = ?, property_release_status = ?, monetization_model = ?, license_price_cents = ?, free_download_enabled = ?,
    geographic_location_source = CASE WHEN ? = 1 THEN 'seller' ELSE geographic_location_source END,
    asset_revision = asset_revision + 1, reviewed_revision = NULL, approved_revision = NULL, human_verified = 0,
    status = 'needs_review', workflow_stage = 'curator_correction', metadata_review_status = 'needs_context',
    metadata_review_note = 'Seller metadata changed; review the current revision before publication.',
    vector_index_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`)
    .bind(next.kind, next.title, next.description ?? "", next.caption ?? "", next.province ?? null, next.city ?? null, next.locality ?? null, next.landmark ?? null, JSON.stringify(next.subjectTags ?? []), JSON.stringify(next.culturalTags ?? []), next.rightsStatus ?? "pending", next.modelReleaseStatus ?? "unknown", next.propertyReleaseStatus ?? "unknown", next.monetizationModel ?? "membership", next.monetizationModel === "individual_license" ? next.licensePriceCents : null, next.kind === "image" && next.freeDownloadEnabled ? 1 : 0, locationWasEdited ? 1 : 0, id, user.organizationId).run();
  return c.json({ ok: true, id });
});

app.get("/api/my/assets", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const result = await c.env.DB.prepare("SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id WHERE a.organization_id = ? AND a.owner_id = ? ORDER BY a.updated_at DESC").bind(user.organizationId, user.id).all<Record<string, unknown>>();
  return c.json({ results: (result.results as Record<string, unknown>[]).map((row) => assetRowToDomain(row, c.env)) });
});

const metadataEventSummaries: Record<string, string> = {
  ai_tagged: "AI enrichment suggested new metadata for review.",
  curator_corrected: "A curator or contributor saved a metadata correction.",
  approved: "This revision was approved and published.",
  rejected: "This revision was rejected.",
};

app.get("/api/assets/:id/versions", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const asset = await c.env.DB.prepare("SELECT id, owner_id FROM assets WHERE id = ? AND organization_id = ?").bind(c.req.param("id"), user.organizationId).first<{ id: string; owner_id: string }>();
  if (!asset) return c.json({ error: "Asset not found" }, 404);
  if (asset.owner_id !== user.id && !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Forbidden" }, 403);
  const rows = await c.env.DB.prepare(`SELECT e.id, e.event_type, e.payload, e.created_at, u.display_name AS actor_name
    FROM metadata_events e JOIN users u ON u.id = e.actor_id WHERE e.asset_id = ? ORDER BY e.created_at DESC LIMIT 100`).bind(c.req.param("id")).all<Record<string, unknown>>();
  return c.json({ assetId: c.req.param("id"), results: rows.results.map((row) => {
    let assetRevision: number | null = null;
    try { assetRevision = Number((JSON.parse(String(row.payload ?? "{}")) as { assetRevision?: number }).assetRevision ?? null) || null; } catch { assetRevision = null; }
    return { id: String(row.id), assetRevision, eventType: row.event_type, actorName: String(row.actor_name), createdAt: String(row.created_at), summary: metadataEventSummaries[String(row.event_type)] ?? String(row.event_type) };
  }) });
});

app.get("/api/admin/review", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Editor access required" }, 403);
  const result = await c.env.DB.prepare("SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id WHERE a.organization_id = ? AND a.status IN ('needs_review', 'processing') ORDER BY a.authenticity_confidence DESC, a.created_at ASC LIMIT 100").bind(user.organizationId).all<Record<string, unknown>>();
  return c.json({ results: (result.results as Record<string, unknown>[]).map((row) => assetRowToDomain(row, c.env)) });
});

const editorialReviewSchema = z.object({ decision: z.enum(["approved", "rejected", "needs_changes", "withdrawn"]), notes: z.string().trim().max(2000).default("") });

app.post("/api/admin/assets/:id/review", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Editor access required" }, 403);
  const payload = editorialReviewSchema.parse(await c.req.json());
  const asset = await c.env.DB.prepare(`SELECT id, kind, owner_id, asset_revision, reviewed_revision, metadata_review_status
    FROM assets WHERE id = ? AND organization_id = ?`).bind(c.req.param("id"), user.organizationId)
    .first<{ id: string; kind: "image" | "video"; owner_id: string; asset_revision: number; reviewed_revision: number | null; metadata_review_status: string }>();
  if (!asset) return c.json({ error: "Asset not found" }, 404);
  if (payload.decision === "approved" && !archiveDomain.canApproveMetadataRevision({ assetRevision: asset.asset_revision, reviewedRevision: asset.reviewed_revision, metadataReviewStatus: asset.metadata_review_status as Asset["metadataReviewStatus"] })) {
    return c.json({ error: "Save a correction for the current metadata revision before approval", code: "review_revision_required" }, 422);
  }
  const status = payload.decision === "approved" ? "published" : payload.decision === "withdrawn" ? "withdrawn" : payload.decision === "rejected" ? "rejected" : "needs_review";
  if (payload.decision === "approved") {
    await c.env.DB.prepare(`UPDATE assets SET status = 'published', workflow_stage = 'approval', human_verified = 1,
      description = CASE WHEN trim(description) = '' THEN COALESCE(json_extract(ai_metadata_suggestion_json, '$.description'), description) ELSE description END,
      caption = CASE WHEN trim(caption) = '' THEN COALESCE(json_extract(ai_metadata_suggestion_json, '$.description'), caption) ELSE caption END,
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
  await appendAssetApprovalAudit(c, user, {
    assetId: asset.id,
    ownerId: asset.owner_id,
    action: payload.decision === "approved" ? "asset.approved" : payload.decision === "needs_changes" ? "asset.changes_requested" : "asset.rejected",
    decision: payload.decision,
    status,
    stage: payload.decision === "approved" ? "approval" : "curator_correction",
    assetRevision: asset.asset_revision,
    notes: payload.notes,
  });
  await c.env.DB.prepare(`UPDATE photo_ai_provenance SET reviewed_by = ?, review_outcome = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = (SELECT id FROM photo_ai_provenance WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1)`)
    .bind(user.id, payload.decision, asset.id).run();
  await resolveHumanReviewedPhotoJobs(c.env, asset.id, asset.asset_revision);
  const indexing = asset.kind === "image" && payload.decision !== "needs_changes"
    ? (await enqueuePhotoJobBestEffort(c.env, asset.id, "sync_index") ? "index_sync_queued" : "index_sync_retry_pending")
    : "not_required";
  if (asset.owner_id !== user.id) {
    if (payload.decision === "approved") {
      c.executionCtx.waitUntil(notify(c.env, user.organizationId, asset.owner_id, { type: "asset_published", title: "Asset published", body: "Your submission was approved and is now published to the archive.", resourceType: "asset", resourceId: asset.id }));
      c.executionCtx.waitUntil(dispatchWebhookEvent(c.env, user.organizationId, "asset.published", { assetId: asset.id }));
    } else if (payload.decision === "rejected" || payload.decision === "needs_changes") {
      c.executionCtx.waitUntil(notify(c.env, user.organizationId, asset.owner_id, { type: "asset_review", title: payload.decision === "rejected" ? "Asset rejected" : "Changes requested", body: payload.notes || "An editor reviewed your submission.", resourceType: "asset", resourceId: asset.id }));
    }
  }
  return c.json({ ok: true, status, indexing });
});

const licenceRequestSchema: z.ZodType<LicenceRequest> = contractLicenceRequestSchema;
const checkoutRequestSchema = contractLicenceRequestSchema.extend({
  buyerAgreementVersion: z.literal(buyerAgreement.version),
  paymentAgreementVersion: z.literal(paymentDisclosure.version),
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
  const priceCents = licencePriceCents(request, asset);
  return c.json({
    assetId: request.assetId,
    licenceType: request.licenceType,
    licence: archiveDomain.licenceDescription(request.licenceType),
    priceCents,
    currency: "ZAR",
    monetizationModel: asset.monetizationModel ?? "membership",
    purchase: { paymentRequired: true, paymentStatus: "not_charged_until_verified_checkout", originalAccess: "released_after_paid_webhook" },
    ...archiveDomain.evaluateLicenceRequest(asset, request),
  });
});

const buyerAutoApprovalPreferenceSchema = z.object({
  enabled: z.boolean(),
  acknowledged: z.boolean(),
  termsVersion: z.string().trim().min(1).max(80),
});

type BuyerAutoApprovalPreferenceRow = {
  id: string;
  organization_id: string;
  buyer_id: string;
  enabled: number;
  terms_version: string;
  signed_at: string | null;
  signed_by: string | null;
  revoked_at: string | null;
  updated_at: string;
};

function buyerAutoApprovalPreferenceResponse(row: BuyerAutoApprovalPreferenceRow | null) {
  return {
    enabled: Boolean(row?.enabled && row.terms_version === AUTO_APPROVAL_TERMS_VERSION && row.signed_at && row.signed_by),
    termsVersion: row?.terms_version ?? AUTO_APPROVAL_TERMS_VERSION,
    signedAt: row?.signed_at ?? null,
    signedBy: row?.signed_by ?? null,
    revokedAt: row?.revoked_at ?? null,
    updatedAt: row?.updated_at ?? null,
    scope: AUTO_APPROVAL_SCOPE,
    policy: {
      acceptsAfterValidation: true,
      paymentStillRequired: true,
      appliesTo: "This buyer's new licence requests in this organisation",
    },
  };
}

app.get("/api/buyer/licence-auto-approval", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["buyer", "admin"])) return c.json({ error: "Buyer access required" }, 403);
  const row = await c.env.DB.prepare(`SELECT id, organization_id, buyer_id, enabled, terms_version, signed_at, signed_by, revoked_at, updated_at
    FROM buyer_licence_approval_preferences WHERE organization_id = ? AND buyer_id = ?`)
    .bind(user.organizationId, user.id).first<BuyerAutoApprovalPreferenceRow>();
  return c.json(buyerAutoApprovalPreferenceResponse(row ?? null));
});

app.put("/api/buyer/licence-auto-approval", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["buyer", "admin"])) return c.json({ error: "Buyer access required" }, 403);
  const payload = buyerAutoApprovalPreferenceSchema.parse(await c.req.json());
  if (payload.enabled && (!payload.acknowledged || payload.termsVersion !== AUTO_APPROVAL_TERMS_VERSION)) {
    return c.json({ error: "Current auto-approval terms must be acknowledged before enabling this setting" }, 422);
  }

  const previous = await c.env.DB.prepare(`SELECT id, organization_id, buyer_id, enabled, terms_version, signed_at, signed_by, revoked_at, updated_at
    FROM buyer_licence_approval_preferences WHERE organization_id = ? AND buyer_id = ?`)
    .bind(user.organizationId, user.id).first<BuyerAutoApprovalPreferenceRow>();
  const preferenceId = previous?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const signedAt = payload.enabled ? now : previous?.signed_at ?? null;
  const signedBy = payload.enabled ? user.id : previous?.signed_by ?? null;
  const revokedAt = payload.enabled ? null : now;

  await c.env.DB.prepare(`INSERT INTO buyer_licence_approval_preferences
      (id, organization_id, buyer_id, enabled, terms_version, signed_at, signed_by, revoked_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(organization_id, buyer_id) DO UPDATE SET
      enabled = excluded.enabled,
      terms_version = excluded.terms_version,
      signed_at = excluded.signed_at,
      signed_by = excluded.signed_by,
      revoked_at = excluded.revoked_at,
      updated_at = excluded.updated_at`)
    .bind(preferenceId, user.organizationId, user.id, payload.enabled ? 1 : 0, AUTO_APPROVAL_TERMS_VERSION, signedAt, signedBy, revokedAt, now).run();

  let auditEventId: string;
  let auditSource: "signed_audit" | "operational_audit" = "signed_audit";
  try {
    const audit = await appendAuditEvent(c.env, {
      streamId: `org:${user.organizationId}:buyer-settings`,
      actorId: user.id,
      actorType: "user",
      action: payload.enabled ? "buyer.licence_auto_approval.enabled" : "buyer.licence_auto_approval.disabled",
      resourceType: "buyer_licence_approval_preference",
      resourceId: preferenceId,
      data: { enabled: payload.enabled, termsVersion: AUTO_APPROVAL_TERMS_VERSION, scope: AUTO_APPROVAL_SCOPE, signedAt, signedBy },
      residencyRegion: user.residencyRegion,
      actorResidencyRegion: user.residencyRegion,
      organizationId: user.organizationId,
    });
    auditEventId = audit.event.eventId;
  } catch (error) {
    try {
      auditEventId = crypto.randomUUID();
      await c.env.DB.prepare("INSERT INTO ops_actions (id, organization_id, actor_id, action, resource_type, resource_id, status, details_json) VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)")
        .bind(auditEventId, user.organizationId, user.id, payload.enabled ? "buyer.licence_auto_approval.enabled" : "buyer.licence_auto_approval.disabled", "buyer_licence_approval_preference", preferenceId, JSON.stringify({ enabled: payload.enabled, termsVersion: AUTO_APPROVAL_TERMS_VERSION, scope: AUTO_APPROVAL_SCOPE, signedAt, signedBy, auditFallback: true })).run();
      auditSource = "operational_audit";
      logEvent("warn", "buyer.licence_auto_approval_signed_audit_unavailable", c.get("trace"), { preferenceId, error: error instanceof Error ? error.message : "unknown" });
    } catch (fallbackError) {
      if (previous) {
        await c.env.DB.prepare(`UPDATE buyer_licence_approval_preferences SET enabled = ?, terms_version = ?, signed_at = ?, signed_by = ?, revoked_at = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND buyer_id = ?`)
          .bind(previous.enabled, previous.terms_version, previous.signed_at, previous.signed_by, previous.revoked_at, previous.updated_at, previous.id, user.organizationId, user.id).run();
      } else {
        await c.env.DB.prepare("DELETE FROM buyer_licence_approval_preferences WHERE id = ? AND organization_id = ? AND buyer_id = ?")
          .bind(preferenceId, user.organizationId, user.id).run();
      }
      logEvent("error", "buyer.licence_auto_approval_audit_failed", c.get("trace"), { preferenceId, error: fallbackError instanceof Error ? fallbackError.message : "unknown" });
      return c.json({ error: "The sign-off could not be recorded. Auto-approval remains unchanged." }, 503);
    }
  }

  const row = await c.env.DB.prepare(`SELECT id, organization_id, buyer_id, enabled, terms_version, signed_at, signed_by, revoked_at, updated_at
    FROM buyer_licence_approval_preferences WHERE id = ? AND organization_id = ? AND buyer_id = ?`)
    .bind(preferenceId, user.organizationId, user.id).first<BuyerAutoApprovalPreferenceRow>();
  return c.json({ ...buyerAutoApprovalPreferenceResponse(row ?? null), auditEventId, auditSource });
});

app.get("/api/admin/licence-approvals", async (c) => {
  const admin = await requestUser(c);
  if (!admin || !allowedRole(admin, ["admin"])) return c.json({ error: "Admin access required" }, 403);
  const preferences = await c.env.DB.prepare(`SELECT p.id, p.buyer_id, p.enabled, p.terms_version, p.signed_at, p.signed_by, p.revoked_at, p.updated_at,
      buyer.display_name AS buyer_name, buyer.email AS buyer_email, signer.display_name AS signer_name
    FROM buyer_licence_approval_preferences p
      JOIN users buyer ON buyer.id = p.buyer_id
      LEFT JOIN users signer ON signer.id = p.signed_by
    WHERE p.organization_id = ? ORDER BY p.updated_at DESC`).bind(admin.organizationId).all<Record<string, unknown>>();
  const requests = await c.env.DB.prepare(`SELECT l.id, l.asset_id, l.buyer_id, l.licence_type, l.territory, l.duration_days, l.price_cents, l.status,
      l.approval_status, l.approval_method, l.approved_at, l.created_at, buyer.display_name AS buyer_name, buyer.email AS buyer_email,
      a.title AS asset_title
    FROM licences l JOIN users buyer ON buyer.id = l.buyer_id JOIN assets a ON a.id = l.asset_id
    WHERE l.organization_id = ? AND l.approval_method = 'buyer_auto_approval'
    ORDER BY l.created_at DESC LIMIT 250`).bind(admin.organizationId).all<Record<string, unknown>>();
  const operationalAudits = await c.env.DB.prepare(`SELECT id, action, resource_id, status, details_json, created_at
    FROM ops_actions WHERE organization_id = ? AND action LIKE 'buyer.licence_auto_approval.%' ORDER BY created_at DESC LIMIT 250`).bind(admin.organizationId).all<Record<string, unknown>>();
  const enabledCount = (preferences.results as Record<string, unknown>[]).filter((row) => Number(row.enabled) === 1).length;
  const requestRows = requests.results as Record<string, unknown>[];
  return c.json({
    organization: { id: admin.organizationId, name: admin.organizationName },
    summary: {
      buyerPreferences: preferences.results.length,
      enabledBuyers: enabledCount,
      autoApprovedRequests: requestRows.length,
      unpaidAutoApprovedRequests: requestRows.filter((row) => row.status !== "paid").length,
      paidAutoApprovedRequests: requestRows.filter((row) => row.status === "paid").length,
    },
    preferences: preferences.results.map((row) => ({
      id: String(row.id), buyerId: String(row.buyer_id), buyerName: String(row.buyer_name), buyerEmail: String(row.buyer_email), enabled: Number(row.enabled) === 1,
      termsVersion: String(row.terms_version), signedAt: row.signed_at ? String(row.signed_at) : null, signedBy: row.signed_by ? String(row.signed_by) : null, signerName: row.signer_name ? String(row.signer_name) : null,
      revokedAt: row.revoked_at ? String(row.revoked_at) : null, updatedAt: String(row.updated_at), auditFallbackEvents: operationalAudits.results.filter((audit) => String(audit.resource_id) === String(row.id)).length,
    })),
    autoApprovedRequests: requestRows.map((row) => ({
      id: String(row.id), assetId: String(row.asset_id), assetTitle: String(row.asset_title), buyerId: String(row.buyer_id), buyerName: String(row.buyer_name), buyerEmail: String(row.buyer_email),
      licenceType: String(row.licence_type), territory: String(row.territory), durationDays: Number(row.duration_days), priceCents: Number(row.price_cents), status: String(row.status), approvalStatus: String(row.approval_status), approvalMethod: String(row.approval_method), approvedAt: row.approved_at ? String(row.approved_at) : null, createdAt: String(row.created_at),
    })),
    operationalAuditEvents: operationalAudits.results.map((row) => ({ id: String(row.id), action: String(row.action), resourceId: String(row.resource_id), status: String(row.status), createdAt: String(row.created_at) })),
  });
});

app.post("/api/checkout", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["buyer", "contributor", "editor", "admin"])) return c.json({ error: "Authenticated buyer required" }, 401);
  const request = checkoutRequestSchema.parse(await c.req.json());
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
  const existing = await c.env.DB.prepare(`SELECT id, price_cents FROM licences
    WHERE organization_id = ? AND asset_id = ? AND buyer_id = ? AND licence_type = ? AND territory = ? AND duration_days = ? AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1`).bind(user.organizationId, request.assetId, user.id, request.licenceType, request.territory, request.durationDays).first<{ id: string; price_cents: number }>();
  const acceptedAt = new Date().toISOString();
  const buyerTermsHash = await sha256Hex(agreementText(buyerAgreement));
  const paymentTermsHash = await sha256Hex(agreementText(paymentDisclosure));
  if (existing) {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT OR IGNORE INTO marketplace_agreement_acceptances (id, organization_id, user_id, agreement_type, agreement_version, terms_sha256, context_type, context_id, accepted_at) VALUES (?, ?, ?, 'buyer', ?, ?, 'checkout', ?, ?)").bind(crypto.randomUUID(), user.organizationId, user.id, buyerAgreement.version, buyerTermsHash, existing.id, acceptedAt),
      c.env.DB.prepare("INSERT OR IGNORE INTO marketplace_agreement_acceptances (id, organization_id, user_id, agreement_type, agreement_version, terms_sha256, context_type, context_id, accepted_at) VALUES (?, ?, ?, 'payment', ?, ?, 'checkout', ?, ?)").bind(crypto.randomUUID(), user.organizationId, user.id, paymentDisclosure.version, paymentTermsHash, existing.id, acceptedAt),
    ]);
    return c.json({ blocked: false, licenceId: existing.id, licenceType: request.licenceType, licence: archiveDomain.licenceDescription(request.licenceType), priceCents: Number(existing.price_cents), currency: "ZAR", paymentRequired: true, purchaseStatus: "not_charged_until_verified_checkout", existing: true, agreementsPersisted: true, ...validation }, 200);
  }
  const preference = await c.env.DB.prepare(`SELECT id, enabled, terms_version, signed_at, signed_by
    FROM buyer_licence_approval_preferences WHERE organization_id = ? AND buyer_id = ?`)
    .bind(user.organizationId, user.id).first<{ id: string; enabled: number; terms_version: string; signed_at: string | null; signed_by: string | null }>();
  const preferenceForDecision = preference ? {
    enabled: Boolean(preference.enabled),
    termsVersion: preference.terms_version,
    signedAt: preference.signed_at,
    signedBy: preference.signed_by,
  } : null;
  const autoApproved = autoApprovalIsActive(preferenceForDecision);
  const approvalStatus = licenceApprovalStatus(autoApproved);
  let approvalAuditEventId: string | null = null;
  let approvalAuditSource: "signed_audit" | "operational_audit" | null = null;
  if (autoApproved) {
    try {
      const audit = await appendAuditEvent(c.env, {
        streamId: `org:${user.organizationId}:licence-approvals`,
        actorId: user.id,
        actorType: "user",
        action: "buyer.licence_auto_approval.applied",
        resourceType: "licence",
        resourceId: licenceId,
        data: { approvalStatus, preferenceId: preference?.id, paymentRequired: true, termsVersion: AUTO_APPROVAL_TERMS_VERSION },
        residencyRegion: user.residencyRegion,
        actorResidencyRegion: user.residencyRegion,
        organizationId: user.organizationId,
      });
      approvalAuditEventId = audit.event.eventId;
      approvalAuditSource = "signed_audit";
    } catch (error) {
      approvalAuditEventId = crypto.randomUUID();
      try {
        await c.env.DB.prepare("INSERT INTO ops_actions (id, organization_id, actor_id, action, resource_type, resource_id, status, details_json) VALUES (?, ?, ?, 'buyer.licence_auto_approval.applied', 'licence', ?, 'completed', ?)")
          .bind(approvalAuditEventId, user.organizationId, user.id, licenceId, JSON.stringify({ approvalStatus, preferenceId: preference?.id, paymentRequired: true, termsVersion: AUTO_APPROVAL_TERMS_VERSION, auditFallback: true })).run();
        approvalAuditSource = "operational_audit";
        logEvent("warn", "buyer.licence_auto_approval_signed_audit_unavailable", c.get("trace"), { licenceId, preferenceId: preference?.id, error: error instanceof Error ? error.message : "unknown" });
      } catch (fallbackError) {
        logEvent("error", "buyer.licence_auto_approval_apply_failed", c.get("trace"), { licenceId, preferenceId: preference?.id, error: fallbackError instanceof Error ? fallbackError.message : "unknown" });
        return c.json({ error: "Auto-approval could not be recorded. No licence request was created." }, 503);
      }
    }
  }
  await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO licences
      (id, organization_id, asset_id, buyer_id, licence_type, territory, duration_days, price_cents, approval_status, approval_method, approved_at, approved_by, auto_approval_preference_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(licenceId, user.organizationId, request.assetId, user.id, request.licenceType, request.territory, request.durationDays, priceCents, approvalStatus, autoApproved ? "buyer_auto_approval" : null, autoApproved ? new Date().toISOString() : null, autoApproved ? user.id : null, autoApproved ? preference?.id ?? null : null),
    c.env.DB.prepare("INSERT INTO marketplace_agreement_acceptances (id, organization_id, user_id, agreement_type, agreement_version, terms_sha256, context_type, context_id, accepted_at) VALUES (?, ?, ?, 'buyer', ?, ?, 'checkout', ?, ?)").bind(crypto.randomUUID(), user.organizationId, user.id, buyerAgreement.version, buyerTermsHash, licenceId, acceptedAt),
    c.env.DB.prepare("INSERT INTO marketplace_agreement_acceptances (id, organization_id, user_id, agreement_type, agreement_version, terms_sha256, context_type, context_id, accepted_at) VALUES (?, ?, ?, 'payment', ?, ?, 'checkout', ?, ?)").bind(crypto.randomUUID(), user.organizationId, user.id, paymentDisclosure.version, paymentTermsHash, licenceId, acceptedAt),
  ]);
  return c.json({ blocked: false, licenceId, licenceType: request.licenceType, licence: archiveDomain.licenceDescription(request.licenceType), priceCents, currency: "ZAR", paymentRequired: true, purchaseStatus: "not_charged_until_verified_checkout", agreementsPersisted: true, approvalStatus, approvalAuditEventId, approvalAuditSource, ...validation }, 201);
});

const paymentSessionSchema = z.object({
  successUrl: z.string().url().max(2048),
  cancelUrl: z.string().url().max(2048),
});

app.post("/api/payments/:licenceId/session", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["buyer", "contributor", "editor", "admin"])) return c.json({ error: "Authenticated buyer required" }, 401);
  if (!licencePaymentProviderConfigured(c.env)) return c.json({ error: "Payment provider is not configured" }, 503);
  const payload = paymentSessionSchema.parse(await c.req.json());
  const licence = await c.env.DB.prepare(`
    SELECT l.id, l.price_cents, l.status, l.payment_reference, u.email, a.owner_id,
      w.provider AS wallet_provider, w.provider_account_id, w.artist_share_percentage, w.status AS wallet_status,
      (SELECT COUNT(*) FROM marketplace_agreement_acceptances maa
       WHERE maa.user_id = l.buyer_id AND maa.context_type = 'checkout' AND maa.context_id = l.id
         AND ((maa.agreement_type = 'buyer' AND maa.agreement_version = ?) OR (maa.agreement_type = 'payment' AND maa.agreement_version = ?))) AS agreement_count
    FROM licences l JOIN users u ON u.id = l.buyer_id JOIN assets a ON a.id = l.asset_id
    LEFT JOIN payout_wallets w ON w.contributor_id = a.owner_id AND w.provider = 'paystack' AND w.status = 'verified'
    WHERE l.id = ? AND l.organization_id = ? AND l.buyer_id = ?
  `).bind(buyerAgreement.version, paymentDisclosure.version, c.req.param("licenceId"), user.organizationId, user.id).first<{ id: string; price_cents: number; status: string; payment_reference: string | null; email: string; owner_id: string; wallet_provider: string | null; provider_account_id: string | null; artist_share_percentage: number | null; wallet_status: string | null; agreement_count: number }>();
  if (!licence) return c.json({ error: "Licence not found" }, 404);
  if (licence.status !== "pending") return c.json({ error: `Licence cannot be paid from status ${licence.status}` }, 409);
  if (Number(licence.agreement_count) !== 2) return c.json({ error: "Current buyer and payment terms must be accepted before payment" }, 409);
  if (c.env.PAYMENT_PROVIDER === "paystack" && (licence.wallet_provider !== "paystack" || licence.wallet_status !== "verified" || !licence.provider_account_id)) {
    return c.json({ error: "The seller does not have a verified Paystack subaccount; checkout cannot safely split settlement" }, 409);
  }
  const allocation = c.env.PAYMENT_PROVIDER === "paystack"
    ? calculateMarketplaceSplit(Number(licence.price_cents), Number(licence.artist_share_percentage ?? c.env.DEFAULT_ARTIST_SHARE_PERCENTAGE ?? 60))
    : null;
  const integrations = new IntegrationContainer(c.env);
  try {
    const session = await integrations.payments.get(c.env.PAYMENT_PROVIDER!).createCheckoutSession({
      idempotencyKey: `licence:${licence.id}`,
      licenceId: licence.id,
      amountCents: Number(licence.price_cents),
      currency: "ZAR",
      buyer: { id: user.id, email: licence.email },
      successUrl: payload.successUrl,
      cancelUrl: payload.cancelUrl,
      metadata: { organizationId: user.organizationId, userId: user.id, productType: "licence", licenceId: licence.id },
      ...(allocation && licence.provider_account_id ? { split: { type: "percentage" as const, bearerType: String(c.env.PAYSTACK_SPLIT_FEE_BEARER) === "subaccount" ? "subaccount" as const : "account" as const, subaccounts: [{ subaccount: licence.provider_account_id, share: allocation.artistSharePercentage }] } } : {}),
    });
    const providerReference = session.providerReference ?? session.id;
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE licences SET payment_provider = ?, payment_reference = COALESCE(payment_reference, ?) WHERE id = ? AND organization_id = ? AND status = 'pending'").bind(c.env.PAYMENT_PROVIDER, providerReference, licence.id, user.organizationId),
      ...(allocation && licence.provider_account_id ? [c.env.DB.prepare(`INSERT INTO payment_split_allocations
        (id, licence_id, provider, provider_reference, contributor_id, provider_account_id, artist_share_percentage, artist_amount_cents, platform_amount_cents, currency)
        VALUES (?, ?, 'paystack', ?, ?, ?, ?, ?, ?, 'ZAR')
        ON CONFLICT(licence_id) DO UPDATE SET provider_reference = excluded.provider_reference, contributor_id = excluded.contributor_id, provider_account_id = excluded.provider_account_id, artist_share_percentage = excluded.artist_share_percentage, artist_amount_cents = excluded.artist_amount_cents, platform_amount_cents = excluded.platform_amount_cents, status = 'configured', updated_at = CURRENT_TIMESTAMP`)
        .bind(crypto.randomUUID(), licence.id, providerReference, licence.owner_id, licence.provider_account_id, allocation.artistSharePercentage, allocation.artistAmountCents, allocation.platformAmountCents)] : []),
    ]);
    return c.json({ licenceId: licence.id, provider: session.provider, checkoutUrl: session.checkoutUrl, status: session.status, split: allocation }, 201, { Location: `/api/payments/${licence.id}/session` });
  } catch (error) {
    logEvent("error", "payment.checkout_session_failed", c.get("trace"), { licenceId: licence.id, provider: c.env.PAYMENT_PROVIDER, error: error instanceof Error ? error.message : "unknown" });
    return c.json({ error: "Payment provider could not create a checkout session" }, 503);
  }
});

const settlementSchema = z.object({
  amountCents: z.number().int().positive().max(100_000_000),
  currency: z.string().length(3).default("ZAR"),
  provider: z.string().trim().min(2).max(80).optional(),
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
  const allocation = payload.provider?.toLowerCase() === "paystack"
    ? await env.DB.prepare("SELECT provider, currency, artist_amount_cents AS artistAmountCents, platform_amount_cents AS platformAmountCents, status FROM payment_split_allocations WHERE licence_id = ?").bind(licenceId).first<{ provider: string; currency: string; artistAmountCents: number; platformAmountCents: number; status: string | null }>()
    : null;
  const amounts = settlementAmounts({ ...payload, allocation });
  const fee = amounts.platformFeeCents;
  const royalty = amounts.royaltyCents;
  const transactionId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO ledger_transactions (id, licence_id, transaction_type, idempotency_key, amount_cents, currency) VALUES (?, ?, 'sale', ?, ?, ?)").bind(transactionId, licenceId, payload.idempotencyKey, payload.amountCents, payload.currency.toUpperCase()),
    env.DB.prepare("INSERT INTO ledger_postings (id, transaction_id, account_code, debit_cents, credit_cents, metadata_json) VALUES (?, ?, 'cash_clearing', ?, 0, '{}')").bind(crypto.randomUUID(), transactionId, payload.amountCents),
    env.DB.prepare("INSERT INTO ledger_postings (id, transaction_id, account_code, contributor_id, debit_cents, credit_cents, metadata_json) VALUES (?, ?, 'contributor_payable', ?, 0, ?, ?)").bind(crypto.randomUUID(), transactionId, licence.owner_id, royalty, JSON.stringify({ licenceId })),
    env.DB.prepare("INSERT INTO ledger_postings (id, transaction_id, account_code, debit_cents, credit_cents, metadata_json) VALUES (?, ?, 'platform_revenue', 0, ?, '{}')").bind(crypto.randomUUID(), transactionId, fee),
    ...(amounts.taxCents > 0 ? [env.DB.prepare("INSERT INTO ledger_postings (id, transaction_id, account_code, debit_cents, credit_cents, metadata_json) VALUES (?, ?, 'tax_payable', 0, ?, '{}')").bind(crypto.randomUUID(), transactionId, amounts.taxCents)] : []),
    env.DB.prepare("INSERT INTO ledger_entries (id, licence_id, contributor_id, entry_type, amount_cents, currency) VALUES (?, ?, ?, 'sale', ?, ?), (?, ?, ?, 'platform_fee', ?, ?)").bind(crypto.randomUUID(), licenceId, licence.owner_id, royalty, payload.currency.toUpperCase(), crypto.randomUUID(), licenceId, licence.owner_id, -fee, payload.currency.toUpperCase()),
    env.DB.prepare("UPDATE licences SET status = 'paid', price_cents = ? WHERE id = ?").bind(payload.amountCents, licenceId),
  ]);
  return { transactionId, idempotent: false };
}

/**
 * Complete a licence in the explicitly non-production demo environment.
 * This is a server-side simulation of the same settlement path used by a
 * signed provider webhook; no browser redirect is treated as payment proof.
 */
app.get("/api/demo/payments/:licenceId/complete", async (c) => {
  if (!demoPaymentEnabled(c.env)) return c.json({ error: "Demo checkout is disabled" }, 404);
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["buyer", "admin"])) return c.json({ error: "Buyer access required" }, user ? 403 : 401);
  const licenceId = c.req.param("licenceId");
  const licence = await c.env.DB.prepare(`
    SELECT l.id, l.organization_id, l.buyer_id, l.price_cents, l.status, l.payment_provider, l.payment_reference,
      a.title AS asset_title
    FROM licences l JOIN assets a ON a.id = l.asset_id
    WHERE l.id = ? AND l.organization_id = ? AND l.buyer_id = ?
  `).bind(licenceId, user.organizationId, user.id).first<{ id: string; organization_id: string; buyer_id: string; price_cents: number; status: string; payment_provider: string | null; payment_reference: string | null; asset_title: string }>();
  if (!licence) return c.json({ error: "Licence not found" }, 404);
  if (licence.status !== "paid" && (licence.payment_provider !== "demo" || licence.payment_reference !== `demo:${licence.id}`)) {
    return c.json({ error: "Start the demo checkout before completing this licence" }, 409);
  }
  if (licence.status === "pending") {
    const eventId = `demo:licence:${licence.id}`;
    try {
      await postSaleSettlement(c.env, licence.id, {
        amountCents: Number(licence.price_cents),
        currency: "ZAR",
        taxCents: 0,
        idempotencyKey: eventId,
      });
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE licences SET payment_provider = 'demo', payment_reference = ?, paid_at = CURRENT_TIMESTAMP, status = 'paid' WHERE id = ? AND organization_id = ? AND buyer_id = ? AND status = 'pending'").bind(eventId, licence.id, user.organizationId, user.id),
        c.env.DB.prepare(`INSERT OR IGNORE INTO payment_webhook_events
          (id, provider, provider_event_id, event_type, licence_id, amount_cents, currency, payload_json, status, processed_at)
          VALUES (?, 'demo', ?, 'payment_succeeded', ?, ?, 'ZAR', ?, 'processed', CURRENT_TIMESTAMP)`)
          .bind(eventId, eventId, licence.id, Number(licence.price_cents), JSON.stringify({ provider: "demo", eventId, type: "payment_succeeded", productType: "licence", licenceId: licence.id, amountCents: Number(licence.price_cents), currency: "ZAR" })),
      ]);
      recordMetric(c.env, "licence_purchase", c.get("trace"), 1, [user.organizationId]);
      c.executionCtx.waitUntil(dispatchWebhookEvent(c.env, user.organizationId, "licence.paid", { licenceId: licence.id, amountCents: Number(licence.price_cents), currency: "ZAR", demo: true }));
    } catch (error) {
      logEvent("error", "demo.payment_completion_failed", c.get("trace"), { licenceId: licence.id, error: error instanceof Error ? error.message : "unknown" });
      return c.json({ error: "Demo payment could not be completed" }, 422);
    }
  }
  const destination = new URL("/account", c.req.url);
  destination.searchParams.set("licence", licence.id);
  destination.searchParams.set("payment", "complete");
  destination.searchParams.set("demo", "1");
  return c.redirect(destination.toString(), 303);
});

app.post("/api/payments/:licenceId/settled", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["admin"])) return c.json({ error: "Payment service or admin access required" }, 403);
  const payload = settlementSchema.parse(await c.req.json());
  try {
    const licence = await c.env.DB.prepare("SELECT id FROM licences WHERE id = ? AND organization_id = ?").bind(c.req.param("licenceId"), user.organizationId).first<{ id: string }>();
    if (!licence) return c.json({ error: "Licence not found" }, 404);
    const result = await postSaleSettlement(c.env, c.req.param("licenceId"), payload);
    if (!result.idempotent) c.executionCtx.waitUntil(dispatchWebhookEvent(c.env, user.organizationId, "licence.paid", { licenceId: c.req.param("licenceId"), amountCents: payload.amountCents, currency: payload.currency }));
    return c.json(result, result.idempotent ? 200 : 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unable to post settlement" }, 422);
  }
});

app.get("/api/my/licences", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const rows = await c.env.DB.prepare(`SELECT l.id, l.licence_type, l.territory, l.duration_days, l.price_cents, l.status, l.approval_status, l.approval_method, l.approved_at, l.created_at,
      a.id AS asset_id, a.title AS asset_title, a.preview_key
    FROM licences l JOIN assets a ON a.id = l.asset_id
    WHERE l.organization_id = ? AND l.buyer_id = ? ORDER BY l.created_at DESC`).bind(user.organizationId, user.id).all<Record<string, unknown>>();
  return c.json({ results: rows.results.map((row) => ({
    id: String(row.id), assetId: String(row.asset_id), assetTitle: String(row.asset_title),
    licenceType: row.licence_type, licence: archiveDomain.licenceDescription(String(row.licence_type) as LicenceRequest["licenceType"]), territory: String(row.territory), durationDays: Number(row.duration_days),
    priceCents: Number(row.price_cents), status: row.status, approvalStatus: row.approval_status ?? "pending", approvalMethod: row.approval_method ?? null, approvedAt: row.approved_at ?? null, createdAt: String(row.created_at),
    previewUrl: row.preview_key ? `/api/assets/${encodeURIComponent(String(row.asset_id))}/preview` : null,
    originalUrl: row.status === "paid" ? `/api/assets/${encodeURIComponent(String(row.asset_id))}/original` : null,
  })) });
});

const photographerSubscriptionSchema = z.object({
  photographerId: z.string().min(1).max(120),
  durationDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).default(30),
  successUrl: z.string().url().max(2048),
  cancelUrl: z.string().url().max(2048),
});

app.post("/api/subscriptions/checkout", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["buyer", "contributor", "editor", "admin"])) return c.json({ error: "Authenticated buyer required" }, 401);
  if (!paymentProviderConfigured(c.env)) return c.json({ error: "Payment provider is not configured" }, 503);
  const payload = photographerSubscriptionSchema.parse(await c.req.json());
  const photographer = await c.env.DB.prepare("SELECT id, email, role FROM users WHERE id = ? AND role = 'contributor'").bind(payload.photographerId).first<{ id: string; email: string; role: string }>();
  if (!photographer || photographer.id === user.id) return c.json({ error: "Photographer not found" }, 404);
  const priceCents = Math.max(100, Number(c.env.PHOTOGRAPHER_SUBSCRIPTION_PRICE_CENTS ?? 10_000)) * Math.ceil(payload.durationDays / 30);
  let subscription = await c.env.DB.prepare("SELECT id, status, expires_at FROM photographer_subscriptions WHERE organization_id = ? AND photographer_id = ? AND subscriber_id = ?")
    .bind(user.organizationId, photographer.id, user.id).first<{ id: string; status: string; expires_at: string | null }>();
  if (subscription?.status === "active" && (!subscription.expires_at || subscription.expires_at > new Date().toISOString())) return c.json({ error: "Photographer subscription is already active" }, 409);
  const subscriptionId = subscription?.id ?? crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO photographer_subscriptions (id, organization_id, photographer_id, subscriber_id, status, price_cents, currency, duration_days)
    VALUES (?, ?, ?, ?, 'pending', ?, 'ZAR', ?)
    ON CONFLICT(organization_id, photographer_id, subscriber_id) DO UPDATE SET status = 'pending', price_cents = excluded.price_cents, currency = excluded.currency, duration_days = excluded.duration_days, updated_at = CURRENT_TIMESTAMP
  `).bind(subscriptionId, user.organizationId, photographer.id, user.id, priceCents, payload.durationDays).run();
  try {
    const session = await new IntegrationContainer(c.env).payments.get(c.env.PAYMENT_PROVIDER!).createCheckoutSession({
      idempotencyKey: `photographer-subscription:${subscriptionId}:${payload.durationDays}`,
      referenceId: subscriptionId,
      productType: "photographer_subscription",
      amountCents: priceCents,
      currency: "ZAR",
      buyer: { id: user.id, email: user.email },
      successUrl: payload.successUrl,
      cancelUrl: payload.cancelUrl,
      metadata: { organizationId: user.organizationId, userId: user.id, photographerId: photographer.id, productType: "photographer_subscription", durationDays: String(payload.durationDays) },
    });
    await c.env.DB.prepare("UPDATE photographer_subscriptions SET payment_provider = ?, payment_reference = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?")
      .bind(c.env.PAYMENT_PROVIDER, session.providerReference ?? session.id, subscriptionId, user.organizationId).run();
    return c.json({ subscriptionId, provider: session.provider, checkoutUrl: session.checkoutUrl, status: session.status, priceCents, currency: "ZAR", durationDays: payload.durationDays }, 201, { Location: `/api/subscriptions/${subscriptionId}` });
  } catch (error) {
    return c.json({ error: "Payment provider could not create a subscription checkout session" }, 503);
  }
});

app.get("/api/my/subscriptions", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const rows = await c.env.DB.prepare(`SELECT s.id, s.photographer_id, u.display_name AS photographer_name, s.status, s.price_cents, s.currency, s.duration_days, s.paid_at, s.expires_at, s.created_at FROM photographer_subscriptions s JOIN users u ON u.id = s.photographer_id WHERE s.organization_id = ? AND s.subscriber_id = ? ORDER BY s.created_at DESC LIMIT 100`).bind(user.organizationId, user.id).all<Record<string, unknown>>();
  return c.json({ results: rows.results });
});

app.get("/api/subscriptions/:id", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const row = await c.env.DB.prepare(`SELECT s.id, s.photographer_id, u.display_name AS photographer_name, s.subscriber_id,
      s.status, s.price_cents, s.currency, s.duration_days, s.payment_provider, s.payment_reference,
      s.paid_at, s.expires_at, s.created_at, s.updated_at
    FROM photographer_subscriptions s JOIN users u ON u.id = s.photographer_id
    WHERE s.id = ? AND s.organization_id = ? AND (s.subscriber_id = ? OR s.photographer_id = ?)`)
    .bind(c.req.param("id"), user.organizationId, user.id, user.id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Subscription not found" }, 404);
  if (String(row.photographer_id) === user.id) {
    return c.json({ subscription: {
      id: row.id,
      photographerId: row.photographer_id,
      photographerName: row.photographer_name,
      status: row.status,
      priceCents: row.price_cents,
      currency: row.currency,
      durationDays: row.duration_days,
      paidAt: row.paid_at,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } });
  }
  return c.json({ subscription: row });
});

app.post("/api/subscriptions/:id/cancel", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const result = await c.env.DB.prepare("UPDATE photographer_subscriptions SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ? AND subscriber_id = ? AND status IN ('pending', 'active')")
    .bind(c.req.param("id"), user.organizationId, user.id).run();
  if (!result.meta.changes) return c.json({ error: "Active subscription not found" }, 404);
  return c.json({ subscriptionId: c.req.param("id"), status: "cancelled" });
});

const buyerSubscriptionSessionSchema = z.object({
  successUrl: z.string().url().max(2048),
  cancelUrl: z.string().url().max(2048),
  plan: z.enum(["monthly", "annual"]).default("monthly"),
});

function buyerSubscriptionConfiguration(env: Bindings): { configured: boolean; plans: Array<{ id: "monthly" | "annual"; planCode: string; amountCents: number; interval: "monthly" | "annually" }>; planCode: string; amountCents: number; interval: string } {
  const monthlyCode = env.PAYSTACK_SUBSCRIPTION_PLAN_CODE?.trim() ?? "";
  const monthlyAmount = Number(env.BUYER_SUBSCRIPTION_AMOUNT_CENTS ?? 120_000);
  const annualCode = env.PAYSTACK_ANNUAL_SUBSCRIPTION_PLAN_CODE?.trim() ?? "";
  const annualAmount = Number(env.BUYER_ANNUAL_SUBSCRIPTION_AMOUNT_CENTS ?? 1_200_000);
  const plans = [
    { id: "monthly" as const, planCode: monthlyCode, amountCents: monthlyAmount, interval: "monthly" as const },
    { id: "annual" as const, planCode: annualCode, amountCents: annualAmount, interval: "annually" as const },
  ].filter((plan) => Boolean(plan.planCode) && Number.isSafeInteger(plan.amountCents) && plan.amountCents > 0);
  const primary = plans[0] ?? { id: "monthly" as const, planCode: monthlyCode, amountCents: monthlyAmount, interval: "monthly" as const };
  return { configured: env.PAYMENT_PROVIDER === "paystack" && paymentProviderConfigured(env) && plans.length > 0, plans, planCode: primary.planCode, amountCents: primary.amountCents, interval: primary.interval };
}

const sellerOnboardingSchema = z.object({
  sellerType: z.enum(["individual", "company"]),
  legalName: z.string().trim().min(2).max(180),
  phone: z.string().trim().min(1, "South African mobile number is required"),
  ageConfirmed: z.literal(true),
  identityDocumentType: z.enum(["sa_id", "passport"]),
  bankAccountName: z.string().trim().min(2).max(180),
  copyrightDeclaration: z.literal(true),
  taxResponsibilityDeclaration: z.literal(true),
  contributorAgreement: z.literal(true),
  registeredName: z.string().trim().min(2).max(180).optional(),
  cipcRegistrationNumber: z.string().trim().min(4).max(80).optional(),
  representativeName: z.string().trim().min(2).max(180).optional(),
  representativeAuthority: z.boolean().default(false),
  beneficialOwnerRequired: z.boolean().default(false),
}).superRefine((value, context) => {
  if (value.sellerType !== "company") return;
  for (const [field, current] of [["registeredName", value.registeredName], ["cipcRegistrationNumber", value.cipcRegistrationNumber], ["representativeName", value.representativeName]] as const) {
    if (!current) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is required for a company seller` });
  }
  if (!value.representativeAuthority) context.addIssue({ code: z.ZodIssueCode.custom, path: ["representativeAuthority"], message: "Representative authority must be confirmed" });
});

app.put("/api/onboarding/seller", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "admin"])) return c.json({ error: "Contributor access required" }, 403);
  const payload = sellerOnboardingSchema.parse(await c.req.json());
  const phone = archiveDomain.normalizeSouthAfricanPhone(payload.phone);
  const now = new Date().toISOString();
  const termsHash = await sha256Hex(agreementText(sellerAgreement));
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO seller_onboarding_profiles
      (contributor_id, seller_type, legal_name, phone_e164, age_confirmed_at, identity_document_type, bank_account_name, copyright_declaration_at, tax_responsibility_declaration_at, contributor_agreement_at, registered_name, cipc_registration_number, representative_name, representative_authority_at, beneficial_owner_required, beneficial_owner_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(contributor_id) DO UPDATE SET seller_type = excluded.seller_type, legal_name = excluded.legal_name, phone_e164 = excluded.phone_e164, age_confirmed_at = excluded.age_confirmed_at, identity_document_type = excluded.identity_document_type, bank_account_name = excluded.bank_account_name, copyright_declaration_at = excluded.copyright_declaration_at, tax_responsibility_declaration_at = excluded.tax_responsibility_declaration_at, contributor_agreement_at = excluded.contributor_agreement_at, registered_name = excluded.registered_name, cipc_registration_number = excluded.cipc_registration_number, representative_name = excluded.representative_name, representative_authority_at = excluded.representative_authority_at, beneficial_owner_required = excluded.beneficial_owner_required, beneficial_owner_status = excluded.beneficial_owner_status, cipc_status = CASE WHEN excluded.cipc_registration_number IS seller_onboarding_profiles.cipc_registration_number THEN seller_onboarding_profiles.cipc_status ELSE 'not_checked' END, updated_at = CURRENT_TIMESTAMP`)
      .bind(user.id, payload.sellerType, payload.legalName, phone, now, payload.identityDocumentType, payload.bankAccountName, now, now, now, payload.registeredName ?? null, payload.cipcRegistrationNumber ?? null, payload.representativeName ?? null, payload.representativeAuthority ? now : null, payload.beneficialOwnerRequired ? 1 : 0, payload.beneficialOwnerRequired ? "pending" : "not_required"),
    c.env.DB.prepare("INSERT OR IGNORE INTO marketplace_agreement_acceptances (id, organization_id, user_id, agreement_type, agreement_version, terms_sha256, context_type, context_id, accepted_at) VALUES (?, ?, ?, 'seller', ?, ?, 'onboarding', ?, ?)").bind(crypto.randomUUID(), user.organizationId, user.id, sellerAgreement.version, termsHash, user.id, now),
  ]);
  return c.json({ sellerType: payload.sellerType, status: "saved", sellerAgreementVersion: sellerAgreement.version, agreementPersisted: true });
});

app.post("/api/onboarding/cipc/lookup", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "admin"])) return c.json({ error: "Contributor access required" }, 403);
  const payload = z.object({ registrationNumber: z.string().trim().min(4).max(80) }).parse(await c.req.json());
  const seller = await c.env.DB.prepare("SELECT registered_name, cipc_registration_number FROM seller_onboarding_profiles WHERE contributor_id = ? AND seller_type = 'company'").bind(user.id).first<{ registered_name: string; cipc_registration_number: string }>();
  if (!seller || seller.cipc_registration_number !== payload.registrationNumber) return c.json({ error: "Save the matching company seller profile before CIPC verification" }, 409);
  const cipc = new IntegrationContainer(c.env).cipc;
  if (!cipc) return c.json({ error: "CIPC lookup is not configured for this environment" }, 503);
  try {
    const result = await cipc.lookup(payload.registrationNumber);
    const verified = result.verified === true && result.registrationNumber === payload.registrationNumber && typeof result.registeredName === "string" && result.registeredName.trim().toLowerCase() === seller.registered_name.trim().toLowerCase();
    await c.env.DB.prepare("UPDATE seller_onboarding_profiles SET cipc_status = ?, cipc_checked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE contributor_id = ?").bind(verified ? "verified" : "rejected", user.id).run();
    return c.json({ verified, status: verified ? "verified" : "rejected", registrationNumber: payload.registrationNumber, providerReference: result.providerReference ?? null }, verified ? 200 : 422);
  } catch (error) {
    logEvent("warn", "cipc.lookup_failed", c.get("trace"), { contributorId: user.id, error: error instanceof Error ? error.message : "unknown" });
    return c.json({ error: "CIPC verification service is unavailable; the saved seller profile was retained" }, 503);
  }
});

app.post("/api/onboarding/didit/session", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "admin"])) return c.json({ error: "Contributor access required" }, 403);
  const seller = await c.env.DB.prepare("SELECT seller_type, phone_e164, cipc_status, didit_session_id, didit_status FROM seller_onboarding_profiles WHERE contributor_id = ?").bind(user.id).first<{ seller_type: "individual" | "company"; phone_e164: string; cipc_status: string; didit_session_id: string | null; didit_status: string }>();
  if (!seller) return c.json({ error: "Save the seller profile before starting identity verification" }, 409);
  if (seller.seller_type === "company" && seller.cipc_status !== "verified") return c.json({ error: "CIPC verification must succeed before company identity verification" }, 409);
  const didit = new IntegrationContainer(c.env).didit;
  if (!didit) return c.json({ error: "Didit API, KYC, and KYB workflows are not fully configured" }, 503);
  if (seller.didit_session_id && !["rejected", "expired", "Declined", "Expired", "Kyc Expired", "Abandoned"].includes(seller.didit_status)) return c.json({ sessionId: seller.didit_session_id, status: seller.didit_status, resumable: true }, 409);
  try {
    const session = await didit.createSellerSession({ sellerType: seller.seller_type, contributorId: user.id, callbackUrl: `${c.env.APP_PUBLIC_URL ?? new URL(c.req.url).origin}/account?verification=returned`, email: user.email, phone: seller.phone_e164 });
    const actor = await requestActor(c);
    if (!actor) return c.json({ error: "Authentication required" }, 401);
    const caseId = await ensureVerificationCase(c, user, actor.residencyRegion, seller.seller_type === "company" ? "business" : "individual");
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE seller_onboarding_profiles SET didit_session_id = ?, didit_session_kind = ?, didit_status = ?, didit_provider_reference = ?, updated_at = CURRENT_TIMESTAMP WHERE contributor_id = ?").bind(session.sessionId, session.sessionKind, session.status, session.sessionId, user.id),
      c.env.DB.prepare("UPDATE contributor_verification_cases SET provider = 'didit', provider_case_id = ?, status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ? AND contributor_id = ? AND residency_region = ?").bind(session.sessionId, caseId, user.organizationId, user.id, actor.residencyRegion),
    ]);
    return c.json({ sessionId: session.sessionId, sessionKind: session.sessionKind, url: session.url, status: session.status, verificationCaseId: caseId }, 201);
  } catch (error) {
    logEvent("error", "didit.session_failed", c.get("trace"), { contributorId: user.id, error: error instanceof Error ? error.message : "unknown" });
    return c.json({ error: "Didit could not create a hosted verification session" }, 503);
  }
});

app.get("/api/subscription", async (c) => {
  const user = await buyerAccount(c);
  if (!user || !allowedRole(user, ["buyer", "admin"])) return c.json({ error: "Buyer access required" }, 403);
  const configuration = buyerSubscriptionConfiguration(c.env);
  const subscription = await c.env.DB.prepare("SELECT * FROM buyer_subscriptions WHERE organization_id = ? AND buyer_id = ? ORDER BY created_at DESC LIMIT 1").bind(user.organizationId, user.id).first<Record<string, unknown>>();
  const payments = subscription ? await c.env.DB.prepare("SELECT provider_event_id, provider_reference, invoice_code, event_type, amount_cents, currency, status, period_start, period_end, paid_at, created_at FROM buyer_subscription_payments WHERE subscription_id = ? ORDER BY created_at DESC LIMIT 100").bind(subscription.id).all<Record<string, unknown>>() : { results: [] };
  return c.json({ configured: configuration.configured, hasAccess: subscription?.status === "active" || subscription?.status === "non-renewing", sourceOfTruth: "signed Paystack webhook events", plans: configuration.plans.map(({ id, amountCents, interval }) => ({ id, amountCents, currency: "ZAR", interval })), plan: configuration.configured ? { amountCents: configuration.amountCents, currency: "ZAR", interval: configuration.interval } : null, subscription: subscription ?? null, payments: payments.results });
});

app.post("/api/subscription/session", async (c) => {
  const user = await buyerAccount(c);
  if (!user || !allowedRole(user, ["buyer", "admin"])) return c.json({ error: "Buyer access required" }, 403);
  const configuration = buyerSubscriptionConfiguration(c.env);
  if (!configuration.configured) return c.json({ error: "The Paystack subscription plan is not fully configured" }, 503);
  const payload = buyerSubscriptionSessionSchema.parse(await c.req.json());
  const selectedPlan = configuration.plans.find((plan) => plan.id === payload.plan);
  if (!selectedPlan) return c.json({ error: `The ${payload.plan} subscription plan is not configured` }, 503);
  const current = await c.env.DB.prepare("SELECT id, status FROM buyer_subscriptions WHERE organization_id = ? AND buyer_id = ? ORDER BY created_at DESC LIMIT 1").bind(user.organizationId, user.id).first<{ id: string; status: string }>();
  if (current && ["pending", "active", "non-renewing", "attention"].includes(current.status)) return c.json({ error: "A subscription is already active or awaiting Paystack" }, 409);
  const subscriptionId = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO buyer_subscriptions (id, organization_id, buyer_id, plan_code, email, amount_cents, currency, interval) VALUES (?, ?, ?, ?, ?, ?, 'ZAR', ?)").bind(subscriptionId, user.organizationId, user.id, selectedPlan.planCode, user.email, selectedPlan.amountCents, selectedPlan.interval).run();
  try {
    const session = await new IntegrationContainer(c.env).payments.get("paystack").createCheckoutSession({
      idempotencyKey: `buyer-subscription:${subscriptionId}`,
      referenceId: subscriptionId,
      productType: "platform_subscription",
      amountCents: selectedPlan.amountCents,
      currency: "ZAR",
      buyer: { id: user.id, email: user.email },
      successUrl: payload.successUrl,
      cancelUrl: payload.cancelUrl,
      planCode: selectedPlan.planCode,
      metadata: { organizationId: user.organizationId, userId: user.id, productType: "platform_subscription", subscriptionId, subscriptionInterval: selectedPlan.interval },
    });
    await c.env.DB.prepare("UPDATE buyer_subscriptions SET provider_reference = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(session.providerReference ?? subscriptionId, subscriptionId).run();
    return c.json({ subscriptionId, provider: "paystack", checkoutUrl: session.checkoutUrl, status: session.status, amountCents: selectedPlan.amountCents, currency: "ZAR", interval: selectedPlan.interval, plan: payload.plan }, 201);
  } catch (error) {
    await c.env.DB.prepare("UPDATE buyer_subscriptions SET status = 'cancelled', failure_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(error instanceof Error ? error.message : "checkout_failed", subscriptionId).run();
    return c.json({ error: "Paystack could not create the recurring subscription checkout" }, 503);
  }
});

app.post("/api/subscription/manage-link", async (c) => {
  const user = await buyerAccount(c);
  if (!user || !allowedRole(user, ["buyer", "admin"])) return c.json({ error: "Buyer access required" }, 403);
  const subscription = await c.env.DB.prepare("SELECT provider_subscription_code FROM buyer_subscriptions WHERE organization_id = ? AND buyer_id = ? AND status IN ('active', 'non-renewing', 'attention') ORDER BY created_at DESC LIMIT 1").bind(user.organizationId, user.id).first<{ provider_subscription_code: string | null }>();
  if (!subscription?.provider_subscription_code) return c.json({ error: "No manageable Paystack subscription was found" }, 404);
  try {
    const provider = new IntegrationContainer(c.env).payments.get("paystack");
    if (!provider.createSubscriptionManageLink) return c.json({ error: "Subscription management is unavailable" }, 503);
    return c.json({ manageUrl: await provider.createSubscriptionManageLink(subscription.provider_subscription_code) });
  } catch {
    return c.json({ error: "Paystack could not create a subscription management link" }, 503);
  }
});

function buyerAccount(c: { env: Bindings; req: { raw: Request } }): Promise<RequestUser | null> {
  return getRequestUser(c.env, c.req.raw);
}

function demoPaymentEnabled(env: Pick<Bindings, "APP_ENV" | "PAYMENT_PROVIDER">): boolean {
  return String(env.APP_ENV) === "demo" && env.PAYMENT_PROVIDER === "demo";
}

function licencePaymentProviderConfigured(env: Pick<Bindings, "APP_ENV" | "PAYMENT_PROVIDER" | "PAYMENT_ENDPOINT" | "PAYMENT_TOKEN" | "PAYMENT_WEBHOOK_SECRET" | "PAYFAST_MERCHANT_ID" | "PAYFAST_MERCHANT_KEY" | "PAYFAST_NOTIFY_URL">): boolean {
  return demoPaymentEnabled(env) || paymentProviderConfigured(env);
}

function paymentProviderConfigured(env: Pick<Bindings, "PAYMENT_PROVIDER" | "PAYMENT_ENDPOINT" | "PAYMENT_TOKEN" | "PAYMENT_WEBHOOK_SECRET" | "PAYFAST_MERCHANT_ID" | "PAYFAST_MERCHANT_KEY" | "PAYFAST_NOTIFY_URL">): boolean {
  if (env.PAYMENT_PROVIDER === "demo") return false;
  if (env.PAYMENT_PROVIDER === "payfast") return Boolean(env.PAYFAST_MERCHANT_ID && env.PAYFAST_MERCHANT_KEY && env.PAYFAST_NOTIFY_URL && env.PAYMENT_WEBHOOK_SECRET);
  return Boolean(env.PAYMENT_PROVIDER && env.PAYMENT_ENDPOINT && env.PAYMENT_TOKEN && env.PAYMENT_WEBHOOK_SECRET);
}

app.post("/api/buyer/platform-subscription/checkout", async (c) => {
  const user = await buyerAccount(c);
  if (!user || !allowedRole(user, ["buyer", "admin"])) return c.json({ error: "Buyer access required" }, 403);
  return c.json({ error: "This legacy subscription route is retired", replacement: "/api/subscription/session" }, 410);
});

app.get("/api/my/platform-subscription", async (c) => {
  const user = await buyerAccount(c);
  if (!user || !allowedRole(user, ["buyer", "admin"])) return c.json({ error: "Buyer access required" }, 403);
  return c.redirect(new URL("/api/subscription", c.req.url).toString(), 308);
});

app.post("/api/my/platform-subscription/cancel", async (c) => {
  const user = await buyerAccount(c);
  if (!user || !allowedRole(user, ["buyer", "admin"])) return c.json({ error: "Buyer access required" }, 403);
  return c.json({ error: "Recurring billing is managed by Paystack", replacement: "/api/subscription/manage-link" }, 410);
});

const creditPurchaseRequestSchema = z.object({
  credits: z.number().int().min(1).max(1000),
  successUrl: z.string().url().max(2048),
  cancelUrl: z.string().url().max(2048),
});

app.post("/api/buyer/credits/checkout", async (c) => {
  const user = await buyerAccount(c);
  if (!user || !allowedRole(user, ["buyer", "admin"])) return c.json({ error: "Buyer access required" }, 403);
  if (!paymentProviderConfigured(c.env)) return c.json({ error: "Payment provider is not configured for credit purchases" }, 503);
  const payload = creditPurchaseRequestSchema.parse(await c.req.json());
  const amountCents = creditPurchaseAmountCents(payload.credits);
  const purchaseId = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO buyer_credit_purchases (id, organization_id, buyer_id, credits, amount_cents, currency) VALUES (?, ?, ?, ?, ?, 'ZAR')")
    .bind(purchaseId, user.organizationId, user.id, payload.credits, amountCents).run();
  try {
    const session = await new IntegrationContainer(c.env).payments.get(c.env.PAYMENT_PROVIDER!).createCheckoutSession({
      idempotencyKey: `credit-purchase:${purchaseId}`,
      referenceId: purchaseId,
      productType: "credit_purchase",
      amountCents,
      currency: "ZAR",
      buyer: { id: user.id, email: user.email },
      successUrl: payload.successUrl,
      cancelUrl: payload.cancelUrl,
      metadata: { organizationId: user.organizationId, userId: user.id, productType: "credit_purchase", credits: String(payload.credits), creditUnitCents: String(CREDIT_UNIT_CENTS) },
    });
    await c.env.DB.prepare("UPDATE buyer_credit_purchases SET payment_provider = ?, payment_reference = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?")
      .bind(c.env.PAYMENT_PROVIDER, session.providerReference ?? session.id, purchaseId, user.organizationId).run();
    return c.json({ purchaseId, provider: session.provider, checkoutUrl: session.checkoutUrl, status: session.status, credits: payload.credits, amountCents, currency: "ZAR" }, 201, { Location: `/api/my/credits` });
  } catch (error) {
    await c.env.DB.prepare("UPDATE buyer_credit_purchases SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ? AND status = 'pending'").bind(purchaseId, user.organizationId).run();
    logEvent("error", "payment.credit_checkout_failed", c.get("trace"), { purchaseId, provider: c.env.PAYMENT_PROVIDER, error: error instanceof Error ? error.message : "unknown" });
    return c.json({ error: "Payment provider could not create a credit checkout session" }, 503);
  }
});

app.get("/api/my/credits", async (c) => {
  const user = await buyerAccount(c);
  if (!user || !allowedRole(user, ["buyer", "admin"])) return c.json({ error: "Buyer access required" }, 403);
  const [balance, transactions, pending] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT COALESCE(SUM(credits), 0) AS balance FROM buyer_credit_transactions WHERE organization_id = ? AND buyer_id = ?").bind(user.organizationId, user.id),
    c.env.DB.prepare("SELECT id, transaction_type, credits, amount_cents, reference_type, reference_id, created_at FROM buyer_credit_transactions WHERE organization_id = ? AND buyer_id = ? ORDER BY created_at DESC LIMIT 100").bind(user.organizationId, user.id),
    c.env.DB.prepare("SELECT id, credits, amount_cents, currency, status, created_at FROM buyer_credit_purchases WHERE organization_id = ? AND buyer_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 20").bind(user.organizationId, user.id),
  ]);
  return c.json({ oneCreditCents: CREDIT_UNIT_CENTS, balanceCredits: Number((balance.results[0] as Record<string, unknown> | undefined)?.balance ?? 0), transactions: transactions.results, pendingPurchases: pending.results });
});

app.get("/api/my/purchases", async (c) => {
  const user = await buyerAccount(c);
  if (!user || !allowedRole(user, ["buyer", "admin"])) return c.json({ error: "Buyer access required" }, user ? 403 : 401);
  const [licences, photographerSubscriptions, platformSubscriptions, platformPayments, creditPurchases] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT l.id, l.asset_id, a.title AS asset_title, l.licence_type, l.territory, l.duration_days, l.price_cents, l.status, l.created_at, l.paid_at FROM licences l JOIN assets a ON a.id = l.asset_id WHERE l.organization_id = ? AND l.buyer_id = ?`).bind(user.organizationId, user.id),
    c.env.DB.prepare("SELECT s.id, u.display_name AS photographer_name, s.price_cents, s.currency, s.status, s.duration_days, s.created_at, s.paid_at FROM photographer_subscriptions s JOIN users u ON u.id = s.photographer_id WHERE s.organization_id = ? AND s.subscriber_id = ?").bind(user.organizationId, user.id),
    c.env.DB.prepare("SELECT id, amount_cents AS price_cents, currency, status, interval, created_at FROM buyer_subscriptions WHERE organization_id = ? AND buyer_id = ?").bind(user.organizationId, user.id),
    c.env.DB.prepare(`SELECT p.provider_event_id AS event_id, p.subscription_id, p.event_type, p.amount_cents, p.currency, p.created_at AS received_at, p.status FROM buyer_subscription_payments p JOIN buyer_subscriptions s ON s.id = p.subscription_id WHERE s.organization_id = ? AND s.buyer_id = ? ORDER BY p.created_at DESC`).bind(user.organizationId, user.id),
    c.env.DB.prepare("SELECT id, credits, amount_cents, currency, status, created_at, paid_at FROM buyer_credit_purchases WHERE organization_id = ? AND buyer_id = ?").bind(user.organizationId, user.id),
  ]);
  const results = [
    ...(licences.results as Record<string, unknown>[]).map((row) => ({ id: String(row.id), kind: "licence", title: String(row.asset_title), status: String(row.status), amountCents: Number(row.price_cents), currency: "ZAR", createdAt: String(row.created_at), details: `${row.licence_type} - ${row.territory} - ${row.duration_days} days`, referenceId: String(row.id), assetId: String(row.asset_id) })),
    ...(photographerSubscriptions.results as Record<string, unknown>[]).map((row) => ({ id: String(row.id), kind: "photographer_subscription", title: `Subscription to ${String(row.photographer_name)}`, status: String(row.status), amountCents: Number(row.price_cents), currency: String(row.currency), createdAt: String(row.created_at), details: `${row.duration_days} days`, referenceId: String(row.id) })),
    ...(platformSubscriptions.results as Record<string, unknown>[]).map((row) => ({ id: String(row.id), kind: "platform_subscription", title: "Veld Archive membership", status: String(row.status), amountCents: Number(row.price_cents), currency: String(row.currency), createdAt: String(row.created_at), details: `${String(row.interval)} Paystack plan`, referenceId: String(row.id) })),
    ...(platformPayments.results as Record<string, unknown>[]).map((row) => ({ id: String(row.event_id), kind: "platform_subscription_payment", title: "Veld Archive membership payment", status: String(row.status), amountCents: Number(row.amount_cents ?? 0), currency: String(row.currency ?? "ZAR"), createdAt: String(row.received_at), details: String(row.event_type), referenceId: String(row.subscription_id) })),
    ...(creditPurchases.results as Record<string, unknown>[]).map((row) => ({ id: String(row.id), kind: "credit_purchase", title: `${Number(row.credits)} archive credit${Number(row.credits) === 1 ? "" : "s"}`, status: String(row.status), amountCents: Number(row.amount_cents), currency: String(row.currency), createdAt: String(row.created_at), details: "1 credit = R100", referenceId: String(row.id) })),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return c.json({ results, summary: { total: results.length, paid: results.filter((item) => item.status === "paid" || item.status === "payment_succeeded").length, totalPaidCents: results.filter((item) => item.status === "paid" || item.status === "payment_succeeded").reduce((sum, item) => sum + item.amountCents, 0) } });
});

const paymentWebhookSchema = z.object({
  provider: z.string().trim().min(2).max(80),
  eventId: z.string().trim().min(4).max(240),
  type: z.enum(["payment_succeeded", "payment_failed", "refund", "chargeback"]),
  licenceId: z.string().min(1).max(120).optional(),
  subscriptionId: z.string().min(1).max(120).optional(),
  creditPurchaseId: z.string().min(1).max(120).optional(),
  productType: z.enum(["licence", "photographer_subscription", "platform_subscription", "credit_purchase"]).default("licence"),
  paymentReference: z.string().trim().max(240).optional(),
  amountCents: z.number().int().positive().max(100_000_000),
  currency: z.string().length(3),
}).refine((value) => value.productType === "licence" ? Boolean(value.licenceId) : value.productType === "credit_purchase" ? Boolean(value.creditPurchaseId) : Boolean(value.subscriptionId), { message: "A product reference is required for the payment type" });


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

async function applyPaystackSubscriptionLifecycle(env: Bindings, envelope: Record<string, unknown>, rawBody: string): Promise<{ handled: boolean; duplicate?: boolean; eventId?: string }> {
  const eventType = typeof envelope.event === "string" ? envelope.event : "";
  if (!["subscription.create", "subscription.not_renew", "subscription.disable", "invoice.create", "invoice.update", "invoice.payment_failed"].includes(eventType)) return { handled: false };
  const data = envelope.data && typeof envelope.data === "object" ? envelope.data as Record<string, unknown> : {};
  const nestedSubscription = data.subscription && typeof data.subscription === "object" ? data.subscription as Record<string, unknown> : {};
  const customer = data.customer && typeof data.customer === "object" ? data.customer as Record<string, unknown> : {};
  const plan = data.plan && typeof data.plan === "object" ? data.plan as Record<string, unknown> : {};
  const metadataValue = data.metadata ?? nestedSubscription.metadata;
  let metadata: Record<string, unknown> = {};
  if (metadataValue && typeof metadataValue === "object") metadata = metadataValue as Record<string, unknown>;
  else if (typeof metadataValue === "string") { try { metadata = JSON.parse(metadataValue) as Record<string, unknown>; } catch { metadata = {}; } }
  const subscriptionId = typeof metadata.subscriptionId === "string" ? metadata.subscriptionId : null;
  const subscriptionCode = typeof data.subscription_code === "string" ? data.subscription_code : typeof nestedSubscription.subscription_code === "string" ? nestedSubscription.subscription_code : null;
  const email = typeof customer.email === "string" ? customer.email : typeof data.email === "string" ? data.email : null;
  const planCode = typeof plan.plan_code === "string" ? plan.plan_code : typeof data.plan_code === "string" ? data.plan_code : null;
  const subscription = subscriptionId
    ? await env.DB.prepare("SELECT id FROM buyer_subscriptions WHERE id = ?").bind(subscriptionId).first<{ id: string }>()
    : subscriptionCode
      ? await env.DB.prepare("SELECT id FROM buyer_subscriptions WHERE provider_subscription_code = ?").bind(subscriptionCode).first<{ id: string }>()
      : email && planCode
        ? await env.DB.prepare("SELECT id FROM buyer_subscriptions WHERE lower(email) = lower(?) AND plan_code = ? ORDER BY created_at DESC LIMIT 1").bind(email, planCode).first<{ id: string }>()
        : null;
  if (!subscription) throw new Error("Paystack subscription event did not match a local subscription");
  const providerEventId = `paystack:${await sha256Hex(rawBody)}`;
  const duplicate = await env.DB.prepare("SELECT id FROM buyer_subscription_payments WHERE provider = 'paystack' AND provider_event_id = ?").bind(providerEventId).first<{ id: string }>();
  if (duplicate) return { handled: true, duplicate: true, eventId: providerEventId };
  const status = eventType === "subscription.not_renew" ? "non-renewing" : eventType === "subscription.disable" ? "cancelled" : eventType === "invoice.payment_failed" ? "attention" : "active";
  const amount = Number(data.amount ?? plan.amount);
  const amountCents = Number.isSafeInteger(amount) && amount > 0 ? amount : null;
  const reference = typeof data.reference === "string" ? data.reference : null;
  const invoiceCode = typeof data.invoice_code === "string" ? data.invoice_code : null;
  const nextPaymentDate = typeof data.next_payment_date === "string" ? data.next_payment_date : typeof nestedSubscription.next_payment_date === "string" ? nestedSubscription.next_payment_date : null;
  await env.DB.batch([
    env.DB.prepare(`UPDATE buyer_subscriptions SET status = ?, provider_subscription_code = COALESCE(?, provider_subscription_code), provider_customer_code = COALESCE(?, provider_customer_code), provider_email_token = COALESCE(?, provider_email_token), next_payment_date = COALESCE(?, next_payment_date), failure_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(status, subscriptionCode, typeof customer.customer_code === "string" ? customer.customer_code : null, typeof data.email_token === "string" ? data.email_token : null, nextPaymentDate, eventType === "invoice.payment_failed" ? "Paystack invoice payment failed" : null, subscription.id),
    env.DB.prepare("INSERT INTO buyer_subscription_payments (id, subscription_id, provider, provider_event_id, provider_reference, invoice_code, event_type, amount_cents, currency, status, payload_json) VALUES (?, ?, 'paystack', ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), subscription.id, providerEventId, reference, invoiceCode, eventType, amountCents, typeof data.currency === "string" ? data.currency.toUpperCase() : "ZAR", eventType === "invoice.payment_failed" ? "failed" : "pending", rawBody),
  ]);
  return { handled: true, eventId: providerEventId };
}

app.post("/api/webhooks/payments", async (c) => {
  if (!c.env.PAYMENT_WEBHOOK_SECRET) return c.json({ error: "Payment webhook secret is not configured" }, 503);
  const body = await c.req.text();
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return c.json({ error: "Invalid webhook JSON" }, 400); }
  const paystackSignature = c.req.header("x-paystack-signature") ?? "";
  let normalized: unknown = parsed;
  if (paystackSignature) {
    if (!c.env.PAYMENT_TOKEN) return c.json({ error: "Paystack secret key is not configured" }, 503);
    if (!(await verifyPaystackWebhook(c.env.PAYMENT_TOKEN, paystackSignature, body))) return c.json({ error: "Invalid Paystack webhook signature" }, 401);
    try {
      const lifecycle = await applyPaystackSubscriptionLifecycle(c.env, parsed as Record<string, unknown>, body);
      if (lifecycle.handled) return c.json({ accepted: true, provider: "paystack", ...lifecycle });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Paystack subscription event could not be applied" }, 422);
    }
    normalized = await normalizePaystackPaymentEvent(parsed);
    if (!normalized) return c.json({ error: "Unsupported Paystack event" }, 422);
  } else if (!(await verifyPaymentWebhook(c.env.PAYMENT_WEBHOOK_SECRET, c.req.header("x-payment-signature") ?? "", body))) {
    return c.json({ error: "Invalid payment webhook signature" }, 401);
  }
  const payload = paymentWebhookSchema.parse(normalized);
  const duplicate = await c.env.DB.prepare("SELECT id, status FROM payment_webhook_events WHERE provider = ? AND provider_event_id = ?").bind(payload.provider, payload.eventId).first<{ id: string; status: string }>();
  if (duplicate) return c.json({ accepted: true, duplicate: true, status: duplicate.status });
  const eventId = crypto.randomUUID();
  try {
    await c.env.DB.prepare("INSERT INTO payment_webhook_events (id, provider, provider_event_id, event_type, licence_id, subscription_id, credit_purchase_id, product_type, amount_cents, currency, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(eventId, payload.provider, payload.eventId, payload.type, payload.licenceId ?? null, payload.subscriptionId ?? null, payload.creditPurchaseId ?? null, payload.productType, payload.amountCents, payload.currency.toUpperCase(), body).run();
    let transactionId: string | null = null;
    if (payload.productType === "photographer_subscription") {
      const subscription = await c.env.DB.prepare("SELECT id, price_cents, duration_days, status FROM photographer_subscriptions WHERE id = ?").bind(payload.subscriptionId).first<{ id: string; price_cents: number; duration_days: number; status: string }>();
      if (!subscription) throw new Error("Photographer subscription not found");
      if (Number(subscription.price_cents) !== payload.amountCents && payload.type === "payment_succeeded") throw new Error("Payment amount does not match the subscription price");
      if (payload.type === "payment_succeeded") {
        await c.env.DB.prepare(`UPDATE photographer_subscriptions SET status = 'active', paid_at = CURRENT_TIMESTAMP, expires_at = datetime(CASE WHEN status = 'active' AND expires_at > CURRENT_TIMESTAMP THEN expires_at ELSE CURRENT_TIMESTAMP END, '+' || duration_days || ' days'), payment_provider = ?, payment_reference = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(payload.provider, payload.paymentReference ?? payload.eventId, subscription.id).run();
      } else if (payload.type === "refund" || payload.type === "chargeback") {
        await c.env.DB.prepare("UPDATE photographer_subscriptions SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(subscription.id).run();
      }
    } else if (payload.productType === "platform_subscription") {
      const subscription = await c.env.DB.prepare("SELECT id, amount_cents, status FROM buyer_subscriptions WHERE id = ?").bind(payload.subscriptionId).first<{ id: string; amount_cents: number; status: string }>();
      if (!subscription) throw new Error("Buyer subscription not found");
      if (Number(subscription.amount_cents) !== payload.amountCents && payload.type === "payment_succeeded") throw new Error("Payment amount does not match the buyer subscription plan");
      const subscriptionStatus = payload.type === "payment_succeeded" ? "active" : "attention";
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE buyer_subscriptions SET status = ?, provider_reference = COALESCE(?, provider_reference), failure_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(subscriptionStatus, payload.paymentReference ?? null, payload.type === "payment_succeeded" ? null : `Paystack ${payload.type}`, subscription.id),
        c.env.DB.prepare("INSERT OR IGNORE INTO buyer_subscription_payments (id, subscription_id, provider, provider_event_id, provider_reference, event_type, amount_cents, currency, status, paid_at, payload_json) VALUES (?, ?, 'paystack', ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'success' THEN CURRENT_TIMESTAMP ELSE NULL END, ?)").bind(crypto.randomUUID(), subscription.id, payload.eventId, payload.paymentReference ?? null, payload.type, payload.amountCents, payload.currency.toUpperCase(), payload.type === "payment_succeeded" ? "success" : payload.type === "refund" ? "refunded" : "failed", payload.type === "payment_succeeded" ? "success" : "failed", body),
      ]);
    } else if (payload.productType === "credit_purchase") {
      const purchase = await c.env.DB.prepare("SELECT id, organization_id, buyer_id, credits, amount_cents, status FROM buyer_credit_purchases WHERE id = ?").bind(payload.creditPurchaseId).first<{ id: string; organization_id: string; buyer_id: string; credits: number; amount_cents: number; status: string }>();
      if (!purchase) throw new Error("Credit purchase not found");
      if (Number(purchase.amount_cents) !== payload.amountCents && payload.type === "payment_succeeded") throw new Error("Payment amount does not match the credit purchase");
      if (payload.type === "payment_succeeded") {
        if (purchase.status !== "pending") throw new Error("Credit purchase is not awaiting payment");
        await c.env.DB.batch([
          c.env.DB.prepare("UPDATE buyer_credit_purchases SET status = 'paid', payment_provider = ?, payment_reference = ?, paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(payload.provider, payload.paymentReference ?? payload.eventId, purchase.id),
          c.env.DB.prepare("INSERT OR IGNORE INTO buyer_credit_transactions (id, organization_id, buyer_id, transaction_type, credits, amount_cents, reference_type, reference_id, idempotency_key) VALUES (?, ?, ?, 'purchase', ?, ?, 'credit_purchase', ?, ?)").bind(crypto.randomUUID(), purchase.organization_id, purchase.buyer_id, purchase.credits, purchase.amount_cents, purchase.id, `${payload.provider}:${payload.eventId}`),
        ]);
        transactionId = purchase.id;
      } else if (payload.type === "payment_failed") {
        await c.env.DB.prepare("UPDATE buyer_credit_purchases SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(purchase.id).run();
      } else if (payload.type === "refund" || payload.type === "chargeback") {
        if (purchase.status !== "paid") throw new Error("Credit purchase is not paid");
        if (payload.amountCents % CREDIT_UNIT_CENTS !== 0 || payload.amountCents > Number(purchase.amount_cents)) throw new Error("Credit refund must be a whole number of purchased credits");
        const credits = payload.amountCents / CREDIT_UNIT_CENTS;
        await c.env.DB.batch([
          c.env.DB.prepare("UPDATE buyer_credit_purchases SET status = 'refunded', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(purchase.id),
          c.env.DB.prepare("INSERT OR IGNORE INTO buyer_credit_transactions (id, organization_id, buyer_id, transaction_type, credits, amount_cents, reference_type, reference_id, idempotency_key) VALUES (?, ?, ?, 'refund', ?, ?, 'credit_purchase', ?, ?)").bind(crypto.randomUUID(), purchase.organization_id, purchase.buyer_id, -credits, -payload.amountCents, purchase.id, `${payload.provider}:${payload.eventId}`),
         ]);
         transactionId = purchase.id;
      }
    } else if (payload.type === "payment_succeeded") {
      const current = await c.env.DB.prepare("SELECT status, price_cents FROM licences WHERE id = ?").bind(payload.licenceId).first<{ status: string; price_cents: number }>();
      if (!current) throw new Error("Licence not found");
      if (Number(current.price_cents) !== payload.amountCents) throw new Error("Payment amount does not match the licence price");
      if (current.status === "paid") {
        const existingSale = await c.env.DB.prepare("SELECT id FROM ledger_transactions WHERE licence_id = ? AND transaction_type = 'sale' ORDER BY created_at DESC LIMIT 1").bind(payload.licenceId).first<{ id: string }>();
        transactionId = existingSale?.id ?? null;
      } else {
      transactionId = (await postSaleSettlement(c.env, payload.licenceId!, { amountCents: payload.amountCents, currency: payload.currency, provider: payload.provider, taxCents: 0, idempotencyKey: `${payload.provider}:${payload.eventId}` })).transactionId;
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE licences SET payment_provider = ?, payment_reference = ?, paid_at = CURRENT_TIMESTAMP, status = 'paid', price_cents = ? WHERE id = ? AND status = 'pending'").bind(payload.provider, payload.paymentReference ?? payload.eventId, payload.amountCents, payload.licenceId),
        c.env.DB.prepare("UPDATE payment_split_allocations SET status = 'settled', provider_reference = COALESCE(?, provider_reference), updated_at = CURRENT_TIMESTAMP WHERE licence_id = ?").bind(payload.paymentReference ?? null, payload.licenceId),
      ]);
      }
    } else if (payload.type === "refund" || payload.type === "chargeback") {
      transactionId = await postPaymentReversal(c.env, payload.licenceId!, { amountCents: payload.amountCents, currency: payload.currency, idempotencyKey: `${payload.provider}:${payload.eventId}`, type: payload.type });
      await c.env.DB.prepare("UPDATE payment_split_allocations SET status = 'reversed', updated_at = CURRENT_TIMESTAMP WHERE licence_id = ?").bind(payload.licenceId).run();
    }
    await c.env.DB.prepare("UPDATE payment_webhook_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP WHERE id = ?").bind(eventId).run();
    if (payload.type === "payment_succeeded") {
      const licenceOrg = payload.productType === "photographer_subscription"
        ? await c.env.DB.prepare("SELECT organization_id FROM photographer_subscriptions WHERE id = ?").bind(payload.subscriptionId).first<{ organization_id: string }>()
        : payload.productType === "platform_subscription"
          ? await c.env.DB.prepare("SELECT organization_id FROM buyer_subscriptions WHERE id = ?").bind(payload.subscriptionId).first<{ organization_id: string }>()
          : payload.productType === "credit_purchase"
            ? await c.env.DB.prepare("SELECT organization_id FROM buyer_credit_purchases WHERE id = ?").bind(payload.creditPurchaseId).first<{ organization_id: string }>()
        : await c.env.DB.prepare("SELECT organization_id FROM licences WHERE id = ?").bind(payload.licenceId).first<{ organization_id: string }>();
      if (licenceOrg) {
        recordMetric(c.env, payload.productType === "photographer_subscription" ? "subscription_purchase" : payload.productType === "licence" ? "licence_purchase" : "payment_purchase", c.get("trace"), 1, [licenceOrg.organization_id]);
        c.executionCtx.waitUntil(dispatchWebhookEvent(c.env, licenceOrg.organization_id, payload.productType === "photographer_subscription" ? "photographer.subscription.paid" : payload.productType === "platform_subscription" ? "platform.subscription.paid" : payload.productType === "credit_purchase" ? "buyer.credits.purchased" : "licence.paid", { licenceId: payload.licenceId, subscriptionId: payload.subscriptionId, creditPurchaseId: payload.creditPurchaseId, amountCents: payload.amountCents, currency: payload.currency }));
      }
    }
    return c.json({ accepted: true, eventId, transactionId, type: payload.type });
  } catch (error) {
    await c.env.DB.prepare("UPDATE payment_webhook_events SET status = 'failed', failure_reason = ? WHERE id = ?").bind(error instanceof Error ? error.message : "payment_event_failed", eventId).run();
    return c.json({ error: "Payment event could not be applied", eventId }, 422);
  }
});

app.post("/api/webhooks/payfast", async (c) => {
  if (!paymentProviderConfigured(c.env) || c.env.PAYMENT_PROVIDER !== "payfast") return c.json({ error: "PayFast payment provider is not configured" }, 503);
  const sourceIp = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  if (!isPayFastIp(sourceIp)) return c.json({ error: "PayFast notification source is not trusted" }, 403);
  const body = await c.req.text();
  const params = new URLSearchParams(body);
  const fields = [...params.entries()];
  const providedSignature = params.get("signature") ?? "";
  if (!providedSignature || !verifyPayFastSignature(fields.filter(([key]) => key !== "signature"), providedSignature, c.env.PAYFAST_PASSPHRASE)) return c.json({ error: "Invalid PayFast notification signature" }, 401);
  if (params.get("merchant_id") !== c.env.PAYFAST_MERCHANT_ID) return c.json({ error: "PayFast merchant mismatch" }, 422);
  const reference = params.get("m_payment_id")?.trim();
  if (!reference) return c.json({ error: "PayFast payment reference is missing" }, 422);
  const [licence, photographerSubscription, platformSubscription, creditPurchase] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT id FROM licences WHERE id = ?").bind(reference),
    c.env.DB.prepare("SELECT id FROM photographer_subscriptions WHERE id = ?").bind(reference),
    c.env.DB.prepare("SELECT id FROM buyer_platform_subscriptions WHERE id = ?").bind(reference),
    c.env.DB.prepare("SELECT id FROM buyer_credit_purchases WHERE id = ?").bind(reference),
  ]);
  const product = licence.results.length ? { productType: "licence" as const, licenceId: reference } : photographerSubscription.results.length ? { productType: "photographer_subscription" as const, subscriptionId: reference } : platformSubscription.results.length ? { productType: "platform_subscription" as const, subscriptionId: reference } : creditPurchase.results.length ? { productType: "credit_purchase" as const, creditPurchaseId: reference } : null;
  if (!product) return c.json({ error: "PayFast payment reference is not recognized" }, 404);
  const status = (params.get("payment_status") ?? "").toUpperCase();
  const type = status === "COMPLETE" ? "payment_succeeded" : status === "FAILED" || status === "CANCELLED" ? "payment_failed" : null;
  if (!type) return c.json({ error: "Unsupported PayFast payment status" }, 422);
  let amountCents: number;
  try { amountCents = payfastAmountCents(params.get("amount_gross") ?? ""); } catch { return c.json({ error: "PayFast payment amount is invalid" }, 422); }
  const normalized = JSON.stringify({ provider: "payfast", eventId: params.get("pf_payment_id") ?? `payfast:${reference}:${status}:${amountCents}`, type, ...product, paymentReference: params.get("pf_payment_id") ?? reference, amountCents, currency: "ZAR" });
  const internalSignature = hex(await hmac(utf8(c.env.PAYMENT_WEBHOOK_SECRET!), normalized));
  return app.fetch(new Request(new URL("/api/webhooks/payments", c.req.url), { method: "POST", headers: { "Content-Type": "application/json", "X-Payment-Signature": internalSignature }, body: normalized }), c.env, c.executionCtx);
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
const payoutBatchDecisionSchema = z.object({ decision: z.enum(["approve", "reject"]), notes: z.string().trim().max(1000).optional() });

async function processPayoutBatch(env: Bindings, batchId: string): Promise<void> {
  const batch = await env.DB.prepare("SELECT * FROM payout_batches WHERE id = ? AND status = 'processing'").bind(batchId).first<Record<string, unknown>>();
  if (!batch) return;
  const items = await env.DB.prepare(`SELECT i.id, i.contributor_id, i.wallet_id, i.contract_id, i.amount_cents, i.currency,
    w.provider, w.provider_account_id, w.account_holder_name, w.account_last4, u.display_name, u.email
    FROM payout_batch_items i JOIN payout_wallets w ON w.id = i.wallet_id JOIN users u ON u.id = i.contributor_id WHERE i.batch_id = ? AND i.status = 'pending'`).bind(batchId).all<Record<string, unknown>>();
  const registry = new IntegrationContainer(env).payouts;
  for (const item of items.results as Record<string, unknown>[]) {
    const reference = `payout-${batchId}-${String(item.id)}`;
    try {
      if (String(item.provider) === "paystack") throw new Error("Paystack marketplace splits settle directly during checkout and are not eligible for manual payout batches");
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
      await notify(env, String(batch.organization_id), String(item.contributor_id), { type: "payout", title: "Payout processed", body: `A payout of ${(Number(item.amount_cents) / 100).toFixed(2)} ${String(item.currency)} was sent for period ${String(batch.period_start)} to ${String(batch.period_end)}.`, resourceType: "payout_batch", resourceId: batchId });
    } catch (error) {
      await env.DB.prepare("UPDATE payout_batch_items SET status = 'failed', failure_reason = ? WHERE id = ?").bind(error instanceof Error ? error.message : "Payout provider failure", item.id).run();
      await notify(env, String(batch.organization_id), String(item.contributor_id), { type: "payout", title: "Payout could not be processed", body: "A scheduled payout failed. An admin has been notified to review your payout wallet.", resourceType: "payout_batch", resourceId: batchId });
    }
  }
  await env.DB.prepare("UPDATE payout_batches SET status = CASE WHEN EXISTS (SELECT 1 FROM payout_batch_items WHERE batch_id = ? AND status = 'failed') THEN 'failed' WHEN EXISTS (SELECT 1 FROM payout_batch_items WHERE batch_id = ? AND status IN ('pending', 'processing')) THEN 'processing' ELSE 'paid' END, processed_at = CASE WHEN NOT EXISTS (SELECT 1 FROM payout_batch_items WHERE batch_id = ? AND status IN ('pending', 'processing')) THEN CURRENT_TIMESTAMP ELSE processed_at END WHERE id = ?").bind(batchId, batchId, batchId, batchId).run();
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
  return c.json({ batchId, itemCount: contributors.results.length, totalCents: total, status: "draft", next: "admin_approval_required" }, 201, { Location: `/api/admin/payout-batches/${batchId}` });
});

app.post("/api/admin/payout-batches/:id/decision", async (c) => {
  const admin = await requestUser(c);
  if (!admin || !allowedRole(admin, ["admin"])) return c.json({ error: "Admin access required" }, 403);
  const payload = payoutBatchDecisionSchema.parse(await c.req.json());
  const batchId = c.req.param("id");
  const batch = await c.env.DB.prepare("SELECT id, organization_id, status, total_cents FROM payout_batches WHERE id = ? AND organization_id = ?")
    .bind(batchId, admin.organizationId).first<{ id: string; organization_id: string; status: string; total_cents: number }>();
  if (!batch) return c.json({ error: "Payout batch not found" }, 404);

  const outcome = decidePayoutBatch(batch.status as Parameters<typeof decidePayoutBatch>[0], payload.decision, Number(batch.total_cents));
  if ("error" in outcome) return c.json({ error: outcome.error }, outcome.statusCode);
  const nextStatus = outcome.status;
  const transition = await c.env.DB.prepare("UPDATE payout_batches SET status = ?, processed_at = CASE WHEN ? = 'cancelled' THEN CURRENT_TIMESTAMP ELSE processed_at END WHERE id = ? AND status = 'draft'").bind(nextStatus, nextStatus, batchId).run();
  if (Number(transition.meta.changes ?? 0) !== 1) return c.json({ error: "Payout batch changed before this decision was applied" }, 409);
  await c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'payout_batch', ?, ?)").bind(crypto.randomUUID(), admin.id, payload.decision === "approve" ? "payout_batch_approved" : "payout_batch_rejected", batchId, JSON.stringify({ notes: payload.notes ?? null, totalCents: Number(batch.total_cents) })).run();
  if (payload.decision === "approve") c.executionCtx.waitUntil(processPayoutBatch(c.env, batchId));
  return c.json({ batchId, status: nextStatus, decision: payload.decision, idempotent: outcome.idempotent }, payload.decision === "approve" ? 202 : 200);
});

app.get("/api/admin/payout-batches", async (c) => {
  const admin = await requestUser(c);
  if (!admin || !allowedRole(admin, ["admin"])) return c.json({ error: "Admin access required" }, 403);
  const rows = await c.env.DB.prepare(`SELECT b.*, COUNT(i.id) AS item_count FROM payout_batches b LEFT JOIN payout_batch_items i ON i.batch_id = b.id
    WHERE b.organization_id = ? GROUP BY b.id ORDER BY b.created_at DESC LIMIT 100`).bind(admin.organizationId).all<Record<string, unknown>>();
  return c.json({ results: rows.results.map((row) => ({ id: String(row.id), periodStart: String(row.period_start), periodEnd: String(row.period_end), currency: String(row.currency), totalCents: Number(row.total_cents), status: String(row.status), itemCount: Number(row.item_count ?? 0), createdAt: String(row.created_at) })) });
});

app.get("/api/admin/payout-batches/:id", async (c) => {
  const admin = await requestUser(c);
  if (!admin || !allowedRole(admin, ["admin"])) return c.json({ error: "Admin access required" }, 403);
  const batch = await c.env.DB.prepare("SELECT * FROM payout_batches WHERE id = ? AND organization_id = ?").bind(c.req.param("id"), admin.organizationId).first<Record<string, unknown>>();
  if (!batch) return c.json({ error: "Payout batch not found" }, 404);
  const items = await c.env.DB.prepare(`SELECT i.id, i.amount_cents, i.currency, i.status, i.failure_reason, u.display_name AS contributor_name
    FROM payout_batch_items i JOIN users u ON u.id = i.contributor_id WHERE i.batch_id = ? ORDER BY i.created_at ASC`).bind(c.req.param("id")).all<Record<string, unknown>>();
  return c.json({
    id: String(batch.id), periodStart: String(batch.period_start), periodEnd: String(batch.period_end), currency: String(batch.currency),
    totalCents: Number(batch.total_cents), status: String(batch.status), itemCount: items.results.length, createdAt: String(batch.created_at),
    items: items.results.map((row) => ({ id: String(row.id), contributorName: String(row.contributor_name), amountCents: Number(row.amount_cents), currency: String(row.currency), status: String(row.status), failureReason: (row.failure_reason as string | null) ?? null })),
  });
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

type AuditActor = { id: string; organizationId: string; type: "user" | "contributor" | "service" | "admin"; residencyRegion: "za" | "eu" };

async function requestUser(c: { env: Bindings; req: { raw: Request } }): Promise<RequestUser | null> {
  return getRequestUser(c.env, c.req.raw);
}

async function requestActor(c: { env: Bindings; req: { raw: Request; header(name: string): string | undefined } }): Promise<AuditActor | null> {
  const user = await requestUser(c);
  if (!user) return null;
  const requestedResidency = c.req.header("x-residency-region");
  if (requestedResidency && requestedResidency !== user.residencyRegion) return null;
  const type = user.role === "admin" ? "admin" : user.role === "contributor" ? "contributor" : "user";
  return { id: user.id, organizationId: user.organizationId, type, residencyRegion: user.residencyRegion };
}

function allowedRole(user: RequestUser | null, roles: string[]): boolean {
  return Boolean(user && roles.includes(user.role));
}

const approvalLedgerAuditActions = [
  "seller.contract.signed",
  "seller.tender.approved",
  "seller.tender.rejected",
  "seller.tender.corrections_requested",
  "verification.case.updated",
  "asset.ai_tagging.requested",
  "asset.metadata.reviewed",
  "asset.approved",
  "asset.rejected",
  "asset.changes_requested",
] as const;

type ApprovalLedgerCategory = "user_account" | "image";
type ApprovalLedgerEntry = {
  id: string;
  category: ApprovalLedgerCategory;
  source: "signed_audit" | "workflow_event" | "r2_data_catalog";
  occurredAt: string;
  action: string;
  decision: string;
  actor: { id: string; name: string; role: string };
  subject: { id: string; name: string; type: string };
  resource: { type: string; id: string; title: string };
  streamId: string | null;
  sequence: number | null;
  notes: string | null;
  integrity: { status: "verified" | "failed" | "legacy" | "catalog"; hashValid: boolean | null; signatureValid: boolean | null; hash: string | null; r2Key: string | null };
};

function auditActorTypeForRole(role: string): "user" | "contributor" | "admin" {
  if (role === "admin") return "admin";
  if (role === "contributor") return "contributor";
  return "user";
}

function storedAuditEventFromRow(row: Record<string, unknown>): StoredAuditEvent {
  return {
    schemaVersion: 1 as const,
    eventId: String(row.event_id),
    streamId: String(row.stream_id),
    sequence: Number(row.sequence),
    occurredAt: String(row.occurred_at),
    actor: { id: String(row.actor_id), type: String(row.actor_type) as StoredAuditEvent["actor"]["type"] },
    action: String(row.action),
    resource: { type: String(row.resource_type), id: String(row.resource_id) },
    data: JSON.parse(String(row.data_json ?? "{}")) as Record<string, unknown>,
    residencyRegion: residencyRegionSchema.parse(String(row.residency_region)),
    previousHash: String(row.previous_hash),
    hash: String(row.event_hash),
    signature: String(row.signature),
    signatureAlgorithm: "Ed25519" as const,
    keyId: String(row.key_id),
    publicKeyJwk: JSON.parse(String(row.public_key_jwk)) as JsonWebKey,
    r2Key: String(row.r2_key),
  };
}

function ledgerCategoryForAction(action: string): ApprovalLedgerCategory {
  return action.startsWith("asset.") ? "image" : "user_account";
}

function ledgerDecision(action: string, data: Record<string, unknown>): string {
  if (typeof data.decision === "string") return data.decision;
  if (typeof data.status === "string") return data.status;
  if (action.endsWith(".signed")) return "signed";
  if (action.endsWith(".approved")) return "approved";
  if (action.endsWith(".rejected")) return "rejected";
  if (action.endsWith(".corrections_requested")) return "corrections requested";
  if (action.endsWith(".changes_requested")) return "changes requested";
  if (action.endsWith(".reviewed")) return "reviewed";
  if (action.endsWith(".requested")) return "requested";
  return action.split(".").at(-1)?.replaceAll("_", " ") ?? action;
}

function ledgerTitleForAction(action: string): string {
  const titles: Record<string, string> = {
    "seller.contract.signed": "Seller signed contributor terms",
    "seller.tender.approved": "User account approved",
    "seller.tender.rejected": "User account rejected",
    "seller.tender.corrections_requested": "User account corrections requested",
    "verification.case.updated": "Verification case updated",
    "asset.ai_tagging.requested": "Image AI enrichment requested",
    "asset.metadata.reviewed": "Image metadata signed off",
    "asset.approved": "Image approved",
    "asset.rejected": "Image rejected",
    "asset.changes_requested": "Image changes requested",
  };
  return titles[action] ?? action.replaceAll(".", " ");
}

async function appendAssetApprovalAudit(c: AppContext, actor: RequestUser, input: { assetId: string; ownerId: string; action: string; decision: string; status: string; stage: string; assetRevision?: number | null; notes?: string | null }): Promise<string | null> {
  try {
    const audit = await appendAuditEvent(c.env, {
      streamId: `asset:${input.assetId}`,
      actorId: actor.id,
      actorType: auditActorTypeForRole(actor.role),
      action: input.action,
      resourceType: "asset",
      resourceId: input.assetId,
      data: redactAuditData({
        decision: input.decision,
        status: input.status,
        stage: input.stage,
        actorRole: actor.role,
        ownerId: input.ownerId,
        assetRevision: input.assetRevision ?? null,
        notes: input.notes ?? null,
      }),
      organizationId: actor.organizationId,
      residencyRegion: actor.residencyRegion,
      actorResidencyRegion: actor.residencyRegion,
    });
    return audit.event.eventId;
  } catch (error) {
    logEvent("warn", "approval_ledger.audit_write_failed", c.get("trace"), {
      assetId: input.assetId,
      action: input.action,
      error: error instanceof Error ? error.message : "unknown-error",
    });
    return null;
  }
}

const approvalLedgerQuerySchema = z.object({
  category: z.enum(["all", "user_account", "image"]).default("all"),
  source: z.enum(["all", "signed_audit", "workflow_event"]).default("all"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const adminAuditSearchQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  action: z.string().regex(/^[a-z0-9._:-]{2,120}$/).optional(),
  resourceType: z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function catalogLedgerEntry(row: AuditCatalogRow): ApprovalLedgerEntry {
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(row.data_json) as Record<string, unknown>; } catch { data = {}; }
  const category = ledgerCategoryForAction(row.action);
  const resourceTitle = typeof data.title === "string" && data.title.trim() ? data.title : row.resource_id;
  const subjectId = category === "image" && typeof data.ownerId === "string" ? data.ownerId : row.resource_id;
  return {
    id: row.event_id,
    category,
    source: "r2_data_catalog",
    occurredAt: row.occurred_at,
    action: ledgerTitleForAction(row.action),
    decision: ledgerDecision(row.action, data),
    actor: { id: row.actor_id, name: row.actor_id, role: row.actor_type },
    subject: { id: subjectId, name: subjectId, type: category === "image" ? "seller" : "user account" },
    resource: { type: row.resource_type, id: row.resource_id, title: resourceTitle },
    streamId: row.stream_id,
    sequence: row.sequence || null,
    notes: typeof data.notes === "string" && data.notes.trim() ? data.notes.trim() : null,
    integrity: { status: "catalog", hashValid: null, signatureValid: null, hash: row.event_hash, r2Key: null },
  };
}

function auditLedgerEntry(row: Record<string, unknown>, event: StoredAuditEvent, verification: { hashValid: boolean; signatureValid: boolean }): ApprovalLedgerEntry {
  const category = ledgerCategoryForAction(event.action);
  const data = event.data;
  const assetTitle = String(row.asset_title ?? "");
  const tenderContributorName = String(row.tender_contributor_name ?? "");
  const contractContributorName = String(row.contract_contributor_name ?? "");
  const verificationContributorName = String(row.verification_contributor_name ?? "");
  const subjectName = category === "image"
    ? String(row.asset_owner_name ?? event.resource.id)
    : tenderContributorName || contractContributorName || verificationContributorName || event.streamId.replace(/^contributor:/, "");
  const subjectId = category === "image"
    ? String(row.asset_owner_id ?? data.ownerId ?? event.resource.id)
    : String(row.tender_contributor_id ?? row.contract_contributor_id ?? row.verification_contributor_id ?? event.streamId.replace(/^contributor:/, ""));
  const title = category === "image"
    ? assetTitle || String(data.title ?? event.resource.id)
    : subjectName;
  const notes = typeof data.notes === "string" && data.notes.trim() ? data.notes.trim() : null;
  return {
    id: event.eventId,
    category,
    source: "signed_audit",
    occurredAt: event.occurredAt,
    action: ledgerTitleForAction(event.action),
    decision: ledgerDecision(event.action, data),
    actor: { id: event.actor.id, name: String(row.actor_name ?? event.actor.id), role: String(row.actor_role ?? event.actor.type) },
    subject: { id: subjectId, name: subjectName, type: category === "image" ? "seller" : "user account" },
    resource: { type: event.resource.type, id: event.resource.id, title },
    streamId: event.streamId,
    sequence: event.sequence,
    notes,
    integrity: {
      status: verification.hashValid && verification.signatureValid ? "verified" : "failed",
      hashValid: verification.hashValid,
      signatureValid: verification.signatureValid,
      hash: event.hash,
      r2Key: event.r2Key,
    },
  };
}

function workflowLedgerEntry(row: Record<string, unknown>): ApprovalLedgerEntry {
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(String(row.payload ?? "{}")) as Record<string, unknown>; } catch { payload = {}; }
  const eventType = String(row.event_type);
  const decision = eventType === "approved" ? "approved" : eventType === "rejected" ? "rejected" : "reviewed";
  const action = eventType === "approved" ? "Image approved" : eventType === "rejected" ? "Image rejected" : "Image metadata signed off";
  return {
    id: String(row.id),
    category: "image",
    source: "workflow_event",
    occurredAt: String(row.created_at),
    action,
    decision,
    actor: { id: String(row.actor_id), name: String(row.actor_name ?? row.actor_id), role: String(row.actor_role ?? "editor") },
    subject: { id: String(row.owner_id), name: String(row.owner_name ?? row.owner_id), type: "seller" },
    resource: { type: "asset", id: String(row.asset_id), title: String(row.asset_title ?? row.asset_id) },
    streamId: null,
    sequence: null,
    notes: typeof payload.notes === "string" && payload.notes.trim() ? payload.notes.trim() : null,
    integrity: { status: "legacy", hashValid: null, signatureValid: null, hash: null, r2Key: null },
  };
}

app.get("/api/admin/approval-ledger", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["admin"])) return c.json({ error: "Admin access required" }, 403);
  const filters = approvalLedgerQuerySchema.parse({
    category: c.req.query("category") ?? "all",
    source: c.req.query("source") ?? "all",
    limit: c.req.query("limit") ?? 200,
  });
  const placeholders = approvalLedgerAuditActions.map(() => "?").join(", ");
  const auditRows = filters.source === "workflow_event" ? { results: [] as Record<string, unknown>[] } : await c.env.DB.prepare(`
    SELECT e.*,
      actor.display_name AS actor_name, actor.role AS actor_role,
      asset.title AS asset_title, asset.kind AS asset_kind, asset.owner_id AS asset_owner_id, asset_owner.display_name AS asset_owner_name,
      tender.contributor_id AS tender_contributor_id, tender.status AS tender_status, tender_user.display_name AS tender_contributor_name,
      contract.contributor_id AS contract_contributor_id, contract_user.display_name AS contract_contributor_name,
      verification.contributor_id AS verification_contributor_id, verification.status AS verification_status, verification_user.display_name AS verification_contributor_name
    FROM audit_log_events e
      LEFT JOIN users actor ON actor.id = e.actor_id
      LEFT JOIN assets asset ON e.resource_type = 'asset' AND asset.id = e.resource_id AND asset.organization_id = ? AND asset.kind = 'image'
      LEFT JOIN users asset_owner ON asset_owner.id = asset.owner_id
      LEFT JOIN onboarding_tenders tender ON e.resource_type = 'onboarding_tender' AND tender.id = e.resource_id AND tender.organization_id = ?
      LEFT JOIN users tender_user ON tender_user.id = tender.contributor_id
      LEFT JOIN seller_contracts contract ON e.resource_type = 'seller_contract' AND contract.id = e.resource_id AND contract.organization_id = ?
      LEFT JOIN users contract_user ON contract_user.id = contract.contributor_id
      LEFT JOIN contributor_verification_cases verification ON e.resource_type = 'verification_case' AND verification.id = e.resource_id AND verification.organization_id = e.organization_id AND verification.residency_region = e.residency_region
      LEFT JOIN organization_memberships verification_membership ON verification_membership.user_id = verification.contributor_id AND verification_membership.organization_id = ? AND verification_membership.status = 'active'
      LEFT JOIN users verification_user ON verification_user.id = verification.contributor_id
    WHERE e.organization_id = ?
      AND e.action IN (${placeholders})
      AND e.residency_region = ?
      AND (
        asset.id IS NOT NULL OR tender.id IS NOT NULL OR contract.id IS NOT NULL OR verification_membership.id IS NOT NULL
        OR e.stream_id IN (SELECT 'contributor:' || user_id FROM organization_memberships WHERE organization_id = ? AND status = 'active')
      )
    ORDER BY e.occurred_at DESC
    LIMIT ?
  `).bind(
    user.organizationId,
    user.organizationId,
    user.organizationId,
    user.organizationId,
    user.organizationId,
    ...approvalLedgerAuditActions,
    user.residencyRegion,
    user.organizationId,
    filters.limit,
  ).all<Record<string, unknown>>();

  const entries: ApprovalLedgerEntry[] = [];
  for (const row of auditRows.results as Record<string, unknown>[]) {
    const event = storedAuditEventFromRow(row);
    const verification = await verifyAuditEvent(c.env, event);
    const entry = auditLedgerEntry(row, event, verification);
    if (filters.category === "all" || entry.category === filters.category) entries.push(entry);
  }

  if (filters.source !== "signed_audit" && (filters.category === "all" || filters.category === "image")) {
    try {
      const metadataRows = await c.env.DB.prepare(`
        SELECT e.id, e.asset_id, e.actor_id, e.event_type, e.payload, e.created_at,
          a.title AS asset_title, a.owner_id, owner.display_name AS owner_name,
          actor.display_name AS actor_name, actor.role AS actor_role
        FROM metadata_events e
          JOIN assets a ON a.id = e.asset_id AND a.organization_id = ? AND a.kind = 'image'
          LEFT JOIN users owner ON owner.id = a.owner_id
          LEFT JOIN users actor ON actor.id = e.actor_id
        WHERE e.event_type IN ('approved', 'rejected', 'curator_corrected')
          AND NOT EXISTS (
            SELECT 1 FROM audit_log_events audit
            WHERE audit.organization_id = ?
              AND audit.resource_type = 'asset'
              AND audit.resource_id = e.asset_id
              AND audit.actor_id = e.actor_id
              AND audit.action = CASE e.event_type
                WHEN 'approved' THEN 'asset.approved'
                WHEN 'rejected' THEN 'asset.rejected'
                ELSE 'asset.metadata.reviewed'
              END
          )
        ORDER BY e.created_at DESC
        LIMIT ?
      `).bind(user.organizationId, user.organizationId, filters.limit).all<Record<string, unknown>>();
      entries.push(...(metadataRows.results as Record<string, unknown>[]).map(workflowLedgerEntry));
    } catch (error) {
      logEvent("warn", "approval_ledger.workflow_events_unavailable", c.get("trace"), { error: error instanceof Error ? error.message : "unknown-error" });
    }
  }

  entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const limited = entries.slice(0, filters.limit);
  return c.json({
    organization: { id: user.organizationId, name: user.organizationName },
    filters,
    summary: {
      total: limited.length,
      userAccount: limited.filter((entry) => entry.category === "user_account").length,
      image: limited.filter((entry) => entry.category === "image").length,
      signedAudit: limited.filter((entry) => entry.source === "signed_audit").length,
      legacyWorkflow: limited.filter((entry) => entry.source === "workflow_event").length,
      verifiedIntegrity: limited.filter((entry) => entry.integrity.status === "verified").length,
      failedIntegrity: limited.filter((entry) => entry.integrity.status === "failed").length,
    },
    analytics: auditAnalyticsStatus(c.env as AuditAnalyticsConfig),
    results: limited,
  });
});

app.get("/api/admin/analytics/audit-search", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["admin"])) return c.json({ error: "Admin access required" }, 403);
  const filters = adminAuditSearchQuerySchema.parse({
    q: c.req.query("q") || undefined,
    action: c.req.query("action") || undefined,
    resourceType: c.req.query("resourceType") || undefined,
    from: c.req.query("from") || undefined,
    to: c.req.query("to") || undefined,
    limit: c.req.query("limit") ?? 50,
  });
  const clauses = [
    "e.organization_id = ?",
    "e.residency_region = ?",
    `(e.stream_id IN (SELECT 'contributor:' || user_id FROM organization_memberships WHERE organization_id = ? AND status = 'active')
      OR EXISTS (SELECT 1 FROM assets scoped_asset WHERE e.resource_type = 'asset' AND scoped_asset.id = e.resource_id AND scoped_asset.organization_id = ?)
      OR EXISTS (SELECT 1 FROM onboarding_tenders scoped_tender WHERE e.resource_type = 'onboarding_tender' AND scoped_tender.id = e.resource_id AND scoped_tender.organization_id = ?)
      OR EXISTS (SELECT 1 FROM seller_contracts scoped_contract WHERE e.resource_type = 'seller_contract' AND scoped_contract.id = e.resource_id AND scoped_contract.organization_id = ?)
      OR EXISTS (SELECT 1 FROM contributor_verification_cases scoped_case JOIN organization_memberships scoped_membership ON scoped_membership.user_id = scoped_case.contributor_id AND scoped_membership.organization_id = ? AND scoped_membership.status = 'active' WHERE e.resource_type = 'verification_case' AND scoped_case.id = e.resource_id AND scoped_case.organization_id = e.organization_id AND scoped_case.residency_region = e.residency_region))`,
  ];
  const values: (string | number)[] = [user.organizationId, user.residencyRegion, user.organizationId, user.organizationId, user.organizationId, user.organizationId, user.organizationId];
  if (filters.q) {
    clauses.push("(e.action LIKE ? OR e.resource_type LIKE ? OR e.resource_id LIKE ? OR e.actor_id LIKE ? OR e.data_json LIKE ?)");
    const pattern = `%${filters.q}%`;
    values.push(pattern, pattern, pattern, pattern, pattern);
  }
  if (filters.action) { clauses.push("e.action = ?"); values.push(filters.action); }
  if (filters.resourceType) { clauses.push("e.resource_type = ?"); values.push(filters.resourceType); }
  if (filters.from) { clauses.push("e.occurred_at >= ?"); values.push(filters.from); }
  if (filters.to) { clauses.push("e.occurred_at <= ?"); values.push(filters.to); }
  const rows = await c.env.DB.prepare(`SELECT e.*,
      actor.display_name AS actor_name, actor.role AS actor_role,
      asset.title AS asset_title, asset.owner_id AS asset_owner_id, asset_owner.display_name AS asset_owner_name,
      tender.contributor_id AS tender_contributor_id, tender_user.display_name AS tender_contributor_name,
      contract.contributor_id AS contract_contributor_id, contract_user.display_name AS contract_contributor_name,
      verification.contributor_id AS verification_contributor_id, verification_user.display_name AS verification_contributor_name
    FROM audit_log_events e
      LEFT JOIN users actor ON actor.id = e.actor_id
      LEFT JOIN assets asset ON e.resource_type = 'asset' AND asset.id = e.resource_id AND asset.organization_id = ?
      LEFT JOIN users asset_owner ON asset_owner.id = asset.owner_id
      LEFT JOIN onboarding_tenders tender ON e.resource_type = 'onboarding_tender' AND tender.id = e.resource_id AND tender.organization_id = ?
      LEFT JOIN users tender_user ON tender_user.id = tender.contributor_id
      LEFT JOIN seller_contracts contract ON e.resource_type = 'seller_contract' AND contract.id = e.resource_id AND contract.organization_id = ?
      LEFT JOIN users contract_user ON contract_user.id = contract.contributor_id
      LEFT JOIN contributor_verification_cases verification ON e.resource_type = 'verification_case' AND verification.id = e.resource_id AND verification.organization_id = e.organization_id AND verification.residency_region = e.residency_region
      LEFT JOIN users verification_user ON verification_user.id = verification.contributor_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY e.occurred_at DESC LIMIT ?`).bind(user.organizationId, user.organizationId, user.organizationId, ...values, filters.limit).all<Record<string, unknown>>();
  const d1Entries: ApprovalLedgerEntry[] = [];
  for (const row of rows.results as Record<string, unknown>[]) {
    const event = storedAuditEventFromRow(row);
    const verification = await verifyAuditEvent(c.env, event);
    d1Entries.push(auditLedgerEntry(row, event, verification));
  }

  const connectorStatus = auditAnalyticsStatus(c.env as AuditAnalyticsConfig);
  let catalogEntries: ApprovalLedgerEntry[] = [];
  let catalogSearch: "ready" | "not_configured" | "unavailable" = connectorStatus.r2Sql === "configured" ? "ready" : "not_configured";
  if (connectorStatus.r2Sql === "configured") {
    try {
      const catalogRows = await searchR2AuditCatalog(c.env as AuditAnalyticsConfig, { ...filters, organizationId: user.organizationId, residencyRegion: user.residencyRegion });
      catalogEntries = catalogRows.map(catalogLedgerEntry);
    } catch (error) {
      catalogSearch = "unavailable";
      logEvent("warn", "audit.analytics_catalog_search_failed", c.get("trace"), { error: error instanceof Error ? error.message : "unknown-error" });
    }
  }
  const seen = new Set(d1Entries.map((entry) => entry.id));
  const results = [...d1Entries, ...catalogEntries.filter((entry) => !seen.has(entry.id))]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, filters.limit);
  return c.json({
    organization: { id: user.organizationId, name: user.organizationName },
    filters,
    connectors: { ...connectorStatus, catalogSearch },
    results,
  });
});

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
      organizationId: actor.organizationId,
      actorId: actor.id,
      actorType: actor.type,
      residencyRegion,
      actorResidencyRegion: actor.residencyRegion,
    });
    return c.json({ ...result, integrity: { algorithm: "SHA-256 + Ed25519", immutable: true } }, result.created ? 201 : 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AUDIT_WRITE_FAILED";
    const status = message === "RESIDENCY_POLICY_VIOLATION" || message === "AUDIT_EVENT_SCOPE_MISMATCH" ? 403 : message === "AUDIT_CHAIN_CONFLICT" ? 409 : 400;
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
  const result = await c.env.DB.prepare("SELECT * FROM audit_log_events WHERE organization_id = ? AND stream_id = ? AND residency_region = ? ORDER BY sequence DESC LIMIT ?")
    .bind(actor.organizationId, streamId, residencyRegion, limit).all<Record<string, unknown>>();
  const events: Array<StoredAuditEvent & { verification: { hashValid: boolean; signatureValid: boolean } }> = [];
  for (const row of result.results as Record<string, unknown>[]) {
    const event = storedAuditEventFromRow(row);
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
  const result = await exportAuditEvents(c.env, { ...filters, organizationId: actor.organizationId, createdBy: actor.id });
  return c.json({ ...result, download: `/api/audit/exports/${result.exportId}` }, 201);
});

app.get("/api/audit/exports/:exportId", async (c) => {
  const actor = await requestActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  if (actor.type !== "admin" && actor.type !== "service") return c.json({ error: "Admin or service identity required" }, 403);
  const row = await c.env.DB.prepare("SELECT * FROM audit_exports WHERE id = ? AND organization_id = ? AND residency_region = ? AND created_by IS NOT NULL").bind(c.req.param("exportId"), actor.organizationId, actor.residencyRegion).first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Export not found" }, 404);
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
  await c.env.DB.prepare("INSERT INTO contributor_verification_cases (id, organization_id, contributor_id, residency_region, subject_type, provider, retention_until) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(caseId, actor.organizationId, actor.id, payload.residencyRegion, payload.subjectType, payload.provider, retentionUntil).run();
  const audit = await appendAuditEvent(c.env, {
    streamId: `contributor:${actor.id}`,
    actorId: actor.id,
    actorType: actor.type,
    action: "verification.case.created",
    resourceType: "verification_case",
    resourceId: caseId,
    data: { subjectType: payload.subjectType, provider: payload.provider, retentionUntil },
    organizationId: actor.organizationId,
    residencyRegion: payload.residencyRegion,
    actorResidencyRegion: actor.residencyRegion,
  });
  return c.json({ caseId, status: "pending", provider: payload.provider, retentionUntil, auditEventId: audit.event.eventId, next: ["collect consent", "submit identity and address documents to KYC provider", "complete liveness check", "screen sanctions, PEP and adverse media", "verify beneficial ownership for businesses"] }, 201);
});

app.get("/api/verification/cases/:caseId", async (c) => {
  const actor = await requestActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  const row = await c.env.DB.prepare("SELECT id, organization_id, contributor_id, residency_region, subject_type, provider, status, risk_level, sanctions_status, pep_status, adverse_media_status, retention_until, created_at, updated_at FROM contributor_verification_cases WHERE id = ? AND organization_id = ? AND residency_region = ?")
    .bind(c.req.param("caseId"), actor.organizationId, actor.residencyRegion).first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Verification case not found" }, 404);
  if (String(row.contributor_id) !== actor.id && actor.type !== "admin") return c.json({ error: "Forbidden" }, 403);
  return c.json({ case: row, documents: await c.env.DB.prepare("SELECT id, document_type, content_sha256, issued_country, expires_at, created_at, uploaded_at, size_bytes FROM verification_documents WHERE case_id = ?").bind(c.req.param("caseId")).all() });
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
  const row = await c.env.DB.prepare("SELECT organization_id, contributor_id, residency_region, retention_until FROM contributor_verification_cases WHERE id = ? AND organization_id = ? AND residency_region = ?").bind(c.req.param("caseId"), actor.organizationId, actor.residencyRegion).first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Verification case not found" }, 404);
  if (String(row.contributor_id) !== actor.id && actor.type !== "admin") return c.json({ error: "Forbidden" }, 403);
  if (String(row.residency_region) !== actor.residencyRegion) return c.json({ error: "Residency mismatch" }, 403);
  const documentId = crypto.randomUUID();
  const objectKey = `verification/${String(row.organization_id)}/${String(row.contributor_id)}/${c.req.param("caseId")}/${documentId}`;
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
    organizationId: actor.organizationId,
    residencyRegion: actor.residencyRegion,
    actorResidencyRegion: actor.residencyRegion,
  });
  return c.json({ documentId, upload: "Upload the document through the authenticated content route. Raw object keys and identity documents are never returned.", retentionUntil: row.retention_until }, 201);
});

app.put("/api/verification/documents/:documentId/content", async (c) => {
  const actor = await requestActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  const document = await c.env.DB.prepare(`SELECT d.id, d.case_id, d.object_key, d.content_sha256, vc.organization_id, vc.contributor_id, vc.residency_region
    FROM verification_documents d JOIN contributor_verification_cases vc ON vc.id = d.case_id WHERE d.id = ? AND vc.organization_id = ? AND vc.residency_region = ?`)
    .bind(c.req.param("documentId"), actor.organizationId, actor.residencyRegion).first<Record<string, unknown>>();
  if (!document) return c.json({ error: "Verification document not found" }, 404);
  if (String(document.contributor_id) !== actor.id && actor.type !== "admin") return c.json({ error: "Forbidden" }, 403);
  const claimedLength = Number(c.req.header("content-length") ?? 0);
  if (claimedLength > 12_000_000) return c.json({ error: "Verification document exceeds the 12 MB limit" }, 413);
  const bytes = await c.req.raw.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > 12_000_000) return c.json({ error: "Verification document is empty or too large" }, 413);
  const contentSha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  if (contentSha256 !== String(document.content_sha256)) return c.json({ error: "Document checksum does not match the registered metadata" }, 422);
  await verificationBucket(c.env, residencyRegionSchema.parse(String(document.residency_region))).put(String(document.object_key), bytes, { httpMetadata: { contentType: c.req.header("content-type") ?? "application/octet-stream" } });
  await c.env.DB.prepare("UPDATE verification_documents SET uploaded_at = CURRENT_TIMESTAMP, size_bytes = ? WHERE id = ? AND case_id = (SELECT id FROM contributor_verification_cases WHERE id = ? AND organization_id = ? AND residency_region = ?)")
    .bind(bytes.byteLength, String(document.id), String(document.case_id), actor.organizationId, actor.residencyRegion).run();
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
  const document = await c.env.DB.prepare(`SELECT d.id, d.case_id, d.object_key, d.document_type, d.content_sha256, vc.organization_id, vc.contributor_id, vc.residency_region
    FROM verification_documents d JOIN contributor_verification_cases vc ON vc.id = d.case_id WHERE d.id = ? AND vc.organization_id = ? AND vc.residency_region = ?`)
    .bind(c.req.param("documentId"), actor.organizationId, actor.residencyRegion).first<Record<string, unknown>>();
  if (!document) return c.json({ error: "Verification document not found" }, 404);
  const residencyRegion = residencyRegionSchema.parse(String(document.residency_region));
  if (residencyRegion !== actor.residencyRegion || String(document.organization_id) !== actor.organizationId) return c.json({ error: "Residency or organization mismatch" }, 403);
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

app.post("/api/webhooks/didit", async (c) => {
  const webhookSecret = diditWebhookSecret(c.env);
  if (!webhookSecret) return c.json({ error: "Didit webhook secret is not configured" }, 503);
  const rawBody = await c.req.text();
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody) as Record<string, unknown>; } catch { return c.json({ error: "Invalid Didit webhook JSON" }, 400); }
  const verified = await verifyDiditWebhook({ secret: webhookSecret, rawBody, payload, signatureV2: c.req.header("x-signature-v2"), signature: c.req.header("x-signature"), timestamp: c.req.header("x-timestamp") });
  if (!verified) return c.json({ error: "Invalid or stale Didit webhook signature" }, 401);
  const sessionId = typeof payload.session_id === "string" ? payload.session_id : "";
  const status = typeof payload.status === "string" ? payload.status : "";
  const webhookType = typeof payload.webhook_type === "string" ? payload.webhook_type : "status.updated";
  if (!sessionId || !status) return c.json({ error: "Didit session_id and status are required" }, 422);
  const eventId = typeof payload.event_id === "string" && payload.event_id ? payload.event_id : `didit:${await sha256Hex(`${sessionId}:${webhookType}:${String(payload.timestamp ?? c.req.header("x-timestamp") ?? "")}:${rawBody}`)}`;
  const seller = await c.env.DB.prepare("SELECT contributor_id FROM seller_onboarding_profiles WHERE didit_session_id = ?").bind(sessionId).first<{ contributor_id: string }>();
  if (!seller) return c.json({ error: "Didit session is not recognized" }, 404);
  const verificationCases = await c.env.DB.prepare(`
    SELECT id, organization_id, contributor_id, residency_region
    FROM contributor_verification_cases
    WHERE contributor_id = ? AND provider = 'didit' AND provider_case_id = ? AND organization_id IS NOT NULL
    ORDER BY updated_at DESC LIMIT 2
  `).bind(seller.contributor_id, sessionId).all<{ id: string; organization_id: string; contributor_id: string; residency_region: string }>();
  if (verificationCases.results.length !== 1) return c.json({ error: verificationCases.results.length ? "Didit verification case is ambiguous across organizations" : "Didit verification case is not recognized for an organization" }, verificationCases.results.length ? 409 : 404);
  const verificationCase = verificationCases.results[0];
  const inserted = await c.env.DB.prepare("INSERT OR IGNORE INTO didit_webhook_events (event_id, session_id, webhook_type, status) VALUES (?, ?, ?, ?)").bind(eventId, sessionId, webhookType, status).run();
  if (!Number(inserted.meta.changes ?? 0)) return c.json({ accepted: true, duplicate: true, eventId });
  const normalizedStatus = normalizeDiditStatus(status);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE seller_onboarding_profiles SET didit_status = ?, didit_provider_reference = ?, updated_at = CURRENT_TIMESTAMP WHERE contributor_id = ? AND didit_session_id = ?").bind(normalizedStatus, sessionId, seller.contributor_id, sessionId),
    c.env.DB.prepare("UPDATE contributor_verification_cases SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ? AND contributor_id = ? AND provider = 'didit' AND provider_case_id = ?").bind(normalizedStatus, verificationCase.id, verificationCase.organization_id, verificationCase.contributor_id, sessionId),
    c.env.DB.prepare("UPDATE contributor_profiles SET identity_status = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").bind(normalizedStatus === "verified" ? "verified" : normalizedStatus === "rejected" ? "rejected" : "submitted", seller.contributor_id),
  ]);
  const audit = await appendAuditEvent(c.env, {
    eventId: `didit:${await sha256Hex(eventId)}`,
    streamId: `contributor:${verificationCase.contributor_id}`,
    actorId: "didit-provider",
    actorType: "service",
    action: "verification.case.updated",
    resourceType: "verification_case",
    resourceId: verificationCase.id,
    data: { status: normalizedStatus, provider: "didit", webhookType },
    organizationId: verificationCase.organization_id,
    residencyRegion: residencyRegionSchema.parse(verificationCase.residency_region),
    actorResidencyRegion: residencyRegionSchema.parse(verificationCase.residency_region),
  });
  return c.json({ accepted: true, eventId, sessionId, status: normalizedStatus, auditEventId: audit.event.eventId });
});

app.post("/api/webhooks/kyc", async (c) => {
  if (!c.env.KYC_WEBHOOK_SECRET) return c.json({ error: "KYC webhook secret is not configured" }, 503);
  const body = await c.req.text();
  if (!(await verifyKycWebhook(c.env.KYC_WEBHOOK_SECRET, c.req.header("x-kyc-signature") ?? "", body))) return c.json({ error: "Invalid KYC webhook signature" }, 401);
  const payload = kycWebhookSchema.parse(JSON.parse(body));
  const row = await c.env.DB.prepare("SELECT organization_id, contributor_id, residency_region FROM contributor_verification_cases WHERE id = ? AND organization_id IS NOT NULL").bind(payload.caseId).first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Verification case not found" }, 404);
  await c.env.DB.prepare(`
    UPDATE contributor_verification_cases
    SET status = ?, risk_level = ?, sanctions_status = ?, pep_status = ?, adverse_media_status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND organization_id = ? AND residency_region = ?
  `).bind(payload.status, payload.riskLevel, payload.sanctionsStatus, payload.pepStatus, payload.adverseMediaStatus, payload.caseId, String(row.organization_id), String(row.residency_region)).run();
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
    organizationId: String(row.organization_id),
  });
  return c.json({ accepted: true, caseId: payload.caseId, status: payload.status, auditEventId: audit.event.eventId });
});

app.on(["GET", "HEAD"], "/api/assets/:id/preview", async (c) => {
  const user = await requestUser(c);
  const row = await c.env.DB.prepare(`
    SELECT a.id, a.organization_id, a.owner_id, a.kind, a.status, a.source_file_name, a.preview_key, a.preview_640_key, a.preview_1200_key, a.original_key
    FROM assets a
    WHERE a.id = ?
  `).bind(c.req.param("id")).first<Record<string, unknown>>();
  const requestedWidth = c.req.query("width") === "640" ? 640 : c.req.query("width") === "1200" ? 1200 : undefined;
  const mediaKey = row ? responsivePreviewKey(row, requestedWidth) : null;
  const canInspectPrivate = Boolean(user && row && String(row.organization_id) === user.organizationId
    && (String(row.owner_id) === user.id || allowedRole(user, ["editor", "admin"])));
  if (!row || !mediaKey || (row.status !== "published" && !canInspectPrivate)) {
    return c.json({ error: "Published media preview not found" }, 404);
  }

  const object = c.req.method === "HEAD"
    ? await headReadableMedia(c.env, mediaKey)
    : await getReadableMedia(c.env, mediaKey, c.req.header("Range") ? { range: c.req.raw.headers } : undefined);
  if (!object) return c.json({ error: "Media preview is unavailable" }, 404);
  const response = createMediaResponse(c.req.raw, object as R2ObjectBody, previewContentType(row));
  response.headers.set("Cache-Control", row.status === "published" && row.kind === "image" ? "public, max-age=3600, stale-while-revalidate=86400" : "private, no-store, max-age=0");
  return response;
});

app.get("/api/assets/:id/preview-access", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ paid: false });
  const freeLimit = Math.max(0, Math.min(5, Number(c.env.INTRODUCTORY_FREE_DOWNLOAD_LIMIT ?? 3)));
  const row = await c.env.DB.prepare(`
    SELECT a.organization_id, a.owner_id, a.kind, a.rights_status, a.free_download_enabled,
      EXISTS(
        SELECT 1 FROM licences l
        WHERE l.asset_id = a.id AND l.organization_id = a.organization_id
          AND l.buyer_id = ? AND l.status = 'paid'
      ) AS paid_entitlement,
      EXISTS(
        SELECT 1 FROM photographer_subscriptions s
        WHERE s.organization_id = a.organization_id AND s.photographer_id = a.owner_id
          AND s.subscriber_id = ? AND s.status = 'active' AND s.paid_at IS NOT NULL
          AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)
      ) AS subscription_entitlement,
      EXISTS(
        SELECT 1 FROM buyer_subscriptions bs
        WHERE bs.organization_id = a.organization_id AND bs.buyer_id = ?
          AND bs.status IN ('active', 'non-renewing')
      ) AS platform_subscription_entitlement,
      EXISTS(
        SELECT 1 FROM buyer_free_downloads fd
        WHERE fd.organization_id = a.organization_id AND fd.buyer_id = ? AND fd.asset_id = a.id
      ) AS introductory_free_entitlement
    FROM assets a
    WHERE a.id = ? AND a.status = 'published'
  `).bind(user.id, user.id, user.id, user.id, c.req.param("id")).first<Record<string, unknown>>();
  const used = Number((await c.env.DB.prepare("SELECT COUNT(*) AS total FROM buyer_free_downloads WHERE organization_id = ? AND buyer_id = ?").bind(user.organizationId, user.id).first<{ total: number }>())?.total ?? 0);
  const paid = Boolean(row && String(row.organization_id) === user.organizationId && (
    String(row.owner_id) === user.id || allowedRole(user, ["editor", "admin"])
      || Number(row.paid_entitlement ?? 0) === 1 || Number(row.subscription_entitlement ?? 0) === 1 || Number(row.platform_subscription_entitlement ?? 0) === 1 || Number(row.introductory_free_entitlement ?? 0) === 1
  ));
  return c.json({ paid, freeDownload: Boolean(row && row.kind === "image" && row.rights_status === "verified" && Number(row.free_download_enabled) === 1), freeDownloadsUsed: used, freeDownloadsRemaining: archiveDomain.introductoryDownloadsRemaining(used, freeLimit), freeDownloadLimit: freeLimit });
});

app.get("/api/my/free-downloads", async (c) => {
  const user = await buyerAccount(c);
  if (!user || !allowedRole(user, ["buyer", "admin"])) return c.json({ error: "Buyer access required" }, user ? 403 : 401);
  const limit = Math.max(0, Math.min(5, Number(c.env.INTRODUCTORY_FREE_DOWNLOAD_LIMIT ?? 3)));
  const claims = await c.env.DB.prepare(`SELECT fd.id, fd.asset_id, a.title, fd.created_at
    FROM buyer_free_downloads fd JOIN assets a ON a.id = fd.asset_id
    WHERE fd.organization_id = ? AND fd.buyer_id = ? ORDER BY fd.created_at DESC LIMIT 100`).bind(user.organizationId, user.id).all<Record<string, unknown>>();
  return c.json({ limit, used: claims.results.length, remaining: archiveDomain.introductoryDownloadsRemaining(claims.results.length, limit), downloads: claims.results });
});

app.on(["GET", "HEAD"], "/api/assets/:id/poster", async (c) => {
  const user = await requestUser(c);
  const row = await c.env.DB.prepare("SELECT id, organization_id, owner_id, kind, status, source_file_name, video_poster_key FROM assets WHERE id = ?")
    .bind(c.req.param("id")).first<Record<string, unknown>>();
  const canInspectPrivate = Boolean(user && row && String(row.organization_id) === user.organizationId && (String(row.owner_id) === user.id || allowedRole(user, ["editor", "admin"])));
  const key = typeof row?.video_poster_key === "string" ? row.video_poster_key.trim() : "";
  if (!row || row.kind !== "video" || !key || (row.status !== "published" && !canInspectPrivate)) return c.json({ error: "Video poster not found" }, 404);
  const object = c.req.method === "HEAD" ? await headReadableMedia(c.env, key) : await getReadableMedia(c.env, key);
  if (!object) return c.json({ error: "Video poster unavailable" }, 404);
  const response = createMediaResponse(c.req.raw, object as R2ObjectBody, "image/webp");
  response.headers.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
  return response;
});

app.on(["GET", "HEAD"], "/api/assets/:id/original", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const row = await c.env.DB.prepare(`
    SELECT a.id, a.organization_id, a.kind, a.status, a.rights_status, a.source_file_name, a.original_key, a.owner_id, a.free_download_enabled,
      EXISTS(
        SELECT 1 FROM licences l
        WHERE l.asset_id = a.id AND l.organization_id = a.organization_id
          AND l.buyer_id = ? AND l.status = 'paid'
      ) AS paid_entitlement,
      EXISTS(
        SELECT 1 FROM photographer_subscriptions s
        WHERE s.organization_id = a.organization_id AND s.photographer_id = a.owner_id
          AND s.subscriber_id = ? AND s.status = 'active' AND s.paid_at IS NOT NULL
          AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)
      ) AS subscription_entitlement,
      EXISTS(
        SELECT 1 FROM buyer_subscriptions bs
        WHERE bs.organization_id = a.organization_id AND bs.buyer_id = ?
          AND bs.status IN ('active', 'non-renewing')
      ) AS platform_subscription_entitlement,
      EXISTS(
        SELECT 1 FROM buyer_free_downloads fd
        WHERE fd.organization_id = a.organization_id AND fd.buyer_id = ? AND fd.asset_id = a.id
      ) AS introductory_free_entitlement
    FROM assets a
    WHERE a.id = ? AND a.organization_id = ?
  `).bind(user.id, user.id, user.id, user.id, c.req.param("id"), user.organizationId).first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Original media not found" }, 404);
  const elevated = allowedRole(user, ["editor", "admin"]);
  const platformSubscription = Number(row.platform_subscription_entitlement) === 1;
  const existingFree = Number(row.introductory_free_entitlement) === 1;
  let freeClaimed = existingFree;
  const freeEligible = row.kind === "image" && row.status === "published" && row.rights_status === "verified" && Number(row.free_download_enabled) === 1;
  const freeLimit = Math.max(0, Math.min(5, Number(c.env.INTRODUCTORY_FREE_DOWNLOAD_LIMIT ?? 3)));

  // Validate storage before claiming an allowance or spending a bundle credit.
  // This keeps unavailable originals from consuming user entitlements.
  const originalKey = typeof row.original_key === "string" ? row.original_key.trim() : "";
  if (!originalKey) return c.json({ error: "Original media is unavailable" }, 404);
  const mediaSource = await resolveReadableMediaHead(c.env, originalKey);
  if (!mediaSource) return c.json({ error: "Original media is unavailable" }, 404);
  const filename = String(row.source_file_name ?? "original").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "original";
  const signedUrl = mediaSource.source === "primary" ? await createPresignedR2Url(c.env, c.env.R2_BUCKET_NAME, originalKey, "GET", 300, {
    contentDisposition: `attachment; filename="${filename}"`,
    contentType: originalContentType(row),
  }) : null;
  // Do not consume a free allowance or bundle credit if the delivery URL
  // cannot be produced for this deployment.
  if (mediaSource.source === "primary" && !signedUrl) return c.json({ error: "Original download signing is unavailable" }, 503);

  if (!elevated && String(row.owner_id) !== user.id && !Number(row.paid_entitlement) && !Number(row.subscription_entitlement) && !platformSubscription && !existingFree && freeEligible && c.req.method === "GET") {
    const claimId = crypto.randomUUID();
    const claim = await c.env.DB.prepare(`INSERT OR IGNORE INTO buyer_free_downloads (id, organization_id, buyer_id, asset_id, object_key)
      SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM buyer_free_downloads WHERE organization_id = ? AND buyer_id = ?) < ?`)
      .bind(claimId, user.organizationId, user.id, row.id, originalKey, user.organizationId, user.id, freeLimit).run();
    freeClaimed = Number(claim.meta.changes ?? 0) === 1 || existingFree;
  }
  let creditClaimed = false;
  if (!elevated && String(row.owner_id) !== user.id && !Number(row.paid_entitlement) && !Number(row.subscription_entitlement) && !platformSubscription && !freeClaimed && c.req.method === "GET") {
    const idempotencyKey = c.req.header("Idempotency-Key")?.trim().slice(0, 180) || crypto.randomUUID();
    const spendKey = `download:${user.id}:${row.id}:${idempotencyKey}`;
    const spend = await c.env.DB.prepare(`INSERT OR IGNORE INTO buyer_credit_transactions (id, organization_id, buyer_id, transaction_type, credits, amount_cents, reference_type, reference_id, idempotency_key)
      SELECT ?, ?, ?, 'spend', -1, 0, 'asset_download', ?, ?
      WHERE (SELECT COALESCE(SUM(ct.credits), 0) FROM buyer_credit_transactions ct WHERE ct.organization_id = ? AND ct.buyer_id = ?) > 0`)
      .bind(crypto.randomUUID(), user.organizationId, user.id, row.id, spendKey, user.organizationId, user.id).run();
    creditClaimed = Number(spend.meta.changes ?? 0) === 1;
    if (!creditClaimed) creditClaimed = Boolean(await c.env.DB.prepare("SELECT id FROM buyer_credit_transactions WHERE organization_id = ? AND buyer_id = ? AND idempotency_key = ?").bind(user.organizationId, user.id, spendKey).first<{ id: string }>());
  }
  const entitled = elevated || String(row.owner_id) === user.id || Number(row.paid_entitlement) === 1 || Number(row.subscription_entitlement) === 1 || platformSubscription || freeClaimed || creditClaimed;
  if (!entitled) {
    const used = Number((await c.env.DB.prepare("SELECT COUNT(*) AS total FROM buyer_free_downloads WHERE organization_id = ? AND buyer_id = ?").bind(user.organizationId, user.id).first<{ total: number }>())?.total ?? 0);
    return c.json({ error: freeEligible && archiveDomain.introductoryDownloadsRemaining(used, freeLimit) === 0 ? "Your introductory free photo downloads are used. Choose a bundle or unlimited subscription to continue." : "A licence, bundle, or subscription is required to download this original", code: freeEligible ? "free_download_limit_reached" : "download_entitlement_required", freeDownloadsRemaining: archiveDomain.introductoryDownloadsRemaining(used, freeLimit) }, 403);
  }
  const entitlementType = elevated ? "staff" : String(row.owner_id) === user.id ? "owner" : platformSubscription || Number(row.subscription_entitlement) === 1 ? "subscription" : "licence";
  if (!freeClaimed || entitlementType !== "licence") {
    await c.env.DB.prepare("INSERT INTO media_download_events (id, organization_id, asset_id, user_id, entitlement_type, object_key) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), user.organizationId, row.id, user.id, entitlementType, originalKey).run();
  }
  recordMetric(c.env, "asset_download", c.get("trace"), 1, [user.organizationId, String(row.id), entitlementType]);
  if (mediaSource.source === "library") {
    if (c.req.method === "HEAD") {
      const headers = new Headers();
      mediaSource.object.writeHttpMetadata(headers);
      headers.set("Content-Type", originalContentType(row));
      headers.set("Content-Length", String(mediaSource.object.size));
      headers.set("Content-Disposition", `attachment; filename="${filename}"`);
      headers.set("Cache-Control", "private, no-store");
      return new Response(null, { status: 200, headers });
    }
    const fallback = await c.env.MEDIA_LIBRARY_BUCKET?.get(originalKey, c.req.header("Range") ? { range: c.req.raw.headers } : undefined);
    if (!fallback) return c.json({ error: "Original media is unavailable" }, 404);
    const response = createMediaResponse(c.req.raw, fallback, originalContentType(row));
    response.headers.set("Content-Disposition", `attachment; filename="${filename}"`);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  return new Response(null, { status: 302, headers: { Location: signedUrl!, "Cache-Control": "private, no-store" } });
});

// Cloudflare Image Resizing uses this short-lived, HMAC-signed source URL for
// originals larger than the Images binding's 20 MB stream limit. The URL is
// never returned to a caller and expires before the transformation completes.
app.on(["GET", "HEAD"], "/internal/media-preview-source", async (c) => {
  const key = c.req.query("key") ?? "";
  const expires = Number(c.req.query("expires") ?? 0);
  const signature = c.req.query("signature") ?? "";
  const secret = c.env.R2_SECRET_ACCESS_KEY;
  if (!key || !secret || !Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return c.json({ error: "Not found" }, 404);
  const expected = hex(await hmac(utf8(secret), `${key}.${expires}`));
  if (!timingSafeEqual(expected, signature)) return c.json({ error: "Not found" }, 404);
  const object = c.req.method === "HEAD" ? await headReadableMedia(c.env, key) : await getReadableMedia(c.env, key);
  if (!object) return c.json({ error: "Not found" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Length", String(object.size));
  return new Response(c.req.method === "HEAD" ? null : (object as R2ObjectBody).body, { status: 200, headers });
});

// Cloudflare Image Resizing calls this source URL with Via: image-resizing.
// The job UUID is an ephemeral capability; the DB check also requires the
// enrichment job to still be running for the exact asset revision and ETag.
app.on(["GET", "HEAD"], "/internal/photo-ai-source/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  if (!/image-resizing/i.test(c.req.header("via") ?? "") && c.req.header("x-photo-ai-job") !== jobId) return c.json({ error: "Not found" }, 404);
  const row = await c.env.DB.prepare(`
    SELECT a.kind, a.preview_key, a.original_key, a.source_file_name, a.asset_revision, a.source_etag,
           j.operation, j.status, j.asset_revision AS job_revision, j.source_etag AS job_source_etag
    FROM photo_ai_jobs j JOIN assets a ON a.id = j.asset_id
    WHERE j.id = ?
  `).bind(jobId).first<Record<string, unknown>>();
  if (!row || row.operation !== "enrich" || row.status !== "running" || row.kind !== "image"
    || Number(row.asset_revision) !== Number(row.job_revision)
    || String(row.source_etag ?? "") !== String(row.job_source_etag ?? "")) {
    return c.json({ error: "Not found" }, 404);
  }
  const sourceKey = String(row.preview_key || row.original_key || "");
  if (!sourceKey) return c.json({ error: "Source image not found" }, 404);
  const object = (c.req.method === "HEAD" ? await headReadableMedia(c.env, sourceKey) : await getReadableMedia(c.env, sourceKey)) as R2ObjectBody | null;
  if (!object) return c.json({ error: "Source image not found" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("ETag", object.httpEtag);
  headers.set("Content-Length", String(object.size));
  return new Response(c.req.method === "HEAD" ? null : object.body, { status: 200, headers });
});

const publicCreatorSearchSchema = z.object({ q: z.string().trim().max(120).default("") });

const productionCreatorFilter = `AND (
  u.id NOT LIKE 'demo-%' OR EXISTS (
    SELECT 1 FROM assets public_asset
    WHERE public_asset.owner_id = cp.user_id AND public_asset.status = 'published'
      AND COALESCE(public_asset.demo_seed, 0) = 0
      AND public_asset.id NOT LIKE 'asset-demo-%'
      AND public_asset.id NOT LIKE 'asset-test-photo-%'
  )
)`;

app.get("/api/creators", async (c) => {
  const { q } = publicCreatorSearchSchema.parse({ q: c.req.query("q") ?? "" });
  const query = `%${q}%`;
  const production = String(c.env.APP_ENV) === "production";
  const productionAssetFilter = production
    ? "AND COALESCE(a.demo_seed, 0) = 0 AND a.id NOT LIKE 'asset-demo-%' AND a.id NOT LIKE 'asset-test-photo-%'"
    : "";
  const rows = await c.env.DB.prepare(`
    SELECT cp.*, u.display_name,
      (SELECT COUNT(*) FROM assets a WHERE a.owner_id = cp.user_id AND a.status = 'published' ${productionAssetFilter}) AS asset_count,
      (SELECT COUNT(*) FROM assets a WHERE a.owner_id = cp.user_id AND a.status = 'published' AND a.kind = 'image' ${productionAssetFilter}) AS published_image_count,
      (SELECT COUNT(*) FROM assets a WHERE a.owner_id = cp.user_id AND a.status = 'needs_review' ${productionAssetFilter}) AS review_count,
      (SELECT COUNT(*) FROM portfolio_collections pc WHERE pc.owner_id = cp.user_id AND pc.visibility = 'public') AS collection_count
    FROM creator_profiles cp JOIN users u ON u.id = cp.user_id
    WHERE cp.visibility = 'public' ${production ? productionCreatorFilter : ""}
      AND (cp.slug LIKE ? OR u.display_name LIKE ? OR cp.headline LIKE ? OR cp.location LIKE ? OR cp.specialties_json LIKE ?)
    ORDER BY asset_count DESC, cp.updated_at DESC LIMIT 48
  `).bind(query, query, query, query, query).all<Record<string, unknown>>();
  return c.json({ results: rows.results.map(creatorProfileFromRow) });
});

app.get("/api/creators/:slug", async (c) => {
  const slug = z.string().regex(/^[a-z0-9-]{3,100}$/).parse(c.req.param("slug"));
  const production = String(c.env.APP_ENV) === "production";
  const productionAssetFilter = production
    ? "AND COALESCE(a.demo_seed, 0) = 0 AND a.id NOT LIKE 'asset-demo-%' AND a.id NOT LIKE 'asset-test-photo-%'"
    : "";
  const row = await c.env.DB.prepare(`
    SELECT cp.*, u.display_name,
      (SELECT COUNT(*) FROM assets a WHERE a.owner_id = cp.user_id AND a.status = 'published' ${productionAssetFilter}) AS asset_count,
      (SELECT COUNT(*) FROM assets a WHERE a.owner_id = cp.user_id AND a.status = 'published' AND a.kind = 'image' ${productionAssetFilter}) AS published_image_count,
      (SELECT COUNT(*) FROM assets a WHERE a.owner_id = cp.user_id AND a.status = 'needs_review' ${productionAssetFilter}) AS review_count,
      (SELECT COUNT(*) FROM portfolio_collections pc WHERE pc.owner_id = cp.user_id AND pc.visibility = 'public') AS collection_count
    FROM creator_profiles cp JOIN users u ON u.id = cp.user_id
    WHERE cp.slug = ? AND cp.visibility = 'public' ${production ? productionCreatorFilter : ""}
  `).bind(slug).first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Creator not found" }, 404);
  const [assets, collections] = await Promise.all([
    c.env.DB.prepare(`SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id
      WHERE a.owner_id = ? AND a.status = 'published' ${productionAssetFilter}
      ORDER BY a.human_verified DESC, a.updated_at DESC LIMIT 24`).bind(row.user_id).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT pc.*, cp.slug AS creator_slug, u.display_name AS creator_name,
      (SELECT COUNT(*) FROM portfolio_collection_assets pca WHERE pca.collection_id = pc.id) AS asset_count
      FROM portfolio_collections pc JOIN creator_profiles cp ON cp.user_id = pc.owner_id JOIN users u ON u.id = pc.owner_id
      WHERE pc.owner_id = ? AND pc.visibility = 'public' ORDER BY pc.updated_at DESC`).bind(row.user_id).all<Record<string, unknown>>(),
  ]);
  return c.json({
    profile: creatorProfileFromRow(row),
    assets: assets.results.map((asset) => assetRowToDomain(asset, c.env)),
    collections: collections.results.map(portfolioCollectionFromRow),
  });
});

app.get("/api/licence-products", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT code, name, description, terms_version, restrictions_json
    FROM licence_products WHERE active = 1
    ORDER BY CASE code WHEN 'standard' THEN 1 WHEN 'enhanced' THEN 2 WHEN 'editorial' THEN 3 ELSE 4 END`).all<Record<string, unknown>>();
  const results: LicenceProduct[] = rows.results.map((row) => ({
    code: String(row.code) as LicenceProduct["code"],
    name: String(row.name),
    description: String(row.description),
    termsVersion: String(row.terms_version),
    restrictions: JSON.parse(String(row.restrictions_json)) as LicenceProduct["restrictions"],
  }));
  return c.json({ results });
});

app.post("/api/search/visual", async (c) => {
  const requestContentType = c.req.raw.headers.get("content-type")?.toLowerCase() ?? "";
  if (!requestContentType.startsWith("multipart/form-data")) {
    return new Response(JSON.stringify({ error: "Upload an image file in the image field" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (!c.env.AI || !c.env.PHOTO_INDEX) return c.json({ error: "Visual search is not configured", code: "visual_search_unavailable" }, 503);
  const contentLength = Number(c.req.header("content-length") ?? 0);
  if (contentLength > 12 * 1024 * 1024) return c.json({ error: "Visual search images must be 10 MB or smaller" }, 413);
  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    return c.json({ error: "Upload an image file in the image field" }, 400);
  }
  const file = form.get("image");
  if (!(file instanceof File) || !file.type.startsWith("image/")) return c.json({ error: "Upload an image file in the image field" }, 400);
  if (file.size > 10 * 1024 * 1024) return c.json({ error: "Visual search images must be 10 MB or smaller" }, 413);

  let visualStage = "image_prepare";
  try {
    const source = new Uint8Array(await file.arrayBuffer());
    let image: Uint8Array<ArrayBufferLike> = source;
    let contentType = file.type.toLowerCase();
    if (source.byteLength > 8_000_000 || !["image/jpeg", "image/png"].includes(contentType)) {
      let transformed: Uint8Array<ArrayBufferLike> | null = null;
      for (const options of [{ width: 1600, quality: 75 }, { width: 1200, quality: 70 }, { width: 900, quality: 65 }]) {
        const input = new Response(source).body;
        if (!input) throw new Error("Visual search image stream is unavailable");
        const output = await c.env.IMAGES.input(input).transform({ width: options.width })
          .output({ format: "image/jpeg", quality: options.quality });
        const candidate = new Uint8Array(await new Response(output.image()).arrayBuffer());
        if (candidate.byteLength > 0 && candidate.byteLength <= 8_000_000) { transformed = candidate; break; }
      }
      if (!transformed) return c.json({ error: "The image could not be prepared for visual search" }, 422);
      image = transformed;
      contentType = "image/jpeg";
    }
    const aiImage = `data:${contentType};base64,${base64Bytes(image)}`;
    const model = c.env.PHOTO_VISION_PROVIDER === "ollama-tunnel"
      ? `ollama:${c.env.LOCAL_VISION_MODEL?.trim() || "qwen3-vl:8b"}`
      : (c.env.PHOTO_VISION_MODEL ?? "@cf/moondream/moondream3.1-9B-A2B");
    visualStage = "vision_provider";
    const vision = await runPhotoVision(photoPipeline(c.env), model, image, aiImage);
    const metadata = classifyVisionResult(vision).metadata;
    const description = [metadata.description, ...metadata.subjectTags, metadata.locationType, metadata.sceneContext, metadata.primaryCategory, ...metadata.sceneAttributes]
      .filter((value) => value && value !== "unknown" && value !== "other").join(" ").trim().slice(0, 1200);
    if (!description) return c.json({ error: "The image could not be described for visual search" }, 422);
    visualStage = "semantic_lookup";
    const semantic = await searchPhotoIndex(photoPipeline(c.env), description, { kind: "image", status: "published", excludeDemo: String(c.env.APP_ENV) === "production" });
    return c.json({
      query: metadata.description || description,
      mode: semantic.usedVectorIndex ? "visual-to-semantic" : "visual-to-keyword",
      results: semantic.rows.map((row) => assetRowToDomain(row, c.env)),
      usedVectorIndex: semantic.usedVectorIndex,
    });
  } catch (error) {
    logEvent("error", "photo.search.visual_failed", c.get("trace"), { error: error instanceof Error ? error.message : "unknown-error" });
    c.header("X-Visual-Search-Failure-Stage", visualStage);
    return c.json({ error: "Visual search is temporarily unavailable", code: "visual_search_failed" }, 503);
  }
});

app.get("/api/assets", async (c) => {
  const params = searchSchema.parse({
    q: c.req.query("q") ?? "",
    kind: c.req.query("kind") ?? "all",
    location: c.req.query("location"),
    locationType: c.req.query("locationType"),
    category: c.req.query("category"),
    verified: c.req.query("verified"),
    status: c.req.query("status") ?? "published",
  });

  let rows: Record<string, unknown>[] = [];
  let searchHandled = false;
  let searchMode: SearchResponse["mode"] = "keyword";
  if (params.q && params.status === "published") {
    try {
      const semantic = await searchPhotoIndex(photoPipeline(c.env), params.q, { ...params, excludeDemo: String(c.env.APP_ENV) === "production" });
      rows = semantic.rows;
      searchMode = semantic.mode;
      if (semantic.fallbackReason) c.header("X-Search-Fallback-Reason", semantic.fallbackReason);
      searchHandled = true;
    } catch (error) {
      logEvent("error", "photo.search.hybrid_failed", c.get("trace"), { error: error instanceof Error ? error.message : "unknown-error" });
    }
  }

  if (!searchHandled) {
    const clauses = [params.status === "all" ? "1 = 1" : "a.status = ?", "a.id NOT LIKE 'asset-test-photo-%'", ...(String(c.env.APP_ENV) === "production" ? ["COALESCE(a.demo_seed, 0) = 0", "a.id NOT LIKE 'asset-demo-%'"] : [])];
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
    if (params.verified) clauses.push("a.human_verified = 1");
    if (params.q) {
      clauses.push("(a.title LIKE ? OR a.description LIKE ? OR a.caption LIKE ? OR a.subject_tags LIKE ? OR a.cultural_tags LIKE ? OR a.ai_tags LIKE ? OR a.ocr_text LIKE ? OR a.visual_location_type LIKE ? OR a.scene_context LIKE ? OR a.primary_category LIKE ? OR a.scene_attributes LIKE ?)");
      const query = `%${params.q}%`;
      values.push(query, query, query, query, query, query, query, query, query, query, query);
    }

    const result = await c.env.DB.prepare(`
      SELECT a.*, u.display_name AS contributor
      FROM assets a JOIN users u ON u.id = a.owner_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY a.human_verified DESC, a.authenticity_confidence DESC, a.created_at DESC
      LIMIT 200
    `).bind(...values).all<Record<string, unknown>>();

    rows = result.results as Record<string, unknown>[];
  }
  if (params.verified) rows = rows.filter((row) => Boolean(row.human_verified));
  const domainAssets = rows.map((row) => assetRowToDomain(row, c.env));
  // Vectorize has already ranked semantic candidates. Applying the lexical
  // relevance gate again would discard valid intent matches such as "warm forest".
  const matchedAssets = searchMode === "keyword"
    ? archiveDomain.rankSearchAssets(domainAssets, params.q)
    : domainAssets;
  const countBy = <T extends string>(values: (T | null | undefined)[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  };
  const topEntries = (counts: Map<string, number>, limit: number): [string, number][] =>
    [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, limit);
  const provinceFacets = topEntries(countBy(matchedAssets.map((asset) => asset.province)), 5)
    .map(([value, count]) => ({ label: value, value, count }));
  const categoryFacets = topEntries(countBy(matchedAssets.map((asset) => asset.primaryCategory?.replaceAll("_", " "))), 5)
    .map(([value, count]) => ({ label: value, value, count }));
  const kindFacets = topEntries(countBy(matchedAssets.map((asset) => asset.kind)), 2)
    .map(([value, count]) => ({ label: value === "video" ? "Film & video" : "Photography", value, count }));
  const response: SearchResponse = {
    query: params.q,
    mode: searchMode,
    results: matchedAssets,
    facets: [
      { label: "Human verified", value: "verified", count: matchedAssets.filter((asset) => asset.humanVerified).length },
      ...kindFacets,
      ...provinceFacets,
      ...categoryFacets,
    ],
  };

  recordMetric(c.env, "asset_search", c.get("trace"), matchedAssets.length, [params.kind, params.status]);
  return c.json(validateContractResponse("GET /api/assets 200", searchResponseSchema, response));
});

function recentAttestation(value: string | undefined, maxAgeDays = 90): boolean {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= Date.now() && Date.now() - time <= maxAgeDays * 86_400_000;
}

function isFutureTimestamp(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  const text = value.trim();
  const normalized = text.includes("T")
    ? text
    : text.includes(" ")
      ? `${text.replace(" ", "T")}${/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? "" : "Z"}`
      : `${text}T00:00:00Z`;
  const time = Date.parse(normalized);
  return Number.isFinite(time) && time > Date.now();
}

async function launchReadiness(env: Bindings): Promise<Record<string, unknown>> {
  const tableRows = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
  const tables = new Set(tableRows.results.map((row) => row.name));
  const requiredTables = ["seller_onboarding_profiles", "didit_webhook_events", "marketplace_agreement_acceptances", "payment_split_allocations", "buyer_subscriptions", "buyer_subscription_payments", "buyer_free_downloads", "asset_edit_versions", "asset_derivative_exports", "campaign_bundles", "campaign_bundle_builds", "stream_uploads", "audit_log_events", "audit_exports", "contributor_verification_cases"];
  const scalar = async (sql: string, key = "total"): Promise<number> => Number((await env.DB.prepare(sql).first<Record<string, unknown>>())?.[key] ?? 0);
  const productionMembers = tables.has("organization_memberships") ? await scalar("SELECT COUNT(*) AS total FROM organization_memberships WHERE organization_id = 'org-production' AND status = 'active'") : 0;
  const demoAssets = tables.has("assets") ? await scalar("SELECT COUNT(*) AS total FROM assets WHERE COALESCE(demo_seed, 0) = 1 OR id LIKE 'asset-demo-%' OR id LIKE 'asset-test-photo-%'") : 0;
  const verifiedPaystackWallets = tables.has("payout_wallets") ? await scalar("SELECT COUNT(*) AS total FROM payout_wallets WHERE provider = 'paystack' AND status = 'verified' AND provider_account_id LIKE 'ACCT_%'") : 0;
  const auth0Configured = Boolean(env.AUTH_JWKS_URL?.trim() && env.AUTH_ISSUER?.trim() && env.AUTH_AUDIENCE?.trim());
  const supabaseConfigured = Boolean(env.SUPABASE_URL?.trim() && env.SUPABASE_AUDIENCE?.trim() && isSupabasePublicKey(env.SUPABASE_ANON_KEY));
  const subscription = buyerSubscriptionConfiguration(env);
  let streamSecretConfigured = Boolean(env.STREAM_WEBHOOK_SECRET?.trim());
  if (!streamSecretConfigured && env.STREAM_WEBHOOK_SECRET_STORE) {
    try { streamSecretConfigured = Boolean(await env.STREAM_WEBHOOK_SECRET_STORE.get()); } catch { streamSecretConfigured = false; }
  }
  const checks = [
    { id: "production_mode", ready: String(env.APP_ENV) === "production" && env.DEMO_AUTH_ENABLED !== "true", action: "Set APP_ENV=production and disable demo authentication." },
    { id: "session_security", ready: Boolean(env.SESSION_SECRET?.trim()), action: "Configure a strong SESSION_SECRET." },
    { id: "identity_provider", ready: auth0Configured || supabaseConfigured, action: "Complete Auth0 issuer/JWKS/audience or Supabase project/audience configuration." },
    { id: "email_sender", ready: Boolean(env.EMAIL && env.EMAIL_FROM?.trim()), action: "Verify the transactional email sender and binding." },
    { id: "turnstile", ready: Boolean(env.TURNSTILE_SECRET?.trim() && env.TURNSTILE_HOSTNAMES?.trim()), action: "Provision Turnstile and configure its secret and hostname allowlist." },
    { id: "firma", ready: Boolean(env.FIRMA_VERIFY_URL?.trim() && env.FIRMA_API_TOKEN?.trim()), action: "Configure the Firma verification endpoint and API token." },
    { id: "didit", ready: Boolean(diditApiKey(env) && diditWebhookSecret(env) && env.DIDIT_KYC_WORKFLOW_ID?.trim() && env.DIDIT_KYB_WORKFLOW_ID?.trim()), action: "Configure Didit API, webhook, KYC, and KYB credentials." },
    { id: "cipc", ready: Boolean(env.CIPC_LOOKUP_URL?.trim() && env.CIPC_API_TOKEN?.trim()), action: "Configure the CIPC verification adapter." },
    { id: "payments", ready: paymentProviderConfigured(env) && subscription.configured, action: "Configure Paystack checkout, signed webhooks, and the recurring plan." },
    { id: "marketplace_terms", ready: String(env.MARKETPLACE_TERMS_APPROVED) === "true", action: "Obtain legal approval for the versioned seller, buyer, and split terms, then attest MARKETPLACE_TERMS_APPROVED=true." },
    { id: "seller_split_rail", ready: verifiedPaystackWallets > 0, action: "Verify at least one seller Paystack subaccount before marketplace checkout." },
    { id: "audit_signing", ready: Boolean(env.AUDIT_SIGNING_PRIVATE_JWK?.trim() && env.AUDIT_SIGNING_PUBLIC_JWK?.trim() && env.AUDIT_SIGNING_KEY_ID?.trim()), action: "Configure the Ed25519 audit signing keypair and key ID." },
    { id: "media_scanning", ready: Boolean(env.MEDIA_SCANNER_URL?.trim() && env.MEDIA_SCANNER_SECRET?.trim()), action: "Configure fail-closed media malware scanning." },
    { id: "stream", ready: Boolean(streamSecretConfigured && env.STREAM_ACCOUNT_ID?.trim() && env.STREAM_ALLOWED_ORIGINS?.trim() && env.STREAM_CUSTOMER_CODE?.trim()), action: "Configure Stream account, allowed origins, customer code, and signed webhook secret." },
    { id: "ai_workflow", ready: Boolean(env.AI && env.PHOTO_INDEX && env.PHOTO_ENRICHMENT_QUEUE && env.PHOTO_EMBEDDING_MODEL?.trim()), action: "Bind Workers AI, Vectorize, and the enrichment queue." },
    { id: "storage_bindings", ready: Boolean(env.MEDIA_BUCKET && env.MEDIA_DR_BUCKET && env.BACKUP_BUCKET && env.AUDIT_BUCKET_ZA && env.AUDIT_BUCKET_EU && env.KYC_BUCKET_ZA && env.KYC_BUCKET_EU), action: "Bind primary, DR, backup, audit, and regional KYC R2 buckets." },
    { id: "migrations", ready: requiredTables.every((table) => tables.has(table)), action: `Apply missing production migrations: ${requiredTables.filter((table) => !tables.has(table)).join(", ") || "none"}.` },
    { id: "production_membership", ready: productionMembers > 0, action: "Add an active administrator to org-production." },
    { id: "demo_data", ready: demoAssets === 0, action: `Remove ${demoAssets} explicitly tagged demo/test assets from production after review.` },
    { id: "edge_controls_attestation", ready: recentAttestation(env.EDGE_CONTROLS_ATTESTED_AT), action: "Run the dated edge/WAF control drill and set EDGE_CONTROLS_ATTESTED_AT." },
    { id: "key_rotation_attestation", ready: recentAttestation(env.KEY_ROTATION_ATTESTED_AT), action: "Complete the dated key-rotation drill and set KEY_ROTATION_ATTESTED_AT." },
    { id: "backup_restore_attestation", ready: recentAttestation(env.BACKUP_RESTORE_ATTESTED_AT), action: "Complete the dated backup restore drill and set BACKUP_RESTORE_ATTESTED_AT." },
  ];
  return { ready: checks.every((check) => check.ready), checkedAt: new Date().toISOString(), checks, counts: { productionMembers, demoAssets, verifiedPaystackWallets }, identity: { auth0Configured, supabaseConfigured }, requiredTables };
}

async function readinessResponse(c: AppContext): Promise<Response> {
  const admin = await requestUser(c);
  if (!admin || !allowedRole(admin, ["admin"])) return c.json({ error: "Admin access required" }, 403);
  return c.json(await launchReadiness(c.env));
}

app.get("/api/ops/readiness", readinessResponse);
app.get("/api/admin/launch-readiness", readinessResponse);

app.get("/api/assets/facets", async (c) => {
  const params = searchSchema.parse({ q: c.req.query("q") ?? "", kind: c.req.query("kind") ?? "all", status: "published" });
  const query = `%${params.q}%`;
  const rows = await c.env.DB.prepare(`SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id
    WHERE a.status = 'published' AND a.id NOT LIKE 'asset-test-photo-%' AND (? = '' OR a.title LIKE ? OR a.description LIKE ? OR a.subject_tags LIKE ?)
    ORDER BY a.human_verified DESC, a.created_at DESC LIMIT 500`).bind(params.q, query, query, query).all<Record<string, unknown>>();
  const assets = rows.results.map((row) => assetRowToDomain(row, c.env));
  const count = (values: Array<string | null | undefined>) => [...values.reduce((map, value) => value ? map.set(value, (map.get(value) ?? 0) + 1) : map, new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([value, total]) => ({ value, count: total }));
  return c.json({ query: params.q, total: assets.length, facets: { kinds: count(assets.map((asset) => asset.kind)), provinces: count(assets.map((asset) => asset.province)), categories: count(assets.map((asset) => asset.primaryCategory)), verified: assets.filter((asset) => asset.humanVerified).length } });
});

app.get("/api/assets/:id", async (c) => {
  const user = await requestUser(c);
  const row = await c.env.DB.prepare("SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id WHERE a.id = ?")
    .bind(c.req.param("id")).first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Asset not found" }, 404);
  const mayInspectPrivate = Boolean(user && String(row.organization_id) === user.organizationId && (String(row.owner_id) === user.id || allowedRole(user, ["editor", "admin"])));
  if (row.status !== "published" && !mayInspectPrivate) return c.json({ error: "Asset not found" }, 404);
  return c.json(assetRowToDomain(row, c.env));
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

app.post("/api/admin/media/previews/rebuild", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["admin", "editor"])) return c.json({ error: "Editor access required" }, 403);
  let payload: { assetIds?: string[] } = {};
  try {
    payload = z.object({ assetIds: z.array(z.string().min(1).max(120)).max(500).optional() }).parse(await c.req.json());
  } catch {
    // An empty body means rebuild every image with a private original in this organisation.
  }
  const assets = await c.env.DB.prepare(`
    SELECT id, kind, original_key, preview_key, video_poster_key
    FROM assets
    WHERE organization_id = ? AND kind IN ('image', 'video') AND original_key IS NOT NULL
    ORDER BY updated_at DESC LIMIT 500
  `).bind(user.organizationId).all<Record<string, unknown>>();
  const requested = payload.assetIds ? new Set(payload.assetIds) : null;
  const selected = requested ? assets.results.filter((asset) => requested.has(String(asset.id))) : assets.results;
  let rebuilt = 0;
  const failures: { assetId: string; error: string }[] = [];
  for (const asset of selected) {
    try {
      const originalKey = String(asset.original_key);
      if (asset.kind === "video") {
        const posterKey = await writeVideoPoster(c.env, originalKey, asset.video_poster_key as string | null);
        await c.env.DB.prepare("UPDATE assets SET video_poster_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?").bind(posterKey, asset.id, user.organizationId).run();
      } else {
        const preview = await writeWatermarkedPreview(c.env, originalKey, asset.preview_key as string | null);
        await c.env.DB.prepare("UPDATE assets SET preview_key = ?, preview_640_key = ?, preview_1200_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?")
          .bind(preview.key, preview.variants.preview640Key, preview.variants.preview1200Key, asset.id, user.organizationId).run();
      }
      rebuilt += 1;
    } catch (error) {
      failures.push({ assetId: String(asset.id), error: error instanceof Error ? error.message : "preview transformation failed" });
    }
  }
  return c.json({ rebuilt, total: selected.length, failed: failures.length, failures, transformation: `webp-${PREVIEW_MAX_DIMENSION}-q${PREVIEW_QUALITY}-watermarked` }, failures.length ? 207 : 200);
});

app.get("/api/admin/media/integrity", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["admin", "editor"])) return c.json({ error: "Editor access required" }, 403);
  const result = await c.env.DB.prepare(`SELECT id, organization_id, owner_id, kind, source_file_name, source_etag, original_key, preview_key, preview_640_key, preview_1200_key, video_poster_key, status FROM assets WHERE organization_id = ? AND original_key IS NOT NULL ORDER BY created_at ASC`).bind(user.organizationId).all<Record<string, unknown>>();
  const assets = result.results;
  const imageAssets = assets.filter((asset) => asset.kind === "image");
  const referenced = new Set(assets.flatMap((asset) => [asset.preview_key, asset.preview_640_key, asset.preview_1200_key, asset.video_poster_key].filter((key): key is string => typeof key === "string" && key.length > 0)));
  const previewObjects = await listR2Keys(c.env.MEDIA_BUCKET, "previews/");
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const asset of assets) {
    const identity = `${asset.owner_id}|${asset.source_etag}|${asset.source_file_name}`;
    const group = groups.get(identity) ?? [];
    group.push(asset);
    groups.set(identity, group);
  }
  const duplicateGroups = [...groups.values()].filter((group) => group.length > 1).map((group) => ({ identity: `${group[0].source_file_name}`, assetIds: group.map((asset) => asset.id), originalKeys: group.map((asset) => asset.original_key), sourceEtag: group[0].source_etag }));
  const incompleteImageIds = imageAssets.filter((asset) => !(asset.preview_key && asset.preview_640_key && asset.preview_1200_key)).map((asset) => String(asset.id));
  const videoIds = assets.filter((asset) => asset.kind === "video" && !asset.video_poster_key).map((asset) => String(asset.id));
  const stalePreviewObjects = previewObjects.filter((key) => !referenced.has(key));
  return c.json({ generatedAt: new Date().toISOString(), assets: assets.length, images: imageAssets.length, imagePairsComplete: imageAssets.length - incompleteImageIds.length, incompleteImageIds, videoPostersComplete: assets.filter((asset) => asset.kind === "video" && asset.video_poster_key).length, videoIds, duplicateGroups, r2: { previewObjects: previewObjects.length, referencedPreviewObjects: referenced.size, stalePreviewObjects, stalePreviewObjectCount: stalePreviewObjects.length }, transformation: `webp-640/1200/${PREVIEW_MAX_DIMENSION}-q${PREVIEW_QUALITY}-watermarked` });
});

app.post("/api/admin/media/reconcile", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["admin"])) return c.json({ error: "Admin access required" }, 403);
  const payload = z.object({ apply: z.boolean().default(false), cleanupStale: z.boolean().default(false) }).parse(await c.req.json().catch(() => ({})));
  const rows = await c.env.DB.prepare(`SELECT a.id, a.organization_id, a.owner_id, a.kind, a.status, a.source_file_name, a.source_etag, a.original_key, a.preview_key, a.preview_640_key, a.preview_1200_key, a.video_poster_key, (SELECT COUNT(*) FROM licences l WHERE l.asset_id = a.id) AS licence_count FROM assets a WHERE a.organization_id = ? AND a.original_key IS NOT NULL ORDER BY a.created_at ASC`).bind(user.organizationId).all<Record<string, unknown>>();
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows.results) {
    const identity = `${row.owner_id}|${row.source_etag}|${row.source_file_name}`;
    const group = groups.get(identity) ?? [];
    group.push(row);
    groups.set(identity, group);
  }
  const candidates: { canonicalId: string; duplicateId: string; keys: string[] }[] = [];
  for (const group of groups.values()) {
    if (group.length < 2 || group.some((row) => Number(row.licence_count) > 0 || row.status === "published" || !row.source_etag)) continue;
    const canonical = group[0];
    const canonicalObject = await c.env.MEDIA_BUCKET.head(String(canonical.original_key));
    if (!canonicalObject || canonicalObject.httpEtag.replace(/^\"|\"$/g, "") !== String(canonical.source_etag).replace(/^\"|\"$/g, "")) continue;
    for (const duplicate of group.slice(1)) {
      const duplicateObject = await c.env.MEDIA_BUCKET.head(String(duplicate.original_key));
      if (!duplicateObject || duplicateObject.httpEtag.replace(/^\"|\"$/g, "") !== String(canonical.source_etag).replace(/^\"|\"$/g, "")) continue;
      candidates.push({ canonicalId: String(canonical.id), duplicateId: String(duplicate.id), keys: [duplicate.original_key, duplicate.preview_key, duplicate.preview_640_key, duplicate.preview_1200_key, duplicate.video_poster_key].filter((key): key is string => typeof key === "string" && key.length > 0) });
    }
  }
  const referenced = new Set(rows.results.flatMap((row) => [row.preview_key, row.preview_640_key, row.preview_1200_key, row.video_poster_key].filter((key): key is string => typeof key === "string" && key.length > 0)));
  const previewObjects = await listR2Keys(c.env.MEDIA_BUCKET, "previews/");
  const stalePreviewObjects = previewObjects.filter((key) => !referenced.has(key));
  if (!payload.apply) return c.json({ dryRun: true, candidates, stalePreviewObjects: payload.cleanupStale ? stalePreviewObjects : [], message: "No objects were deleted. Re-run with apply:true after reviewing the exact ETag-matched candidates." });
  let deletedObjects = 0;
  for (const candidate of candidates) {
    await c.env.MEDIA_BUCKET.delete(candidate.keys);
    await c.env.DB.prepare("UPDATE assets SET status = 'withdrawn', original_key = NULL, preview_key = NULL, preview_640_key = NULL, preview_1200_key = NULL, video_poster_key = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ? AND status <> 'published'")
      .bind(candidate.duplicateId, user.organizationId).run();
    deletedObjects += candidate.keys.length;
  }
  let staleDeleted = 0;
  if (payload.cleanupStale && stalePreviewObjects.length) {
    await c.env.MEDIA_BUCKET.delete(stalePreviewObjects);
    staleDeleted = stalePreviewObjects.length;
  }
  return c.json({ dryRun: false, candidates, deletedObjects, withdrawnAssets: candidates.length, staleDeleted });
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
  const job = await c.env.DB.prepare(`SELECT j.id, j.operation, j.status FROM photo_ai_jobs j JOIN assets a ON a.id = j.asset_id
    WHERE j.id = ? AND a.organization_id = ?`)
    .bind(c.req.param("jobId"), user.organizationId).first<{ id: string; operation: PhotoJobOperation; status: string }>();
  if (!job) return c.json({ error: "Replayable photo job not found" }, 404);
  if (job.operation === "enrich") {
    return c.json({
      error: "AI enrichment is upload-only and cannot be replayed after the upload revision was created.",
      code: "ai_enrichment_upload_only",
    }, 409);
  }
  if (!["failed", "dead_lettered", "needs_review", "skipped"].includes(job.status)) {
    return c.json({ error: "Photo job is not replayable", code: "photo_job_not_replayable" }, 409);
  }
  const replayedJobId = await replayPhotoJob(photoPipeline(c.env), job.id);
  if (!replayedJobId) return c.json({ error: "Photo queue is unavailable", code: "photo_queue_unavailable" }, 503);
  return c.json({ jobId: replayedJobId, status: "queued", replayed: true }, 202);
});

const photoReEnrichmentSchema = z.object({ confirmation: z.literal("re-enrich") });

app.post("/api/admin/photo-jobs/:jobId/re-enrich", async (c) => {
  const user = await requestUser(c);
  if (!user || user.role !== "admin") return c.json({ error: "Admin access required" }, 403);
  photoReEnrichmentSchema.parse(await c.req.json());
  const job = await c.env.DB.prepare(`SELECT j.id, j.operation, j.status FROM photo_ai_jobs j JOIN assets a ON a.id = j.asset_id
    WHERE j.id = ? AND a.organization_id = ?`).bind(c.req.param("jobId"), user.organizationId)
    .first<{ id: string; operation: PhotoJobOperation; status: string }>();
  if (!job || job.operation !== "enrich") return c.json({ error: "Re-enrichable AI job not found" }, 404);
  if (!["completed", "needs_review", "failed", "dead_lettered", "skipped"].includes(job.status)) {
    return c.json({ error: "Photo job is not ready for re-enrichment", code: "photo_job_not_re_enrichable" }, 409);
  }
  const requeuedJobId = await requeuePhotoEnrichment(photoPipeline(c.env), job.id);
  if (!requeuedJobId) return c.json({ error: "Photo queue is unavailable or the asset revision changed", code: "photo_queue_unavailable" }, 503);
  return c.json({ jobId: requeuedJobId, status: "queued", reEnriched: true }, 202);
});

app.post("/api/analytics/events", async (c) => {
  const payload = analyticsEventSchema.parse(await c.req.json());
  const metricKey = normalizedMetric(payload.type === "search" ? payload.query : payload.type === "tag_click" ? payload.tag : payload.assetId);
  if (!metricKey) return c.json({ accepted: false, reason: "A metric key is required." }, 400);
  if (payload.type === "asset_view") {
    const asset = await c.env.DB.prepare("SELECT id, organization_id, status FROM assets WHERE id = ?")
      .bind(payload.assetId).first<{ id: string; organization_id: string; status: string }>();
    if (!asset || asset.status !== "published") return c.json({ accepted: false, reason: "Published asset not found." }, 404);
    recordMetric(c.env, "asset_view", c.get("trace"), 1, [asset.organization_id, asset.id]);
  }
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

app.get("/api/analytics/contributor/assets/:id", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "admin"])) return c.json({ error: "Contributor analytics access required" }, 403);
  const asset = await c.env.DB.prepare("SELECT id, title FROM assets WHERE id = ? AND organization_id = ? AND owner_id = ?").bind(c.req.param("id"), user.organizationId, user.id).first<{ id: string; title: string }>();
  if (!asset) return c.json({ error: "Asset not found" }, 404);
  const [views, licences] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT metric_date AS label, SUM(count) AS value FROM analytics_daily WHERE metric_type = 'asset_view' AND asset_id = ? AND metric_date >= date('now', '-30 day') GROUP BY metric_date ORDER BY metric_date ASC`).bind(asset.id),
    c.env.DB.prepare(`SELECT licence_type, status, price_cents, created_at FROM licences WHERE asset_id = ? ORDER BY created_at DESC LIMIT 20`).bind(asset.id),
  ]);
  const rows = (result: { results: unknown[] }): Record<string, unknown>[] => result.results as Record<string, unknown>[];
  const licenceRows = rows(licences);
  return c.json({
    assetId: asset.id, assetTitle: asset.title,
    viewTrend: rows(views).map((row) => ({ label: String(row.label), value: Number(row.value) })),
    totalViews: rows(views).reduce((sum, row) => sum + Number(row.value), 0),
    licences: licenceRows.map((row) => ({ licenceType: row.licence_type, status: row.status, priceCents: Number(row.price_cents), createdAt: String(row.created_at) })),
    licensedCount: licenceRows.filter((row) => row.status === "paid").length,
    revenueCents: licenceRows.filter((row) => row.status === "paid").reduce((sum, row) => sum + Number(row.price_cents), 0),
  });
});

app.get("/api/analytics/contributor/revenue", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "admin"])) return c.json({ error: "Contributor revenue access required" }, 403);
  const [licences, ledger, subscriptions, payouts, mediaInventory, mediaCount, mediaShape, paymentStatuses, packageMix, performanceAssets] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT l.id, a.id AS asset_id, a.title AS asset_title, a.kind, l.licence_type, l.territory,
        l.duration_days, l.price_cents, l.status, l.paid_at, l.created_at,
        buyer.display_name AS buyer_name,
        COALESCE(SUM(CASE WHEN le.entry_type = 'sale' THEN le.amount_cents ELSE 0 END), 0) AS royalty_cents,
        COALESCE(SUM(CASE WHEN le.entry_type = 'platform_fee' THEN ABS(le.amount_cents) ELSE 0 END), 0) AS platform_fee_cents,
        COALESCE(SUM(CASE WHEN le.entry_type = 'refund' THEN ABS(le.amount_cents) ELSE 0 END), 0) AS refunded_cents
      FROM licences l
        JOIN assets a ON a.id = l.asset_id AND a.organization_id = ? AND a.owner_id = ? AND a.monetization_model = 'individual_license'
        JOIN users buyer ON buyer.id = l.buyer_id
        LEFT JOIN ledger_entries le ON le.licence_id = l.id AND le.contributor_id = ?
      WHERE l.organization_id = ? AND l.status IN ('paid', 'refunded')
      GROUP BY l.id, a.id, a.title, a.kind, l.licence_type, l.territory, l.duration_days, l.price_cents, l.status, l.paid_at, l.created_at, buyer.display_name
      ORDER BY COALESCE(l.paid_at, l.created_at) DESC`).bind(user.organizationId, user.id, user.id, user.organizationId),
    c.env.DB.prepare(`SELECT
        COALESCE(SUM(CASE WHEN entry_type = 'sale' THEN amount_cents ELSE 0 END), 0) AS royalty_cents,
        COALESCE(SUM(CASE WHEN entry_type = 'platform_fee' THEN ABS(amount_cents) ELSE 0 END), 0) AS platform_fee_cents,
        COALESCE(SUM(CASE WHEN entry_type = 'refund' THEN ABS(amount_cents) ELSE 0 END), 0) AS refunded_cents
      FROM ledger_entries le
        JOIN licences l ON l.id = le.licence_id AND l.organization_id = ?
        JOIN assets a ON a.id = l.asset_id AND a.owner_id = ? AND a.monetization_model = 'individual_license'
      WHERE le.contributor_id = ?`)
      .bind(user.organizationId, user.id, user.id),
    c.env.DB.prepare(`SELECT COUNT(CASE WHEN paid_at IS NOT NULL THEN 1 END) AS subscription_count,
        COALESCE(SUM(CASE WHEN paid_at IS NOT NULL THEN price_cents ELSE 0 END), 0) AS subscription_gross_cents
      FROM photographer_subscriptions WHERE organization_id = ? AND photographer_id = ?`)
      .bind(user.organizationId, user.id),
    c.env.DB.prepare(`SELECT
        COALESCE(SUM(CASE WHEN item.status = 'paid' THEN item.amount_cents ELSE 0 END), 0) AS paid_out_cents,
        COALESCE(SUM(CASE WHEN item.status IN ('pending', 'processing') THEN item.amount_cents ELSE 0 END), 0) AS in_flight_cents,
        COALESCE(SUM(CASE WHEN item.status = 'failed' THEN item.amount_cents ELSE 0 END), 0) AS failed_cents
      FROM payout_batch_items item JOIN payout_batches batch ON batch.id = item.batch_id
      WHERE batch.organization_id = ? AND item.contributor_id = ?`).bind(user.organizationId, user.id),
    c.env.DB.prepare(`SELECT id, title, kind, status, monetization_model, license_price_cents
      FROM assets WHERE organization_id = ? AND owner_id = ? ORDER BY created_at DESC`).bind(user.organizationId, user.id),
    c.env.DB.prepare("SELECT COUNT(*) AS total FROM assets WHERE organization_id = ? AND owner_id = ?").bind(user.organizationId, user.id),
    c.env.DB.prepare(`SELECT kind, monetization_model, COUNT(*) AS total,
        SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published_count
      FROM assets WHERE organization_id = ? AND owner_id = ? GROUP BY kind, monetization_model ORDER BY kind, monetization_model`).bind(user.organizationId, user.id),
    c.env.DB.prepare(`SELECT l.status, COUNT(*) AS transaction_count, COALESCE(SUM(l.price_cents), 0) AS amount_cents
      FROM licences l JOIN assets a ON a.id = l.asset_id AND a.organization_id = ? AND a.owner_id = ?
      WHERE l.organization_id = ? GROUP BY l.status ORDER BY l.status`).bind(user.organizationId, user.id, user.organizationId),
    c.env.DB.prepare(`SELECT l.licence_type, l.duration_days, l.territory, COUNT(*) AS transaction_count,
        COALESCE(SUM(l.price_cents), 0) AS purchase_cents,
        COALESCE(SUM(CASE WHEN le.entry_type = 'sale' THEN le.amount_cents ELSE 0 END), 0) AS royalty_cents,
        COALESCE(SUM(CASE WHEN le.entry_type = 'refund' THEN ABS(le.amount_cents) ELSE 0 END), 0) AS refunded_cents
      FROM licences l JOIN assets a ON a.id = l.asset_id AND a.organization_id = ? AND a.owner_id = ?
        LEFT JOIN ledger_entries le ON le.licence_id = l.id AND le.contributor_id = ?
      WHERE l.organization_id = ? AND l.status IN ('paid', 'refunded')
      GROUP BY l.licence_type, l.duration_days, l.territory ORDER BY purchase_cents DESC`).bind(user.organizationId, user.id, user.id, user.organizationId),
    c.env.DB.prepare(`SELECT a.id, a.title, a.kind,
        COALESCE((SELECT SUM(ad.count) FROM analytics_daily ad WHERE ad.asset_id = a.id AND ad.metric_type = 'asset_view' AND ad.metric_date >= date('now', '-30 day')), 0) AS views_30d,
        COALESCE((SELECT COUNT(*) FROM licences l WHERE l.asset_id = a.id AND l.organization_id = a.organization_id AND l.status IN ('paid', 'refunded')), 0) AS licence_count,
        COALESCE((SELECT COUNT(*) FROM media_download_events de WHERE de.asset_id = a.id AND de.organization_id = a.organization_id AND de.created_at >= datetime('now', '-30 day')), 0) AS download_count,
        COALESCE((SELECT COUNT(*) FROM media_download_events de JOIN photographer_subscriptions s ON s.subscriber_id = de.user_id AND s.photographer_id = a.owner_id AND s.organization_id = a.organization_id WHERE de.asset_id = a.id AND de.entitlement_type = 'subscription' AND de.created_at >= datetime('now', '-30 day')), 0) AS subscription_download_count,
        COALESCE((SELECT SUM(CASE WHEN le.entry_type = 'sale' THEN le.amount_cents ELSE 0 END) FROM ledger_entries le JOIN licences l ON l.id = le.licence_id WHERE l.asset_id = a.id AND l.organization_id = a.organization_id AND le.contributor_id = a.owner_id), 0) AS royalty_cents
      FROM assets a WHERE a.organization_id = ? AND a.owner_id = ? ORDER BY royalty_cents DESC, views_30d DESC`).bind(user.organizationId, user.id),
  ]);
  const rows = (result: { results: unknown[] }): Record<string, unknown>[] => result.results as Record<string, unknown>[];
  const first = (result: { results: unknown[] }): Record<string, unknown> => (rows(result)[0] ?? {});
  const ledgerRow = first(ledger);
  const subscriptionRow = first(subscriptions);
  const payoutRow = first(payouts);
  const mediaRows = rows(mediaInventory);
  const mediaCountRow = first(mediaCount);
  const mediaShapeRows = rows(mediaShape);
  const paymentStatusRows = rows(paymentStatuses);
  const packageRows = rows(packageMix);
  const performanceRows = rows(performanceAssets);
  const royaltyCents = Number(ledgerRow.royalty_cents ?? 0);
  const refundedCents = Number(ledgerRow.refunded_cents ?? 0);
  const paidOutCents = Number(payoutRow.paid_out_cents ?? 0);
  const inFlightCents = Number(payoutRow.in_flight_cents ?? 0);
  const failedPayoutCents = Number(payoutRow.failed_cents ?? 0);
  const payoutSchedule = monthlyPayoutSchedule();
  const customLicenceRows = rows(licences).map((row) => ({
    id: String(row.id),
    assetId: String(row.asset_id),
    assetTitle: String(row.asset_title),
    kind: String(row.kind),
    licenceType: String(row.licence_type),
    territory: String(row.territory),
    durationDays: Number(row.duration_days),
    purchaseCents: Number(row.price_cents),
    royaltyCents: Number(row.royalty_cents ?? 0),
    platformFeeCents: Number(row.platform_fee_cents ?? 0),
    refundedCents: Number(row.refunded_cents ?? 0),
    status: String(row.status),
    buyerName: String(row.buyer_name ?? "Buyer identity unavailable"),
    paidAt: row.paid_at ? String(row.paid_at) : null,
    createdAt: String(row.created_at),
  }));
  return c.json({
    statement: {
      currency: "ZAR",
      generatedAt: new Date().toISOString(),
      customPricedLicences: {
        results: customLicenceRows,
        total: customLicenceRows.length,
        purchaseCents: customLicenceRows.reduce((sum, row) => sum + row.purchaseCents, 0),
        royaltyCents,
        platformFeeCents: Number(ledgerRow.platform_fee_cents ?? 0),
        refundedCents,
      },
      mediaInventory: {
        total: Number(mediaCountRow.total ?? mediaRows.length),
        results: mediaRows.map((row) => ({
          id: String(row.id), title: String(row.title), kind: String(row.kind), status: String(row.status),
          monetizationModel: String(row.monetization_model), licensePriceCents: row.license_price_cents === null ? null : Number(row.license_price_cents),
        })),
        byTypeAndPackage: mediaShapeRows.map((row) => ({ kind: String(row.kind), monetizationModel: String(row.monetization_model), total: Number(row.total ?? 0), published: Number(row.published_count ?? 0) })),
      },
      paymentFlow: {
        byStatus: paymentStatusRows.map((row) => ({ status: String(row.status), transactionCount: Number(row.transaction_count ?? 0), amountCents: Number(row.amount_cents ?? 0) })),
        packageMix: packageRows.map((row) => ({ licenceType: String(row.licence_type), durationDays: Number(row.duration_days), territory: String(row.territory), transactionCount: Number(row.transaction_count ?? 0), purchaseCents: Number(row.purchase_cents ?? 0), royaltyCents: Number(row.royalty_cents ?? 0), refundedCents: Number(row.refunded_cents ?? 0) })),
        transactionCount: paymentStatusRows.reduce((sum, row) => sum + Number(row.transaction_count ?? 0), 0),
      },
      performance: {
        range: "Last 30 days",
        summary: {
          views: performanceRows.reduce((sum, row) => sum + Number(row.views_30d ?? 0), 0),
          downloads: performanceRows.reduce((sum, row) => sum + Number(row.download_count ?? 0), 0),
          subscriptionDownloads: performanceRows.reduce((sum, row) => sum + Number(row.subscription_download_count ?? 0), 0),
          licensedAssets: performanceRows.filter((row) => Number(row.licence_count ?? 0) > 0).length,
          royaltyCents,
          roiStatus: "not_available",
          roiExplanation: "Seller costs are not recorded, so Veld does not calculate a literal seller ROI. Royalty yield is shown as a performance proxy instead.",
        },
        assets: performanceRows.map((row) => {
          const views = Number(row.views_30d ?? 0);
          const royalty = Number(row.royalty_cents ?? 0);
          return { id: String(row.id), title: String(row.title), kind: String(row.kind), views, downloads: Number(row.download_count ?? 0), subscriptionDownloads: Number(row.subscription_download_count ?? 0), licenceCount: Number(row.licence_count ?? 0), royaltyCents: royalty, royaltyPerThousandViewsCents: views ? Math.round((royalty * 1000) / views) : null };
        }),
      },
      veldSubscriptionRoyalty: {
        status: "not_allocated",
        amountCents: 0,
        period: null,
        subscriptionPurchases: Number(subscriptionRow.subscription_count ?? 0),
        subscriptionGrossCents: Number(subscriptionRow.subscription_gross_cents ?? 0),
        explanation: "Veld has not posted a generic subscription royalty allocation for this account. Subscription access and any future royalty pool are tracked separately; no amount is estimated or promised here.",
      },
      payoutPosition: {
        postedRoyaltyCents: royaltyCents - refundedCents,
        paidOutCents,
        inFlightCents,
        failedPayoutCents,
        outstandingCents: Math.max(0, royaltyCents - refundedCents - paidOutCents - inFlightCents),
        note: "Payout batches and their payment status are controlled by the Veld finance workflow. This statement does not expose bank details or payment credentials.",
      },
      payoutPolicy: {
        cadence: "monthly",
        method: "lump_sum",
        payoutDayOfMonth: payoutSchedule.payoutDayOfMonth,
        timeZone: payoutSchedule.timeZone,
        nextScheduledPayoutDate: payoutSchedule.nextPayoutDate,
        amountExpectedCents: Math.max(0, royaltyCents - refundedCents - paidOutCents - inFlightCents),
        status: "scheduled_subject_to_approved_payout_batch",
        explanation: "Veld's stated policy is to pay posted royalty amounts as one lump sum on the 25th of each month. The amount remains subject to refunds, the payout minimum, verified payout details, finance approval, and provider settlement.",
      },
      privacy: {
        buyerIdentity: "Only the buyer display name attached to an owned licence is shown.",
        hidden: ["email", "payment details", "provider references", "private checkout data"],
        scope: "Results are limited to media owned by the signed-in contributor in the active organisation.",
      },
    },
  });
});

async function contributorStatementForExport(c: AppContext): Promise<Record<string, unknown> | null> {
  const response = await app.fetch(new Request(new URL("/api/analytics/contributor/revenue", c.req.url), { headers: c.req.raw.headers }), c.env, c.executionCtx);
  if (!response.ok) return null;
  const body = await response.json() as { statement?: Record<string, unknown> };
  return body.statement ?? null;
}

app.get("/api/analytics/contributor/revenue.csv", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "admin"])) return c.json({ error: "Contributor revenue access required" }, 403);
  const statement = await contributorStatementForExport(c);
  if (!statement) return c.json({ error: "Contributor revenue statement unavailable" }, 503);
  return new Response(buildStatementCsv(statement), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="veld-seller-statement-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" } });
});

app.get("/api/analytics/contributor/revenue.pdf", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "admin"])) return c.json({ error: "Contributor revenue access required" }, 403);
  const statement = await contributorStatementForExport(c);
  if (!statement) return c.json({ error: "Contributor revenue statement unavailable" }, 503);
  const pdf = buildStatementPdf(statement);
  return new Response(pdf.buffer as ArrayBuffer, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="veld-seller-statement-${new Date().toISOString().slice(0, 10)}.pdf"`, "Cache-Control": "private, no-store" } });
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

app.get("/api/admin/search-insights", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Editor access required" }, 403);
  const [searches, tags, views] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT metric_key AS value, SUM(count) AS count FROM analytics_daily WHERE metric_type = 'search' AND metric_date >= date('now', '-30 day') GROUP BY metric_key ORDER BY count DESC LIMIT 20"),
    c.env.DB.prepare("SELECT metric_key AS value, SUM(count) AS count FROM analytics_daily WHERE metric_type = 'tag_click' AND metric_date >= date('now', '-30 day') GROUP BY metric_key ORDER BY count DESC LIMIT 20"),
    c.env.DB.prepare("SELECT a.id, a.title, SUM(ad.count) AS views FROM analytics_daily ad JOIN assets a ON a.id = ad.asset_id WHERE ad.metric_type = 'asset_view' AND a.organization_id = ? AND ad.metric_date >= date('now', '-30 day') GROUP BY a.id ORDER BY views DESC LIMIT 20").bind(user.organizationId),
  ]);
  return c.json({ range: "Last 30 days", searches: searches.results, tagClicks: tags.results, mostViewedAssets: views.results, rankingSignals: ["human verification", "metadata match", "rights readiness", "editorial freshness"] });
});

app.get("/api/admin/community/curation", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Editor access required" }, 403);
  const [showcases, collections] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM showcases WHERE organization_id = ? ORDER BY created_at DESC").bind(user.organizationId),
    c.env.DB.prepare("SELECT * FROM featured_collections WHERE organization_id = ? ORDER BY created_at DESC").bind(user.organizationId),
  ]);
  return c.json({ showcases: showcases.results, collections: collections.results });
});

app.post("/api/admin/community/showcases", async (c) => {
  const user = await requestUser(c); if (!user || !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Editor access required" }, 403);
  const payload = curationSchema.parse(await c.req.json()); const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO showcases (id, organization_id, title, description, curator_id, theme, status) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, user.organizationId, payload.title, payload.description, user.id, payload.theme, payload.status).run();
  try { await replaceCurationAssets(c.env, "showcase_assets", "showcase_id", id, user.organizationId, payload.assetIds); } catch (error) { await c.env.DB.prepare("DELETE FROM showcases WHERE id = ?").bind(id).run(); return c.json({ error: error instanceof Error ? error.message : "Could not curate assets" }, 422); }
  return c.json({ id, status: payload.status }, 201, { Location: `/api/admin/community/showcases/${id}` });
});

app.patch("/api/admin/community/showcases/:id", async (c) => {
  const user = await requestUser(c); if (!user || !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Editor access required" }, 403);
  const payload = curationSchema.partial().parse(await c.req.json()); const id = c.req.param("id");
  const current = await c.env.DB.prepare("SELECT id FROM showcases WHERE id = ? AND organization_id = ?").bind(id, user.organizationId).first(); if (!current) return c.json({ error: "Showcase not found" }, 404);
  await c.env.DB.prepare("UPDATE showcases SET title = COALESCE(?, title), description = COALESCE(?, description), theme = COALESCE(?, theme), status = COALESCE(?, status) WHERE id = ?").bind(payload.title ?? null, payload.description ?? null, payload.theme ?? null, payload.status ?? null, id).run();
  if (payload.assetIds) try { await replaceCurationAssets(c.env, "showcase_assets", "showcase_id", id, user.organizationId, payload.assetIds); } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Could not curate assets" }, 422); }
  return c.json({ id, ok: true });
});

app.delete("/api/admin/community/showcases/:id", async (c) => { const user = await requestUser(c); if (!user || !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Editor access required" }, 403); const result = await c.env.DB.prepare("DELETE FROM showcases WHERE id = ? AND organization_id = ?").bind(c.req.param("id"), user.organizationId).run(); return Number(result.meta.changes ?? 0) ? c.json({ ok: true }) : c.json({ error: "Showcase not found" }, 404); });

app.post("/api/admin/community/collections", async (c) => {
  const user = await requestUser(c); if (!user || !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Editor access required" }, 403);
  const payload = curationSchema.parse(await c.req.json()); const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO featured_collections (id, organization_id, title, description, location, featured_label, status) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, user.organizationId, payload.title, payload.description, payload.location, payload.featuredLabel, payload.status).run();
  try { await replaceCurationAssets(c.env, "collection_assets", "collection_id", id, user.organizationId, payload.assetIds); } catch (error) { await c.env.DB.prepare("DELETE FROM featured_collections WHERE id = ?").bind(id).run(); return c.json({ error: error instanceof Error ? error.message : "Could not curate assets" }, 422); }
  return c.json({ id, status: payload.status }, 201, { Location: `/api/admin/community/collections/${id}` });
});

app.patch("/api/admin/community/collections/:id", async (c) => {
  const user = await requestUser(c); if (!user || !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Editor access required" }, 403);
  const payload = curationSchema.partial().parse(await c.req.json()); const id = c.req.param("id"); const current = await c.env.DB.prepare("SELECT id FROM featured_collections WHERE id = ? AND organization_id = ?").bind(id, user.organizationId).first(); if (!current) return c.json({ error: "Collection not found" }, 404);
  await c.env.DB.prepare("UPDATE featured_collections SET title = COALESCE(?, title), description = COALESCE(?, description), location = COALESCE(?, location), featured_label = COALESCE(?, featured_label), status = COALESCE(?, status) WHERE id = ?").bind(payload.title ?? null, payload.description ?? null, payload.location ?? null, payload.featuredLabel ?? null, payload.status ?? null, id).run();
  if (payload.assetIds) try { await replaceCurationAssets(c.env, "collection_assets", "collection_id", id, user.organizationId, payload.assetIds); } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Could not curate assets" }, 422); }
  return c.json({ id, ok: true });
});

app.delete("/api/admin/community/collections/:id", async (c) => { const user = await requestUser(c); if (!user || !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Editor access required" }, 403); const result = await c.env.DB.prepare("DELETE FROM featured_collections WHERE id = ? AND organization_id = ?").bind(c.req.param("id"), user.organizationId).run(); return Number(result.meta.changes ?? 0) ? c.json({ ok: true }) : c.json({ error: "Collection not found" }, 404); });

app.post("/api/buyer-api-keys", async (c) => {
  const user = await requestUser(c); if (!user || !allowedRole(user, ["buyer", "admin"])) return c.json({ error: "Buyer access required" }, 403);
  const payload = buyerApiKeySchema.parse(await c.req.json()); const token = `va_buyer_${base64UrlToken()}`; const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO buyer_api_keys (id, organization_id, user_id, label, token_hash) VALUES (?, ?, ?, ?, ?)").bind(id, user.organizationId, user.id, payload.label, await sha256Hex(token)).run();
  return c.json({ id, label: payload.label, token, warning: "Copy this token now. It will not be shown again." }, 201, { Location: `/api/buyer-api-keys/${id}` });
});

app.get("/api/buyer-api-keys", async (c) => { const user = await requestUser(c); if (!user || !allowedRole(user, ["buyer", "admin"])) return c.json({ error: "Buyer access required" }, 403); const keys = await c.env.DB.prepare("SELECT id, label, status, last_used_at, created_at, revoked_at FROM buyer_api_keys WHERE organization_id = ? AND user_id = ? ORDER BY created_at DESC").bind(user.organizationId, user.id).all(); return c.json({ results: keys.results }); });
app.delete("/api/buyer-api-keys/:id", async (c) => { const user = await requestUser(c); if (!user || !allowedRole(user, ["buyer", "admin"])) return c.json({ error: "Buyer access required" }, 403); const changed = await c.env.DB.prepare("UPDATE buyer_api_keys SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ? AND user_id = ? AND status = 'active'").bind(c.req.param("id"), user.organizationId, user.id).run(); return Number(changed.meta.changes ?? 0) ? c.json({ ok: true }) : c.json({ error: "API key not found" }, 404); });

app.get("/api/public/v1/assets", async (c) => {
  const organizationId = await publicBuyerOrganization(c.env, c.req.raw); if (!organizationId) return c.json({ error: "Valid buyer API token required" }, 401);
  const q = z.string().trim().max(240).parse(c.req.query("q") ?? ""); const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 25) || 25)); const match = `%${q}%`;
  const rows = await c.env.DB.prepare("SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id WHERE a.organization_id = ? AND a.status = 'published' AND (? = '' OR a.title LIKE ? OR a.description LIKE ? OR a.subject_tags LIKE ?) ORDER BY a.human_verified DESC, a.created_at DESC LIMIT ?").bind(organizationId, q, match, match, match, limit).all<Record<string, unknown>>();
  return c.json({ results: rows.results.map((row) => assetRowToDomain(row, c.env)), limit });
});
app.get("/api/public/v1/assets/:id", async (c) => { const organizationId = await publicBuyerOrganization(c.env, c.req.raw); if (!organizationId) return c.json({ error: "Valid buyer API token required" }, 401); const row = await c.env.DB.prepare("SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id WHERE a.id = ? AND a.organization_id = ? AND a.status = 'published'").bind(c.req.param("id"), organizationId).first<Record<string, unknown>>(); return row ? c.json(assetRowToDomain(row, c.env)) : c.json({ error: "Asset not found" }, 404); });

app.get("/api/community/overview", async (c) => {
  const organizationId = c.env.DEFAULT_ORGANIZATION_ID ?? "org-demo";
  const [forums, threads, showcases, showcaseAssets, collections, collectionAssets] = await Promise.all([
    c.env.DB.prepare(`SELECT f.*, COUNT(DISTINCT t.id) AS topic_count, COUNT(p.id) AS post_count FROM community_forums f LEFT JOIN forum_threads t ON t.forum_id = f.id AND t.status = 'open' LEFT JOIN forum_posts p ON p.thread_id = t.id AND p.status = 'visible' WHERE f.status = 'open' GROUP BY f.id ORDER BY f.created_at ASC`).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT t.*, u.display_name AS author, COUNT(p.id) AS replies FROM forum_threads t JOIN users u ON u.id = t.author_id LEFT JOIN forum_posts p ON p.thread_id = t.id AND p.status = 'visible' WHERE t.status = 'open' GROUP BY t.id ORDER BY t.featured DESC, t.updated_at DESC LIMIT 12`).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT s.*, u.display_name AS curator FROM showcases s JOIN users u ON u.id = s.curator_id WHERE s.organization_id = ? AND s.status = 'published' ORDER BY s.created_at DESC LIMIT 12`).bind(organizationId).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT sa.showcase_id, sa.asset_id FROM showcase_assets sa JOIN showcases s ON s.id = sa.showcase_id WHERE s.organization_id = ? ORDER BY sa.sort_order ASC`).bind(organizationId).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT c.*, COUNT(DISTINCT ca.asset_id) AS asset_count, COUNT(DISTINCT a.owner_id) AS contributor_count FROM featured_collections c LEFT JOIN collection_assets ca ON ca.collection_id = c.id LEFT JOIN assets a ON a.id = ca.asset_id WHERE c.organization_id = ? AND c.status = 'published' GROUP BY c.id ORDER BY c.created_at DESC LIMIT 12`).bind(organizationId).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT ca.collection_id, ca.asset_id FROM collection_assets ca JOIN featured_collections c ON c.id = ca.collection_id WHERE c.organization_id = ? ORDER BY ca.sort_order ASC`).bind(organizationId).all<Record<string, unknown>>(),
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

const forumThreadSchema = z.object({ title: z.string().trim().min(4).max(200), body: z.string().trim().min(10).max(4000) });

app.post("/api/community/forums/:forumId/threads", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const forum = await c.env.DB.prepare("SELECT id FROM community_forums WHERE id = ? AND status = 'open'").bind(c.req.param("forumId")).first<{ id: string }>();
  if (!forum) return c.json({ error: "Forum not found or read-only" }, 404);
  const payload = forumThreadSchema.parse(await c.req.json());
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO forum_threads (id, forum_id, author_id, title, body) VALUES (?, ?, ?, ?, ?)").bind(id, forum.id, user.id, payload.title, payload.body).run();
  return c.json({ id }, 201);
});

const forumPostSchema = z.object({ body: z.string().trim().min(1).max(2000) });

app.post("/api/community/threads/:threadId/posts", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const thread = await c.env.DB.prepare("SELECT id, author_id, title FROM forum_threads WHERE id = ? AND status = 'open'").bind(c.req.param("threadId")).first<{ id: string; author_id: string; title: string }>();
  if (!thread) return c.json({ error: "Thread not found or locked" }, 404);
  const payload = forumPostSchema.parse(await c.req.json());
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO forum_posts (id, thread_id, author_id, body) VALUES (?, ?, ?, ?)").bind(id, thread.id, user.id, payload.body),
    c.env.DB.prepare("UPDATE forum_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(thread.id),
  ]);
  if (thread.author_id !== user.id) {
    c.executionCtx.waitUntil(notify(c.env, user.organizationId, thread.author_id, { type: "forum_reply", title: "New reply", body: `Someone replied to "${thread.title}".`, resourceType: "forum_thread", resourceId: thread.id }));
  }
  return c.json({ id }, 201);
});

app.get("/api/community/threads/:threadId/posts", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT p.id, p.body, p.status, p.created_at, u.display_name AS author
    FROM forum_posts p JOIN users u ON u.id = p.author_id WHERE p.thread_id = ? AND p.status = 'visible' ORDER BY p.created_at ASC LIMIT 200`).bind(c.req.param("threadId")).all<Record<string, unknown>>();
  return c.json({ threadId: c.req.param("threadId"), results: rows.results.map((row) => ({ id: String(row.id), body: String(row.body), author: String(row.author), createdAt: String(row.created_at) })) });
});

app.post("/api/admin/community/posts/:postId/moderate", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Editor access required" }, 403);
  const payload = z.object({ action: z.enum(["hide", "restore", "remove"]) }).parse(await c.req.json());
  const status = payload.action === "hide" ? "hidden" : payload.action === "remove" ? "removed" : "visible";
  await c.env.DB.prepare("UPDATE forum_posts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(status, c.req.param("postId")).run();
  return c.json({ ok: true, status });
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
  const auditEventId = await appendCampaignAudit(c, user, "rights.case.created", "takedown_request", id, { assetId: asset.id, reason: payload.reason, mediationRequested: payload.mediationRequested });
  const moderators = await c.env.DB.prepare("SELECT u.email FROM organization_memberships om JOIN users u ON u.id = om.user_id WHERE om.organization_id = ? AND om.role IN ('editor', 'admin') AND om.status = 'active'").bind(user.organizationId).all<{ email: string }>();
  c.executionCtx.waitUntil(Promise.all(moderators.results.map((moderator) => dispatchEmailBestEffort(c.env, moderator.email, "New rights case", `A rights case was lodged for ${asset.title}. Case ID: ${id}.`, `rights-case:${id}:${moderator.email}`))));
  const result: RightsCase & { auditEventId: string } = { id, assetId: asset.id, assetTitle: asset.title, reason: payload.reason as TakedownReason, summary: payload.summary, status, dueAt: "Within 5 working days", mediationRequested: payload.mediationRequested, createdAt: new Date().toISOString(), auditEventId };
  return c.json(result, 201);
});

app.get("/api/rights/cases", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const rows = await c.env.DB.prepare(`SELECT t.*, a.title AS asset_title,
      EXISTS(SELECT 1 FROM mediation_sessions ms WHERE ms.takedown_request_id = t.id) AS mediation_requested
    FROM takedown_requests t JOIN assets a ON a.id = t.asset_id AND a.organization_id = t.organization_id
    WHERE t.organization_id = ? AND (t.requester_id = ? OR a.owner_id = ? OR ? IN ('editor', 'admin')) ORDER BY t.created_at DESC LIMIT 50`).bind(user.organizationId, user.id, user.id, user.role).all<Record<string, unknown>>();
  return c.json(rows.results.map((row) => ({ id: String(row.id), assetId: String(row.asset_id), assetTitle: String(row.asset_title), reason: row.reason as TakedownReason, summary: String(row.summary), status: row.status, dueAt: String(row.response_due_at), mediationRequested: Number(row.mediation_requested ?? 0) === 1, createdAt: String(row.created_at) })));
});

const mediationMessageSchema = z.object({ body: z.string().trim().min(1).max(2000), visibility: z.enum(["participants", "facilitator_only", "case_record"]).default("participants") });

app.post("/api/rights/cases/:id/messages", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const payload = mediationMessageSchema.parse(await c.req.json());
  const caseId = c.req.param("id");
  const session = await c.env.DB.prepare("SELECT ms.id, t.requester_id, a.owner_id FROM mediation_sessions ms JOIN takedown_requests t ON t.id = ms.takedown_request_id JOIN assets a ON a.id = t.asset_id AND a.organization_id = t.organization_id WHERE ms.takedown_request_id = ? AND t.organization_id = ?").bind(caseId, user.organizationId).first<{ id: string; requester_id: string; owner_id: string }>();
  if (!session) return c.json({ error: "Mediation has not been requested for this case" }, 409);
  const participant = user.id === session.requester_id || user.id === session.owner_id || ["editor", "admin"].includes(user.role);
  if (!participant) return c.json({ error: "You are not a participant in this case" }, 403);
  if (payload.visibility === "facilitator_only" && !["editor", "admin"].includes(user.role)) return c.json({ error: "Facilitator-only messages require a moderator" }, 403);
  const authorId = user.id;
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO mediation_messages (id, session_id, author_id, body, visibility) VALUES (?, ?, ?, ?, ?)").bind(id, session.id, authorId, payload.body, payload.visibility).run();
  await c.env.DB.prepare("INSERT INTO rights_case_events (id, organization_id, case_id, actor_id, event_type, payload_json) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), user.organizationId, caseId, user.id, "message_recorded", JSON.stringify({ visibility: payload.visibility })).run();
  await appendCampaignAudit(c, user, "rights.case.message_recorded", "takedown_request", caseId, { messageId: id, visibility: payload.visibility });
  if (payload.visibility !== "facilitator_only") {
    const otherParticipantId = user.id === session.requester_id ? session.owner_id : session.requester_id;
    if (otherParticipantId && otherParticipantId !== user.id) {
      c.executionCtx.waitUntil(notify(c.env, user.organizationId, otherParticipantId, { type: "mediation_message", title: "New mediation message", body: "A new message was posted in your rights case.", resourceType: "takedown_request", resourceId: caseId }));
    }
  }
  return c.json({ id, caseId, status: "message_recorded" }, 201);
});

app.get("/api/rights/cases/:id/messages", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const caseId = c.req.param("id");
  const session = await c.env.DB.prepare("SELECT ms.id, t.requester_id, a.owner_id FROM mediation_sessions ms JOIN takedown_requests t ON t.id = ms.takedown_request_id JOIN assets a ON a.id = t.asset_id AND a.organization_id = t.organization_id WHERE ms.takedown_request_id = ? AND t.organization_id = ?").bind(caseId, user.organizationId).first<{ id: string; requester_id: string; owner_id: string }>();
  if (!session) return c.json({ error: "Mediation has not been requested for this case" }, 409);
  const isModerator = ["editor", "admin"].includes(user.role);
  const participant = user.id === session.requester_id || user.id === session.owner_id || isModerator;
  if (!participant) return c.json({ error: "You are not a participant in this case" }, 403);
  const visibilityClause = isModerator ? "1 = 1" : "m.visibility <> 'facilitator_only'";
  const rows = await c.env.DB.prepare(`SELECT m.id, m.author_id, u.display_name AS author_name, m.body, m.visibility, m.created_at
    FROM mediation_messages m JOIN users u ON u.id = m.author_id
    WHERE m.session_id = ? AND ${visibilityClause} ORDER BY m.created_at ASC LIMIT 200`).bind(session.id).all<Record<string, unknown>>();
  return c.json({ caseId, results: rows.results.map((row) => ({ id: String(row.id), authorId: String(row.author_id), authorName: String(row.author_name), body: String(row.body), visibility: row.visibility, createdAt: String(row.created_at) })) });
});

async function transitionRightsCase(c: AppContext, user: RequestUser, payload: { to: RightsCase["status"]; resolutionSummary?: string; summary?: string; evidenceReferences?: string[] }): Promise<Response> {
  const caseId = c.req.param("id");
  if (!caseId) return c.json({ error: "Rights case id is required", code: "rights_case_id_required" }, 400);
  const row = await c.env.DB.prepare(`SELECT t.id, t.organization_id, t.status, t.requester_id, t.summary AS case_summary, t.resolution_summary,
      a.owner_id AS asset_owner_id, a.title AS asset_title
    FROM takedown_requests t JOIN assets a ON a.id = t.asset_id AND a.organization_id = t.organization_id
    WHERE t.id = ? AND t.organization_id = ?`).bind(caseId, user.organizationId).first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Rights case not found" }, 404);
  const decision = decideRightsTransition({ from: String(row.status) as RightsCase["status"], to: payload.to, actorId: user.id, actorRole: user.role, requesterId: row.requester_id == null ? null : String(row.requester_id), assetOwnerId: String(row.asset_owner_id) });
  if (!decision.allowed) return c.json({ error: decision.code === "rights_actor_not_authorized" ? "Only the requester, asset owner, or a reviewer can make this decision" : "That rights-case transition is not allowed from the current state", code: decision.code }, decision.code === "rights_actor_not_authorized" ? 403 : 409);
  const resolutionSummary = String(payload.resolutionSummary ?? payload.summary ?? "").trim();
  if ((payload.to === "resolved" || payload.to === "closed") && resolutionSummary.length < 10) return c.json({ error: "Resolution text is required for this transition", code: "resolution_summary_required" }, 422);
  if (payload.to === "appealed" && resolutionSummary.length < 10) return c.json({ error: "An appeal summary is required", code: "appeal_summary_required" }, 422);
  const updated = await c.env.DB.prepare(`UPDATE takedown_requests
    SET status = ?,
      resolution_summary = CASE WHEN ? <> '' THEN ? ELSE resolution_summary END,
      resolved_at = CASE WHEN ? IN ('resolved', 'closed') THEN COALESCE(resolved_at, CURRENT_TIMESTAMP) ELSE resolved_at END
    WHERE id = ? AND organization_id = ? AND status = ?`).bind(payload.to, resolutionSummary, resolutionSummary, payload.to, caseId, user.organizationId, row.status).run();
  if (Number(updated.meta.changes ?? 0) !== 1) return c.json({ error: "The rights case changed while this decision was being applied", code: "rights_transition_conflict" }, 409);
  if (payload.to === "mediation") await c.env.DB.prepare("INSERT OR IGNORE INTO mediation_sessions (id, takedown_request_id) VALUES (?, ?)").bind(`med-${crypto.randomUUID()}`, caseId).run();
  await c.env.DB.prepare("INSERT INTO rights_case_events (id, organization_id, case_id, actor_id, event_type, payload_json) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), user.organizationId, caseId, user.id, `transitioned_to_${payload.to}`, JSON.stringify({ from: row.status, to: payload.to, summary: resolutionSummary || null, evidenceReferences: payload.evidenceReferences ?? [] })).run();
  const auditEventId = await appendCampaignAudit(c, user, "rights.case.transitioned", "takedown_request", caseId, { from: row.status, to: payload.to, summary: resolutionSummary || null, evidenceReferences: payload.evidenceReferences ?? [], assetTitle: String(row.asset_title ?? "") });
  const recipients = [...new Set([String(row.requester_id), String(row.asset_owner_id)].filter((id) => id && id !== user.id))];
  for (const recipient of recipients) c.executionCtx.waitUntil(notify(c.env, user.organizationId, recipient, { type: "rights_case_transition", title: `Rights case ${payload.to.replaceAll("_", " ")}`, body: `Rights case ${caseId} moved to ${payload.to.replaceAll("_", " ")}.`, resourceType: "takedown_request", resourceId: caseId }).catch(() => undefined));
  return c.json(validateContractResponse("POST /api/rights/cases/{id}/transition 200", rightsTransitionResponseSchema, { id: caseId, status: payload.to, auditEventId }));
}

app.post("/api/rights/cases/:id/transition", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const payload = rightsTransitionRequestSchema.parse(await c.req.json());
  return transitionRightsCase(c, user, payload);
});

app.post("/api/rights/cases/:id/appeal", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const raw = await c.req.json() as Record<string, unknown>;
  const payload = rightsTransitionRequestSchema.parse({ ...raw, to: "appealed" });
  return transitionRightsCase(c, user, payload);
});

const campaignBrandKitSchema = z.object({
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
  brief: z.union([z.string().trim().max(8000), z.record(z.unknown())]).default(""),
  platforms: z.array(z.string().trim().max(40)).max(8).default([]),
  brandKit: campaignBrandKitSchema.default({}),
  status: z.enum(["draft", "active", "archived"]).default("draft"),
});
const campaignAssetSchema = z.object({
  assetId: z.string().min(1).max(120),
  stage: z.enum(["shortlisted", "rejected", "approved", "needs_review"]).default("shortlisted"),
  note: z.string().trim().max(1000).default(""),
});
const campaignTermsAcceptanceSchema = z.object({
  viewed: z.literal(true),
  accepted: z.literal(true),
  buyerAgreementVersion: z.literal(buyerAgreement.version),
  paymentAgreementVersion: z.literal(paymentDisclosure.version),
});

async function campaignTermsAccepted(c: { env: Bindings }, campaignId: string, user: RequestUser): Promise<boolean> {
  const row = await c.env.DB.prepare(`SELECT COUNT(DISTINCT agreement_type) AS agreement_count
    FROM marketplace_agreement_acceptances
    WHERE organization_id = ? AND user_id = ? AND context_type = 'listing' AND context_id = ?
      AND ((agreement_type = 'buyer' AND agreement_version = ?) OR (agreement_type = 'payment' AND agreement_version = ?))`)
    .bind(user.organizationId, user.id, campaignId, buyerAgreement.version, paymentDisclosure.version)
    .first<{ agreement_count: number }>();
  return Number(row?.agreement_count ?? 0) === 2;
}

function safeJsonObject<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as T : fallback;
  } catch {
    return fallback;
  }
}

function campaignBriefFromPayload(payload: z.infer<typeof campaignInputSchema>): { briefText: string; briefFields: CampaignBrief } {
  const briefText = payload.briefText ?? (typeof payload.brief === "string" ? payload.brief : "");
  const parsed = parseCampaignBrief(briefText, payload.platforms);
  const supplied = typeof payload.brief === "string" ? {} : payload.brief;
  const briefFields = mergeCampaignBrief(parsed, { ...supplied, ...(payload.platforms.length ? { platforms: payload.platforms } : {}) });
  return { briefText, briefFields };
}

function mergeCampaignBrief(base: CampaignBrief, value: Record<string, unknown>): CampaignBrief {
  const arrayValue = (key: string, fallback: string[]) => Array.isArray(value[key]) && value[key].length ? value[key].filter((item): item is string => typeof item === "string" && item.trim().length > 0) : fallback;
  const stringValue = (key: string, fallback: string) => typeof value[key] === "string" && value[key].trim() ? value[key].trim() : fallback;
  return {
    ...base,
    audience: stringValue("audience", base.audience),
    platforms: arrayValue("platforms", base.platforms) as CampaignBrief["platforms"],
    locations: Array.isArray(value.locations) ? arrayValue("locations", []) : base.locations,
    tone: arrayValue("tone", base.tone),
    industry: stringValue("industry", base.industry),
    productService: stringValue("productService", base.productService),
    usageRights: ["editorial", "commercial", "advertising", "social", "broadcast", "exclusive"].includes(String(value.usageRights)) ? value.usageRights as CampaignBrief["usageRights"] : base.usageRights,
    licenceType: stringValue("licenceType", base.licenceType),
    modelReleaseRequired: typeof value.modelReleaseRequired === "boolean" ? value.modelReleaseRequired : base.modelReleaseRequired,
    formatNeeded: arrayValue("formatNeeded", base.formatNeeded),
    keywords: arrayValue("keywords", base.keywords),
  };
}

function campaignSummaryFromRow(row: Record<string, unknown>) {
  const briefText = String(row.brief_text ?? "");
  const briefFields = mergeCampaignBrief(parseCampaignBrief(briefText), safeJsonObject<Record<string, unknown>>(row.brief_json, {}));
  const brandKit = safeJsonObject<BrandKit>(row.brand_kit_json, { colours: [], logoNotes: "", tone: "", industry: "", forbiddenStyles: [], preferredVisuals: "" });
  return {
    id: String(row.id),
    name: String(row.name),
    briefText,
    brief: briefText,
    briefFields,
    brandKit,
    status: String(row.status),
    assetCounts: {
      shortlisted: Number(row.shortlisted_count ?? 0),
      approved: Number(row.approved_count ?? 0),
      needsReview: Number(row.needs_review_count ?? 0),
      rejected: Number(row.rejected_count ?? 0),
    },
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

app.get("/api/campaigns", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const rows = await c.env.DB.prepare(`SELECT c.*,
    SUM(CASE WHEN ca.stage = 'shortlisted' THEN 1 ELSE 0 END) AS shortlisted_count,
    SUM(CASE WHEN ca.stage = 'approved' THEN 1 ELSE 0 END) AS approved_count,
    SUM(CASE WHEN ca.stage = 'needs_review' THEN 1 ELSE 0 END) AS needs_review_count,
    SUM(CASE WHEN ca.stage = 'rejected' THEN 1 ELSE 0 END) AS rejected_count
    FROM campaigns c LEFT JOIN campaign_assets ca ON ca.campaign_id = c.id
    WHERE c.organization_id = ? GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 100`).bind(user.organizationId).all<Record<string, unknown>>();
  return c.json({ results: rows.results.map(campaignSummaryFromRow) });
});

app.post("/api/campaigns", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["buyer", "contributor", "editor", "admin"])) return c.json({ error: "Campaign workspace access required" }, 403);
  const payload = campaignInputSchema.parse(await c.req.json());
  const id = crypto.randomUUID();
  const { briefText, briefFields } = campaignBriefFromPayload(payload);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO campaigns (id, organization_id, owner_id, name, brief_text, brief_json, brand_kit_json, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, user.organizationId, user.id, payload.name, briefText, JSON.stringify(briefFields), JSON.stringify(payload.brandKit), payload.status),
    c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, 'campaign_created', 'campaign', ?, ?)").bind(crypto.randomUUID(), user.id, id, JSON.stringify({ name: payload.name, platforms: briefFields.platforms, usageRights: briefFields.usageRights })),
  ]);
  return c.json({ id, name: payload.name, brief: briefText, briefText, briefFields, brandKit: payload.brandKit, status: payload.status, assetCounts: { shortlisted: 0, approved: 0, needsReview: 0, rejected: 0 } }, 201);
});

type CampaignLicenceRow = {
  id: string;
  asset_id: string;
  licence_type: string;
  territory: string;
  duration_days: number;
  paid_at: string;
  licence_expires_at: string;
};

function editVersionPayload(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    assetId: String(row.asset_id),
    versionNumber: Number(row.version_number),
    recipe: safeJsonObject<Record<string, unknown>>(row.recipe_json, {}),
    note: String(row.note ?? ""),
    createdAt: String(row.created_at),
  };
}

function derivativePayload(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    assetId: String(row.asset_id),
    editVersionId: String(row.edit_version_id),
    campaignId: row.campaign_id == null ? null : String(row.campaign_id),
    licenceId: String(row.licence_id),
    variant: String(row.variant),
    status: String(row.status),
    contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes ?? 0),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    contentUrl: `/api/assets/${encodeURIComponent(String(row.asset_id))}/derivatives/${encodeURIComponent(String(row.id))}/content`,
    createdAt: String(row.created_at),
  };
}

function bundlePayload(row: Record<string, unknown>) {
  const buildStatus = String(row.build_status ?? "");
  const isExpired = String(row.status) === "approved" && row.expires_at != null && !isFutureTimestamp(row.expires_at);
  return {
    id: String(row.id),
    campaignId: String(row.campaign_id),
    bundleType: String(row.bundle_type),
    status: buildStatus === "building" ? "building" : isExpired ? "expired" : String(row.status),
    expiresAt: row.expires_at == null ? null : String(row.expires_at),
    download: String(row.status) === "approved" && !isExpired && row.expires_at ? `/api/campaign-bundles/${encodeURIComponent(String(row.id))}/download` : null,
    manifest: safeJsonObject<Record<string, unknown>>(row.manifest_json, {}),
    buildStatus: buildStatus || null,
    error: row.build_error == null ? null : String(row.build_error),
    createdAt: String(row.created_at),
  };
}

function campaignAssetBlockers(row: Record<string, unknown>, hasLicence: boolean, hasDerivative: boolean, requireDerivative = true): Array<{ code: string; message: string }> {
  const blockers: Array<{ code: string; message: string }> = [];
  if (!hasLicence) blockers.push({ code: "licence_required", message: "An active paid licence owned by this organization is required." });
  if (String(row.rights_status) !== "verified" || Number(row.human_verified) !== 1) blockers.push({ code: "rights_not_verified", message: "Rights and human review must be verified before delivery." });
  if (!["verified", "not_required"].includes(String(row.model_release_status)) || !["verified", "not_required"].includes(String(row.property_release_status))) blockers.push({ code: "release_required", message: "Required model or property releases are not verified." });
  if (requireDerivative && !hasDerivative) blockers.push({ code: "derivative_required", message: "A ready derivative is required for this bundle." });
  return blockers;
}

async function activeCampaignLicence(env: Bindings, organizationId: string, buyerId: string, assetId: string): Promise<CampaignLicenceRow | null> {
  return env.DB.prepare(`SELECT l.id, l.asset_id, l.licence_type, l.territory, l.duration_days, l.paid_at,
      datetime(l.paid_at, '+' || l.duration_days || ' days') AS licence_expires_at
    FROM licences l
    WHERE l.organization_id = ? AND l.asset_id = ? AND l.buyer_id = ? AND l.status = 'paid'
      AND l.paid_at IS NOT NULL AND datetime(l.paid_at, '+' || l.duration_days || ' days') > CURRENT_TIMESTAMP
    ORDER BY l.created_at DESC LIMIT 1`).bind(organizationId, assetId, buyerId).first<CampaignLicenceRow>();
}

async function licensedCampaignAsset(c: { env: Bindings }, user: RequestUser, campaignId: string, assetId: string, licenceId: string | null): Promise<Record<string, unknown> | null> {
  const licenceFilter = licenceId == null ? "" : " AND l.id = ?";
  const values: unknown[] = [user.id];
  if (licenceId != null) values.push(licenceId);
  values.push(campaignId, user.organizationId, assetId);
  return c.env.DB.prepare(`SELECT c.id AS campaign_id, c.owner_id AS campaign_owner_id, ca.stage, a.id AS asset_id, a.owner_id,
      a.kind, a.title, a.rights_status, a.human_verified, a.model_release_status, a.property_release_status,
      a.original_key, a.source_file_name, a.source_attribution, l.id AS licence_id, l.licence_type, l.territory,
      l.duration_days, l.paid_at, datetime(l.paid_at, '+' || l.duration_days || ' days') AS licence_expires_at
    FROM campaigns c JOIN campaign_assets ca ON ca.campaign_id = c.id
      JOIN assets a ON a.id = ca.asset_id AND a.organization_id = c.organization_id
      JOIN licences l ON l.asset_id = a.id AND l.organization_id = c.organization_id AND l.buyer_id = ?
        AND l.status = 'paid' AND l.paid_at IS NOT NULL
        AND datetime(l.paid_at, '+' || l.duration_days || ' days') > CURRENT_TIMESTAMP${licenceFilter}
    WHERE c.id = ? AND c.organization_id = ? AND ca.asset_id = ? LIMIT 1`).bind(...values).first<Record<string, unknown>>();
}

app.get("/api/campaigns/:id", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const campaignId = c.req.param("id");
  const campaign = await c.env.DB.prepare(`SELECT c.*,
    SUM(CASE WHEN ca.stage = 'shortlisted' THEN 1 ELSE 0 END) AS shortlisted_count,
    SUM(CASE WHEN ca.stage = 'approved' THEN 1 ELSE 0 END) AS approved_count,
    SUM(CASE WHEN ca.stage = 'needs_review' THEN 1 ELSE 0 END) AS needs_review_count,
    SUM(CASE WHEN ca.stage = 'rejected' THEN 1 ELSE 0 END) AS rejected_count
    FROM campaigns c LEFT JOIN campaign_assets ca ON ca.campaign_id = c.id
    WHERE c.id = ? AND c.organization_id = ? GROUP BY c.id`).bind(campaignId, user.organizationId).first<Record<string, unknown>>();
  if (!campaign) return c.json({ error: "Campaign not found" }, 404);
  const summary = campaignSummaryFromRow(campaign);
  const stagedRows = await c.env.DB.prepare(`SELECT ca.stage, ca.note, a.*, u.display_name AS contributor,
      (SELECT l.id FROM licences l
       WHERE l.asset_id = a.id AND l.organization_id = a.organization_id AND l.buyer_id = ? AND l.status = 'paid'
         AND l.paid_at IS NOT NULL AND datetime(l.paid_at, '+' || l.duration_days || ' days') > CURRENT_TIMESTAMP
       ORDER BY l.created_at DESC LIMIT 1) AS active_licence_id
    FROM campaign_assets ca JOIN assets a ON a.id = ca.asset_id JOIN users u ON u.id = a.owner_id
    WHERE ca.campaign_id = ? AND a.organization_id = ? ORDER BY ca.updated_at DESC`).bind(user.id, campaignId, user.organizationId).all<Record<string, unknown>>();
  const stagedByAsset = new Map(stagedRows.results.map((row) => [String(row.id), { stage: String(row.stage) as CampaignStage, note: String(row.note ?? "") }]));
  const assetIds = stagedRows.results.map((row) => String(row.id));
  const placeholders = assetIds.map(() => "?").join(", ");
  const licenceRows = assetIds.length ? await c.env.DB.prepare(`SELECT l.id, l.asset_id, l.licence_type, l.territory, l.duration_days, l.paid_at, datetime(l.paid_at, '+' || l.duration_days || ' days') AS licence_expires_at
    FROM licences l WHERE l.organization_id = ? AND l.buyer_id = ? AND l.status = 'paid' AND l.paid_at IS NOT NULL
      AND datetime(l.paid_at, '+' || l.duration_days || ' days') > CURRENT_TIMESTAMP AND l.asset_id IN (${placeholders})
    ORDER BY l.created_at DESC`).bind(user.organizationId, user.id, ...assetIds).all<CampaignLicenceRow>() : { results: [] as CampaignLicenceRow[] };
  const licenceByAsset = new Map<string, CampaignLicenceRow>();
  for (const row of licenceRows.results) if (!licenceByAsset.has(String(row.asset_id))) licenceByAsset.set(String(row.asset_id), row);
  const assets = stagedRows.results.map((row) => ({ ...assetRowToDomain(row, c.env), campaignStage: String(row.stage) as CampaignStage, campaignNote: String(row.note ?? ""), activeLicenceId: row.active_licence_id == null ? null : String(row.active_licence_id) }));
  const editVersions = assetIds.length ? (await c.env.DB.prepare(`SELECT id, asset_id, version_number, recipe_json, note, created_at FROM asset_edit_versions WHERE organization_id = ? AND asset_id IN (${placeholders}) ORDER BY asset_id, version_number ASC`).bind(user.organizationId, ...assetIds).all<Record<string, unknown>>()).results.map(editVersionPayload) : [];
  const derivativeRows = assetIds.length ? (await c.env.DB.prepare(`SELECT id, asset_id, edit_version_id, campaign_id, licence_id, variant, status, content_type, size_bytes, width, height, created_at FROM asset_derivative_exports WHERE organization_id = ? AND campaign_id = ? AND asset_id IN (${placeholders}) ORDER BY created_at DESC`).bind(user.organizationId, campaignId, ...assetIds).all<Record<string, unknown>>()).results : [];
  const derivatives = derivativeRows.map(derivativePayload);
  const readyDerivativeAssets = new Set(derivativeRows.filter((row) => String(row.status) === "ready").map((row) => String(row.asset_id)));
  const bundleRows = (await c.env.DB.prepare(`SELECT b.*, bb.status AS build_status, bb.error_text AS build_error
    FROM campaign_bundles b LEFT JOIN campaign_bundle_builds bb ON bb.bundle_id = b.id
    WHERE b.organization_id = ? AND b.campaign_id = ? ORDER BY b.created_at DESC`).bind(user.organizationId, campaignId).all<Record<string, unknown>>()).results;
  const bundles = bundleRows.map(bundlePayload);
  const candidateRows = await c.env.DB.prepare("SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id WHERE a.organization_id = ? AND a.status = 'published' ORDER BY a.human_verified DESC, a.created_at DESC LIMIT 200").bind(user.organizationId).all<Record<string, unknown>>();
  const rankedCandidates = rankCampaignAssets(candidateRows.results.map((row) => assetRowToDomain(row, c.env)), summary.briefFields, summary.brandKit);
  const recommendations = [...rankedCandidates.slice(0, 12), ...rankedCandidates.slice(12).filter((item) => stagedByAsset.has(item.asset.id))].map((item) => {
    const staged = stagedByAsset.get(item.asset.id);
    return { ...item, stage: staged?.stage ?? null, note: staged?.note ?? "" };
  });
  return c.json({ campaign: summary, recommendations, assets, editVersions, derivatives, bundles,
    licenceMetadata: assets.map((asset) => { const licence = licenceByAsset.get(asset.id); return { assetId: asset.id, licenceId: licence?.id ?? null, licenceType: licence?.licence_type ?? null, territory: licence?.territory ?? null, expiresAt: licence?.licence_expires_at ?? null }; }),
    blockers: stagedRows.results.map((row) => ({ assetId: String(row.id), blockers: campaignAssetBlockers(row, row.active_licence_id != null, readyDerivativeAssets.has(String(row.id))) })),
    buyerTermsAccepted: await campaignTermsAccepted(c, campaignId, user) });
});

app.post("/api/campaigns/:id/terms/accept", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["buyer", "admin"])) return c.json({ error: "Buyer access required" }, 403);
  const campaignId = c.req.param("id");
  const campaign = await c.env.DB.prepare("SELECT id FROM campaigns WHERE id = ? AND organization_id = ?").bind(campaignId, user.organizationId).first<{ id: string }>();
  if (!campaign) return c.json({ error: "Campaign not found" }, 404);
  campaignTermsAcceptanceSchema.parse(await c.req.json());
  const acceptedAt = new Date().toISOString();
  const buyerTermsHash = await sha256Hex(agreementText(buyerAgreement));
  const paymentTermsHash = await sha256Hex(agreementText(paymentDisclosure));
  const statements = [
    c.env.DB.prepare("INSERT OR IGNORE INTO marketplace_agreement_acceptances (id, organization_id, user_id, agreement_type, agreement_version, terms_sha256, context_type, context_id, accepted_at) VALUES (?, ?, ?, 'buyer', ?, ?, 'listing', ?, ?)").bind(crypto.randomUUID(), user.organizationId, user.id, buyerAgreement.version, buyerTermsHash, campaignId, acceptedAt),
    c.env.DB.prepare("INSERT OR IGNORE INTO marketplace_agreement_acceptances (id, organization_id, user_id, agreement_type, agreement_version, terms_sha256, context_type, context_id, accepted_at) VALUES (?, ?, ?, 'payment', ?, ?, 'listing', ?, ?)").bind(crypto.randomUUID(), user.organizationId, user.id, paymentDisclosure.version, paymentTermsHash, campaignId, acceptedAt),
  ];
  if (!(await campaignTermsAccepted(c, campaignId, user))) statements.push(c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, 'campaign_terms_accepted', 'campaign', ?, ?)").bind(crypto.randomUUID(), user.id, campaignId, JSON.stringify({ buyerAgreementVersion: buyerAgreement.version, paymentAgreementVersion: paymentDisclosure.version, acceptedAt })));
  await c.env.DB.batch(statements);
  return c.json({ accepted: await campaignTermsAccepted(c, campaignId, user), buyerAgreementVersion: buyerAgreement.version, paymentAgreementVersion: paymentDisclosure.version, acceptedAt });
});

app.post("/api/campaigns/:id/assets", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["buyer", "contributor", "editor", "admin"])) return c.json({ error: "Campaign workspace access required" }, 403);
  const payload = campaignAssetSchema.parse(await c.req.json());
  const campaignId = c.req.param("id");
  const campaign = await c.env.DB.prepare("SELECT id FROM campaigns WHERE id = ? AND organization_id = ?").bind(campaignId, user.organizationId).first<{ id: string }>();
  if (!campaign) return c.json({ error: "Campaign not found" }, 404);
  if (payload.stage === "approved" && user.role === "buyer" && !(await campaignTermsAccepted(c, campaignId, user))) {
    return c.json({ error: "View and accept the current buyer and payment terms before approving a campaign source", code: "campaign_terms_required" }, 422);
  }
  const asset = await c.env.DB.prepare("SELECT id FROM assets WHERE id = ? AND organization_id = ? AND status = 'published'").bind(payload.assetId, user.organizationId).first<{ id: string }>();
  if (!asset) return c.json({ error: "Published asset not found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO campaign_assets (campaign_id, asset_id, stage, note, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(campaign_id, asset_id) DO UPDATE SET stage = excluded.stage, note = excluded.note, updated_at = CURRENT_TIMESTAMP").bind(campaignId, payload.assetId, payload.stage, payload.note),
    c.env.DB.prepare("UPDATE campaigns SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(campaignId),
    c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, 'campaign_asset_stage_changed', 'campaign', ?, ?)").bind(crypto.randomUUID(), user.id, campaignId, JSON.stringify({ assetId: payload.assetId, stage: payload.stage })),
  ]);
  return c.json({ ok: true, assetId: payload.assetId, stage: payload.stage });
});

async function campaignBundleAssetRows(env: Bindings, organizationId: string, campaignId: string): Promise<Record<string, unknown>[]> {
  const rows = await env.DB.prepare(`
    SELECT c.id AS campaign_id, c.owner_id AS campaign_owner_id, ca.stage,
      a.id AS asset_id, a.owner_id AS asset_owner_id, a.status AS asset_status, a.kind, a.title,
      a.rights_status, a.human_verified, a.model_release_status, a.property_release_status,
      a.original_key, a.source_file_name, a.source_attribution,
      l.id AS licence_id, l.licence_type, l.territory, l.duration_days, l.paid_at,
      datetime(l.paid_at, '+' || l.duration_days || ' days') AS licence_expires_at,
      d.id AS derivative_id, d.object_key AS derivative_key, d.content_type AS derivative_content_type,
      d.size_bytes AS derivative_size_bytes, d.variant AS derivative_variant
    FROM campaigns c
    JOIN campaign_assets ca ON ca.campaign_id = c.id
    JOIN assets a ON a.id = ca.asset_id AND a.organization_id = c.organization_id
    LEFT JOIN licences l ON l.id = (
      SELECT l2.id FROM licences l2
      WHERE l2.asset_id = a.id AND l2.organization_id = c.organization_id AND l2.buyer_id = c.owner_id
        AND l2.status = 'paid' AND l2.paid_at IS NOT NULL
        AND datetime(l2.paid_at, '+' || l2.duration_days || ' days') > CURRENT_TIMESTAMP
      ORDER BY l2.created_at DESC LIMIT 1
    )
    LEFT JOIN asset_derivative_exports d ON d.id = (
      SELECT d2.id FROM asset_derivative_exports d2
      WHERE d2.organization_id = c.organization_id AND d2.asset_id = a.id AND d2.campaign_id = c.id
        AND d2.licence_id = l.id AND d2.status = 'ready'
      ORDER BY d2.created_at DESC LIMIT 1
    )
    WHERE c.id = ? AND c.organization_id = ?
    ORDER BY ca.updated_at ASC
  `).bind(campaignId, organizationId).all<Record<string, unknown>>();
  return rows.results;
}

function campaignBundleBlockers(row: Record<string, unknown>, requireOriginal = false): Array<{ code: string; message: string }> {
  const blockers = campaignAssetBlockers(row, row.licence_id != null, row.derivative_id != null);
  if (String(row.stage) !== "approved") blockers.push({ code: "campaign_asset_not_approved", message: "Only approved campaign sources can be delivered." });
  if (String(row.asset_status) !== "published") blockers.push({ code: "asset_not_published", message: "The source asset is not currently published." });
  if (requireOriginal && String(row.original_key ?? "").trim() === "") blockers.push({ code: "original_unavailable", message: "The source original is unavailable." });
  return blockers;
}

async function appendCampaignAudit(c: AppContext, user: RequestUser, action: string, resourceType: string, resourceId: string, data: Record<string, unknown>): Promise<string> {
  const result = await appendAuditEvent(c.env, {
    streamId: `organization:${user.organizationId}`,
    actorId: user.id,
    actorType: auditActorTypeForRole(user.role),
    action,
    resourceType,
    resourceId,
    data: redactAuditData(data),
    organizationId: user.organizationId,
    residencyRegion: user.residencyRegion,
    actorResidencyRegion: user.residencyRegion,
  });
  return result.event.eventId;
}

app.get("/api/assets/:id/edit-versions", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const assetId = c.req.param("id");
  const asset = await c.env.DB.prepare("SELECT id, organization_id, owner_id FROM assets WHERE id = ? AND organization_id = ?")
    .bind(assetId, user.organizationId).first<{ id: string; organization_id: string; owner_id: string }>();
  if (!asset) return c.json({ error: "Asset not found" }, 404);
  const licence = await activeCampaignLicence(c.env, user.organizationId, user.id, assetId);
  const mayRead = asset.owner_id === user.id || allowedRole(user, ["editor", "admin"]) || Boolean(licence);
  if (!mayRead) return c.json({ error: "An active paid licence is required to inspect edit versions", code: "licence_required" }, 403);
  const rows = await c.env.DB.prepare(`SELECT id, asset_id, version_number, recipe_json, note, created_at
    FROM asset_edit_versions WHERE organization_id = ? AND asset_id = ? ORDER BY version_number ASC`)
    .bind(user.organizationId, assetId).all<Record<string, unknown>>();
  return c.json({ assetId, results: rows.results.map(editVersionPayload) });
});

app.post("/api/assets/:id/edit-versions", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["buyer", "editor", "admin"])) return c.json({ error: "Campaign editing access required" }, 403);
  const payload = editVersionRequestSchema.parse(await c.req.json());
  const asset = await licensedCampaignAsset(c, user, payload.campaignId, c.req.param("id"), payload.licenceId);
  if (!asset) return c.json({ error: "A valid paid licence owned by this organization is required for this campaign asset", code: "licence_required" }, 403);
  const blockers = campaignAssetBlockers(asset, true, true, false);
  if (blockers.length) return c.json({ error: "The asset is not ready for editing", code: "campaign_edit_blocked", blockers }, 422);
  const existing = await c.env.DB.prepare("SELECT COALESCE(MAX(version_number), 0) AS version_number FROM asset_edit_versions WHERE organization_id = ? AND asset_id = ?")
    .bind(user.organizationId, c.req.param("id")).first<{ version_number: number }>();
  const versionNumber = Number(existing?.version_number ?? 0) + 1;
  const versionId = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO asset_edit_versions (id, organization_id, asset_id, version_number, recipe_json, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(versionId, user.organizationId, c.req.param("id"), versionNumber, JSON.stringify(payload.recipe), payload.note, user.id).run();
  const auditEventId = await appendCampaignAudit(c, user, "campaign.edit_version.created", "asset_edit_version", versionId, { assetId: c.req.param("id"), campaignId: payload.campaignId, licenceId: payload.licenceId, versionNumber });
  const response = validateContractResponse("POST /api/assets/{id}/edit-versions 201", editVersionResponseSchema, {
    id: versionId, assetId: c.req.param("id"), versionNumber, recipe: payload.recipe, note: payload.note, createdAt: new Date().toISOString(), auditEventId,
  });
  return c.json(response, 201);
});

app.post("/api/assets/:id/derivatives", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["buyer", "editor", "admin"])) return c.json({ error: "Campaign editing access required" }, 403);
  const payload = derivativeRequestSchema.parse(await c.req.json());
  const asset = await licensedCampaignAsset(c, user, payload.campaignId, c.req.param("id"), payload.licenceId);
  if (!asset) return c.json({ error: "A valid paid licence owned by this organization is required for this campaign asset", code: "licence_required" }, 403);
  const version = await c.env.DB.prepare("SELECT id FROM asset_edit_versions WHERE id = ? AND organization_id = ? AND asset_id = ?")
    .bind(payload.editVersionId, user.organizationId, c.req.param("id")).first<{ id: string }>();
  if (!version) return c.json({ error: "Edit version does not belong to this asset" }, 404);
  const blockers = campaignAssetBlockers(asset, true, true, false);
  if (blockers.length) return c.json({ error: "The asset is not ready for derivative delivery", code: "derivative_blocked", blockers }, 422);
  const derivativeId = crypto.randomUUID();
  const objectKey = `derivatives/${user.organizationId}/${c.req.param("id")}/${derivativeId}`;
  await c.env.DB.prepare(`INSERT INTO asset_derivative_exports (id, organization_id, asset_id, source_asset_id, edit_version_id, campaign_id, licence_id, variant, object_key, content_type, size_bytes, width, height, rights_snapshot_json, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(derivativeId, user.organizationId, c.req.param("id"), c.req.param("id"), payload.editVersionId, payload.campaignId, payload.licenceId, payload.variant, objectKey, payload.contentType, payload.sizeBytes, payload.width ?? null, payload.height ?? null,
      JSON.stringify({ rightsStatus: asset.rights_status, humanVerified: Number(asset.human_verified) === 1, modelReleaseStatus: asset.model_release_status, propertyReleaseStatus: asset.property_release_status, licenceExpiresAt: asset.licence_expires_at }), user.id).run();
  const auditEventId = await appendCampaignAudit(c, user, "campaign.derivative.created", "asset_derivative_export", derivativeId, { assetId: c.req.param("id"), campaignId: payload.campaignId, licenceId: payload.licenceId, variant: payload.variant });
  const response = validateContractResponse("POST /api/assets/{id}/derivatives 201", derivativeResponseSchema, {
    id: derivativeId, assetId: c.req.param("id"), editVersionId: payload.editVersionId, campaignId: payload.campaignId, licenceId: payload.licenceId, variant: payload.variant, status: "pending", contentType: payload.contentType, sizeBytes: payload.sizeBytes, width: payload.width ?? null, height: payload.height ?? null, contentUrl: `/api/assets/${encodeURIComponent(c.req.param("id"))}/derivatives/${encodeURIComponent(derivativeId)}/content`, createdAt: new Date().toISOString(), auditEventId,
  });
  return c.json(response, 201);
});

app.on(["GET", "HEAD", "PUT"], "/api/assets/:id/derivatives/:derivativeId/content", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const row = await c.env.DB.prepare(`SELECT d.*, a.owner_id AS asset_owner_id, a.rights_status, a.human_verified, a.model_release_status, a.property_release_status,
      l.buyer_id, l.status AS licence_status, l.paid_at, datetime(l.paid_at, '+' || l.duration_days || ' days') AS licence_expires_at
    FROM asset_derivative_exports d JOIN assets a ON a.id = d.asset_id AND a.organization_id = d.organization_id
      JOIN licences l ON l.id = d.licence_id AND l.organization_id = d.organization_id
    WHERE d.id = ? AND d.asset_id = ? AND d.organization_id = ?`)
    .bind(c.req.param("derivativeId"), c.req.param("id"), user.organizationId).first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Derivative not found" }, 404);
  const licenceValid = String(row.licence_status) === "paid" && row.paid_at != null && isFutureTimestamp(row.licence_expires_at);
  const mayRead = String(row.asset_owner_id) === user.id || allowedRole(user, ["editor", "admin"]) || (String(row.buyer_id) === user.id && licenceValid);
  if (!mayRead) return c.json({ error: "Derivative access is not authorized" }, 403);
  if (c.req.method === "PUT") {
    if (!allowedRole(user, ["editor", "admin"]) && !(String(row.buyer_id) === user.id && licenceValid)) return c.json({ error: "A valid licence owner or reviewer must upload derivative content" }, 403);
    if (String(row.status) === "revoked") return c.json({ error: "Revoked derivatives are immutable" }, 409);
    const contentType = (c.req.header("content-type") ?? String(row.content_type)).split(";", 1)[0].trim().toLowerCase();
    if (contentType !== String(row.content_type).toLowerCase()) return c.json({ error: "Derivative content type does not match its declaration" }, 415);
    const claimedLength = Number(c.req.header("content-length") ?? 0);
    if (claimedLength > 50_000_000) return c.json({ error: "Derivative exceeds the 50 MB limit" }, 413);
    const bytes = await c.req.raw.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > 50_000_000) return c.json({ error: "Derivative is empty or too large" }, 413);
    await c.env.MEDIA_BUCKET.put(String(row.object_key), bytes, { httpMetadata: { contentType } });
    await c.env.DB.prepare("UPDATE asset_derivative_exports SET status = 'ready', size_bytes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?")
      .bind(bytes.byteLength, row.id, user.organizationId).run();
    const auditEventId = await appendCampaignAudit(c, user, "campaign.derivative.content_uploaded", "asset_derivative_export", String(row.id), { assetId: c.req.param("id"), sizeBytes: bytes.byteLength, contentType });
    return c.json(validateContractResponse("PUT /api/assets/{id}/derivatives/{derivativeId}/content 200", derivativeResponseSchema, { ...derivativePayload({ ...row, status: "ready", size_bytes: bytes.byteLength }), auditEventId }));
  }
  const canRead = mayRead && String(row.status) === "ready";
  if (!canRead) return c.json({ error: String(row.status) === "ready" ? "Derivative access is not authorized" : "Derivative content is not ready", code: "derivative_unavailable" }, String(row.status) === "ready" ? 403 : 409);
  const object = c.req.method === "HEAD" ? await headReadableMedia(c.env, String(row.object_key)) : await getReadableMedia(c.env, String(row.object_key), c.req.header("Range") ? { range: c.req.raw.headers } : undefined);
  if (!object) return c.json({ error: "Derivative content is unavailable", code: "derivative_unavailable" }, 404);
  return createMediaResponse(c.req.raw, object as R2ObjectBody, String(row.content_type));
});

app.post("/api/campaigns/:id/bundles", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["buyer", "editor", "admin"])) return c.json({ error: "Campaign workspace access required" }, 403);
  const campaignId = c.req.param("id");
  const payload = bundleRequestSchema.parse(await c.req.json());
  const campaign = await c.env.DB.prepare("SELECT id, owner_id FROM campaigns WHERE id = ? AND organization_id = ?").bind(campaignId, user.organizationId).first<{ id: string; owner_id: string }>();
  if (!campaign) return c.json({ error: "Campaign not found" }, 404);
  if (String(campaign.owner_id) !== user.id && !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Only the campaign owner or a reviewer can request a bundle" }, 403);
  if (user.role === "buyer" && !(await campaignTermsAccepted(c, campaignId, user))) return c.json({ error: "Accept the campaign terms before requesting delivery", code: "campaign_terms_required" }, 422);
  const assets = await campaignBundleAssetRows(c.env, user.organizationId, campaignId);
  if (!assets.length) return c.json({ error: "The campaign has no assets", code: "campaign_empty" }, 422);
  const blockers = assets.flatMap((row) => campaignBundleBlockers(row, payload.bundleType === "full_archive").map((blocker) => ({ assetId: String(row.asset_id), ...blocker })));
  if (blockers.length) return c.json({ error: "The campaign is not ready for delivery", code: "bundle_blocked", blockers }, 422);
  const bundleId = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO campaign_bundles (id, organization_id, campaign_id, owner_id, bundle_type, status) VALUES (?, ?, ?, ?, ?, 'pending')")
    .bind(bundleId, user.organizationId, campaignId, campaign.owner_id, payload.bundleType).run();
  const auditEventId = await appendCampaignAudit(c, user, "campaign.bundle.requested", "campaign_bundle", bundleId, { campaignId, bundleType: payload.bundleType, assetCount: assets.length });
  const row = await c.env.DB.prepare("SELECT * FROM campaign_bundles WHERE id = ? AND organization_id = ?").bind(bundleId, user.organizationId).first<Record<string, unknown>>();
  return c.json(validateContractResponse("POST /api/campaigns/{id}/bundles 201", bundleResponseSchema, { ...bundlePayload(row ?? { id: bundleId, campaign_id: campaignId, bundle_type: payload.bundleType, status: "pending", created_at: new Date().toISOString() }), auditEventId }), 201);
});

function safeArchiveSegment(value: string, fallback: string): string {
  const segment = value.replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.\./g, "_").slice(0, 180);
  return segment || fallback;
}

async function buildCampaignBundle(c: AppContext, user: RequestUser, bundle: Record<string, unknown>): Promise<{ objectKey: string; manifest: Record<string, unknown>; items: Array<{ assetId: string; derivativeId: string | null; itemType: string; archivePath: string }> }> {
  const campaignId = String(bundle.campaign_id);
  const bundleType = String(bundle.bundle_type);
  const assets = await campaignBundleAssetRows(c.env, user.organizationId, campaignId);
  const blockers = assets.flatMap((row) => campaignBundleBlockers(row, bundleType === "full_archive").map((blocker) => ({ assetId: String(row.asset_id), ...blocker })));
  if (blockers.length) throw new Error(`Bundle blockers: ${JSON.stringify(blockers)}`);
  const campaign = await c.env.DB.prepare("SELECT id, name, brief_text, brief_json, brand_kit_json, owner_id FROM campaigns WHERE id = ? AND organization_id = ?").bind(campaignId, user.organizationId).first<Record<string, unknown>>();
  if (!campaign) throw new Error("Campaign not found");
  const items: Array<{ assetId: string; derivativeId: string | null; itemType: string; archivePath: string }> = [];
  const entries: ZipEntry[] = [];
  const manifestAssets = assets.map((row) => ({ assetId: String(row.asset_id), title: String(row.title), derivativeId: String(row.derivative_id), variant: String(row.derivative_variant), licenceId: String(row.licence_id), licenceType: String(row.licence_type), territory: String(row.territory), licenceExpiresAt: String(row.licence_expires_at), sourceAttribution: String(row.source_attribution ?? "") }));
  const campaignManifest = { version: 1, bundleId: String(bundle.id), campaignId, bundleType, generatedAt: new Date().toISOString(), campaign: { id: campaignId, name: String(campaign.name), brief: safeJsonObject<Record<string, unknown>>(campaign.brief_json, { text: String(campaign.brief_text ?? "") }), brandKit: safeJsonObject<Record<string, unknown>>(campaign.brand_kit_json, {}) }, assets: manifestAssets };
  entries.push({ path: "manifest.json", body: JSON.stringify(campaignManifest, null, 2) });
  entries.push({ path: "brief.json", body: JSON.stringify({ campaignId, name: campaign.name, briefText: campaign.brief_text ?? "", brief: safeJsonObject<Record<string, unknown>>(campaign.brief_json, {}), brandKit: safeJsonObject<Record<string, unknown>>(campaign.brand_kit_json, {}) }, null, 2) });
  entries.push({ path: "audit-manifest.json", body: JSON.stringify({ bundleId: bundle.id, campaignId, generatedAt: campaignManifest.generatedAt, sourceCount: assets.length, immutableOriginals: true }, null, 2) });
  const manifestAssetId = String(assets[0].asset_id);
  items.push({ assetId: manifestAssetId, derivativeId: null, itemType: "brief", archivePath: "brief.json" });
  items.push({ assetId: manifestAssetId, derivativeId: null, itemType: "audit_manifest", archivePath: "audit-manifest.json" });
  items.push({ assetId: manifestAssetId, derivativeId: null, itemType: "metadata", archivePath: "manifest.json" });
  for (const row of assets) {
    const assetSegment = safeArchiveSegment(String(row.asset_id), "asset");
    const variant = safeArchiveSegment(String(row.derivative_variant), "derivative");
    const derivativePath = `assets/${assetSegment}/${variant}`;
    const derivative = await getReadableMedia(c.env, String(row.derivative_key));
    if (!derivative) throw new Error(`Derivative object is unavailable for ${row.asset_id}`);
    entries.push({ path: derivativePath, body: derivative.body as ReadableStream<Uint8Array> });
    items.push({ assetId: String(row.asset_id), derivativeId: String(row.derivative_id), itemType: "derivative", archivePath: derivativePath });
    const licencePath = `licences/${assetSegment}.json`;
    entries.push({ path: licencePath, body: JSON.stringify({ licenceId: row.licence_id, licenceType: row.licence_type, territory: row.territory, expiresAt: row.licence_expires_at, assetId: row.asset_id }, null, 2) });
    items.push({ assetId: String(row.asset_id), derivativeId: null, itemType: "licence_certificate", archivePath: licencePath });
    const attributionPath = `attribution/${assetSegment}.txt`;
    entries.push({ path: attributionPath, body: String(row.source_attribution ?? "") || `Contributor asset ${row.asset_id}` });
    items.push({ assetId: String(row.asset_id), derivativeId: null, itemType: "attribution", archivePath: attributionPath });
    const metadataPath = `metadata/${assetSegment}.json`;
    entries.push({ path: metadataPath, body: JSON.stringify({ assetId: row.asset_id, title: row.title, kind: row.kind, rightsStatus: row.rights_status, humanVerified: Number(row.human_verified) === 1, modelReleaseStatus: row.model_release_status, propertyReleaseStatus: row.property_release_status }, null, 2) });
    items.push({ assetId: String(row.asset_id), derivativeId: null, itemType: "metadata", archivePath: metadataPath });
    if (bundleType === "full_archive") {
      const originalKey = String(row.original_key ?? "").trim();
      const original = originalKey ? await getReadableMedia(c.env, originalKey) : null;
      if (!original) throw new Error(`Original object is unavailable for ${row.asset_id}`);
      const originalPath = `originals/${assetSegment}/${safeArchiveSegment(String(row.source_file_name ?? "original"), "original")}`;
      entries.push({ path: originalPath, body: original.body as ReadableStream<Uint8Array> });
      items.push({ assetId: String(row.asset_id), derivativeId: null, itemType: "original", archivePath: originalPath });
    }
  }
  const objectKey = `bundles/${user.organizationId}/${campaignId}/${String(bundle.id)}.zip`;
  await c.env.MEDIA_BUCKET.put(objectKey, createStoredZip(entries), { httpMetadata: { contentType: "application/zip", cacheControl: "private, no-store" }, customMetadata: { bundleId: String(bundle.id), campaignId, organizationId: user.organizationId, bundleType, immutable: "true" } });
  return { objectKey, manifest: campaignManifest, items };
}

app.post("/api/campaigns/:id/bundles/:bundleId/approve", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Reviewer access required" }, 403);
  const campaignId = c.req.param("id");
  const bundle = await c.env.DB.prepare("SELECT b.*, c.owner_id AS campaign_owner_id FROM campaign_bundles b JOIN campaigns c ON c.id = b.campaign_id AND c.organization_id = b.organization_id WHERE b.id = ? AND b.campaign_id = ? AND b.organization_id = ?")
    .bind(c.req.param("bundleId"), campaignId, user.organizationId).first<Record<string, unknown>>();
  if (!bundle) return c.json({ error: "Bundle not found" }, 404);
  if (String(bundle.status) === "approved") return c.json(validateContractResponse("POST /api/campaigns/{id}/bundles/{bundleId}/approve 200", bundleResponseSchema, bundlePayload(bundle)));
  if (["expired", "revoked"].includes(String(bundle.status))) return c.json({ error: "This bundle can no longer be approved", code: "bundle_not_rebuildable" }, 409);
  const currentBuild = await c.env.DB.prepare("SELECT status, error_text FROM campaign_bundle_builds WHERE bundle_id = ? AND organization_id = ?").bind(bundle.id, user.organizationId).first<{ status: string; error_text: string | null }>();
  if (currentBuild?.status === "building") return c.json({ error: "Bundle is already being built", code: "bundle_building", status: "building" }, 409);
  const claimed = await c.env.DB.prepare("INSERT INTO campaign_bundle_builds (bundle_id, organization_id, status) VALUES (?, ?, 'building') ON CONFLICT(bundle_id) DO NOTHING")
    .bind(bundle.id, user.organizationId).run();
  if (!Number(claimed.meta.changes ?? 0)) {
    const updatedLock = await c.env.DB.prepare("UPDATE campaign_bundle_builds SET status = 'building', error_text = NULL, started_at = CURRENT_TIMESTAMP, completed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE bundle_id = ? AND organization_id = ? AND status <> 'building'")
      .bind(bundle.id, user.organizationId).run();
    if (!Number(updatedLock.meta.changes ?? 0)) return c.json({ error: "Bundle is already being built", code: "bundle_building", status: "building" }, 409);
  }
  try {
    const built = await buildCampaignBundle(c, user, bundle);
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM campaign_bundle_items WHERE bundle_id = ?").bind(bundle.id),
      ...built.items.map((item) => c.env.DB.prepare("INSERT INTO campaign_bundle_items (bundle_id, derivative_id, asset_id, item_type, archive_path) VALUES (?, ?, ?, ?, ?)").bind(bundle.id, item.derivativeId, item.assetId, item.itemType, item.archivePath)),
      c.env.DB.prepare("UPDATE campaign_bundles SET status = 'approved', object_key = ?, manifest_json = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?").bind(built.objectKey, JSON.stringify(built.manifest), user.id, expiresAt, bundle.id, user.organizationId),
      c.env.DB.prepare("UPDATE campaign_bundle_builds SET status = 'completed', error_text = NULL, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE bundle_id = ? AND organization_id = ?").bind(bundle.id, user.organizationId),
    ]);
    const auditEventId = await appendCampaignAudit(c, user, "campaign.bundle.approved", "campaign_bundle", String(bundle.id), { campaignId, bundleType: bundle.bundle_type, expiresAt, itemCount: built.items.length });
    if (String(bundle.campaign_owner_id) !== user.id) c.executionCtx.waitUntil(notify(c.env, user.organizationId, String(bundle.campaign_owner_id), { type: "campaign_bundle_ready", title: "Campaign bundle ready", body: "Your approved campaign bundle is ready for authenticated download for seven days.", resourceType: "campaign_bundle", resourceId: String(bundle.id) }).catch(() => undefined));
    const updated = await c.env.DB.prepare("SELECT b.*, bb.status AS build_status, bb.error_text AS build_error FROM campaign_bundles b LEFT JOIN campaign_bundle_builds bb ON bb.bundle_id = b.id WHERE b.id = ? AND b.organization_id = ?").bind(bundle.id, user.organizationId).first<Record<string, unknown>>();
    return c.json(validateContractResponse("POST /api/campaigns/{id}/bundles/{bundleId}/approve 200", bundleResponseSchema, { ...bundlePayload(updated ?? { ...bundle, status: "approved", object_key: built.objectKey, expires_at: expiresAt }), auditEventId }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bundle build failed";
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE campaign_bundle_builds SET status = 'failed', error_text = ?, updated_at = CURRENT_TIMESTAMP WHERE bundle_id = ? AND organization_id = ?").bind(message.slice(0, 1000), bundle.id, user.organizationId),
      c.env.DB.prepare("UPDATE campaign_bundles SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?").bind(bundle.id, user.organizationId),
    ]);
    return c.json({ error: "Bundle could not be built", code: "bundle_build_failed" }, 422);
  }
});

app.get("/api/campaign-bundles/:id/download", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const bundle = await c.env.DB.prepare("SELECT b.*, c.owner_id AS campaign_owner_id, c.name AS campaign_name FROM campaign_bundles b JOIN campaigns c ON c.id = b.campaign_id AND c.organization_id = b.organization_id WHERE b.id = ? AND b.organization_id = ?")
    .bind(c.req.param("id"), user.organizationId).first<Record<string, unknown>>();
  if (!bundle) return c.json({ error: "Bundle not found" }, 404);
  if (String(bundle.campaign_owner_id) !== user.id && !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Bundle download is not authorized" }, 403);
  if (String(bundle.status) !== "approved") return c.json({ error: "Bundle is not available", code: String(bundle.status) === "failed" ? "bundle_build_failed" : "bundle_not_approved" }, 409);
  if (!bundle.expires_at || String(bundle.expires_at) <= new Date().toISOString()) {
    await c.env.DB.prepare("UPDATE campaign_bundles SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?").bind(bundle.id, user.organizationId).run();
    return c.json({ error: "Bundle download has expired", code: "bundle_expired" }, 410);
  }
  const object = await c.env.MEDIA_BUCKET.get(String(bundle.object_key));
  if (!object) return c.json({ error: "Bundle object is unavailable", code: "bundle_unavailable" }, 404);
  const filename = `${safeArchiveSegment(String(bundle.campaign_name ?? "campaign"), "campaign")}-${safeArchiveSegment(String(bundle.bundle_type), "bundle")}.zip`;
  return new Response(object.body, { headers: { "Content-Type": "application/zip", "Content-Length": String(object.size), "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" } });
});

app.get("/api/campaigns/:id/manifest", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const campaign = await c.env.DB.prepare("SELECT * FROM campaigns WHERE id = ? AND organization_id = ?").bind(c.req.param("id"), user.organizationId).first<Record<string, unknown>>();
  if (!campaign) return c.json({ error: "Campaign not found" }, 404);
  const briefFields = mergeCampaignBrief(parseCampaignBrief(String(campaign.brief_text ?? "")), safeJsonObject<Record<string, unknown>>(campaign.brief_json, {}));
  const approvedRows = await c.env.DB.prepare(`SELECT ca.stage, ca.note, a.*, u.display_name AS contributor
    FROM campaign_assets ca JOIN assets a ON a.id = ca.asset_id JOIN users u ON u.id = a.owner_id
    WHERE ca.campaign_id = ? AND a.organization_id = ? AND ca.stage = 'approved' ORDER BY ca.updated_at DESC`).bind(campaign.id, user.organizationId).all<Record<string, unknown>>();
  const approvedAssets = approvedRows.results.map((row) => assetRowToDomain(row, c.env));
  return c.json({
    manifestVersion: "3A",
    campaignId: String(campaign.id),
    generatedAt: new Date().toISOString(),
    brief: briefFields,
    auditTrail: {
      approvedCount: approvedAssets.length,
      rightsVerifiedCount: approvedAssets.filter((asset) => asset.rightsStatus === "verified").length,
      humanVerifiedCount: approvedAssets.filter((asset) => asset.humanVerified).length,
    },
    terms: { accepted: await campaignTermsAccepted(c, String(campaign.id), user), buyerAgreementVersion: buyerAgreement.version, paymentAgreementVersion: paymentDisclosure.version },
    assets: approvedAssets.map((asset) => ({ id: asset.id, title: asset.title, rightsStatus: asset.rightsStatus, humanVerified: asset.humanVerified, sourceAttribution: asset.sourceAttribution })),
  });
});

const zohoSocialExportSchema = z.object({
  copy: z.string().trim().max(5000).optional(),
  channels: z.array(z.string().trim().max(40)).max(12).optional(),
  scheduleAt: z.string().datetime({ offset: true }).optional(),
}).default({});

app.post("/api/campaigns/:id/integrations/zoho/social", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["buyer", "contributor", "editor", "admin"])) return c.json({ error: "Campaign workspace access required" }, 403);
  const input = zohoSocialExportSchema.parse(await c.req.json().catch(() => ({})));
  const campaign = await c.env.DB.prepare("SELECT * FROM campaigns WHERE id = ? AND organization_id = ?").bind(c.req.param("id"), user.organizationId).first<Record<string, unknown>>();
  if (!campaign) return c.json({ error: "Campaign not found" }, 404);
  const brief = mergeCampaignBrief(parseCampaignBrief(String(campaign.brief_text ?? "")), safeJsonObject<Record<string, unknown>>(campaign.brief_json, {}));
  const requestedChannels = input.channels?.length ? input.channels : brief.platforms;
  const socialChannels = ["instagram", "facebook", "tiktok", "linkedin"];
  const channels = [...new Set(requestedChannels.filter((channel) => socialChannels.includes(channel)))];
  if (!channels.length) return c.json({ error: "Select at least one Zoho Social channel: Instagram, Facebook, TikTok, or LinkedIn" }, 422);
  const approvedRows = await c.env.DB.prepare(`SELECT a.*, u.display_name AS contributor
    FROM campaign_assets ca JOIN assets a ON a.id = ca.asset_id JOIN users u ON u.id = a.owner_id
    WHERE ca.campaign_id = ? AND a.organization_id = ? AND ca.stage = 'approved' ORDER BY ca.updated_at DESC`).bind(campaign.id, user.organizationId).all<Record<string, unknown>>();
  const approvedAssets = approvedRows.results.map((row) => assetRowToDomain(row, c.env));
  if (!approvedAssets.length) return c.json({ error: "Approve at least one asset before sending to Zoho Social" }, 422);
  const blocked = approvedAssets.filter((asset) => asset.rightsStatus !== "verified" || !asset.humanVerified || !asset.previewUrl);
  if (blocked.length) return c.json({ error: "Every approved asset must have verified rights, human review, and an available preview", blockedAssetIds: blocked.map((asset) => asset.id) }, 422);
  const origin = (c.env.APP_PUBLIC_URL ?? new URL(c.req.url).origin).replace(/\/$/, "");
  const media = approvedAssets.map((asset) => ({ assetId: asset.id, title: asset.title, url: `${origin}${asset.previewUrl}`, attribution: asset.sourceAttribution }));
  const payload: ZohoSocialDraft = {
    id: String(campaign.id), name: String(campaign.name), brief: String(campaign.brief_text ?? "").slice(0, 5000), status: String(campaign.status),
    approvedAssetCount: approvedAssets.length, platforms: brief.platforms, usageRights: brief.usageRights, channels,
    copy: input.copy ?? String(campaign.name), ...(input.scheduleAt ? { scheduleAt: input.scheduleAt } : {}), media,
  };
  const idempotencyKey = `campaign-social-${campaign.id}-${await sha256Hex(JSON.stringify({ channels, media: media.map((item) => item.assetId), copy: payload.copy, scheduleAt: payload.scheduleAt ?? null }))}`;
  const job = await enqueueZohoOutbox(c.env, { organizationId: user.organizationId, actorId: user.id, app: "social", action: "create_reviewable_social_draft", entityType: "campaign", entityId: String(campaign.id), idempotencyKey, payload });
  return c.json({ jobId: job.id, status: job.status, created: job.created, channels, approvedAssetCount: approvedAssets.length }, job.created ? 202 : 200);
});

const savedSearchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  label: z.string().trim().min(1).max(120).optional(),
  query: z.string().trim().max(240).default(""),
  mediaKind: z.enum(["all", "image", "video"]).optional(),
  kind: z.enum(["all", "image", "video"]).optional(),
  alertFrequency: z.enum(["none", "daily", "weekly"]).optional(),
  location: z.string().trim().max(80).optional(),
  locationType: z.string().trim().max(40).optional(),
  category: z.string().trim().max(40).optional(),
  notifyOnNew: z.boolean().optional(),
}).refine((payload) => payload.name || payload.label, { message: "Saved search name is required" });

function nullableString(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : null;
}

function savedSearchFromRow(row: Record<string, unknown>): SavedSearch {
  const name = String(row.label ?? "");
  const kind = (["all", "image", "video"].includes(String(row.kind)) ? String(row.kind) : "all") as SavedSearch["mediaKind"];
  const notifyOnNew = Number(row.notify_on_new ?? 0) === 1 || row.notify_on_new === true;
  return {
    id: String(row.id),
    name,
    label: name,
    query: String(row.query ?? ""),
    mediaKind: kind,
    kind,
    alertFrequency: notifyOnNew ? "daily" : "none",
    notifyOnNew,
    location: nullableString(row.location),
    locationType: nullableString(row.location_type),
    category: nullableString(row.category),
    lastNotifiedAt: nullableString(row.last_notified_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.created_at),
  };
}

function lightboxFromRow(row: Record<string, unknown>): UserLightbox {
  const assetIds = String(row.asset_ids ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const name = String(row.name ?? "");
  return {
    id: String(row.id),
    name,
    description: String(row.description ?? ""),
    visibility: row.visibility === "shared" ? "shared" : "private",
    assetIds,
    assetCount: Number(row.asset_count ?? assetIds.length),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function listUserLightboxes(c: { env: Bindings }, user: RequestUser): Promise<UserLightbox[]> {
  const rows = await c.env.DB.prepare(`SELECT l.*, COUNT(la.asset_id) AS asset_count, COALESCE(GROUP_CONCAT(la.asset_id), '') AS asset_ids
    FROM user_lightboxes l
    LEFT JOIN user_lightbox_assets la ON la.lightbox_id = l.id
    WHERE l.organization_id = ? AND l.owner_id = ?
    GROUP BY l.id ORDER BY l.updated_at DESC LIMIT 50`).bind(user.organizationId, user.id).all<Record<string, unknown>>();
  return rows.results.map(lightboxFromRow);
}

app.get("/api/discovery", async (c) => {
  const user = await requestUser(c);
  const fallbackOrg = user ? null : await c.env.DB.prepare("SELECT id FROM organizations WHERE status = 'active' ORDER BY created_at ASC LIMIT 1").first<{ id: string }>();
  const organizationId = user?.organizationId ?? c.env.DEFAULT_ORGANIZATION_ID ?? fallbackOrg?.id ?? "org-demo";
  const trendingRows = await c.env.DB.prepare(`SELECT metric_key AS query, SUM(count) AS search_count
    FROM analytics_daily
    WHERE metric_type = 'search' AND metric_key <> '' AND metric_date >= date('now', '-30 day')
    GROUP BY metric_key HAVING search_count >= 2 ORDER BY search_count DESC LIMIT 8`).all<Record<string, unknown>>();
  const trending = trendingRows.results.map((row) => ({ query: String(row.query), searchCount: Number(row.search_count ?? 0) }));
  let savedSearches: SavedSearch[] = [];
  let lightboxes: UserLightbox[] = [];
  if (user) {
    const rows = await c.env.DB.prepare("SELECT * FROM saved_searches WHERE organization_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 50").bind(user.organizationId, user.id).all<Record<string, unknown>>();
    savedSearches = rows.results.map(savedSearchFromRow);
    lightboxes = await listUserLightboxes(c, user);
  }
  const interestTokens = discoveryTokens([...savedSearches.map((search) => search.query || search.name), ...lightboxes.flatMap((box) => [box.name, box.description])]);
  const assetRows = await c.env.DB.prepare(`SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id
    WHERE a.organization_id = ? AND a.status = 'published'
    ORDER BY a.human_verified DESC, a.created_at DESC LIMIT 24`).bind(organizationId).all<Record<string, unknown>>();
  const recommendations = assetRows.results.map((row) => {
    const asset = assetRowToDomain(row, c.env);
    const score = scoreRecommendation(asset, interestTokens);
    return { asset, ...score };
  }).sort((left, right) => right.score - left.score).slice(0, 8).map(({ asset, reason }) => ({ asset, reason }));
  const response: DiscoveryResponse = { trending, savedSearches, recommendations, personalized: Boolean(user && interestTokens.length) };
  return c.json(response);
});

app.get("/api/saved-searches", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const rows = await c.env.DB.prepare("SELECT * FROM saved_searches WHERE organization_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 50").bind(user.organizationId, user.id).all<Record<string, unknown>>();
  return c.json({ results: rows.results.map(savedSearchFromRow) });
});

app.post("/api/saved-searches", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const payload = savedSearchSchema.parse(await c.req.json());
  const id = crypto.randomUUID();
  const label = payload.label ?? payload.name ?? "Saved search";
  const kind = payload.kind ?? payload.mediaKind ?? "all";
  const notifyOnNew = payload.notifyOnNew ?? payload.alertFrequency !== "none";
  await c.env.DB.prepare("INSERT INTO saved_searches (id, organization_id, user_id, label, query, kind, location, location_type, category, notify_on_new) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, user.organizationId, user.id, label, normalizeSavedQuery(payload.query), kind, payload.location ?? null, payload.locationType ?? null, payload.category ?? null, notifyOnNew ? 1 : 0).run();
  const row = await c.env.DB.prepare("SELECT * FROM saved_searches WHERE id = ?").bind(id).first<Record<string, unknown>>();
  return c.json(row ? savedSearchFromRow(row) : { id }, 201);
});

app.delete("/api/saved-searches/:id", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  await c.env.DB.prepare("DELETE FROM saved_searches WHERE id = ? AND organization_id = ? AND user_id = ?").bind(c.req.param("id"), user.organizationId, user.id).run();
  return c.json({ ok: true });
});

app.get("/api/lightboxes", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  return c.json({ results: await listUserLightboxes(c, user) });
});

app.post("/api/lightboxes", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const payload = z.object({ name: z.string().trim().min(1).max(120).optional(), title: z.string().trim().min(1).max(120).optional(), description: z.string().trim().max(500).default(""), visibility: z.enum(["private", "shared"]).default("private") }).refine((body) => body.name || body.title, { message: "Lightbox name is required" }).parse(await c.req.json());
  const id = crypto.randomUUID();
  const name = payload.name ?? payload.title ?? "Untitled lightbox";
  await c.env.DB.prepare("INSERT INTO user_lightboxes (id, organization_id, owner_id, name, description, visibility) VALUES (?, ?, ?, ?, ?, ?)").bind(id, user.organizationId, user.id, name, payload.description, payload.visibility).run();
  const row = await c.env.DB.prepare("SELECT l.*, 0 AS asset_count, '' AS asset_ids FROM user_lightboxes l WHERE l.id = ?").bind(id).first<Record<string, unknown>>();
  return c.json(row ? lightboxFromRow(row) : { id, name }, 201);
});

app.get("/api/lightboxes/shared/:token", async (c) => {
  const tokenHash = await sha256Hex(c.req.param("token"));
  const lightbox = await c.env.DB.prepare("SELECT * FROM user_lightboxes WHERE share_token_hash = ? AND visibility = 'shared'").bind(tokenHash).first<Record<string, unknown>>();
  if (!lightbox) return c.json({ error: "Shared lightbox not found" }, 404);
  const assets = await c.env.DB.prepare(`SELECT a.*, u.display_name AS contributor FROM user_lightbox_assets la
    JOIN assets a ON a.id = la.asset_id JOIN users u ON u.id = a.owner_id
    WHERE la.lightbox_id = ? AND a.status = 'published' ORDER BY la.added_at ASC`).bind(lightbox.id).all<Record<string, unknown>>();
  return c.json({ id: String(lightbox.id), name: String(lightbox.name), visibility: "shared", results: assets.results.map((row) => assetRowToDomain(row, c.env)) });
});

app.get("/api/lightboxes/:id", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const lightbox = await c.env.DB.prepare("SELECT * FROM user_lightboxes WHERE id = ? AND organization_id = ? AND owner_id = ?").bind(c.req.param("id"), user.organizationId, user.id).first<Record<string, unknown>>();
  if (!lightbox) return c.json({ error: "Lightbox not found" }, 404);
  const assets = await c.env.DB.prepare(`SELECT a.*, u.display_name AS contributor FROM user_lightbox_assets la
    JOIN assets a ON a.id = la.asset_id JOIN users u ON u.id = a.owner_id WHERE la.lightbox_id = ? ORDER BY la.added_at ASC`).bind(c.req.param("id")).all<Record<string, unknown>>();
  return c.json({ ...lightboxFromRow({ ...lightbox, asset_count: assets.results.length, asset_ids: assets.results.map((row) => row.id).join(",") }), assets: assets.results.map((row) => assetRowToDomain(row, c.env)) });
});

app.post("/api/lightboxes/:id/assets", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const payload = z.object({ assetId: z.string().min(1).max(120) }).parse(await c.req.json());
  const lightbox = await c.env.DB.prepare("SELECT id FROM user_lightboxes WHERE id = ? AND organization_id = ? AND owner_id = ?").bind(c.req.param("id"), user.organizationId, user.id).first<{ id: string }>();
  if (!lightbox) return c.json({ error: "Lightbox not found" }, 404);
  const asset = await c.env.DB.prepare("SELECT id FROM assets WHERE id = ? AND organization_id = ? AND status = 'published'").bind(payload.assetId, user.organizationId).first<{ id: string }>();
  if (!asset) return c.json({ error: "Asset not found" }, 404);
  await c.env.DB.prepare("INSERT INTO user_lightbox_assets (lightbox_id, asset_id) VALUES (?, ?) ON CONFLICT(lightbox_id, asset_id) DO NOTHING").bind(lightbox.id, asset.id).run();
  await c.env.DB.prepare("UPDATE user_lightboxes SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(lightbox.id).run();
  return c.json({ ok: true }, 201);
});

app.post("/api/lightboxes/:id/share-link", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const lightbox = await c.env.DB.prepare("SELECT id FROM user_lightboxes WHERE id = ? AND organization_id = ? AND owner_id = ?").bind(c.req.param("id"), user.organizationId, user.id).first<{ id: string }>();
  if (!lightbox) return c.json({ error: "Lightbox not found" }, 404);
  const token = base64UrlToken();
  await c.env.DB.prepare("UPDATE user_lightboxes SET visibility = 'shared', share_token_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(await sha256Hex(token), lightbox.id).run();
  return c.json({ shareUrl: `/api/lightboxes/shared/${token}` }, 201);
});

app.delete("/api/lightboxes/:id/assets/:assetId", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const lightbox = await c.env.DB.prepare("SELECT id FROM user_lightboxes WHERE id = ? AND organization_id = ? AND owner_id = ?").bind(c.req.param("id"), user.organizationId, user.id).first<{ id: string }>();
  if (!lightbox) return c.json({ error: "Lightbox not found" }, 404);
  await c.env.DB.prepare("DELETE FROM user_lightbox_assets WHERE lightbox_id = ? AND asset_id = ?").bind(lightbox.id, c.req.param("assetId")).run();
  await c.env.DB.prepare("UPDATE user_lightboxes SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(lightbox.id).run();
  return c.json({ ok: true });
});

app.delete("/api/lightboxes/:id", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const result = await c.env.DB.prepare("DELETE FROM user_lightboxes WHERE id = ? AND organization_id = ? AND owner_id = ?").bind(c.req.param("id"), user.organizationId, user.id).run();
  return Number(result.meta.changes ?? 0) ? c.json({ ok: true }) : c.json({ error: "Lightbox not found" }, 404);
});

const webhookSubscriptionSchema = z.object({ targetUrl: z.string().url().max(2048), events: z.array(z.string().trim().min(1).max(60)).min(1).max(20) });

app.get("/api/webhooks/subscriptions", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["admin"])) return c.json({ error: "Admin access required" }, 403);
  const rows = await c.env.DB.prepare("SELECT id, target_url, events, status, created_at FROM webhook_subscriptions WHERE organization_id = ? ORDER BY created_at DESC LIMIT 50").bind(user.organizationId).all<Record<string, unknown>>();
  return c.json({ results: rows.results.map((row) => ({ id: String(row.id), targetUrl: String(row.target_url), events: JSON.parse(String(row.events ?? "[]")), status: row.status, createdAt: String(row.created_at) })) });
});

app.post("/api/webhooks/subscriptions", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["admin"])) return c.json({ error: "Admin access required" }, 403);
  const payload = webhookSubscriptionSchema.parse(await c.req.json());
  const id = crypto.randomUUID();
  const secret = base64UrlToken();
  await c.env.DB.prepare("INSERT INTO webhook_subscriptions (id, organization_id, created_by, target_url, secret, events) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, user.organizationId, user.id, payload.targetUrl, secret, JSON.stringify(payload.events)).run();
  return c.json({ id, secret }, 201);
});

app.delete("/api/webhooks/subscriptions/:id", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["admin"])) return c.json({ error: "Admin access required" }, 403);
  await c.env.DB.prepare("UPDATE webhook_subscriptions SET status = 'disabled' WHERE id = ? AND organization_id = ?").bind(c.req.param("id"), user.organizationId).run();
  return c.json({ ok: true });
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
  const idempotencyKey = payload.idempotencyKey ?? c.req.header("Idempotency-Key")?.trim() ?? null;
  const contentSha256 = payload.sha256?.toLowerCase() ?? null;
  if (payload.assetId) {
    const asset = await c.env.DB.prepare("SELECT owner_id FROM assets WHERE id = ? AND organization_id = ?").bind(payload.assetId, owner.organizationId).first<{ owner_id: string }>();
    if (!asset || (asset.owner_id !== ownerId && !allowedRole(owner, ["editor", "admin"]))) return c.json({ error: "Asset not found" }, 404);
  }
  if (idempotencyKey) {
    const existing = await c.env.DB.prepare("SELECT id, object_key, filename, content_type, size_bytes, status FROM upload_sessions WHERE organization_id = ? AND owner_id = ? AND idempotency_key = ?")
      .bind(owner.organizationId, ownerId, idempotencyKey).first<{ id: string; object_key: string; filename: string; content_type: string; size_bytes: number; status: string }>();
    if (existing) {
      const existingHash = await c.env.DB.prepare("SELECT content_sha256 FROM upload_sessions WHERE id = ?").bind(existing.id).first<{ content_sha256: string | null }>();
      if (existing.filename !== payload.filename || existing.content_type !== payload.contentType || Number(existing.size_bytes) !== payload.sizeBytes || (contentSha256 && contentSha256 !== existingHash?.content_sha256)) return c.json({ error: "Idempotency key was already used for different upload content" }, 409);
      if (existing.status === "failed" || existing.status === "expired") return c.json({ error: "This idempotency key belongs to a failed or expired upload; use a new key" }, 409);
      const uploadUrl = await createPresignedR2Url(c.env, c.env.R2_BUCKET_NAME, existing.object_key, "PUT");
      if (!uploadUrl) return c.json({ error: "Media storage is not configured for uploads", code: "r2_presign_config_missing" }, 503);
      return c.json(validateContractResponse("POST /api/uploads 201", uploadResponseSchema, { uploadId: existing.id, objectKey: existing.object_key, strategy: "r2-presigned-put", uploadUrl, expiresInSeconds: 900, idempotent: true, message: existing.status === "uploaded" ? "Upload already completed; safe to reuse." : "Upload session already exists; safe to retry." }), existing.status === "uploaded" ? 200 : 201, { Location: `/api/uploads/${existing.id}/complete` });
    }
  }
  const dailyQuota = Math.max(1, Number(c.env.UPLOAD_DAILY_QUOTA_BYTES ?? 50_000_000_000));
  const usage = await c.env.DB.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM upload_sessions WHERE organization_id = ? AND owner_id = ? AND created_at >= date('now') AND status <> 'failed'").bind(owner.organizationId, owner.id).first<{ total: number }>();
  if (Number(usage?.total ?? 0) + payload.sizeBytes > dailyQuota) return c.json({ error: "Daily upload quota exceeded", quotaBytes: dailyQuota }, 429);
  const organizationQuota = Math.max(1, Number(c.env.ORG_STORAGE_QUOTA_BYTES ?? 500_000_000_000));
  const organizationUsage = await c.env.DB.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM upload_sessions WHERE organization_id = ? AND status IN ('created', 'uploaded')").bind(owner.organizationId).first<{ total: number }>();
  if (Number(organizationUsage?.total ?? 0) + payload.sizeBytes > organizationQuota) return c.json({ error: "Organization storage quota exceeded", quotaBytes: organizationQuota }, 413);
  const id = crypto.randomUUID();
  const objectIdentity = idempotencyKey ? await sha256Hex(`${owner.organizationId}:${ownerId}:${idempotencyKey}`) : id;
  const objectKey = `originals/${ownerId}/${objectIdentity}/${payload.filename.replace(/[^a-zA-Z0-9._-]/g, "-")}`;

  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO upload_sessions (id, organization_id, owner_id, asset_id, object_key, filename, content_type, size_bytes, idempotency_key, content_sha256)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, owner.organizationId, ownerId, payload.assetId ?? null, objectKey, payload.filename, payload.contentType, payload.sizeBytes, idempotencyKey, contentSha256).run();
  if (idempotencyKey) {
    const persisted = await c.env.DB.prepare("SELECT id, object_key, status FROM upload_sessions WHERE organization_id = ? AND owner_id = ? AND idempotency_key = ?")
      .bind(owner.organizationId, ownerId, idempotencyKey).first<{ id: string; object_key: string; status: string }>();
    if (!persisted) return c.json({ error: "Upload session could not be persisted" }, 503);
    if (persisted.id !== id) {
      const uploadUrl = await createPresignedR2Url(c.env, c.env.R2_BUCKET_NAME, persisted.object_key, "PUT");
      if (!uploadUrl) return c.json({ error: "Media storage is not configured for uploads", code: "r2_presign_config_missing" }, 503);
      return c.json(validateContractResponse("POST /api/uploads 201", uploadResponseSchema, { uploadId: persisted.id, objectKey: persisted.object_key, strategy: "r2-presigned-put", uploadUrl, expiresInSeconds: 900, idempotent: true, message: "Upload session already exists; safe to retry." }), 201, { Location: `/api/uploads/${persisted.id}/complete` });
    }
  }

  if (chaos === "fail-after-session") {
    logChaos(c, trace, chaos, "after-db");
    await c.env.DB.prepare("UPDATE upload_sessions SET status = 'failed', failure_reason = ? WHERE id = ?")
      .bind("chaos:fail-after-session", id).run();
    return c.json({ error: "Injected post-session failure", uploadId: id }, 503);
  }

  const uploadUrl = chaos === "r2-signing-failure" ? null : await createPresignedR2Url(c.env, c.env.R2_BUCKET_NAME, objectKey, "PUT");
  if (chaos === "r2-signing-failure") {
    logChaos(c, trace, chaos, "presign");
    await c.env.DB.prepare("UPDATE upload_sessions SET status = 'failed', failure_reason = ? WHERE id = ?")
      .bind("chaos:r2-signing-failure", id).run();
    return c.json({ error: "Injected R2 signing failure", uploadId: id }, 503);
  }

  if (!uploadUrl) {
    await c.env.DB.prepare("UPDATE upload_sessions SET status = 'failed', failure_reason = ? WHERE id = ?").bind("R2 presigned upload is not configured", id).run();
    const missingR2Bindings = [
      ["R2_ACCOUNT_ID", c.env.R2_ACCOUNT_ID],
      ["R2_ACCESS_KEY_ID", c.env.R2_ACCESS_KEY_ID],
      ["R2_SECRET_ACCESS_KEY", c.env.R2_SECRET_ACCESS_KEY],
      ["R2_BUCKET_NAME", c.env.R2_BUCKET_NAME],
    ].filter(([, value]) => !String(value ?? "").trim()).map(([name]) => name);
    return c.json({
      error: "Media storage is not configured for uploads",
      code: "r2_presign_config_missing",
      missingBindings: missingR2Bindings,
    }, 503);
  }
  recordMetric(c.env, "upload_session_created", trace, payload.sizeBytes, [payload.contentType.split("/")[0]]);
  return c.json(validateContractResponse("POST /api/uploads 201", uploadResponseSchema, {
    uploadId: id,
    objectKey,
    strategy: "r2-presigned-put",
    uploadUrl,
    expiresInSeconds: uploadUrl ? 900 : null,
    idempotent: false,
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

  let previewKey: string | null = null;
  let preview640Key: string | null = null;
  let preview1200Key: string | null = null;
  let videoPosterKey: string | null = null;
  if (session.content_type.startsWith("image/")) {
    previewKey = previewObjectKey(session.object_key, session.content_type);
    const previewExists = await c.env.MEDIA_BUCKET.head(previewKey);
    if (!previewExists) {
      try {
        const previews = await writeWatermarkedPreview(c.env, session.object_key);
        previewKey = previews.key;
        preview640Key = previews.variants.preview640Key;
        preview1200Key = previews.variants.preview1200Key;
      } catch (error) {
        await c.env.DB.prepare("UPDATE upload_sessions SET status = 'failed', failure_reason = ? WHERE id = ?")
          .bind(`Preview transformation failed: ${error instanceof Error ? error.message : "unknown error"}`, uploadId).run();
        return c.json({ error: "Image preview transformation is unavailable", code: "preview_transformation_unavailable", uploadId }, 503);
      }
    }
  } else if (session.content_type.startsWith("video/")) {
    try {
      videoPosterKey = await writeVideoPoster(c.env, session.object_key);
    } catch (error) {
      await c.env.DB.prepare("UPDATE upload_sessions SET status = 'failed', failure_reason = ? WHERE id = ?")
        .bind(`Video poster transformation failed: ${error instanceof Error ? error.message : "unknown error"}`, uploadId).run();
      return c.json({ error: "Video poster transformation is unavailable", code: "video_preview_transformation_unavailable", uploadId }, 503);
    }
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
    ? c.env.DB.prepare(`UPDATE assets SET original_key = ?, preview_key = ?, preview_640_key = ?, preview_1200_key = ?, video_poster_key = ?, source_file_name = ?, source_etag = ?,
        status = 'needs_review', workflow_stage = 'ai_tagging', asset_revision = asset_revision + 1,
        enriched_revision = NULL, reviewed_revision = NULL, approved_revision = NULL, human_verified = 0,
        metadata_review_status = 'needs_context', metadata_review_note = 'Uploaded media is queued for AI enrichment and human review.',
        vector_index_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`)
      .bind(session.object_key, previewKey, preview640Key, preview1200Key, videoPosterKey, session.filename, object.etag, assetId, session.organization_id)
    : c.env.DB.prepare("INSERT INTO assets (id, organization_id, owner_id, kind, status, title, source_file_name, original_key, preview_key, preview_640_key, preview_1200_key, video_poster_key, source_etag, workflow_stage) VALUES (?, ?, ?, ?, 'needs_review', ?, ?, ?, ?, ?, ?, ?, ?, 'ai_tagging')")
      .bind(assetId, session.organization_id, session.owner_id, session.content_type.startsWith("video/") ? "video" : "image", session.filename, session.filename, session.object_key, previewKey, preview640Key, preview1200Key, videoPosterKey, object.etag);
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

async function verifyTurnstileToken(env: Bindings, token: string | undefined, action: string, traceparent?: string, remoteIp?: string): Promise<{ verified: boolean; reason?: string }> {
  if (!token) return String(env.APP_ENV) === "production" ? { verified: false, reason: "Turnstile token is required" } : { verified: true, reason: "development bypass" };
  if (!env.TURNSTILE_SECRET) return { verified: false, reason: "Turnstile is not configured for this environment" };
  if (token.length > 2048) return { verified: false, reason: "Turnstile token is too long" };
  const allowedHosts = new Set((env.TURNSTILE_HOSTNAMES ?? "").split(",").map((host) => host.trim()).filter(Boolean));
  if (String(env.APP_ENV) === "production" && allowedHosts.size === 0) return { verified: false, reason: "Turnstile hostname allowlist is not configured" };
  try {
    const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...(traceparent ? { traceparent } : {}) },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, ...(remoteIp ? { remoteip: remoteIp } : {}), idempotency_key: crypto.randomUUID() }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!verification.ok) return { verified: false, reason: "Turnstile verification service unavailable" };
    const result = await verification.json() as { success: boolean; action?: string; hostname?: string; [key: string]: unknown };
    const hostnameValid = typeof result.hostname === "string" && allowedHosts.has(result.hostname);
    const actionValid = result.action === action;
    return result.success === true && hostnameValid && actionValid
      ? { verified: true }
      : { verified: false, reason: "Turnstile token did not match the expected action or hostname" };
  } catch {
    return { verified: false, reason: "Turnstile verification service unavailable" };
  }
}

app.post("/api/security/turnstile", async (c) => {
  const payload = turnstileSchema.parse(await c.req.json());
  const result = await verifyTurnstileToken(c.env, payload.token, payload.action, c.get("trace").traceparent, c.req.header("CF-Connecting-IP"));
  return c.json(result, result.verified ? 200 : 403);
});

type StreamWebhookPayload = z.infer<typeof streamWebhookRequestSchema>;

async function verifyStreamWebhook(secret: string, signature: string, body: string): Promise<boolean> {
  const values = new Map(signature.split(",").map((part) => {
    const [key, ...rest] = part.trim().split("=");
    return [key.trim(), rest.join("=").trim()] as const;
  }));
  const timestamp = values.get("time");
  const supplied = values.get("sig1");
  if (!timestamp || !supplied || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  const expected = hex(await hmac(utf8(secret), `${timestamp}.${body}`));
  return timingSafeEqual(expected, supplied);
}

function streamUploadStatus(value: string): "uploading" | "processing" | "ready" | "error" {
  return value === "ready" ? "ready" : value === "processing" ? "processing" : value === "error" || value === "expired" ? "error" : "uploading";
}

app.post("/api/assets/:id/stream-upload", async (c) => {
  const user = await requestUser(c);
  if (!user || !allowedRole(user, ["contributor", "editor", "admin"])) return c.json({ error: "Owned video upload access required" }, 403);
  const payload = streamUploadRequestSchema.parse(await c.req.json());
  const asset = await c.env.DB.prepare("SELECT id, organization_id, owner_id, kind, stream_uid, stream_status FROM assets WHERE id = ? AND organization_id = ?")
    .bind(c.req.param("id"), user.organizationId).first<Record<string, unknown>>();
  if (!asset) return c.json({ error: "Asset not found" }, 404);
  if (String(asset.kind) !== "video") return c.json({ error: "Stream direct uploads are available for video assets only", code: "video_required" }, 422);
  if (String(asset.owner_id) !== user.id && !allowedRole(user, ["editor", "admin"])) return c.json({ error: "Only the asset owner or a reviewer can provision a Stream upload" }, 403);
  const idempotencyKey = (c.req.header("Idempotency-Key")?.trim() || crypto.randomUUID()).slice(0, 180);
  const existing = await c.env.DB.prepare("SELECT asset_id, provider_uid, upload_url, expires_at, status FROM stream_uploads WHERE organization_id = ? AND asset_id = ? AND idempotency_key = ?")
    .bind(user.organizationId, asset.id, idempotencyKey).first<Record<string, unknown>>();
  if (existing && existing.upload_url && isFutureTimestamp(existing.expires_at)) {
    return c.json(validateContractResponse("POST /api/assets/{id}/stream-upload 200", streamUploadResponseSchema, { assetId: String(existing.asset_id), streamUid: String(existing.provider_uid), uploadUrl: String(existing.upload_url), expiresAt: String(existing.expires_at), status: streamUploadStatus(String(existing.status)) }));
  }
  const stream = new IntegrationContainer(c.env).stream;
  if (!stream) return c.json({ error: "Cloudflare Stream is not configured for this environment", code: "stream_unavailable" }, 503);
  let directUpload: Awaited<ReturnType<NonNullable<typeof stream>["createDirectUpload"]>>;
  try {
    directUpload = await stream.createDirectUpload({ assetId: String(asset.id), organizationId: user.organizationId, creator: user.id, filename: payload.filename, maxDurationSeconds: payload.maxDurationSeconds, idempotencyKey });
  } catch (error) {
    logEvent("warn", "stream.direct_upload_failed", c.get("trace"), { assetId: String(asset.id), error: error instanceof Error ? error.message : "unknown-error" });
    return c.json({ error: "Cloudflare Stream could not provision an upload", code: "stream_upload_unavailable" }, 503);
  }
  const uploadId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO stream_uploads (id, organization_id, asset_id, uploaded_by, provider_uid, upload_url, idempotency_key, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'created', ?)").bind(uploadId, user.organizationId, asset.id, user.id, directUpload.uid, directUpload.uploadUrl, idempotencyKey, directUpload.expiresAt),
    c.env.DB.prepare("UPDATE assets SET stream_uid = ?, stream_status = 'uploading', stream_progress = 0, stream_error_code = NULL, stream_error_text = NULL, stream_updated_at = CURRENT_TIMESTAMP, stream_ready_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?").bind(directUpload.uid, asset.id, user.organizationId),
  ]);
  const auditEventId = await appendCampaignAudit(c, user, "stream.upload.provisioned", "asset", String(asset.id), { streamUid: directUpload.uid, filename: payload.filename, maxDurationSeconds: payload.maxDurationSeconds, uploadId });
  return c.json(validateContractResponse("POST /api/assets/{id}/stream-upload 201", streamUploadResponseSchema, { assetId: String(asset.id), streamUid: directUpload.uid, uploadUrl: directUpload.uploadUrl, expiresAt: directUpload.expiresAt, status: "uploading", auditEventId }), 201);
});

app.get("/api/assets/:id/stream-playback", async (c) => {
  const user = await requestUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const asset = await c.env.DB.prepare("SELECT id, organization_id, owner_id, kind, stream_uid, stream_status FROM assets WHERE id = ? AND organization_id = ?")
    .bind(c.req.param("id"), user.organizationId).first<Record<string, unknown>>();
  if (!asset) return c.json({ error: "Asset not found" }, 404);
  if (String(asset.kind) !== "video") return c.json({ error: "Stream playback is available for video assets only", code: "video_required" }, 422);
  const licensed = await activeCampaignLicence(c.env, user.organizationId, user.id, String(asset.id));
  const authorized = String(asset.owner_id) === user.id || allowedRole(user, ["editor", "admin"]) || Boolean(licensed);
  if (!authorized) return c.json({ error: "A valid licence or ownership is required for Stream playback", code: "playback_forbidden" }, 403);
  if (String(asset.stream_status) !== "ready" || !String(asset.stream_uid ?? "").trim()) return c.json({ error: "Stream playback is not ready", code: "stream_not_ready" }, 409);
  const stream = new IntegrationContainer(c.env).stream;
  if (!stream) return c.json({ error: "Cloudflare Stream is not configured for this environment", code: "stream_unavailable" }, 503);
  try {
    const playback = await stream.createSignedPlaybackToken(String(asset.stream_uid));
    return c.json(validateContractResponse("GET /api/assets/{id}/stream-playback 200", streamPlaybackResponseSchema, { assetId: String(asset.id), streamUid: playback.uid, iframeUrl: playback.iframeUrl, expiresInSeconds: playback.expiresInSeconds }));
  } catch (error) {
    logEvent("warn", "stream.playback_token_failed", c.get("trace"), { assetId: String(asset.id), error: error instanceof Error ? error.message : "unknown-error" });
    return c.json({ error: "Signed Stream playback is unavailable", code: "stream_playback_unavailable" }, 503);
  }
});

app.post("/api/webhooks/stream", async (c) => {
  const trace = c.get("trace");
  let streamWebhookSecret = c.env.STREAM_WEBHOOK_SECRET;
  if (!streamWebhookSecret && c.env.STREAM_WEBHOOK_SECRET_STORE) {
    try { streamWebhookSecret = await c.env.STREAM_WEBHOOK_SECRET_STORE.get(); } catch { streamWebhookSecret = undefined; }
  }
  if (!streamWebhookSecret) return c.json({ error: "Stream webhook secret is not configured" }, 503);
  const body = await c.req.text();
  const signature = c.req.header("Webhook-Signature") ?? "";
  if (!(await verifyStreamWebhook(streamWebhookSecret, signature, body))) {
    recordMetric(c.env, "stream_webhook_rejected", trace, 1, ["signature"]);
    return c.json({ error: "Invalid Stream webhook signature" }, 401);
  }

  const payload: StreamWebhookPayload = streamWebhookRequestSchema.parse(JSON.parse(body));
  const streamUid = payload.uid ?? "unknown";
  const statusObject = typeof payload.status === "object" && payload.status !== null ? payload.status : {};
  const state = payload.state ?? (typeof payload.status === "string" ? payload.status : statusObject.state) ?? "unknown";
  const providerEventId = hex(await crypto.subtle.digest("SHA-256", utf8(body)));
  const statusText = String(state).toLowerCase();
  const errorCode = statusObject.errorReasonCode ?? statusObject.errReasonCode ?? payload.errorReasonCode ?? payload.errReasonCode;
  const errorText = statusObject.errorReasonText ?? statusObject.errReasonText ?? payload.errorReasonText ?? payload.errReasonText;
  const parsedProgress = Number.parseFloat(String(payload.pctComplete ?? statusObject.pctComplete ?? ""));
  const progress = Number.isFinite(parsedProgress) ? Math.max(0, Math.min(100, Math.round(parsedProgress))) : payload.readyToStream || statusText === "ready" ? 100 : 0;
  const isReady = payload.readyToStream === true && statusText === "ready";
  const isError = statusText === "error" || Boolean(errorCode || errorText);
  const nextStatus = isError ? "error" : isReady ? "ready" : "processing";
  const inserted = await c.env.DB.prepare(`
    INSERT OR IGNORE INTO stream_events (id, provider_event_id, stream_uid, event_type, state, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), providerEventId, streamUid, "video-status", state, body).run();

  if (!Number(inserted.meta.changes ?? 0)) return c.json({ accepted: true, duplicate: true, streamUid, state, progress, status: nextStatus });
  const upload = streamUid === "unknown" ? null : await c.env.DB.prepare("SELECT id, organization_id, asset_id, uploaded_by FROM stream_uploads WHERE provider_uid = ? ORDER BY updated_at DESC LIMIT 1").bind(streamUid).first<Record<string, unknown>>();
  const fallbackAsset = upload || streamUid === "unknown" ? null : await c.env.DB.prepare("SELECT id, organization_id, owner_id FROM assets WHERE stream_uid = ? ORDER BY stream_updated_at DESC LIMIT 1").bind(streamUid).first<Record<string, unknown>>();
  const organizationId = String(upload?.organization_id ?? fallbackAsset?.organization_id ?? "");
  const assetId = String(upload?.asset_id ?? fallbackAsset?.id ?? "");
  const notificationUserId = String(upload?.uploaded_by ?? fallbackAsset?.owner_id ?? "");
  if (organizationId && assetId) {
    const owner = await c.env.DB.prepare("SELECT u.residency_region FROM users u JOIN assets a ON a.owner_id = u.id WHERE a.id = ? AND a.organization_id = ?").bind(assetId, organizationId).first<{ residency_region: string }>();
    const updates = [c.env.DB.prepare(`UPDATE assets SET stream_status = ?, stream_progress = ?, stream_error_code = ?, stream_error_text = ?, stream_updated_at = CURRENT_TIMESTAMP,
        stream_ready_at = CASE WHEN ? = 'ready' THEN COALESCE(stream_ready_at, CURRENT_TIMESTAMP) ELSE stream_ready_at END,
        workflow_stage = CASE WHEN ? = 'ready' THEN 'approval' ELSE workflow_stage END,
        status = CASE WHEN ? = 'ready' AND status = 'published' THEN 'needs_review' ELSE status END,
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`).bind(nextStatus, progress, errorCode ?? null, errorText ?? null, nextStatus, nextStatus, nextStatus, assetId, organizationId)];
    if (upload) updates.unshift(c.env.DB.prepare("UPDATE stream_uploads SET status = ?, error_code = ?, error_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?").bind(nextStatus, errorCode ?? null, errorText ?? null, upload.id, organizationId));
    await c.env.DB.batch(updates);
    if (owner) {
      try {
        await appendAuditEvent(c.env, { eventId: `stream:${providerEventId}`, streamId: `organization:${organizationId}`, actorId: "stream-provider", actorType: "service", action: isError ? "stream.asset.failed" : isReady ? "stream.asset.ready" : "stream.asset.processing", resourceType: "asset", resourceId: assetId, data: redactAuditData({ streamUid, state: statusText, progress, errorCode: errorCode ?? null, errorText: errorText ?? null }), organizationId, residencyRegion: residencyRegionSchema.parse(owner.residency_region), actorResidencyRegion: residencyRegionSchema.parse(owner.residency_region) });
      } catch (error) {
        logEvent("error", "stream.audit_write_failed", trace, { streamUid, assetId, error: error instanceof Error ? error.message : "unknown-error" });
      }
      if ((isReady || isError) && notificationUserId) c.executionCtx.waitUntil(notify(c.env, organizationId, notificationUserId, { type: isReady ? "stream_ready" : "stream_error", title: isReady ? "Video processing complete" : "Video processing failed", body: isReady ? "Your video is ready for editorial review." : errorText ?? "Cloudflare Stream reported a processing error. Review the upload and retry.", resourceType: "asset", resourceId: assetId }).catch(() => undefined));
    }
  }

  recordMetric(c.env, "stream_webhook_received", trace, 1, [state]);
  logEvent("info", "stream.video.status", trace, {
    streamUid,
    state,
    readyToStream: payload.readyToStream ?? false,
  });
  return c.json({ accepted: true, streamUid, state, progress, status: nextStatus });
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

type QueueMessage = R2EventMessage | PhotoEnrichmentJob | ZohoOutboxJobMessage;

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

function isZohoOutboxMessage(message: QueueMessage): message is ZohoOutboxJobMessage {
  const candidate = message as { type?: unknown; jobId?: unknown };
  return candidate.type === "zoho.outbox" && typeof candidate.jobId === "string";
}

async function dispatchSavedSearchAlerts(env: Bindings): Promise<number> {
  const searches = await env.DB.prepare("SELECT * FROM saved_searches WHERE notify_on_new = 1").all<Record<string, unknown>>();
  let notified = 0;
  for (const search of searches.results) {
    const clauses = ["a.status = 'published'", "a.created_at > ?"];
    const values: string[] = [String(search.last_seen_at)];
    if (search.kind !== "all") { clauses.push("a.kind = ?"); values.push(String(search.kind)); }
    if (search.location) { clauses.push("(a.country LIKE ? OR a.city LIKE ? OR a.province LIKE ? OR a.locality LIKE ? OR a.landmark LIKE ?)"); const location = `%${search.location}%`; values.push(location, location, location, location, location); }
    if (search.location_type) { clauses.push("a.visual_location_type = ?"); values.push(String(search.location_type)); }
    if (search.category) { clauses.push("a.primary_category = ?"); values.push(String(search.category)); }
    if (search.query) { clauses.push("(a.title LIKE ? OR a.description LIKE ? OR a.subject_tags LIKE ?)"); const query = `%${search.query}%`; values.push(query, query, query); }
    const matches = await env.DB.prepare(`SELECT COUNT(*) AS total FROM assets a WHERE ${clauses.join(" AND ")}`).bind(...values).first<{ total: number }>();
    await env.DB.prepare("UPDATE saved_searches SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").bind(search.id).run();
    if (Number(matches?.total ?? 0) > 0) {
      await notify(env, String(search.organization_id), String(search.user_id), { type: "saved_search_match", title: `New matches for "${String(search.label)}"`, body: `${matches?.total} new asset(s) match your saved search.`, resourceType: "saved_search", resourceId: String(search.id) });
      await env.DB.prepare("UPDATE saved_searches SET last_notified_at = CURRENT_TIMESTAMP WHERE id = ?").bind(search.id).run();
      notified += 1;
    }
  }
  return notified;
}

const worker: ExportedHandler<Bindings, QueueMessage> = {
  fetch: app.fetch,
  async scheduled(_controller, env) {
    const trace = traceContext(new Request("https://internal/scheduled/r2-replication"));
    try {
      await catchUpR2Replication(env, trace);
      const requeued = await retryQueuedPhotoJobs(photoPipeline(env));
      const repaired = await repairPendingPhotoPipeline(photoPipeline(env), 40);
      await runMaintenance(env);
      const alerted = await dispatchSavedSearchAlerts(env);
      const zohoDispatched = await dispatchDueZohoOutbox(env);
      recordMetric(env, "photo_jobs_requeued", trace, requeued, ["cron"]);
      recordMetric(env, "photo_pipeline_repairs", trace, repaired.queued + repaired.recovered + repaired.stale + repaired.resolvedReviews + repaired.reconciledIndexes, ["cron"]);
      recordMetric(env, "saved_search_alerts_sent", trace, alerted, ["cron"]);
      recordMetric(env, "zoho_outbox_dispatched", trace, zohoDispatched, ["cron"]);
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
        } else if (isZohoOutboxMessage(message.body)) {
          await dispatchZohoOutboxJob(env, message.body.jobId);
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
