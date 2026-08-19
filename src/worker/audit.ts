import { z } from "zod";
import { publishAuditAnalyticsEvent, type AuditAnalyticsPipeline } from "./audit-analytics";

export const residencyRegionSchema = z.enum(["za", "eu"]);
export type ResidencyRegion = z.infer<typeof residencyRegionSchema>;

const auditInputSchema = z.object({
  eventId: z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).optional(),
  streamId: z.string().regex(/^[A-Za-z0-9._:-]{1,120}$/),
  actorId: z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/),
  actorType: z.enum(["user", "contributor", "service", "admin"]),
  action: z.string().regex(/^[a-z0-9._:-]{2,120}$/),
  resourceType: z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/),
  resourceId: z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/),
  data: z.record(z.unknown()).default({}),
  residencyRegion: residencyRegionSchema,
  actorResidencyRegion: residencyRegionSchema,
  organizationId: z.string().min(1).max(120).optional(),
});

export type AuditEventInput = z.input<typeof auditInputSchema>;

export type AuditRecord = {
  schemaVersion: 1;
  eventId: string;
  streamId: string;
  sequence: number;
  occurredAt: string;
  actor: { id: string; type: "user" | "contributor" | "service" | "admin" };
  action: string;
  resource: { type: string; id: string };
  data: Record<string, unknown>;
  residencyRegion: ResidencyRegion;
  previousHash: string;
};

export type StoredAuditEvent = AuditRecord & {
  hash: string;
  signature: string;
  signatureAlgorithm: "Ed25519";
  keyId: string;
  publicKeyJwk: JsonWebKey;
  r2Key: string;
};

export type AuditBindings = {
  DB: D1Database;
  AUDIT_BUCKET_ZA: R2Bucket;
  AUDIT_BUCKET_EU: R2Bucket;
  AUDIT_SIGNING_PRIVATE_JWK?: string;
  AUDIT_SIGNING_PUBLIC_JWK?: string;
  AUDIT_SIGNING_KEY_ID?: string;
  AUDIT_ANALYTICS_PIPELINE?: AuditAnalyticsPipeline;
};

const GENESIS_HASH = "GENESIS-SHA256-0000000000000000000000000000000000000000000000000000000000000000";
const MAX_CANONICAL_BYTES = 16_000;

const utf8 = (value: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;

function base64(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deterministic JSON used as the signed and hashed representation. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isPlainRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("Audit data must be JSON serializable");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", utf8(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parsePublicJwk(env: AuditBindings): JsonWebKey {
  if (!env.AUDIT_SIGNING_PUBLIC_JWK) throw new Error("AUDIT_SIGNING_PUBLIC_JWK is not configured");
  const jwk = JSON.parse(env.AUDIT_SIGNING_PUBLIC_JWK) as JsonWebKey;
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) throw new Error("AUDIT_SIGNING_PUBLIC_JWK must be an Ed25519 public JWK");
  return jwk;
}

