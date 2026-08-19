import { IntegrationError, IntegrationContainer, type ZohoCampaignSync, type ZohoDeskCase, type ZohoIntegrationEnvironment, type ZohoSocialDraft } from "../integrations";

export type ZohoOutboxApp = "social" | "crm" | "desk" | "campaigns" | "analytics";
export type ZohoOutboxJobMessage = { type: "zoho.outbox"; jobId: string };

export type ZohoOutboxBindings = ZohoIntegrationEnvironment & {
  DB: D1Database;
  ZOHO_TOKEN_ENCRYPTION_KEY?: string;
  ZOHO_INTEGRATION_QUEUE?: Queue<ZohoOutboxJobMessage>;
};

export type ZohoOutboxInput = {
  organizationId: string;
  actorId: string;
  app: ZohoOutboxApp;
  action: string;
  entityType: string;
  entityId: string;
  idempotencyKey: string;
  payload: unknown;
  contractVersion?: string;
};

type StoredJob = {
  id: string;
  organization_id: string;
  actor_id: string;
  app: ZohoOutboxApp;
  action: string;
  entity_type: string;
  entity_id: string;
  idempotency_key: string;
  payload_json: string;
  status: "pending" | "processing" | "succeeded" | "failed" | "unknown";
  attempts: number;
};

type EncryptedSecret = { ciphertext: string; iv: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

async function keyMaterial(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptZohoSecret(secret: string, encryptionKey: string): Promise<EncryptedSecret> {
  if (!encryptionKey.trim()) throw new Error("ZOHO_TOKEN_ENCRYPTION_KEY is required");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyMaterial(encryptionKey), encoder.encode(secret));
  return { ciphertext: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv) };
}

export async function decryptZohoSecret(ciphertext: string, iv: string, encryptionKey: string): Promise<string> {
  if (!encryptionKey.trim()) throw new Error("ZOHO_TOKEN_ENCRYPTION_KEY is required");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, await keyMaterial(encryptionKey), fromBase64(ciphertext));
  return decoder.decode(plaintext);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function enqueueZohoOutbox(env: ZohoOutboxBindings, input: ZohoOutboxInput): Promise<{ id: string; status: string; created: boolean }> {
  const payloadJson = JSON.stringify(input.payload);
  const payloadHash = await sha256Hex(payloadJson);
  const existing = await env.DB.prepare("SELECT id, status FROM zoho_outbox_jobs WHERE idempotency_key = ? LIMIT 1").bind(input.idempotencyKey).first<{ id: string; status: string }>();
  if (existing) return { id: String(existing.id), status: String(existing.status), created: false };
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO zoho_outbox_jobs
    (id, organization_id, actor_id, app, action, entity_type, entity_id, idempotency_key, contract_version, payload_json, payload_sha256)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.organizationId, input.actorId, input.app, input.action, input.entityType, input.entityId, input.idempotencyKey, input.contractVersion ?? "1.0", payloadJson, payloadHash).run();
  try { await env.ZOHO_INTEGRATION_QUEUE?.send({ type: "zoho.outbox", jobId: id }); } catch { /* scheduled reconciliation remains authoritative */ }
  return { id, status: "pending", created: true };
}

