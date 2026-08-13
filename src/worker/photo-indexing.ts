import { logEvent, recordMetric, type ObservabilityBindings, type TraceContext } from "./observability";

export type PhotoJobOperation = "enrich" | "sync_index";

export type PhotoEnrichmentJob = {
  type: "photo.enrich";
  jobId: string;
  assetId: string;
  operation: PhotoJobOperation;
};

export type PhotoPipelineBindings = ObservabilityBindings & {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  PHOTO_INDEX?: VectorizeIndex;
  PHOTO_ENRICHMENT_QUEUE?: Queue<PhotoEnrichmentJob>;
  PHOTO_VISION_MODEL?: string;
  PHOTO_EMBEDDING_MODEL?: string;
  PHOTO_INDEX_NAMESPACE?: string;
};

type AssetRow = Record<string, unknown> & {
  id: string;
  owner_id: string;
  kind: "image" | "video";
  status: string;
  title: string;
  original_key: string | null;
};

type VisionMetadata = {
  description: string;
  visibleText: string;
  subjectTags: string[];
  confidence: number;
};

const DEFAULT_VISION_MODEL = "@cf/moondream/moondream3.1-9B-A2B";
const DEFAULT_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const MAX_IMAGE_BYTES = 12_000_000;
const UNSAFE_INFERENCE = /\b(ethnic|racial|tribe|tribal|religion|muslim|christian|black people|white people|colou?red people|native people|indigenous people|criminal|illegal|exotic)\b/i;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter((item) => item.length > 1 && item.length <= 80 && !UNSAFE_INFERENCE.test(item))
    .slice(0, 30);
}

function clampConfidence(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5;
}

function extractJson(value: string): string {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced) return fenced;
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  return start >= 0 && end > start ? value.slice(start, end + 1) : value;
}

function base64Bytes(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function parseVisionMetadata(value: unknown): VisionMetadata {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? "");
  try {
    const parsed = JSON.parse(extractJson(raw)) as Record<string, unknown>;
    return {
      description: asString(parsed.description).slice(0, 1200),
      visibleText: asString(parsed.visibleText ?? parsed.visible_text ?? parsed.ocrText).slice(0, 2000),
      subjectTags: asStringArray(parsed.subjectTags ?? parsed.subject_tags ?? parsed.tags),
      confidence: clampConfidence(parsed.confidence),
    };
  } catch {
    return {
      description: raw.trim().slice(0, 1200),
      visibleText: "",
      subjectTags: [],
      confidence: 0.35,
    };
  }
}

export function buildPhotoSearchDocument(row: Record<string, unknown>): string {
  const list = (key: string): string[] => {
    try {
      const parsed = JSON.parse(String(row[key] ?? "[]"));
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
    } catch {
      return [];
    }
  };
  const location = [row.country, row.province, row.city, row.locality, row.landmark].filter(Boolean).join(", ");
  return [
    `Title: ${asString(row.title)}`,
    `Description: ${asString(row.description)}`,
    `Caption: ${asString(row.caption)}`,
    `Location: ${location}`,
    `Subject tags: ${list("subject_tags").join(", ")}`,
    `AI visual tags: ${list("ai_tags").join(", ")}`,
    `Visible text in image: ${asString(row.ocr_text)}`,
    `Contributor context: ${list("cultural_tags").join(", ")}`,
  ].filter((line) => !line.endsWith(": ")).join("\n").slice(0, 6000);
}

