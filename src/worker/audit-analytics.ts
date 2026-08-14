import type { StoredAuditEvent } from "./audit";

export type AuditAnalyticsRecord = {
  schema_version: 1;
  event_id: string;
  organization_id: string;
  stream_id: string;
  sequence: number;
  occurred_at: string;
  actor_id: string;
  actor_type: string;
  action: string;
  resource_type: string;
  resource_id: string;
  residency_region: string;
  event_hash: string;
  previous_hash: string;
  data_json: string;
  source: "audit_log_events";
  ingested_at: string;
};

export type AuditAnalyticsPipeline = {
  send(records: AuditAnalyticsRecord[]): Promise<void>;
};

export type AuditAnalyticsConfig = {
  AUDIT_ANALYTICS_PIPELINE?: AuditAnalyticsPipeline;
  R2_ACCOUNT_ID?: string;
  R2_SQL_AUTH_TOKEN?: string;
  R2_SQL_ENDPOINT?: string;
  R2_ANALYTICS_BUCKET?: string;
  R2_ANALYTICS_NAMESPACE?: string;
  R2_ANALYTICS_TABLE?: string;
  R2_DATA_CATALOG_ENABLED?: string;
};

export type AuditCatalogRow = {
  event_id: string;
  organization_id: string;
  stream_id: string;
  sequence: number;
  occurred_at: string;
  actor_id: string;
  actor_type: string;
  action: string;
  resource_type: string;
  resource_id: string;
  residency_region: string;
  event_hash: string;
  previous_hash: string;
  data_json: string;
};

export type AuditCatalogSearch = {
  organizationId: string;
  q?: string;
  action?: string;
  resourceType?: string;
  from?: string;
  to?: string;
  limit: number;
};

export type AuditAnalyticsStatus = {
  pipeline: "configured" | "not_configured";
  r2DataCatalog: "configured" | "not_configured";
  r2Sql: "configured" | "not_configured";
  table: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlIdentifier(value: string, fallback: string): string {
  const candidate = value || fallback;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(candidate)) throw new Error("Invalid R2 Data Catalog identifier");
  return `"${candidate}"`;
}

function catalogEndpoint(config: AuditAnalyticsConfig): string | null {
  if (config.R2_SQL_ENDPOINT) return config.R2_SQL_ENDPOINT.replace(/\/$/, "");
  if (!config.R2_ACCOUNT_ID || !config.R2_ANALYTICS_BUCKET) return null;
  return `https://api.sql.cloudflarestorage.com/api/v1/accounts/${encodeURIComponent(config.R2_ACCOUNT_ID)}/r2-sql/query/${encodeURIComponent(config.R2_ANALYTICS_BUCKET)}`;
}

function extractRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ["result", "results", "rows", "data"]) {
    const child = value[key];
    if (Array.isArray(child)) return child;
    if (isRecord(child)) {
      const rows = extractRows(child);
      if (rows.length) return rows;
    }
  }
  return [];
}

function catalogRow(value: unknown): AuditCatalogRow | null {
  if (!isRecord(value)) return null;
  const required = ["event_id", "organization_id", "stream_id", "occurred_at", "actor_id", "action", "resource_type", "resource_id", "event_hash", "previous_hash"];
  if (required.some((key) => typeof value[key] !== "string")) return null;
  return {
    event_id: String(value.event_id),
    organization_id: String(value.organization_id),
    stream_id: String(value.stream_id),
    sequence: Number(value.sequence ?? 0),
    occurred_at: String(value.occurred_at),
    actor_id: String(value.actor_id),
    actor_type: String(value.actor_type ?? "unknown"),
    action: String(value.action),
    resource_type: String(value.resource_type),
    resource_id: String(value.resource_id),
    residency_region: String(value.residency_region ?? "za"),
    event_hash: String(value.event_hash),
    previous_hash: String(value.previous_hash),
    data_json: typeof value.data_json === "string" ? value.data_json : JSON.stringify(value.data_json ?? {}),
  };
}

