import { afterEach, describe, expect, it, vi } from "vitest";
import { auditAnalyticsStatus, publishAuditAnalyticsEvent, searchR2AuditCatalog, type AuditAnalyticsRecord } from "./audit-analytics";

const event = {
  schemaVersion: 1 as const,
  eventId: "event-1234",
  streamId: "asset:asset-1",
  sequence: 2,
  occurredAt: "2026-08-13T10:00:00.000Z",
  actor: { id: "admin-1", type: "admin" as const },
  action: "asset.approved",
  resource: { type: "asset", id: "asset-1" },
  data: { ownerId: "user-1", email: "private@example.com", title: "Cape Town" },
  residencyRegion: "za" as const,
  previousHash: "previous",
  hash: "hash",
  signature: "signature",
  signatureAlgorithm: "Ed25519" as const,
  keyId: "audit-ed25519-v1",
  publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: "public" },
  r2Key: "events/za/asset:asset-1/2-event-1234.json",
};

afterEach(() => vi.restoreAllMocks());

describe("audit analytics connector", () => {
  it("reports the catalog as unavailable until the endpoint and token are configured", () => {
    expect(auditAnalyticsStatus({ R2_ANALYTICS_BUCKET: "veld-archive-analytics" })).toEqual({
      pipeline: "not_configured",
      r2DataCatalog: "not_configured",
      table: "audit.events",
    });
  });

  it("publishes a redacted, tenant-scoped record to the optional pipeline", async () => {
    const send = vi.fn<(records: AuditAnalyticsRecord[]) => Promise<void>>().mockResolvedValue(undefined);
    const published = await publishAuditAnalyticsEvent({ AUDIT_ANALYTICS_PIPELINE: { send } }, event, "org-demo", (data) => ({ ...data, email: "[REDACTED]" }));
    expect(published).toBe(true);
    expect(send).toHaveBeenCalledWith([expect.objectContaining({ event_id: event.eventId, organization_id: "org-demo", data_json: expect.stringContaining("[REDACTED]") })]);
  });

  it("queries only the configured catalog table and returns rows from the SQL response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ result: [{
      event_id: "event-1234", organization_id: "org-demo", stream_id: "asset:asset-1", sequence: 2,
      occurred_at: "2026-08-13T10:00:00.000Z", actor_id: "admin-1", actor_type: "admin", action: "asset.approved",
      resource_type: "asset", resource_id: "asset-1", residency_region: "za", event_hash: "hash", previous_hash: "previous", data_json: "{}",
    }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const rows = await searchR2AuditCatalog({ R2_ACCOUNT_ID: "account", R2_ANALYTICS_BUCKET: "bucket", R2_SQL_AUTH_TOKEN: "secret" }, { organizationId: "org-demo", q: "asset", limit: 10 });
    expect(rows).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/accounts/account/r2-sql/query/bucket"), expect.objectContaining({ method: "POST" }));
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("organization_id = 'org-demo'");
  });
});