function retryDelay(attempt: number): string {
  const seconds = Math.min(3600, Math.max(30, 30 * 2 ** Math.min(attempt, 6)));
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function loadConnection(env: ZohoOutboxBindings, organizationId: string): Promise<Partial<ZohoIntegrationEnvironment> & { connectionId?: string }> {
  const row = await env.DB.prepare(`SELECT id, account_server, api_domain, refresh_token_ciphertext, refresh_token_iv
    FROM zoho_connections WHERE organization_id = ? AND status = 'active' LIMIT 1`).bind(organizationId).first<Record<string, unknown>>();
  if (!row) return {};
  if (!env.ZOHO_TOKEN_ENCRYPTION_KEY) throw new Error("Zoho connection encryption is not configured");
  const refreshToken = await decryptZohoSecret(String(row.refresh_token_ciphertext), String(row.refresh_token_iv), env.ZOHO_TOKEN_ENCRYPTION_KEY);
  return { connectionId: String(row.id), ZOHO_ACCOUNTS_URL: String(row.account_server), ZOHO_API_DOMAIN: row.api_domain ? String(row.api_domain) : undefined, ZOHO_REFRESH_TOKEN: refreshToken };
}

async function claimJob(env: ZohoOutboxBindings, jobId: string): Promise<StoredJob | null> {
  await env.DB.prepare(`UPDATE zoho_outbox_jobs SET status = 'processing', attempts = attempts + 1, locked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('pending', 'failed') AND next_attempt_at <= CURRENT_TIMESTAMP AND attempts < 8`).bind(jobId).run();
  return env.DB.prepare("SELECT * FROM zoho_outbox_jobs WHERE id = ? AND status = 'processing' LIMIT 1").bind(jobId).first<StoredJob>();
}

export async function dispatchZohoOutboxJob(env: ZohoOutboxBindings, jobId: string): Promise<void> {
  const job = await claimJob(env, jobId);
  if (!job) return;
  const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
  const connection = await loadConnection(env, job.organization_id);
  const integration = new IntegrationContainer({ ...env, ...connection });
  try {
    let result: { providerReference?: string; raw?: unknown };
    if (job.app === "social") result = await integration.zoho.sendSocialDraft(payload as unknown as ZohoSocialDraft, job.idempotency_key);
    else if (job.app === "crm") result = await integration.zoho.syncCampaignToCrm(payload as unknown as ZohoCampaignSync);
    else if (job.app === "desk") result = await integration.zoho.sendDeskCase(payload as unknown as ZohoDeskCase, job.idempotency_key);
    else if (job.app === "campaigns") result = await integration.zoho.sendCampaignsHandoff(payload as unknown as ZohoCampaignSync, job.idempotency_key);
    else result = await integration.zoho.sendAnalyticsEvent(payload, job.idempotency_key);
    await env.DB.batch([
      env.DB.prepare("UPDATE zoho_outbox_jobs SET status = 'succeeded', provider_reference = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(result.providerReference ?? null, job.id),
      env.DB.prepare(`INSERT INTO zoho_integration_events (id, organization_id, actor_id, app, action, entity_type, entity_id, idempotency_key, status, provider_reference, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'succeeded', ?, ?, ?)
        ON CONFLICT(organization_id, app, action, entity_type, entity_id, idempotency_key) DO UPDATE SET status = 'succeeded', provider_reference = excluded.provider_reference, metadata_json = excluded.metadata_json, error_message = NULL`)
        .bind(crypto.randomUUID(), job.organization_id, job.actor_id, job.app, job.action, job.entity_type, job.entity_id, job.idempotency_key, result.providerReference ?? null, JSON.stringify({ outboxJobId: job.id, attempts: job.attempts }),),
    ]);
  } catch (error) {
    const retryable = error instanceof IntegrationError && error.retryable;
    const unknown = !(error instanceof IntegrationError) || error.status === undefined;
    const status = unknown ? "unknown" : "failed";
    const message = error instanceof Error ? error.message : "Zoho delivery failed";
    await env.DB.prepare(`UPDATE zoho_outbox_jobs SET status = ?, last_error = ?, next_attempt_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(status, message, retryable ? retryDelay(job.attempts) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), job.id).run();
    await env.DB.prepare(`INSERT INTO zoho_integration_events (id, organization_id, actor_id, app, action, entity_type, entity_id, idempotency_key, status, metadata_json, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'failed', ?, ?)
      ON CONFLICT(organization_id, app, action, entity_type, entity_id, idempotency_key) DO UPDATE SET status = 'failed', metadata_json = excluded.metadata_json, error_message = excluded.error_message`)
      .bind(crypto.randomUUID(), job.organization_id, job.actor_id, job.app, job.action, job.entity_type, job.entity_id, job.idempotency_key, JSON.stringify({ outboxJobId: job.id, attempts: job.attempts, retryable, unknown }), message).run();
  }
}

export async function dispatchDueZohoOutbox(env: ZohoOutboxBindings, limit = 25): Promise<number> {
  const rows = await env.DB.prepare(`SELECT id FROM zoho_outbox_jobs WHERE status IN ('pending', 'failed') AND next_attempt_at <= CURRENT_TIMESTAMP AND attempts < 8 ORDER BY created_at LIMIT ?`).bind(limit).all<{ id: string }>();
  for (const row of rows.results) await dispatchZohoOutboxJob(env, String(row.id));
  return rows.results.length;
}
