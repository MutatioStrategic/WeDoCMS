# Observability

Workers platform logs and traces are enabled in `wrangler.jsonc` with a head sampling rate of `1`. The Worker adds a W3C `traceparent` response header and emits structured JSON events with `traceId`, `spanId`, route, status, and duration.

Custom application metrics are written non-blockingly to the `veld_archive_observability` Workers Analytics Engine dataset. The dataset records request latency/errors, upload lifecycle events, R2 replication outcomes, chaos injections, and Stream webhook states. Query it through the Analytics Engine SQL API or connect Grafana with account-level Analytics Engine credentials.

Photo enrichment emits revision-aware structured events and metrics for accepted versus review-required AI output, OCR hit/empty state, retryable/permanent failures, dead-lettering, and successful vector indexing. D1 retains the job state and `photo_ai_provenance` records (model, prompt/schema version, source ETag, attempt, validation, and human review outcome). Operators can inspect `/api/admin/photo-jobs`, inspect `/:jobId/provenance`, and replay eligible jobs through `/:jobId/replay`.

R2 object changes flow through `veld-archive-r2-events` and are consumed by the same Worker. Stream processing state is authenticated using the Stream `Webhook-Signature` header and persisted to D1 in `stream_events`, with retries deduplicated by a body hash.

## Admin audit analytics connector

The Admin ledger remains backed by tenant-scoped D1 audit records. The optional
analytics connector publishes a redacted copy of each new signed audit event
to a Cloudflare Pipeline and can query an Iceberg table in the R2 Data Catalog
through the R2 SQL HTTP API. The dashboard merges the sources by `event_id` and
labels catalog rows as analytics copies; catalog data never replaces signed
proof or operational D1 state.

The intended beta table is `audit.events` in the separate
`veld-archive-analytics` bucket. The table schema is the fixed, metadata-only
record emitted by `src/worker/audit-analytics.ts`. Configure the Pipeline
binding after the stream is provisioned, then store the R2 SQL bearer token as
a Worker secret:

```powershell
npx wrangler secret put R2_SQL_AUTH_TOKEN
```

Do not put the token in `wrangler.jsonc`, browser storage, logs, or the admin
UI. Until both the Pipeline binding and R2 SQL token are configured, the D1
ledger and admin search continue to work and the dashboard reports the missing
connector explicitly.

```powershell
wrangler tail veld-archive-api-production --format json
wrangler r2 bucket info veld-archive-media
wrangler queues list
```

Do not log upload contents, access tokens, presigned URLs, Turnstile tokens, or webhook secrets. Structured events record identifiers and sizes only.