export async function enqueuePhotoJob(
  env: PhotoPipelineBindings,
  assetId: string,
  operation: PhotoJobOperation,
): Promise<string> {
  const jobId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO photo_ai_jobs (id, asset_id, operation, status, attempts, requested_at, updated_at)
    VALUES (?, ?, ?, 'queued', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(asset_id, operation) DO UPDATE SET
      status = 'queued', last_error = NULL, requested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  `).bind(jobId, assetId, operation).run();
  if (operation === "sync_index") {
    await env.DB.prepare("UPDATE assets SET vector_index_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(assetId).run();
  }
  const row = await env.DB.prepare("SELECT id FROM photo_ai_jobs WHERE asset_id = ? AND operation = ?")
    .bind(assetId, operation).first<{ id: string }>();
  const persistedJobId = row?.id ?? jobId;
  if (!env.PHOTO_ENRICHMENT_QUEUE) throw new Error("PHOTO_ENRICHMENT_QUEUE binding is not configured");
  await env.PHOTO_ENRICHMENT_QUEUE.send({ type: "photo.enrich", jobId: persistedJobId, assetId, operation });
  return persistedJobId;
}

export async function retryQueuedPhotoJobs(env: PhotoPipelineBindings): Promise<number> {
  if (!env.PHOTO_ENRICHMENT_QUEUE) return 0;
  await env.DB.prepare("UPDATE photo_ai_jobs SET status = 'queued', updated_at = CURRENT_TIMESTAMP WHERE status = 'running' AND updated_at < datetime('now', '-10 minutes') AND attempts < 5").run();
  const result = await env.DB.prepare(`
    SELECT id, asset_id, operation FROM photo_ai_jobs
    WHERE status IN ('queued', 'failed') AND attempts < 5
      AND (updated_at < datetime('now', '-2 minutes') OR status = 'queued')
    ORDER BY requested_at ASC LIMIT 50
  `).all<{ id: string; asset_id: string; operation: PhotoJobOperation }>();
  if (!result.results.length) return 0;
  await env.PHOTO_ENRICHMENT_QUEUE.sendBatch(result.results.map((job) => ({
    body: { type: "photo.enrich" as const, jobId: job.id, assetId: job.asset_id, operation: job.operation },
  })));
  return result.results.length;
}

async function markJob(env: PhotoPipelineBindings, jobId: string, status: string, error?: string): Promise<void> {
  await env.DB.prepare(`
    UPDATE photo_ai_jobs SET status = ?, attempts = CASE WHEN ? = 'running' THEN attempts + 1 ELSE attempts END,
      last_error = ?, started_at = CASE WHEN ? = 'running' THEN CURRENT_TIMESTAMP ELSE started_at END,
      completed_at = CASE WHEN ? IN ('completed', 'skipped') THEN CURRENT_TIMESTAMP ELSE completed_at END,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(status, status, error ?? null, status, status, jobId).run();
}

async function getAsset(env: PhotoPipelineBindings, assetId: string): Promise<AssetRow | null> {
  return env.DB.prepare("SELECT * FROM assets WHERE id = ?").bind(assetId).first<AssetRow>();
}

async function enrichPhoto(env: PhotoPipelineBindings, job: PhotoEnrichmentJob, trace: TraceContext): Promise<void> {
  const asset = await getAsset(env, job.assetId);
  if (!asset) {
    await markJob(env, job.jobId, "skipped", "asset-not-found");
    return;
  }
  if (asset.kind !== "image" || !asset.original_key) {
    await markJob(env, job.jobId, "skipped", "not-an-indexable-image");
    return;
  }
  if (!env.AI) throw new Error("AI binding is not configured for photo enrichment");
  const object = await env.MEDIA_BUCKET.get(asset.original_key);
  if (!object) throw new Error("Photo object was not found in R2");
  if (object.size > MAX_IMAGE_BYTES) throw new Error("Photo exceeds the AI enrichment size limit");

  const image = new Uint8Array(await object.arrayBuffer());
  const contentType = object.httpMetadata?.contentType?.toLowerCase() ?? "image/jpeg";
  if (!contentType.startsWith("image/")) {
    await markJob(env, job.jobId, "skipped", "not-an-image-object");
    return;
  }
  const vision = await env.AI.run(env.PHOTO_VISION_MODEL ?? DEFAULT_VISION_MODEL, {
    task: "query",
    image: `data:${contentType};base64,${base64Bytes(image)}`,
    question: `Return JSON only with this exact shape: {"description":"short factual scene description","visibleText":"all legible text or empty string","subjectTags":["factual visual tags"],"confidence":0.0}. Describe only observable objects, activities, and setting. Do not infer names, identity, ethnicity, race, religion, culture, intent, legality, or location. If uncertain, leave it out.`,
    reasoning: false,
    stream: false,
    temperature: 0,
    max_tokens: 500,
  }) as { answer?: string; description?: string };
  const metadata = parseVisionMetadata(vision.answer ?? vision.description ?? vision);
  const currentSubjectTags = JSON.parse(String(asset.subject_tags ?? "[]")) as string[];
  const mergedTags = [...new Set([...currentSubjectTags, ...metadata.subjectTags])].slice(0, 50);
  await env.DB.prepare(`
    UPDATE assets SET
      description = CASE WHEN trim(description) = '' THEN ? ELSE description END,
      caption = CASE WHEN trim(caption) = '' THEN ? ELSE caption END,
      subject_tags = ?, ai_tags = ?, ocr_text = ?, ai_confidence = ?,
      metadata_review_status = 'needs_context',
      metadata_review_note = 'AI visual metadata and visible text require seller/editor confirmation before publication.',
      metadata_provenance = 'ai_suggested', status = 'needs_review', workflow_stage = 'curator_correction',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    metadata.description,
    metadata.description,
    JSON.stringify(mergedTags),
    JSON.stringify(metadata.subjectTags),
    metadata.visibleText,
    metadata.confidence,
    asset.id,
  ).run();
  await env.DB.prepare("INSERT INTO metadata_events (id, asset_id, actor_id, event_type, payload) VALUES (?, ?, ?, 'ai_tagged', ?)")
    .bind(crypto.randomUUID(), asset.id, asset.owner_id, JSON.stringify({ source: "photo-enrichment", model: env.PHOTO_VISION_MODEL ?? DEFAULT_VISION_MODEL, visibleTextDetected: Boolean(metadata.visibleText), subjectTagCount: metadata.subjectTags.length })).run();
  await markJob(env, job.jobId, "completed");
  recordMetric(env, "photo_ai_enrichment_completed", trace, 1, [metadata.visibleText ? "ocr-hit" : "ocr-empty"]);
  logEvent("info", "photo.ai_enrichment.completed", trace, { assetId: asset.id, jobId: job.jobId, tagCount: metadata.subjectTags.length });
}

async function syncPhotoIndex(env: PhotoPipelineBindings, job: PhotoEnrichmentJob, trace: TraceContext): Promise<void> {
  const asset = await getAsset(env, job.assetId);
  if (!asset) {
    await markJob(env, job.jobId, "skipped", "asset-not-found");
    return;
  }
  if (!env.PHOTO_INDEX) throw new Error("PHOTO_INDEX binding is not configured");
  const namespace = env.PHOTO_INDEX_NAMESPACE?.trim() || undefined;
  if (asset.status !== "published" || asset.kind !== "image") {
    await env.PHOTO_INDEX.deleteByIds([asset.id]);
    await env.DB.prepare("UPDATE assets SET vector_index_status = 'not_indexed', vector_indexed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(asset.id).run();
    await markJob(env, job.jobId, "skipped", "asset-not-published");
    return;
  }
  if (!env.AI) throw new Error("AI binding is not configured for photo indexing");
  const document = buildPhotoSearchDocument(asset);
  const embeddingResult = await env.AI.run(env.PHOTO_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL, { text: document, pooling: "cls" }) as { data?: number[][] };
  const vector = embeddingResult.data?.[0];
  if (!vector?.length) throw new Error("Embedding model returned no vector");
  await env.PHOTO_INDEX.upsert([{
    id: asset.id,
    values: vector,
    ...(namespace ? { namespace } : {}),
    metadata: {
      assetId: asset.id,
      status: asset.status,
      kind: asset.kind,
      country: asString(asset.country),
      province: asString(asset.province),
      city: asString(asset.city),
      metadataReviewStatus: asString(asset.metadata_review_status),
    },
  }]);
  await env.DB.prepare("UPDATE assets SET vector_index_status = 'indexed', vector_indexed_at = CURRENT_TIMESTAMP, vector_index_version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(env.PHOTO_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL, asset.id).run();
  await markJob(env, job.jobId, "completed");
  recordMetric(env, "photo_vector_indexed", trace, 1, [asset.id]);
  logEvent("info", "photo.vector_indexed", trace, { assetId: asset.id, jobId: job.jobId, dimensions: vector.length });
}

export async function processPhotoJob(env: PhotoPipelineBindings, job: PhotoEnrichmentJob, trace: TraceContext): Promise<void> {
  const claim = await env.DB.prepare(`
    UPDATE photo_ai_jobs SET status = 'running', attempts = attempts + 1, started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('queued', 'failed') AND attempts < 5
  `).bind(job.jobId).run();
  if (claim.meta.changes === 0) return;
  try {
    if (job.operation === "enrich") await enrichPhoto(env, job, trace);
    else await syncPhotoIndex(env, job, trace);
  } catch (error) {
    const message = error instanceof Error ? error.message : "photo-job-failed";
    await markJob(env, job.jobId, "failed", message);
    recordMetric(env, "photo_pipeline_error", trace, 1, [job.operation]);
    throw error;
  }
}

export async function searchPhotoIndex(
  env: PhotoPipelineBindings,
  query: string,
  filters: { kind: "all" | "image" | "video"; status: "published" | "needs_review" | "all"; location?: string },
): Promise<{ rows: Record<string, unknown>[]; usedVectorIndex: boolean }> {
  if (!env.PHOTO_INDEX || !env.AI || filters.status !== "published") return { rows: [], usedVectorIndex: false };
  const embeddingResult = await env.AI.run(env.PHOTO_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL, { text: query, pooling: "cls" }) as { data?: number[][] };
  const vector = embeddingResult.data?.[0];
  if (!vector?.length) return { rows: [], usedVectorIndex: false };
  const namespace = env.PHOTO_INDEX_NAMESPACE?.trim() || undefined;
  const matches = await env.PHOTO_INDEX.query(vector, {
    topK: 120,
    returnMetadata: false,
    ...(namespace ? { namespace } : {}),
    filter: { status: "published", ...(filters.kind !== "all" ? { kind: filters.kind } : {}) },
  });
  const ids = matches.matches.map((match) => match.id).filter(Boolean);
  if (!ids.length) return { rows: [], usedVectorIndex: true };
  const clauses = [`a.id IN (${ids.map(() => "?").join(",")})`];
  const values: string[] = ids;
  if (filters.kind !== "all") { clauses.push("a.kind = ?"); values.push(filters.kind); }
  if (filters.location) {
    const location = `%${filters.location}%`;
    clauses.push("(a.city LIKE ? OR a.province LIKE ? OR a.locality LIKE ? OR a.landmark LIKE ?)");
    values.push(location, location, location, location);
  }
  const result = await env.DB.prepare(`SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id WHERE ${clauses.join(" AND ")}`).bind(...values).all<Record<string, unknown>>();
  const scores = new Map(matches.matches.map((match) => [match.id, match.score]));
  const rows = result.results as Record<string, unknown>[];
  rows.sort((left, right) => Number(scores.get(String(right.id)) ?? 0) - Number(scores.get(String(left.id)) ?? 0));
  return { rows: rows.slice(0, 60), usedVectorIndex: true };
}