async function signingKey(env: AuditBindings): Promise<CryptoKey> {
  if (!env.AUDIT_SIGNING_PRIVATE_JWK) throw new Error("AUDIT_SIGNING_PRIVATE_JWK is not configured");
  return crypto.subtle.importKey(
    "jwk",
    JSON.parse(env.AUDIT_SIGNING_PRIVATE_JWK) as JsonWebKey,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
}

function bucketFor(env: AuditBindings, region: ResidencyRegion): R2Bucket {
  return region === "eu" ? env.AUDIT_BUCKET_EU : env.AUDIT_BUCKET_ZA;
}

function asStoredEvent(row: Record<string, unknown>): StoredAuditEvent {
  const canonical = JSON.parse(String(row.canonical_json)) as AuditRecord;
  return {
    ...canonical,
    hash: String(row.event_hash),
    signature: String(row.signature),
    signatureAlgorithm: "Ed25519",
    keyId: String(row.key_id),
    publicKeyJwk: JSON.parse(String(row.public_key_jwk)) as JsonWebKey,
    r2Key: String(row.r2_key),
  };
}

export async function appendAuditEvent(env: AuditBindings, rawInput: AuditEventInput): Promise<{ event: StoredAuditEvent; created: boolean }> {
  const input = auditInputSchema.parse(rawInput);
  if (input.residencyRegion !== input.actorResidencyRegion) {
    throw new Error("RESIDENCY_POLICY_VIOLATION");
  }

  if (input.eventId) {
    const existing = await env.DB.prepare("SELECT * FROM audit_log_events WHERE event_id = ?").bind(input.eventId).first<Record<string, unknown>>();
    if (existing) return { event: asStoredEvent(existing), created: false };
  }

  const eventId = input.eventId ?? crypto.randomUUID();
  await env.DB.prepare("INSERT OR IGNORE INTO audit_chain_heads (stream_id, sequence, head_hash) VALUES (?, 0, ?)").bind(input.streamId, GENESIS_HASH).run();
  const head = await env.DB.prepare("SELECT sequence, head_hash FROM audit_chain_heads WHERE stream_id = ?").bind(input.streamId).first<{ sequence: number; head_hash: string }>();
  if (!head) throw new Error("AUDIT_CHAIN_HEAD_UNAVAILABLE");

  const record: AuditRecord = {
    schemaVersion: 1,
    eventId,
    streamId: input.streamId,
    sequence: Number(head.sequence) + 1,
    occurredAt: new Date().toISOString(),
    actor: { id: input.actorId, type: input.actorType },
    action: input.action,
    resource: { type: input.resourceType, id: input.resourceId },
    data: input.data,
    residencyRegion: input.residencyRegion,
    previousHash: String(head.head_hash),
  };
  const canonical = canonicalize(record);
  if (utf8(canonical).byteLength > MAX_CANONICAL_BYTES) throw new Error("AUDIT_EVENT_TOO_LARGE");
  const hash = await sha256(canonical);
  const signature = base64(await crypto.subtle.sign("Ed25519", await signingKey(env), utf8(hash)));
  const keyId = env.AUDIT_SIGNING_KEY_ID ?? "audit-ed25519-v1";
  const publicKeyJwk = parsePublicJwk(env);
  const r2Key = `events/${record.residencyRegion}/${record.streamId}/${record.sequence}-${record.eventId}.json`;
  const stored: StoredAuditEvent = { ...record, hash, signature, signatureAlgorithm: "Ed25519", keyId, publicKeyJwk, r2Key };

  await bucketFor(env, record.residencyRegion).put(r2Key, JSON.stringify(stored), {
    httpMetadata: { contentType: "application/json", cacheControl: "no-store" },
    customMetadata: { immutable: "true", eventHash: hash, streamId: record.streamId, residencyRegion: record.residencyRegion },
  });

  const result = await env.DB.prepare(`
    INSERT INTO audit_log_events (
      event_id, stream_id, sequence, occurred_at, actor_id, actor_type, action,
      resource_type, resource_id, data_json, residency_region, previous_hash,
      event_hash, signature, key_id, public_key_jwk, canonical_json, r2_key
    )
    SELECT ?, ?, sequence + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    FROM audit_chain_heads
    WHERE stream_id = ? AND sequence = ? AND head_hash = ?
  `).bind(
    record.eventId, record.streamId, record.occurredAt, record.actor.id, record.actor.type, record.action,
    record.resource.type, record.resource.id, JSON.stringify(record.data), record.residencyRegion, record.previousHash,
    stored.hash, stored.signature, stored.keyId, JSON.stringify(stored.publicKeyJwk), canonical, stored.r2Key,
    record.streamId, Number(head.sequence), record.previousHash,
  ).run();

  if (Number(result.meta.changes ?? 0) === 1) {
    try {
      await publishAuditAnalyticsEvent(env, stored, input.organizationId, redactAuditData);
    } catch (error) {
      console.warn(JSON.stringify({ event: "audit.analytics_publish_failed", eventId: stored.eventId, error: error instanceof Error ? error.message : "unknown-error" }));
    }
    return { event: stored, created: true };
  }
  const concurrent = await env.DB.prepare("SELECT * FROM audit_log_events WHERE event_id = ?").bind(record.eventId).first<Record<string, unknown>>();
  if (concurrent) return { event: asStoredEvent(concurrent), created: false };
  throw new Error("AUDIT_CHAIN_CONFLICT");
}

export async function verifyAuditEvent(env: AuditBindings, event: StoredAuditEvent): Promise<{ hashValid: boolean; signatureValid: boolean }> {
  const canonical = canonicalize({
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    streamId: event.streamId,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
    actor: event.actor,
    action: event.action,
    resource: event.resource,
    data: event.data,
    residencyRegion: event.residencyRegion,
    previousHash: event.previousHash,
  });
  const computedHash = await sha256(canonical);
  const hashValid = computedHash === event.hash;
  const publicKey = await crypto.subtle.importKey("jwk", event.publicKeyJwk, { name: "Ed25519" }, false, ["verify"]);
  const signatureValid = await crypto.subtle.verify("Ed25519", publicKey, fromBase64(event.signature), utf8(event.hash));
  return { hashValid, signatureValid };
}

export async function exportAuditEvents(env: AuditBindings, filters: { streamId: string; residencyRegion: ResidencyRegion; from?: string; to?: string }): Promise<{ exportId: string; objectKey: string; eventCount: number; manifestHash: string }> {
  const clauses = ["stream_id = ?", "residency_region = ?"];
  const values: string[] = [filters.streamId, filters.residencyRegion];
  if (filters.from) { clauses.push("occurred_at >= ?"); values.push(filters.from); }
  if (filters.to) { clauses.push("occurred_at <= ?"); values.push(filters.to); }
  const rows = await env.DB.prepare(`SELECT * FROM audit_log_events WHERE ${clauses.join(" AND ")} ORDER BY sequence ASC LIMIT 10000`).bind(...values).all<Record<string, unknown>>();
  const events = (rows.results as Record<string, unknown>[]).map(asStoredEvent);
  let previous = events[0]?.previousHash ?? null;
  for (const event of events) {
    if (previous !== event.previousHash) throw new Error("AUDIT_CHAIN_GAP");
    previous = event.hash;
    const verification = await verifyAuditEvent(env, event);
    if (!verification.hashValid || !verification.signatureValid) throw new Error("AUDIT_SIGNATURE_INVALID");
  }

  const exportId = crypto.randomUUID();
  const manifest = {
    schemaVersion: 1,
    exportId,
    generatedAt: new Date().toISOString(),
    filters,
    eventCount: events.length,
    firstSequence: events[0]?.sequence ?? null,
    lastSequence: events.at(-1)?.sequence ?? null,
    rootHash: await sha256(events.map((event) => event.hash).join("\n")),
    signatureAlgorithm: "Ed25519" as const,
    keyId: env.AUDIT_SIGNING_KEY_ID ?? "audit-ed25519-v1",
    publicKeyJwk: parsePublicJwk(env),
  };
  const canonicalManifest = canonicalize(manifest);
  const manifestHash = await sha256(canonicalManifest);
  const manifestSignature = base64(await crypto.subtle.sign("Ed25519", await signingKey(env), utf8(manifestHash)));
  const bundle = JSON.stringify({ manifest, manifestHash, manifestSignature, events });
  const objectKey = `exports/${filters.residencyRegion}/${exportId}.json`;
  await bucketFor(env, filters.residencyRegion).put(objectKey, bundle, {
    httpMetadata: { contentType: "application/json", cacheControl: "no-store" },
    customMetadata: { immutable: "true", manifestHash, exportId, residencyRegion: filters.residencyRegion },
  });
  await env.DB.prepare(`
    INSERT INTO audit_exports (id, stream_id, residency_region, from_occurred_at, to_occurred_at, event_count, manifest_hash, object_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(exportId, filters.streamId, filters.residencyRegion, filters.from ?? null, filters.to ?? null, events.length, manifestHash, objectKey).run();
  return { exportId, objectKey, eventCount: events.length, manifestHash };
}

export function getAuditBucket(env: AuditBindings, region: ResidencyRegion): R2Bucket {
  return bucketFor(env, region);
}

export function redactAuditData(value: Record<string, unknown>): Record<string, unknown> {
  const sensitive = /email|phone|mobile|address|passport|identity|id_number|tax|bank|document/i;
  const redact = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(redact);
    if (isPlainRecord(item)) return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, sensitive.test(key) ? "[REDACTED]" : redact(child)]));
    return item;
  };
  return redact(value) as Record<string, unknown>;
}

export { GENESIS_HASH };