export function auditAnalyticsStatus(config: AuditAnalyticsConfig): AuditAnalyticsStatus {
  const namespace = config.R2_ANALYTICS_NAMESPACE ?? "audit";
  const table = config.R2_ANALYTICS_TABLE ?? "events";
  return {
    pipeline: config.AUDIT_ANALYTICS_PIPELINE ? "configured" : "not_configured",
    r2DataCatalog: config.R2_DATA_CATALOG_ENABLED === "true" || Boolean(config.R2_ANALYTICS_BUCKET && config.R2_ACCOUNT_ID) ? "configured" : "not_configured",
    r2Sql: config.R2_SQL_AUTH_TOKEN && catalogEndpoint(config) ? "configured" : "not_configured",
    table: `${namespace}.${table}`,
  };
}

export async function publishAuditAnalyticsEvent(
  config: AuditAnalyticsConfig,
  event: StoredAuditEvent,
  organizationId: string | undefined,
  redact: (data: Record<string, unknown>) => Record<string, unknown>,
): Promise<boolean> {
  if (!config.AUDIT_ANALYTICS_PIPELINE || !organizationId) return false;
  const record: AuditAnalyticsRecord = {
    schema_version: 1,
    event_id: event.eventId,
    organization_id: organizationId,
    stream_id: event.streamId,
    sequence: event.sequence,
    occurred_at: event.occurredAt,
    actor_id: event.actor.id,
    actor_type: event.actor.type,
    action: event.action,
    resource_type: event.resource.type,
    resource_id: event.resource.id,
    residency_region: event.residencyRegion,
    event_hash: event.hash,
    previous_hash: event.previousHash,
    data_json: JSON.stringify(redact(event.data)),
    source: "audit_log_events",
    ingested_at: new Date().toISOString(),
  };
  await config.AUDIT_ANALYTICS_PIPELINE.send([record]);
  return true;
}

export async function searchR2AuditCatalog(config: AuditAnalyticsConfig, filters: AuditCatalogSearch): Promise<AuditCatalogRow[]> {
  if (!config.R2_SQL_AUTH_TOKEN) return [];
  const endpoint = catalogEndpoint(config);
  if (!endpoint) return [];
  const namespace = sqlIdentifier(config.R2_ANALYTICS_NAMESPACE ?? "audit", "audit");
  const table = sqlIdentifier(config.R2_ANALYTICS_TABLE ?? "events", "events");
  const conditions = [`organization_id = ${sqlLiteral(filters.organizationId)}`];
  if (filters.q) {
    const term = sqlLiteral(`%${filters.q}%`);
    conditions.push(`LOWER(action || ' ' || resource_type || ' ' || resource_id || ' ' || actor_id || ' ' || data_json) LIKE LOWER(${term})`);
  }
  if (filters.action) conditions.push(`action = ${sqlLiteral(filters.action)}`);
  if (filters.resourceType) conditions.push(`resource_type = ${sqlLiteral(filters.resourceType)}`);
  if (filters.from) conditions.push(`occurred_at >= ${sqlLiteral(filters.from)}`);
  if (filters.to) conditions.push(`occurred_at <= ${sqlLiteral(filters.to)}`);
  const query = `SELECT event_id, organization_id, stream_id, sequence, occurred_at, actor_id, actor_type, action, resource_type, resource_id, residency_region, event_hash, previous_hash, data_json FROM ${namespace}.${table} WHERE ${conditions.join(" AND ")} ORDER BY occurred_at DESC LIMIT ${Math.min(Math.max(filters.limit, 1), 100)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.R2_SQL_AUTH_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`R2 SQL query failed (${response.status})`);
  const rows = extractRows(await response.json());
  return rows.map(catalogRow).filter((row): row is AuditCatalogRow => Boolean(row));
}
