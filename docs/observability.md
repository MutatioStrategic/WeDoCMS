# Observability

Workers platform logs and traces are enabled in `wrangler.jsonc` with a head sampling rate of `1`. The Worker adds a W3C `traceparent` response header and emits structured JSON events with `traceId`, `spanId`, route, status, and duration.

Custom application metrics are written non-blockingly to the `veld_archive_observability` Workers Analytics Engine dataset. The dataset records request latency/errors, upload lifecycle events, R2 replication outcomes, chaos injections, and Stream webhook states. Query it through the Analytics Engine SQL API or connect Grafana with account-level Analytics Engine credentials.

R2 object changes flow through `veld-archive-r2-events` and are consumed by the same Worker. Stream processing state is authenticated using the Stream `Webhook-Signature` header and persisted to D1 in `stream_events`, with retries deduplicated by a body hash.

```powershell
wrangler tail veld-archive-api --format json
wrangler r2 bucket info veld-archive-media
wrangler queues list
```

Do not log upload contents, access tokens, presigned URLs, Turnstile tokens, or webhook secrets. Structured events record identifiers and sizes only.
