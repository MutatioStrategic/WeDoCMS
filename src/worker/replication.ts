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

type CatchUpState = {
  cursor: string;
  pages: number;
  scanned: number;
  copied: number;
  startedAt: string;
};

const CATCH_UP_STATE_KEY = "r2-manifests/_catch-up-state.json";
const CATCH_UP_PAGE_SIZE = 100;
const CATCH_UP_COPY_CONCURRENCY = 6;

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
  const savedState = await env.BACKUP_BUCKET.get(CATCH_UP_STATE_KEY);
  let state: CatchUpState | undefined;
  if (savedState) {
    try {
      const parsed = JSON.parse(await savedState.text()) as Partial<CatchUpState>;
      if (typeof parsed.cursor === "string" && typeof parsed.pages === "number" && typeof parsed.scanned === "number" && typeof parsed.copied === "number" && typeof parsed.startedAt === "string") {
        state = parsed as CatchUpState;
      }
    } catch {
      // A corrupt cursor must not prevent a fresh catch-up scan.
    }
  }

  const page = await env.MEDIA_BUCKET.list({ cursor: state?.cursor, limit: CATCH_UP_PAGE_SIZE });
  let copiedThisPage = 0;
  for (let offset = 0; offset < page.objects.length; offset += CATCH_UP_COPY_CONCURRENCY) {
    const batch = page.objects.slice(offset, offset + CATCH_UP_COPY_CONCURRENCY);
    const results = await Promise.all(batch.map((object) => copyObject(env, object.key, trace)));
    copiedThisPage += results.filter((result) => result.copied).length;
  }

  const pages = (state?.pages ?? 0) + 1;
  const scanned = (state?.scanned ?? 0) + page.objects.length;
  const copied = (state?.copied ?? 0) + copiedThisPage;
  const startedAt = state?.startedAt ?? new Date().toISOString();
  const nextCursor = page.truncated ? page.cursor : undefined;

  if (nextCursor) {
    await env.BACKUP_BUCKET.put(CATCH_UP_STATE_KEY, JSON.stringify({ cursor: nextCursor, pages, scanned, copied, startedAt } satisfies CatchUpState), {
      httpMetadata: { contentType: "application/json" },
    });
  } else {
    const completedAt = new Date().toISOString();
    const manifest = {
      schemaVersion: 1,
      type: "r2-catch-up",
      startedAt,
      completedAt,
      pages,
      scanned,
      copied,
      traceId: trace.traceId,
    };
    await env.BACKUP_BUCKET.put(
      `r2-manifests/${completedAt.replace(/[:.]/g, "-")}.json`,
      JSON.stringify(manifest),
      { httpMetadata: { contentType: "application/json" } },
    );
    await env.BACKUP_BUCKET.delete(CATCH_UP_STATE_KEY);
  }

  recordMetric(env, "r2_replication_run", trace, copiedThisPage, ["catch-up"]);
  logEvent("info", nextCursor ? "r2.replication.page_completed" : "r2.replication.completed", trace, {
    objectsThisPage: page.objects.length,
    copiedThisPage,
    scanned,
    copied,
    resumed: Boolean(state),
    hasNextPage: Boolean(nextCursor),
  });
}
