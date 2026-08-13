import { logEvent, recordMetric, type ObservabilityBindings, type TraceContext } from "./observability";

export type ReplicationBindings = ObservabilityBindings & {
  MEDIA_BUCKET: R2Bucket;
  MEDIA_DR_BUCKET: R2Bucket;
  BACKUP_BUCKET: R2Bucket;
};

export type R2EventMessage = {
  account?: string;
  action: string;
  bucket: string;
  object: { key: string; size?: number; eTag?: string };
  eventTime?: string;
};

type ReplicationResult = {
  key: string;
  copied: boolean;
  reason: "missing-source" | "already-current" | "copied";
};

async function copyObject(
  env: ReplicationBindings,
  key: string,
  trace: TraceContext,
): Promise<ReplicationResult> {
  const source = await env.MEDIA_BUCKET.get(key);
  if (!source) return { key, copied: false, reason: "missing-source" };

  const existing = await env.MEDIA_DR_BUCKET.head(key);
  if (existing?.etag === source.etag) {
    return { key, copied: false, reason: "already-current" };
  }

  await env.MEDIA_DR_BUCKET.put(key, source.body, {
    httpMetadata: source.httpMetadata,
    customMetadata: source.customMetadata,
  });
  recordMetric(env, "r2_replication_copy", trace, source.size, ["media"]);
  logEvent("info", "r2.object.replicated", trace, { key, sizeBytes: source.size });
  return { key, copied: true, reason: "copied" };
}

export async function replicateR2Event(
  env: ReplicationBindings,
  event: R2EventMessage,
  trace: TraceContext,
): Promise<void> {
  if (!event.object?.key) return;
  if (event.action === "DeleteObject" || event.action === "LifecycleDeletion") {
    // The DR bucket is an undelete-friendly backup. Deletions are intentionally retained.
    recordMetric(env, "r2_replication_delete_retained", trace, 1, ["media"]);
    logEvent("info", "r2.object.delete.retained", trace, { key: event.object.key });
    return;
  }
  await copyObject(env, event.object.key, trace);
}

export async function catchUpR2Replication(
  env: ReplicationBindings,
  trace: TraceContext,
): Promise<void> {
  let cursor: string | undefined;
  let pages = 0;
  let copied = 0;
  let scanned = 0;

  do {
    const page = await env.MEDIA_BUCKET.list({ cursor, limit: 1000 });
    pages += 1;
    for (const object of page.objects) {
      scanned += 1;
      const result = await copyObject(env, object.key, trace);
      if (result.copied) copied += 1;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const manifest = {
    schemaVersion: 1,
    type: "r2-catch-up",
    completedAt: new Date().toISOString(),
    pages,
    scanned,
    copied,
    traceId: trace.traceId,
  };
  await env.BACKUP_BUCKET.put(
    `r2-manifests/${manifest.completedAt.replace(/[:.]/g, "-")}.json`,
    JSON.stringify(manifest),
    { httpMetadata: { contentType: "application/json" } },
  );
  recordMetric(env, "r2_replication_run", trace, copied, ["catch-up"]);
  logEvent("info", "r2.replication.completed", trace, { pages, scanned, copied });
}
