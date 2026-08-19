# Pre-API contract blast-radius report

Date: 2026-08-13

The pre-API boundary was exercised against the local Wrangler Worker with the
migrated D1 fixture. The gate is available as `npm run test:blast-radius` when a
Worker is already running, and is included in `npm run test:local-smoke`.

## Result

The controlled run passed after one containment defect was corrected. Invalid
input stayed out of asset ingestion, moderation safety rejected unsafe labels,
queue failure remained a review-state outcome, licensing rejected typed
mismatches before licence evaluation, and payment failures did not change
ledger reconciliation.

| Injection | Boundary response | Observed propagation |
| --- | --- | --- |
| Truncated asset JSON | `400`, `code=invalid_json` | No asset was created; no moderation or ledger work ran. |
| Asset schema mismatch (`kind=audio`, short title) | `400` Zod error | Contributor asset count was unchanged. |
| Unsafe cultural metadata | `422`, `metadata_context_required` | No ingestion row was created and no queue was scheduled. |
| Unsafe moderation correction | `422`, `metadata_context_required` | Existing asset remained unchanged. |
| Missing photo queue/schema mismatch | `200`, explicit `enrichment_retry_pending`, or `503 metadata_schema_unavailable` before mutation | Asset remained `needs_review`; the failure was logged/metriced and did not reach licensing or ledger. |
| Licence request with string `durationDays` | `400` Zod error | No licence or ledger mutation. |
| Signed Stream payload with numeric `uid` | `400` Zod error | No `stream_events` row or downstream video state change. |
| Signed payment JSON malformed or wrong types | `400`, including `invalid_json` | No webhook event or ledger mutation. Repeating the case remained a `400`, not a duplicate acceptance. |
| Valid payment shape, wrong amount for a known licence | `422` and failed webhook event | Ledger reconciliation was unchanged; retry returned `200 duplicate=true`. |

## Propagation paths and containment

The intended path is:

```text
request body
  -> shared Zod contract
  -> ingestion/moderation or provider event record
  -> isolated queue/licensing/ledger operation
  -> reconciliation/audit state
```

The tested paths stopped at the first invalid boundary. Moderation actions can
persist a review-state transition before a queue send; on a fully migrated
database queue failure is caught by `enqueuePhotoJobBestEffort` and returned as
an explicit retry-pending status. If the revision columns are missing, the
governance preflight now returns `503 metadata_schema_unavailable` before any
mutation. Neither path can publish an asset or create ledger postings. Payment webhook events
are deduplicated by provider/event ID; processing errors are recorded as failed
events and do not partially settle the ledger.

## Defect found and corrected

Before this test, malformed JSON escaped the Zod-only error branch and returned
a generic `500`. More importantly, a schema-valid payment event referencing a
nonexistent licence failed on the webhook-event foreign key before the guarded
payment-processing block, also returning `500`. The first behavior is now a
structured `400 invalid_json`; payment event insertion is inside the guarded
path, so the foreign-key case is contained as a client/payment failure rather
than an unhandled server failure.

The same run exposed a local migration/schema mismatch: `assets.asset_revision`
and related review columns were missing in the local D1 state. The governance
preflight now returned `503 metadata_schema_unavailable` before mutation. In a
partially mismatched state where the asset update succeeds but the queue insert
fails, the existing best-effort queue seam returns `enrichment_retry_pending`
and preserves the asset in `needs_review`. Both outcomes are contained, but the
migration smoke failure below must be resolved before enabling the enrichment
queue in a deployed environment.

## Silent-failure assessment

- No system-wide silent data corruption was observed.
- Invalid request and metadata cases expose status/error information to callers.
- Queue failure is operationally visible through the explicit response,
  `photo.job.enqueue_failed` logging, and the queue error metric.
- The pre-fix malformed JSON and payment foreign-key paths were silent from the
  contract consumer's perspective because they surfaced only as generic `500`
  responses. Both are now regression-covered.

## Remaining release blockers

The full `npm test`/`npm run typecheck` gate remains red for pre-existing,
unrelated changes in `src/worker/photo-indexing.test.ts`: it imports
`classifyVisionResult`, `photoJobMatchesAsset`, and `mergeHybridSearchRows`,
which are not currently exported by `photo-indexing.ts`. The migration smoke
also fails on an existing `organization_memberships` uniqueness error. Those
failures are preserved as separate work; they are not attributed to the
contract blast-radius changes.

The containment gate itself passed through the local smoke workflow, including
the existing auth, penetration, payment reconciliation, and 100-case HTTP fuzz
checks.
