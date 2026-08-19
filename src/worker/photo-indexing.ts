import { logEvent, recordMetric, type ObservabilityBindings, type TraceContext } from "./observability";
import { createPresignedR2Url } from "./r2-presign";
import { archiveDomain } from "../shared";

export type PhotoJobOperation = "enrich" | "sync_index";
export type PhotoJobErrorClass = "retryable" | "permanent" | "validation" | "stale";

export type PhotoEnrichmentJob = {
  type: "photo.enrich";
  jobId: string;
  assetId: string;
  operation: PhotoJobOperation;
  assetRevision: number;
  sourceEtag: string | null;
};

export type PhotoPipelineBindings = ObservabilityBindings & {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  PHOTO_INDEX?: VectorizeIndex;
  PHOTO_ENRICHMENT_QUEUE?: Queue<PhotoEnrichmentJob>;
  PHOTO_VISION_MODEL?: string;
  PHOTO_VISION_PROVIDER?: string;
  LOCAL_VISION_URL?: string;
  LOCAL_VISION_MODEL?: string;
  REMOTE_VISION_URL?: string;
  REMOTE_VISION_TOKEN?: string;
  PHOTO_EMBEDDING_MODEL?: string;
  PHOTO_INDEX_NAMESPACE?: string;
  PHOTO_CANDIDATE_INDEX_NAMESPACE?: string;
  PHOTO_AI_SOURCE_ORIGIN?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
};

type AssetRow = Record<string, unknown> & {
  id: string;
  owner_id: string;
  kind: "image" | "video";
  status: string;
  title: string;
  original_key: string | null;
  preview_key: string | null;
  source_etag: string | null;
  asset_revision: number;
  approved_revision: number | null;
  vector_index_id: string | null;
  candidate_vector_status?: string | null;
  candidate_vector_indexed_at?: string | null;
  candidate_vector_version?: string | null;
  candidate_vector_id?: string | null;
  ai_metadata_suggestion_json?: string | null;
  ai_metadata_suggestion_revision?: number | null;
  ai_metadata_suggestion_etag?: string | null;
  scene_context?: string | null;
};

export type VisionMetadata = {
  description: string;
  visibleText: string;
  subjectTags: string[];
  locationType: string;
  sceneContext: string;
  primaryCategory: string;
  sceneAttributes: string[];
  detectedLanguage: string;
  textReadability: "clear" | "partial" | "unreadable" | "no_text";
  imageQuality: "readable" | "poor" | "unreadable";
  confidence: number;
  fieldConfidences: Record<string, number>;
};

export type VisionClassification = {
  metadata: VisionMetadata;
  accepted: boolean;
  issues: string[];
  validation: Record<string, unknown>;
};

const DEFAULT_VISION_MODEL = "@cf/moondream/moondream3.1-9B-A2B";
const DEFAULT_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const PHOTO_PROMPT_VERSION = "photo-enrichment-v3";
const PHOTO_SCHEMA_VERSION = "photo-metadata-v3";
// Keep enough headroom for the data URL and base64 expansion in the AI request.
const MAX_AI_IMAGE_BYTES = 8_000_000;
const DIRECT_VISION_CONTENT_TYPES = new Set(["image/jpeg", "image/png"]);
const AI_IMAGE_TRANSFORM_ATTEMPTS = [
  { width: 1600, quality: 75 },
  { width: 1200, quality: 70 },
  { width: 960, quality: 65 },
] as const;
const MAX_ATTEMPTS = 5;
const MIN_CONFIDENCE = 0.65;
const MIN_FIELD_CONFIDENCE = 0.55;
const UNSAFE_INFERENCE = /\b(ethnic|racial|tribe|tribal|religion|muslim|christian|black[ _]people|white[ _]people|colou?red[ _]people|native[ _]people|indigenous[ _]people|criminal|illegal|exotic)\b/i;

const LOCATION_TYPES = new Set([
  "urban_street", "coastal_landscape", "market_scene", "indoor", "residential",
  "rural_landscape", "industrial", "event", "transport", "nature", "sports",
  "food", "other", "unknown",
]);
const PRIMARY_CATEGORIES = new Set([
  "people", "lifestyle", "travel", "nature", "architecture", "food", "business",
  "transport", "arts_culture", "sport", "news_editorial", "objects", "other",
]);
const SCENE_ATTRIBUTES = new Set([
  "indoor", "outdoor", "daylight", "night", "sunrise_sunset", "people_present",
  "no_people", "crowd", "single_person", "group", "vehicle", "building", "landscape",
  "close_up", "wide_view", "aerial", "food_present", "text_present", "copy_space",
]);
const SCENE_CONTEXTS = new Set([
  "animal_close_up", "plant_close_up", "garden", "field", "mountain", "street", "shoreline", "indoor_object", "unknown",
]);
const SUPPORTED_TEXT_LANGUAGES = new Set(["none", "en", "af", "nr", "nso", "st", "ss", "tn", "ts", "ve", "xh", "zu"]);
const PHOTO_VISION_PROMPT = `Return JSON only using schema ${PHOTO_SCHEMA_VERSION}: {"description":"factual observable description","visibleText":"all legible text or empty","subjectTags":["observable tags"],"locationType":"urban_street|coastal_landscape|market_scene|indoor|residential|rural_landscape|industrial|event|transport|nature|sports|food|other|unknown","sceneContext":"animal_close_up|plant_close_up|garden|field|mountain|street|shoreline|indoor_object|unknown","primaryCategory":"people|lifestyle|travel|nature|architecture|food|business|transport|arts_culture|sport|news_editorial|objects|other","sceneAttributes":["indoor|outdoor|daylight|night|sunrise_sunset|people_present|no_people|crowd|single_person|group|vehicle|building|landscape|close_up|wide_view|aerial|food_present|text_present|copy_space"],"detectedLanguage":"ISO 639-1/3 code, none if no text","textReadability":"clear|partial|unreadable|no_text","imageQuality":"readable|poor|unreadable","confidence":0.0,"fieldConfidences":{"description":0.0,"visibleText":0.0,"locationType":0.0,"sceneContext":0.0,"primaryCategory":0.0,"sceneAttributes":0.0}}. Answer these visual questions in order: is it indoors; is there a road/street or dense built environment; is there a sea/shoreline; is it a wide open field or mountain landscape; is it mainly a close-up animal or plant; is it a garden/home setting; is it an indoor object. Use the most specific sceneContext. Close-up animals without a road, building, horizon, or wide landscape are animal_close_up, not rural_landscape. Close-up plants or flowers are plant_close_up. Never assert country, province, city, locality, landmark, identity, ethnicity, race, religion, culture, intent, legality, authenticity, or rights from pixels. If uncertain use unknown/other and lower confidence.`;
const PHOTO_VISION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["description", "visibleText", "subjectTags", "locationType", "sceneContext", "primaryCategory", "sceneAttributes", "detectedLanguage", "textReadability", "imageQuality", "confidence", "fieldConfidences"],
  properties: {
    description: { type: "string" }, visibleText: { type: "string" }, subjectTags: { type: "array", items: { type: "string" } },
    locationType: { type: "string", enum: [...LOCATION_TYPES] }, primaryCategory: { type: "string", enum: [...PRIMARY_CATEGORIES] },
    sceneContext: { type: "string", enum: [...SCENE_CONTEXTS] },
    sceneAttributes: { type: "array", items: { type: "string", enum: [...SCENE_ATTRIBUTES] } }, detectedLanguage: { type: "string", enum: [...SUPPORTED_TEXT_LANGUAGES] },
    textReadability: { type: "string", enum: ["clear", "partial", "unreadable", "no_text"] }, imageQuality: { type: "string", enum: ["readable", "poor", "unreadable"] },
    confidence: { type: "number", minimum: 0, maximum: 1 }, fieldConfidences: { type: "object", additionalProperties: { type: "number", minimum: 0, maximum: 1 } },
  },
} as const;

class PhotoPipelineError extends Error {
  constructor(message: string, readonly errorClass: Exclude<PhotoJobErrorClass, "validation" | "stale">) {
    super(message);
    this.name = "PhotoPipelineError";
  }
}

export type PreparedVisionImage = {
  bytes: Uint8Array | null;
  contentType: string;
  transformed: boolean;
  aiInput: string | null;
};

/**
 * Returns an AI-safe image copy without changing the licensed/original R2 object.
 * Large private R2 objects are fetched through a short-lived signed URL so
 * Cloudflare Image Resizing can decode them without buffering the original in JS.
 */
export async function preparePhotoForVision(
  env: PhotoPipelineBindings,
  sourceKey: string,
  jobId: string,
  object: R2ObjectBody,
  contentType: string,
): Promise<PreparedVisionImage> {
  if (object.size <= MAX_AI_IMAGE_BYTES && DIRECT_VISION_CONTENT_TYPES.has(contentType)) {
    return { bytes: new Uint8Array(await object.arrayBuffer()), contentType, transformed: false, aiInput: null };
  }

  const sourceUrl = await createPresignedR2Url(env, env.R2_BUCKET_NAME, sourceKey, "GET");
  if (!sourceUrl) {
    const origin = env.PHOTO_AI_SOURCE_ORIGIN?.replace(/\/$/, "");
    if (origin) {
      const internalSourceUrl = `${origin}/internal/photo-ai-source/${encodeURIComponent(jobId)}`;
      for (const options of AI_IMAGE_TRANSFORM_ATTEMPTS) {
        const response = await fetch(internalSourceUrl, {
          headers: { "x-photo-ai-job": jobId },
          cf: {
            image: {
              fit: "scale-down",
              width: options.width,
              height: options.width,
              format: "jpeg",
              quality: options.quality,
              anim: false,
              metadata: "none",
            },
          },
        });
        if (!response.ok) {
          const errorClass = response.status >= 500 ? "retryable" : "permanent";
          throw new PhotoPipelineError(`Image resizing failed with HTTP ${response.status}`, errorClass);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > 0 && bytes.byteLength <= MAX_AI_IMAGE_BYTES) {
          return { bytes, contentType: "image/jpeg", transformed: true, aiInput: null };
        }
      }
      throw new PhotoPipelineError("Image resizing did not produce an AI-safe image", "permanent");
    }
    throw new PhotoPipelineError("Image resizing is unavailable because private R2 GET signing and the AI source origin are not configured", "retryable");
  }

  let largestOutputBytes = 0;
  for (const options of AI_IMAGE_TRANSFORM_ATTEMPTS) {
    const response = await fetch(sourceUrl, {
      cf: {
        image: {
          fit: "scale-down",
          width: options.width,
          height: options.width,
          format: "jpeg",
          quality: options.quality,
          anim: false,
          metadata: "none",
        },
      },
    });
    if (!response.ok) {
      const errorClass = response.status >= 500 ? "retryable" : "permanent";
      throw new PhotoPipelineError(`Image resizing failed with HTTP ${response.status}`, errorClass);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    largestOutputBytes = Math.max(largestOutputBytes, bytes.byteLength);
    if (bytes.byteLength > 0 && bytes.byteLength <= MAX_AI_IMAGE_BYTES) {
      return { bytes, contentType: "image/jpeg", transformed: true, aiInput: null };
    }
  }

  throw new PhotoPipelineError(`Image resizing did not produce an AI-safe image (largest output ${largestOutputBytes} bytes)`, "permanent");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown, allowed?: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase().replace(/[\s-]+/g, "_"))
    .filter((item) => item.length > 1 && item.length <= 80 && !UNSAFE_INFERENCE.test(item) && (!allowed || allowed.has(item))))]
    .slice(0, 30);
}

function clampConfidence(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

export function normalizeSceneContext(metadata: Pick<VisionMetadata, "description" | "subjectTags" | "locationType" | "primaryCategory" | "sceneAttributes" | "sceneContext">): string {
  const text = [metadata.description, ...metadata.subjectTags].join(" ").toLowerCase();
  const attributes = new Set(metadata.sceneAttributes);
  const animal = /\b(cat|dog|bird|elephant|animal|mammal|fish|horse|cow|sheep|goat|insect|butterfly|beetle)\b/i.test(text);
  const plant = /\b(flower|plant|tree|leaf|leaves|blossom|crop|fruit|vegetable|corn|flowering)\b/i.test(text);
  const builtEvidence = attributes.has("vehicle") || attributes.has("building") || /\b(road|street|sidewalk|building|house|facade|urban)\b/i.test(text);
  const streetEvidence = /\b(road|street|sidewalk|avenue|lane|roadway)\b/i.test(text);
  const wideLandscape = attributes.has("wide_view") || /\b(field|farmland|mountain|valley|horizon|landscape)\b/i.test(text);
  const largeInterior = /\b(church|cathedral|interior|room|hall|pew|organ|ceiling|vaulted)\b/i.test(text);
  const displayedObject = metadata.primaryCategory === "objects" || /\b(bicycle|chair|object|signboard|displayed)\b/i.test(text);
  const outdoorEvidence = /\b(pavement|paved|sky|sunlight|grass|ground|outdoors?)\b/i.test(text);
  if (metadata.locationType === "coastal_landscape" || /\b(shoreline|shore|coast|beach|ocean|sea)\b/i.test(text)) return "shoreline";
  if (streetEvidence && !attributes.has("indoor") && !largeInterior) return "street";
  if (metadata.locationType === "indoor" && displayedObject && !largeInterior && !outdoorEvidence && !attributes.has("outdoor") && !attributes.has("landscape")) return "indoor_object";
  if (animal && attributes.has("close_up") && !builtEvidence && !wideLandscape) return "animal_close_up";
  if (plant && attributes.has("close_up") && !builtEvidence && !wideLandscape) return "plant_close_up";
  if (metadata.locationType === "residential" || /\b(garden|backyard|yard|home)\b/i.test(text)) return "garden";
  if (/\b(mountain|mountains|mountainous)\b/i.test(text)) return "mountain";
  if (metadata.locationType === "rural_landscape" && /\b(field|farmland|farm|crop|agricultural)\b/i.test(text)) return "field";
  if (animal && !builtEvidence && !wideLandscape) return "animal_close_up";
  if (plant && !builtEvidence && !wideLandscape) return "plant_close_up";
  return "unknown";
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

export async function runPhotoVision(env: PhotoPipelineBindings, model: string, image: Uint8Array, aiImage: string): Promise<unknown> {
  const provider = (env.PHOTO_VISION_PROVIDER ?? "").trim().toLowerCase();
  if (provider === "ollama" || provider === "ollama-tunnel") {
    const remote = provider === "ollama-tunnel";
    let endpoint: URL;
    try {
      endpoint = new URL(remote ? (env.REMOTE_VISION_URL?.trim() || "") : (env.LOCAL_VISION_URL?.trim() || "http://127.0.0.1:11434/api/generate"));
    } catch {
      throw new PhotoPipelineError("Vision provider endpoint is not configured", "permanent");
    }
    if (remote ? endpoint.protocol !== "https:" : endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) {
      throw new PhotoPipelineError("Vision provider endpoint is not permitted", "permanent");
    }
    const localModel = env.LOCAL_VISION_MODEL?.trim() || "moondream";
    const token = env.REMOTE_VISION_TOKEN?.trim();
    if (remote && !token) throw new PhotoPipelineError("Remote vision provider token is not configured", "retryable");
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ model: localModel, prompt: PHOTO_VISION_PROMPT, images: [base64Bytes(image)], format: PHOTO_VISION_JSON_SCHEMA, stream: false, think: false, options: { temperature: 0 } }),
        signal: AbortSignal.timeout(300_000),
      });
    } catch (error) {
      throw new PhotoPipelineError(`Local vision provider is unavailable: ${error instanceof Error ? error.message : "connection failed"}`, "retryable");
    }
    if (!response.ok) throw new PhotoPipelineError(`Local vision provider returned HTTP ${response.status}`, response.status >= 500 ? "retryable" : "permanent");
    const body = await response.json() as { response?: unknown; thinking?: unknown; message?: { content?: unknown } };
    return body.response || body.thinking || body.message?.content || body;
  }
  if (!env.AI) throw new PhotoPipelineError("AI binding is not configured for photo enrichment", "retryable");
  return env.AI.run(model, { task: "query", image: aiImage, question: PHOTO_VISION_PROMPT, reasoning: false, stream: false, temperature: 0, max_tokens: 900 });
}

function emptyVisionMetadata(): VisionMetadata {
  return {
    description: "",
    visibleText: "",
    subjectTags: [],
    locationType: "unknown",
    sceneContext: "unknown",
    primaryCategory: "other",
    sceneAttributes: [],
    detectedLanguage: "none",
    textReadability: "no_text",
    imageQuality: "unreadable",
    confidence: 0,
    fieldConfidences: {},
  };
}

function parseVisionObject(value: unknown): { metadata: VisionMetadata; malformed: boolean } {
  let parsed: Record<string, unknown>;
  try {
    if (typeof value === "string") parsed = JSON.parse(extractJson(value)) as Record<string, unknown>;
    else if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
    else return { metadata: emptyVisionMetadata(), malformed: true };
  } catch {
    return { metadata: emptyVisionMetadata(), malformed: true };
  }
  const rawLocationType = asString(parsed.locationType ?? parsed.location_type).toLowerCase().replace(/[\s-]+/g, "_");
  const rawSceneContext = asString(parsed.sceneContext ?? parsed.scene_context).toLowerCase().replace(/[\s-]+/g, "_");
  const rawCategory = asString(parsed.primaryCategory ?? parsed.primary_category).toLowerCase().replace(/[\s-]+/g, "_");
  const rawReadability = asString(parsed.textReadability ?? parsed.text_readability).toLowerCase();
  const rawImageQuality = asString(parsed.imageQuality ?? parsed.image_quality).toLowerCase();
  const confidenceSource = parsed.fieldConfidences ?? parsed.field_confidences;
  const confidenceRecord = confidenceSource && typeof confidenceSource === "object" && !Array.isArray(confidenceSource)
    ? confidenceSource as Record<string, unknown>
    : {};
  const fieldConfidences = Object.fromEntries(Object.entries(confidenceRecord).map(([key, confidence]) => [key, clampConfidence(confidence)]));
  const metadata: VisionMetadata = {
    description: asString(parsed.description).slice(0, 1200),
    visibleText: asString(parsed.visibleText ?? parsed.visible_text ?? parsed.ocrText).slice(0, 2000),
    subjectTags: asStringArray(parsed.subjectTags ?? parsed.subject_tags ?? parsed.tags).map((tag) => tag.replaceAll("_", " ")),
    locationType: LOCATION_TYPES.has(rawLocationType) ? rawLocationType : "unknown",
    sceneContext: SCENE_CONTEXTS.has(rawSceneContext) ? rawSceneContext : "unknown",
    primaryCategory: PRIMARY_CATEGORIES.has(rawCategory) ? rawCategory : "other",
    sceneAttributes: asStringArray(parsed.sceneAttributes ?? parsed.scene_attributes, SCENE_ATTRIBUTES),
    detectedLanguage: asString(parsed.detectedLanguage ?? parsed.detected_language).toLowerCase().slice(0, 12) || "none",
    textReadability: ["clear", "partial", "unreadable", "no_text"].includes(rawReadability) ? rawReadability as VisionMetadata["textReadability"] : "no_text",
    imageQuality: ["readable", "poor", "unreadable"].includes(rawImageQuality) ? rawImageQuality as VisionMetadata["imageQuality"] : "unreadable",
    confidence: clampConfidence(parsed.confidence),
    fieldConfidences,
  };
  metadata.sceneContext = normalizeSceneContext(metadata);
  return { malformed: false, metadata };
}

function unwrapVisionResult(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (typeof value === "string") return value.trim();
  if (typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const metadataKeys = ["description", "visibleText", "visible_text", "subjectTags", "subject_tags", "locationType", "location_type", "sceneContext", "scene_context", "primaryCategory", "primary_category"];
  if (metadataKeys.some((key) => key in record)) return record;
  for (const key of ["answer", "response", "output", "result", "data"]) {
    if (record[key] !== undefined && record[key] !== null) {
      const nested = unwrapVisionResult(record[key], depth + 1);
      if (nested !== "") return nested;
    }
  }
  return record;
}

export function normalizeVisionResult(value: unknown): unknown {
  return unwrapVisionResult(value);
}

export function classifyVisionResult(value: unknown): VisionClassification {
  const { metadata, malformed } = parseVisionObject(normalizeVisionResult(value));
  const issues: string[] = [];
  if (malformed) issues.push("malformed_json");
  if (metadata.description.length < 12) issues.push("missing_description");
  if (metadata.locationType === "unknown") issues.push("missing_location_type");
  if (metadata.sceneContext === "unknown") issues.push("missing_scene_context");
  if (!metadata.primaryCategory || metadata.primaryCategory === "other") issues.push("missing_primary_category");
  if (metadata.confidence < MIN_CONFIDENCE) issues.push("low_confidence");
  const requiredConfidenceKeys = ["description", "locationType", "sceneContext", "primaryCategory"];
  if (requiredConfidenceKeys.some((key) => (metadata.fieldConfidences[key] ?? 0) < MIN_FIELD_CONFIDENCE)) issues.push("low_field_confidence");
  if (metadata.imageQuality === "unreadable") issues.push("unreadable_image");
  if (metadata.visibleText && (!SUPPORTED_TEXT_LANGUAGES.has(metadata.detectedLanguage) || metadata.detectedLanguage === "none")) issues.push("unsupported_language");
  if (metadata.visibleText && metadata.textReadability === "unreadable") issues.push("unreadable_text");
  return {
    metadata,
    accepted: issues.length === 0,
    issues: [...new Set(issues)],
    validation: {
      accepted: issues.length === 0,
      issues: [...new Set(issues)],
      minimumConfidence: MIN_CONFIDENCE,
      minimumFieldConfidence: MIN_FIELD_CONFIDENCE,
      requiresHumanReview: true,
      geographicLocationInferred: false,
    },
  };
}

export function parseVisionMetadata(value: unknown): VisionMetadata {
  return classifyVisionResult(value).metadata;
}

export function mergeAiMetadataFallback(
  current: { description?: string | null; caption?: string | null; subjectTags?: string[] },
  metadata: VisionMetadata,
): { description: string; caption: string; subjectTags: string[] } {
  return {
    description: String(current.description ?? "").trim() || metadata.description,
    caption: String(current.caption ?? "").trim() || metadata.description,
    subjectTags: [...new Set([...(current.subjectTags ?? []), ...metadata.subjectTags])].slice(0, 50),
  };
}

function jsonList(row: Record<string, unknown>, key: string): string[] {
  try {
    const parsed = JSON.parse(String(row[key] ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export function buildPhotoSearchDocument(row: Record<string, unknown>): string {
  const location = [row.country, row.province, row.city, row.locality, row.landmark].filter(Boolean).join(", ");
  return [
    `Title: ${asString(row.title)}`,
    `Description: ${asString(row.description)}`,
    `Caption: ${asString(row.caption)}`,
    `Evidence-backed geographic location: ${location}`,
    `Visible location type: ${asString(row.visual_location_type).replaceAll("_", " ")}`,
    `Primary category: ${asString(row.primary_category).replaceAll("_", " ")}`,
    `Scene attributes: ${jsonList(row, "scene_attributes").join(", ")}`,
    `Subject tags: ${jsonList(row, "subject_tags").join(", ")}`,
    `AI visual tags: ${jsonList(row, "ai_tags").join(", ")}`,
    `Visible text in image: ${asString(row.ocr_text)}`,
    `Contributor context: ${jsonList(row, "cultural_tags").join(", ")}`,
  ].filter((line) => !line.endsWith(": ")).join("\n").slice(0, 7000);
}

function searchTokens(value: string): string[] {
  return [...new Set(value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((token) => token.length > 1)
    .slice(0, 20);
}

export function mergeHybridSearchRows(
  semanticRows: Record<string, unknown>[],
  keywordRows: Record<string, unknown>[],
  query: string,
  semanticScores: Map<string, number>,
): Record<string, unknown>[] {
  return archiveDomain.rankHybridSearchRows(semanticRows, keywordRows, query, semanticScores);
}

export function photoJobMatchesAsset(
  job: Pick<PhotoEnrichmentJob, "assetRevision" | "sourceEtag">,
  asset: Pick<AssetRow, "asset_revision" | "source_etag"> | Record<string, unknown>,
): boolean {
  return Number(asset.asset_revision) === job.assetRevision && String(asset.source_etag ?? "") === String(job.sourceEtag ?? "");
}

function vectorAssetId(vectorId: string): string {
  const revisionMarker = vectorId.lastIndexOf("::r");
  return revisionMarker > 0 ? vectorId.slice(0, revisionMarker) : vectorId;
}

function revisionDocumentId(assetId: string, revision: number): string {
  return `${assetId}::r${revision}`;
}

function candidateRevisionDocumentId(assetId: string, revision: number): string {
  return `candidate::${assetId}::r${revision}`;
}

export async function enqueuePhotoJob(
  env: PhotoPipelineBindings,
  assetId: string,
  operation: PhotoJobOperation,
): Promise<string> {
  if (!env.PHOTO_ENRICHMENT_QUEUE) throw new Error("PHOTO_ENRICHMENT_QUEUE binding is not configured");
  const asset = await env.DB.prepare("SELECT asset_revision, source_etag FROM assets WHERE id = ?")
    .bind(assetId).first<{ asset_revision: number; source_etag: string | null }>();
  if (!asset) throw new Error("Photo asset was not found");

  // Enrichment is an upload-time decision. A later correction, approval, or
  // admin replay must never create a second AI revision for the same source
  // media revision. Queue recovery may resend this same job id, but it must
  // not reset or replace the persisted job.
  if (operation === "enrich") {
    const existing = await env.DB.prepare(`
      SELECT id FROM photo_ai_jobs
      WHERE asset_id = ? AND operation = 'enrich' AND asset_revision = ?
    `).bind(assetId, asset.asset_revision).first<{ id: string }>();
    if (existing) return existing.id;
  }

  const jobId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO photo_ai_jobs (
      id, asset_id, operation, status, asset_revision, source_etag,
      prompt_version, schema_version, attempts, requested_at, updated_at
    ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(asset_id, operation, asset_revision) DO UPDATE SET
      status = 'queued', source_etag = excluded.source_etag, attempts = 0,
      error_class = NULL, last_error = NULL, next_attempt_at = NULL,
      dead_lettered_at = NULL, requested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  `).bind(jobId, assetId, operation, asset.asset_revision, asset.source_etag, PHOTO_PROMPT_VERSION, PHOTO_SCHEMA_VERSION).run();
  if (operation === "sync_index") {
    await env.DB.prepare(`UPDATE assets SET
      vector_index_status = CASE WHEN status = 'published' THEN 'pending' ELSE 'not_indexed' END,
      candidate_vector_status = CASE WHEN status = 'published' THEN candidate_vector_status ELSE 'pending' END,
      index_terminal_reason = CASE WHEN status = 'published' THEN NULL ELSE status END,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(assetId).run();
  }
  const row = await env.DB.prepare("SELECT id FROM photo_ai_jobs WHERE asset_id = ? AND operation = ? AND asset_revision = ?")
    .bind(assetId, operation, asset.asset_revision).first<{ id: string }>();
  const persistedJobId = row?.id ?? jobId;
  await env.PHOTO_ENRICHMENT_QUEUE.send({
    type: "photo.enrich",
    jobId: persistedJobId,
    assetId,
    operation,
    assetRevision: asset.asset_revision,
    sourceEtag: asset.source_etag,
  });
  return persistedJobId;
}

export async function replayPhotoJob(env: PhotoPipelineBindings, jobId: string): Promise<string | null> {
  const job = await env.DB.prepare("SELECT id, asset_id, operation, asset_revision, source_etag FROM photo_ai_jobs WHERE id = ?")
    .bind(jobId).first<{ id: string; asset_id: string; operation: PhotoJobOperation; asset_revision: number; source_etag: string | null }>();
  if (!job || !env.PHOTO_ENRICHMENT_QUEUE) return null;
  if (job.operation === "enrich") return null;
  const asset = await env.DB.prepare("SELECT asset_revision, source_etag FROM assets WHERE id = ?")
    .bind(job.asset_id).first<{ asset_revision: number; source_etag: string | null }>();
  if (!asset) return null;
  if (asset.asset_revision !== job.asset_revision || String(asset.source_etag ?? "") !== String(job.source_etag ?? "")) {
    return enqueuePhotoJob(env, job.asset_id, job.operation);
  }
  await env.DB.prepare(`UPDATE photo_ai_jobs SET status = 'queued', attempts = 0, error_class = NULL, last_error = NULL,
    next_attempt_at = NULL, dead_lettered_at = NULL, requested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(job.id).run();
  await env.PHOTO_ENRICHMENT_QUEUE.send({ type: "photo.enrich", jobId: job.id, assetId: job.asset_id, operation: job.operation, assetRevision: job.asset_revision, sourceEtag: job.source_etag });
  return job.id;
}

function cachedVisionMetadata(asset: AssetRow, job: PhotoEnrichmentJob): VisionMetadata | null {
  if (Number(asset.ai_metadata_suggestion_revision ?? 0) !== job.assetRevision
    || String(asset.ai_metadata_suggestion_etag ?? "") !== String(job.sourceEtag ?? "")) return null;
  try {
    const value = JSON.parse(String(asset.ai_metadata_suggestion_json ?? "{}"));
    if (!value || typeof value !== "object" || Array.isArray(value) || !("description" in value)) return null;
    return classifyVisionResult(value).metadata;
  } catch {
    return null;
  }
}

export async function requeuePhotoEnrichment(env: PhotoPipelineBindings, jobId: string): Promise<string | null> {
  if (!env.PHOTO_ENRICHMENT_QUEUE) return null;
  const job = await env.DB.prepare(`SELECT id, asset_id, operation, status, asset_revision, source_etag
    FROM photo_ai_jobs WHERE id = ?`).bind(jobId)
    .first<{ id: string; asset_id: string; operation: PhotoJobOperation; status: string; asset_revision: number; source_etag: string | null }>();
  if (!job || job.operation !== "enrich" || !["completed", "needs_review", "failed", "dead_lettered", "skipped"].includes(job.status)) return null;
  const asset = await env.DB.prepare(`SELECT kind, status, asset_revision, source_etag FROM assets WHERE id = ?`)
    .bind(job.asset_id).first<{ kind: string; status: string; asset_revision: number; source_etag: string | null }>();
  if (!asset || asset.kind !== "image" || asset.status === "published" || !photoJobMatchesAsset({ assetRevision: job.asset_revision, sourceEtag: job.source_etag }, asset)) return null;
  await env.DB.prepare(`UPDATE photo_ai_jobs SET status = 'queued', attempts = 0, error_class = NULL,
    last_error = NULL, next_attempt_at = NULL, dead_lettered_at = NULL, requested_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(job.id).run();
  await env.PHOTO_ENRICHMENT_QUEUE.send({
    type: "photo.enrich", jobId: job.id, assetId: job.asset_id, operation: "enrich",
    assetRevision: job.asset_revision, sourceEtag: job.source_etag,
  });
  return job.id;
}

export async function retryQueuedPhotoJobs(env: PhotoPipelineBindings): Promise<number> {
  if (!env.PHOTO_ENRICHMENT_QUEUE) return 0;
  await env.DB.batch([
    env.DB.prepare(`UPDATE photo_ai_jobs SET status = 'failed', error_class = 'retryable', last_error = 'running-timeout',
      next_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE status = 'running' AND updated_at < datetime('now', '-10 minutes') AND attempts < ?`).bind(MAX_ATTEMPTS),
    env.DB.prepare(`UPDATE photo_ai_jobs SET status = 'dead_lettered', dead_lettered_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE status IN ('running', 'failed') AND attempts >= ?`).bind(MAX_ATTEMPTS),
  ]);
  const result = await env.DB.prepare(`
    SELECT id, asset_id, operation, asset_revision, source_etag FROM photo_ai_jobs
    WHERE (status = 'queued' OR (status = 'failed' AND error_class = 'retryable'))
      AND attempts < ? AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
    ORDER BY requested_at ASC LIMIT 50
  `).bind(MAX_ATTEMPTS).all<{ id: string; asset_id: string; operation: PhotoJobOperation; asset_revision: number; source_etag: string | null }>();
  if (!result.results.length) return 0;
  await env.PHOTO_ENRICHMENT_QUEUE.sendBatch(result.results.map((job) => ({
    body: { type: "photo.enrich" as const, jobId: job.id, assetId: job.asset_id, operation: job.operation, assetRevision: job.asset_revision, sourceEtag: job.source_etag },
  })));
  return result.results.length;
}

export async function repairPendingPhotoPipeline(
  env: PhotoPipelineBindings,
  limit = 40,
): Promise<{ queued: number; recovered: number; stale: number; resolvedReviews: number }> {
  if (!env.PHOTO_ENRICHMENT_QUEUE) return { queued: 0, recovered: 0, stale: 0, resolvedReviews: 0 };

  // Preserve historical failure/validation evidence in provenance while
  // removing records that no longer require an operational response.
  const staleResult = await env.DB.prepare(`UPDATE photo_ai_jobs SET status = 'skipped', error_class = 'stale',
    last_error = 'superseded-by-newer-asset-revision', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'dead_lettered' AND EXISTS (
      SELECT 1 FROM assets a WHERE a.id = photo_ai_jobs.asset_id
        AND (a.asset_revision <> photo_ai_jobs.asset_revision
          OR COALESCE(a.source_etag, '') <> COALESCE(photo_ai_jobs.source_etag, ''))
    )`).run();
  const resolvedReviewResult = await env.DB.prepare(`UPDATE photo_ai_jobs SET status = 'completed',
    error_class = NULL, last_error = NULL, completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
    updated_at = CURRENT_TIMESTAMP
    WHERE operation = 'enrich' AND status = 'needs_review' AND EXISTS (
      SELECT 1 FROM assets a WHERE a.id = photo_ai_jobs.asset_id
        AND a.metadata_review_status = 'reviewed'
        AND COALESCE(a.reviewed_revision, 0) >= photo_ai_jobs.asset_revision
    )`).run();

  // Older pipeline versions used the public vector status for review assets.
  // Move those records into the private candidate namespace before queueing.
  await env.DB.prepare(`UPDATE assets SET candidate_vector_status = 'pending', vector_index_status = 'not_indexed',
    index_terminal_reason = status, updated_at = CURRENT_TIMESTAMP
    WHERE kind = 'image' AND status <> 'published' AND vector_index_status = 'pending'
      AND COALESCE(candidate_vector_status, 'not_indexed') <> 'indexed'`).run();

  const pending = await env.DB.prepare(`SELECT a.id FROM assets a
    WHERE a.kind = 'image'
      AND ((a.status = 'published' AND a.vector_index_status = 'pending' AND a.approved_revision = a.asset_revision)
        OR (a.status <> 'published' AND a.candidate_vector_status = 'pending'))
      AND NOT EXISTS (
        SELECT 1 FROM photo_ai_jobs j
        WHERE j.asset_id = a.id AND j.operation = 'sync_index' AND j.asset_revision = a.asset_revision
          AND (j.status IN ('queued', 'running') OR (j.status = 'failed' AND j.error_class = 'retryable' AND j.attempts < ?))
      )
    ORDER BY a.updated_at ASC LIMIT ?`).bind(MAX_ATTEMPTS, Math.max(1, Math.min(limit, 50)))
    .all<{ id: string }>();

  let queued = 0;
  for (const asset of pending.results) {
    await enqueuePhotoJob(env, asset.id, "sync_index");
    queued += 1;
  }

  const legacyFailures = await env.DB.prepare(`SELECT j.id FROM photo_ai_jobs j
    JOIN assets a ON a.id = j.asset_id
    WHERE j.operation = 'enrich' AND j.status = 'dead_lettered' AND a.kind = 'image' AND a.status <> 'published'
      AND a.asset_revision = j.asset_revision AND COALESCE(a.source_etag, '') = COALESCE(j.source_etag, '')
      AND (j.last_error LIKE '%size limit%' OR j.last_error LIKE '%Image resizing%')
    ORDER BY j.updated_at ASC LIMIT 10`).all<{ id: string }>();
  let recovered = 0;
  for (const job of legacyFailures.results) {
    if (await requeuePhotoEnrichment(env, job.id)) recovered += 1;
  }
  return {
    queued,
    recovered,
    stale: Number(staleResult.meta.changes ?? 0),
    resolvedReviews: Number(resolvedReviewResult.meta.changes ?? 0),
  };
}

async function markJob(env: PhotoPipelineBindings, jobId: string, status: string, options: { error?: string; errorClass?: PhotoJobErrorClass; vectorId?: string; nextAttemptMinutes?: number } = {}): Promise<void> {
  await env.DB.prepare(`
    UPDATE photo_ai_jobs SET status = ?, error_class = ?, last_error = ?, vector_id = COALESCE(?, vector_id),
      completed_at = CASE WHEN ? IN ('completed', 'needs_review', 'dead_lettered', 'skipped') THEN CURRENT_TIMESTAMP ELSE completed_at END,
      dead_lettered_at = CASE WHEN ? = 'dead_lettered' THEN CURRENT_TIMESTAMP ELSE dead_lettered_at END,
      next_attempt_at = CASE WHEN ? IS NOT NULL THEN datetime('now', '+' || ? || ' minutes') ELSE NULL END,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(status, options.errorClass ?? null, options.error ?? null, options.vectorId ?? null, status, status, options.nextAttemptMinutes ?? null, options.nextAttemptMinutes ?? null, jobId).run();
}

async function getAsset(env: PhotoPipelineBindings, assetId: string): Promise<AssetRow | null> {
  return env.DB.prepare("SELECT * FROM assets WHERE id = ?").bind(assetId).first<AssetRow>();
}

async function recordProvenance(
  env: PhotoPipelineBindings,
  job: PhotoEnrichmentJob,
  attempt: number,
  outcome: string,
  options: { model?: string; errorClass?: PhotoJobErrorClass; result?: unknown; validation?: unknown; actorId?: string } = {},
): Promise<void> {
  await env.DB.prepare(`INSERT INTO photo_ai_provenance (
    id, job_id, asset_id, operation, asset_revision, source_etag, model, prompt_version,
    schema_version, attempt, actor_id, outcome, error_class, result_json, validation_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      crypto.randomUUID(), job.jobId, job.assetId, job.operation, job.assetRevision, job.sourceEtag,
      options.model ?? null, PHOTO_PROMPT_VERSION, PHOTO_SCHEMA_VERSION, attempt,
      options.actorId ?? "photo-pipeline", outcome, options.errorClass ?? null,
      JSON.stringify(options.result ?? {}), JSON.stringify(options.validation ?? {}),
    ).run();
}

async function markStale(env: PhotoPipelineBindings, job: PhotoEnrichmentJob, attempt: number, reason: string): Promise<void> {
  await markJob(env, job.jobId, "skipped", { error: reason, errorClass: "stale" });
  await recordProvenance(env, job, attempt, "stale", { errorClass: "stale", validation: { reason } });
}

async function enrichPhoto(env: PhotoPipelineBindings, job: PhotoEnrichmentJob, trace: TraceContext, attempt: number): Promise<void> {
  const asset = await getAsset(env, job.assetId);
  if (!asset) {
    await markJob(env, job.jobId, "skipped", { error: "asset-not-found", errorClass: "permanent" });
    return;
  }
  if (!photoJobMatchesAsset(job, asset)) {
    await markStale(env, job, attempt, "asset-revision-or-source-changed");
    return;
  }
  // Vision enrichment must inspect the private original. Generated watermarked
  // WebP previews are delivery artifacts and can be unreadable to some vision
  // models; they remain the correct source for browser previews only.
  const sourceKey = asset.original_key || asset.preview_key;
  if (asset.kind !== "image" || !sourceKey) {
    await markJob(env, job.jobId, "skipped", { error: "not-an-indexable-image", errorClass: "permanent" });
    return;
  }
  const cached = cachedVisionMetadata(asset, job);
  let preparedImage: PreparedVisionImage = { bytes: null, contentType: "image/jpeg", transformed: false, aiInput: null };
  let image: Uint8Array | null = null;
  const visionProvider = (env.PHOTO_VISION_PROVIDER ?? "").trim().toLowerCase();
  const localVision = visionProvider === "ollama" || visionProvider === "ollama-tunnel";
  const model = localVision ? `ollama:${env.LOCAL_VISION_MODEL?.trim() || "moondream"}` : (env.PHOTO_VISION_MODEL ?? DEFAULT_VISION_MODEL);
  let vision: unknown = cached;
  let classified: VisionClassification;
  if (cached) {
    classified = classifyVisionResult(cached);
  } else {
    if (!localVision && !env.AI) throw new PhotoPipelineError("AI binding is not configured for photo enrichment", "retryable");
    const object = await env.MEDIA_BUCKET.get(sourceKey);
    if (!object) throw new PhotoPipelineError("Photo object was not found in R2", "retryable");
    const contentType = object.httpMetadata?.contentType?.toLowerCase() ?? "image/jpeg";
    if (!contentType.startsWith("image/")) throw new PhotoPipelineError("Photo object is not an image", "permanent");
    preparedImage = await preparePhotoForVision(env, sourceKey, job.jobId, object, contentType);
    image = preparedImage.bytes;
    const aiImage = preparedImage.aiInput ?? `data:${preparedImage.contentType};base64,${base64Bytes(image ?? new Uint8Array())}`;
    vision = await runPhotoVision(env, model, image ?? new Uint8Array(), aiImage);
    classified = classifyVisionResult(vision);
    // This is the durable AI checkpoint. It intentionally happens before the
    // final metadata event/job update so retries never spend another token on
    // a response that was already received from the model.
    await env.DB.prepare(`UPDATE assets SET ai_metadata_suggestion_json = ?, ai_metadata_suggestion_revision = ?, ai_metadata_suggestion_etag = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND asset_revision = ? AND COALESCE(source_etag, '') = COALESCE(?, '') AND status <> 'published'`)
      .bind(JSON.stringify(classified.metadata), job.assetRevision, job.sourceEtag, asset.id, job.assetRevision, job.sourceEtag).run();
  }
  const metadata = classified.metadata;
  const current = await getAsset(env, job.assetId);
  if (!current || !photoJobMatchesAsset(job, current) || current.status === "published") {
    await markStale(env, job, attempt, "asset-changed-during-enrichment");
    return;
  }
  const currentSubjectTags = jsonList(current, "subject_tags");
  const fallback = mergeAiMetadataFallback({ description: asString(current.description), caption: asString(current.caption), subjectTags: currentSubjectTags }, metadata);
  const reviewNote = classified.accepted
    ? "AI description, visual location type, category, attributes, and visible text require seller/editor confirmation before publication. Geographic location was not inferred from pixels."
    : `AI enrichment needs review before use: ${classified.issues.join(", ")}. Geographic location was not inferred from pixels.`;
  const result = await env.DB.prepare(`
    UPDATE assets SET
      description = CASE WHEN trim(description) = '' THEN ? ELSE description END,
      caption = CASE WHEN trim(caption) = '' THEN ? ELSE caption END,
      subject_tags = CASE WHEN ? = 1 THEN ? ELSE subject_tags END,
      ai_tags = ?, ai_metadata_suggestion_json = ?, ocr_text = ?, visual_location_type = ?, scene_context = ?, primary_category = ?, scene_attributes = ?,
      detected_language = ?, text_readability = ?, ocr_confidence = ?, ai_field_confidences = ?,
      enrichment_validation_json = ?, ai_confidence = ?, enriched_revision = ?,
      metadata_review_status = 'needs_context', metadata_review_note = ?, metadata_provenance = 'ai_suggested',
      status = 'needs_review', workflow_stage = 'curator_correction', updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND asset_revision = ? AND COALESCE(source_etag, '') = COALESCE(?, '') AND status <> 'published'
  `).bind(
    fallback.description, fallback.caption,
    metadata.subjectTags.length > 0 ? 1 : 0, JSON.stringify(fallback.subjectTags),
    JSON.stringify(metadata.subjectTags), JSON.stringify(metadata), metadata.visibleText, metadata.locationType, metadata.sceneContext, metadata.primaryCategory,
    JSON.stringify(metadata.sceneAttributes), metadata.detectedLanguage, metadata.textReadability,
    metadata.fieldConfidences.visibleText ?? null, JSON.stringify(metadata.fieldConfidences),
    JSON.stringify(classified.validation), metadata.confidence, job.assetRevision, reviewNote,
    asset.id, job.assetRevision, job.sourceEtag,
  ).run();
  if (result.meta.changes === 0) {
    await markStale(env, job, attempt, "conditional-enrichment-write-was-stale");
    return;
  }
  await env.DB.prepare("INSERT INTO metadata_events (id, asset_id, actor_id, event_type, payload) VALUES (?, ?, ?, 'ai_tagged', ?)")
    .bind(crypto.randomUUID(), asset.id, asset.owner_id, JSON.stringify({ source: "photo-enrichment", model, promptVersion: PHOTO_PROMPT_VERSION, schemaVersion: PHOTO_SCHEMA_VERSION, assetRevision: job.assetRevision, accepted: classified.accepted, issues: classified.issues, geographicLocationInferred: false, imageTransformedForAi: preparedImage.transformed })).run();
  await markJob(env, job.jobId, classified.accepted ? "completed" : "needs_review", classified.accepted ? {} : { error: classified.issues.join(","), errorClass: "validation" });
  await recordProvenance(env, job, attempt, classified.accepted ? "completed" : "needs_review", { model, errorClass: classified.accepted ? undefined : "validation", result: metadata, validation: { ...classified.validation, imageInput: { transformed: preparedImage.transformed, mode: preparedImage.aiInput ? "public-url" : "data-uri", bytes: image?.byteLength ?? null }, modelResponse: normalizeVisionResult(vision) } });
  if (env.PHOTO_ENRICHMENT_QUEUE && (metadata.description || metadata.subjectTags.length || metadata.visibleText || metadata.sceneAttributes.length)) {
    try {
      await env.DB.prepare("UPDATE assets SET candidate_vector_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND asset_revision = ? AND status <> 'published'")
        .bind(asset.id, job.assetRevision).run();
      await enqueuePhotoJob(env, asset.id, "sync_index");
    } catch (error) {
      await env.DB.prepare("UPDATE assets SET candidate_vector_status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND asset_revision = ?")
        .bind(asset.id, job.assetRevision).run();
      logEvent("warn", "photo.candidate_vector_enqueue_failed", trace, { assetId: asset.id, jobId: job.jobId, error: error instanceof Error ? error.message : "unknown-error" });
    }
  }
  recordMetric(env, "photo_ai_enrichment_completed", trace, 1, [classified.accepted ? "accepted" : "needs-review", metadata.visibleText ? "ocr-hit" : "ocr-empty", preparedImage.transformed ? "resized" : "original"]);
  logEvent("info", "photo.ai_enrichment.completed", trace, { assetId: asset.id, jobId: job.jobId, revision: job.assetRevision, accepted: classified.accepted, issueCount: classified.issues.length, imageTransformedForAi: preparedImage.transformed, imageInputMode: preparedImage.aiInput ? "public-url" : "data-uri", imageBytes: image?.byteLength ?? null });
}

async function deleteAssetSearchDocuments(env: PhotoPipelineBindings, asset: AssetRow): Promise<void> {
  await env.DB.prepare("DELETE FROM asset_search_fts WHERE asset_id = ?").bind(asset.id).run();
  const vectorRows = await env.DB.prepare("SELECT DISTINCT vector_id FROM photo_ai_jobs WHERE asset_id = ? AND vector_id IS NOT NULL")
    .bind(asset.id).all<{ vector_id: string }>();
  const vectorIds = [...new Set([asset.vector_index_id, ...vectorRows.results.map((row) => row.vector_id)].filter((value): value is string => Boolean(value)))];
  if (env.PHOTO_INDEX && vectorIds.length) await env.PHOTO_INDEX.deleteByIds(vectorIds.slice(0, 1000));
  await env.DB.prepare(`UPDATE assets SET vector_index_status = 'not_indexed', vector_indexed_at = NULL,
    vector_index_id = NULL, indexed_revision = NULL, candidate_vector_status = 'not_indexed',
    candidate_vector_indexed_at = NULL, candidate_vector_id = NULL, index_terminal_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(asset.status, asset.id).run();
}

async function syncCandidatePhotoIndex(env: PhotoPipelineBindings, job: PhotoEnrichmentJob, trace: TraceContext, attempt: number): Promise<void> {
  const asset = await getAsset(env, job.assetId);
  if (!asset) {
    await markJob(env, job.jobId, "skipped", { error: "asset-not-found", errorClass: "permanent" });
    return;
  }
  if (asset.status === "published" || asset.kind !== "image") {
    await markJob(env, job.jobId, "skipped", { error: "candidate-index-requires-unpublished-image", errorClass: "permanent" });
    return;
  }
  if (!photoJobMatchesAsset(job, asset) || asset.candidate_vector_status !== "pending") {
    await markStale(env, job, attempt, "candidate-index-is-not-current");
    return;
  }
  if (!env.PHOTO_INDEX) throw new PhotoPipelineError("PHOTO_INDEX binding is not configured", "retryable");
  if (!env.AI) throw new PhotoPipelineError("AI binding is not configured for candidate photo indexing", "retryable");
  const embeddingModel = env.PHOTO_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  const embeddingResult = await env.AI.run(embeddingModel, { text: buildPhotoSearchDocument(asset), pooling: "cls" }) as { data?: number[][] };
  const vector = embeddingResult.data?.[0];
  if (!vector?.length) throw new PhotoPipelineError("Embedding model returned no candidate vector", "retryable");
  const current = await getAsset(env, asset.id);
  if (!current || !photoJobMatchesAsset(job, current) || current.status === "published" || current.candidate_vector_status !== "pending") {
    await markStale(env, job, attempt, "candidate-asset-changed-during-indexing");
    return;
  }
  const namespace = env.PHOTO_CANDIDATE_INDEX_NAMESPACE?.trim() || "review-photos-v1";
  const vectorId = candidateRevisionDocumentId(asset.id, job.assetRevision);
  await env.PHOTO_INDEX.upsert([{ id: vectorId, values: vector, namespace, metadata: {
    assetId: asset.id, revision: job.assetRevision, status: asset.status, kind: asset.kind,
    candidate: true, locationType: asString(asset.visual_location_type), category: asString(asset.primary_category),
  } }]);
  const indexed = await env.DB.prepare(`UPDATE assets SET candidate_vector_status = 'indexed', candidate_vector_indexed_at = CURRENT_TIMESTAMP,
    candidate_vector_version = ?, candidate_vector_id = ?, vector_index_status = 'not_indexed', vector_indexed_at = NULL,
    vector_index_version = NULL, vector_index_id = NULL, indexed_revision = NULL, index_terminal_reason = status,
    updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND asset_revision = ? AND status <> 'published' AND candidate_vector_status = 'pending'`)
    .bind(embeddingModel, vectorId, asset.id, job.assetRevision).run();
  if (indexed.meta.changes === 0) {
    await env.PHOTO_INDEX.deleteByIds([vectorId]);
    await markStale(env, job, attempt, "conditional-candidate-index-write-was-stale");
    return;
  }
  if (asset.vector_index_id && asset.vector_index_id !== vectorId) await env.PHOTO_INDEX.deleteByIds([asset.vector_index_id]);
  await markJob(env, job.jobId, "completed", { vectorId });
  await recordProvenance(env, job, attempt, "indexed", { model: embeddingModel, actorId: "photo-indexer", result: { vectorId, namespace, dimensions: vector.length, scope: "candidate" } });
  recordMetric(env, "photo_candidate_vector_indexed", trace, 1, [asset.id]);
  logEvent("info", "photo.candidate_vector_indexed", trace, { assetId: asset.id, jobId: job.jobId, revision: job.assetRevision, dimensions: vector.length });
}

async function syncFtsDocument(env: PhotoPipelineBindings, asset: AssetRow, revision: number): Promise<string> {
  const documentId = revisionDocumentId(asset.id, revision);
  await env.DB.prepare("DELETE FROM asset_search_fts WHERE document_id = ?").bind(documentId).run();
  await env.DB.prepare(`INSERT INTO asset_search_fts (
    document_id, asset_id, revision, title, description, caption, subject_tags, context_tags,
    visible_text, location_type, category, scene_attributes, geographic_context
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      documentId, asset.id, revision, asset.title, asString(asset.description), asString(asset.caption),
      jsonList(asset, "subject_tags").join(" "), jsonList(asset, "cultural_tags").join(" "),
      asString(asset.ocr_text), asString(asset.visual_location_type).replaceAll("_", " "),
      asString(asset.primary_category).replaceAll("_", " "), jsonList(asset, "scene_attributes").join(" "),
      [asset.country, asset.province, asset.city, asset.locality, asset.landmark].filter(Boolean).join(" "),
    ).run();
  return documentId;
}

async function syncPhotoIndex(env: PhotoPipelineBindings, job: PhotoEnrichmentJob, trace: TraceContext, attempt: number): Promise<void> {
  const asset = await getAsset(env, job.assetId);
  if (!asset) {
    await markJob(env, job.jobId, "skipped", { error: "asset-not-found", errorClass: "permanent" });
    return;
  }
  if (asset.status !== "published" || asset.kind !== "image") {
    if (asset.kind === "image" && asset.status !== "published" && asset.candidate_vector_status === "pending") {
      await syncCandidatePhotoIndex(env, job, trace, attempt);
      return;
    }
    await deleteAssetSearchDocuments(env, asset);
    await markJob(env, job.jobId, "completed");
    await recordProvenance(env, job, attempt, "deleted", { actorId: "photo-indexer", validation: { reason: asset.status } });
    return;
  }
  if (!photoJobMatchesAsset(job, asset) || Number(asset.approved_revision) !== job.assetRevision) {
    await markStale(env, job, attempt, "only-the-current-approved-revision-can-be-indexed");
    return;
  }
  const ftsDocumentId = await syncFtsDocument(env, asset, job.assetRevision);
  if (!env.PHOTO_INDEX) throw new PhotoPipelineError("PHOTO_INDEX binding is not configured", "retryable");
  if (!env.AI) throw new PhotoPipelineError("AI binding is not configured for photo indexing", "retryable");
  const document = buildPhotoSearchDocument(asset);
  const embeddingModel = env.PHOTO_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  const embeddingResult = await env.AI.run(embeddingModel, { text: document, pooling: "cls" }) as { data?: number[][] };
  const vector = embeddingResult.data?.[0];
  if (!vector?.length) throw new PhotoPipelineError("Embedding model returned no vector", "retryable");
  const current = await getAsset(env, asset.id);
  if (!current || !photoJobMatchesAsset(job, current) || current.status !== "published" || Number(current.approved_revision) !== job.assetRevision) {
    await env.DB.prepare("DELETE FROM asset_search_fts WHERE document_id = ?").bind(ftsDocumentId).run();
    await markStale(env, job, attempt, "asset-changed-during-indexing");
    return;
  }
  const namespace = env.PHOTO_INDEX_NAMESPACE?.trim() || undefined;
  const vectorId = revisionDocumentId(asset.id, job.assetRevision);
  await env.PHOTO_INDEX.upsert([{
    id: vectorId,
    values: vector,
    ...(namespace ? { namespace } : {}),
    metadata: {
      assetId: asset.id,
      revision: job.assetRevision,
      status: asset.status,
      kind: asset.kind,
      country: asString(asset.country),
      province: asString(asset.province),
      city: asString(asset.city),
      locationType: asString(asset.visual_location_type),
      category: asString(asset.primary_category),
    },
  }]);
  const indexed = await env.DB.prepare(`UPDATE assets SET vector_index_status = 'indexed', vector_indexed_at = CURRENT_TIMESTAMP,
    vector_index_version = ?, vector_index_id = ?, indexed_revision = ?, index_terminal_reason = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'published' AND asset_revision = ? AND approved_revision = ?`)
    .bind(embeddingModel, vectorId, job.assetRevision, asset.id, job.assetRevision, job.assetRevision).run();
  if (indexed.meta.changes === 0) {
    await env.PHOTO_INDEX.deleteByIds([vectorId]);
    await env.DB.prepare("DELETE FROM asset_search_fts WHERE document_id = ?").bind(ftsDocumentId).run();
    await markStale(env, job, attempt, "conditional-index-write-was-stale");
    return;
  }
  if (asset.vector_index_id && asset.vector_index_id !== vectorId) await env.PHOTO_INDEX.deleteByIds([asset.vector_index_id]);
  await env.DB.prepare("DELETE FROM asset_search_fts WHERE asset_id = ? AND document_id <> ?").bind(asset.id, ftsDocumentId).run();
  await markJob(env, job.jobId, "completed", { vectorId });
  await recordProvenance(env, job, attempt, "indexed", { model: embeddingModel, actorId: "photo-indexer", result: { vectorId, dimensions: vector.length, ftsDocumentId } });
  recordMetric(env, "photo_vector_indexed", trace, 1, [asset.id]);
  logEvent("info", "photo.vector_indexed", trace, { assetId: asset.id, jobId: job.jobId, revision: job.assetRevision, dimensions: vector.length });
}

export async function processPhotoJob(env: PhotoPipelineBindings, job: PhotoEnrichmentJob, trace: TraceContext): Promise<void> {
  const claim = await env.DB.prepare(`
    UPDATE photo_ai_jobs SET status = 'running', attempts = attempts + 1, started_at = CURRENT_TIMESTAMP, next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND asset_id = ? AND operation = ? AND asset_revision = ?
      AND status IN ('queued', 'failed') AND attempts < ?
      AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
  `).bind(job.jobId, job.assetId, job.operation, job.assetRevision, MAX_ATTEMPTS).run();
  if (claim.meta.changes === 0) return;
  const claimed = await env.DB.prepare("SELECT attempts FROM photo_ai_jobs WHERE id = ?").bind(job.jobId).first<{ attempts: number }>();
  const attempt = Number(claimed?.attempts ?? 1);
  try {
    if (job.operation === "enrich") await enrichPhoto(env, job, trace, attempt);
    else await syncPhotoIndex(env, job, trace, attempt);
  } catch (error) {
    const message = error instanceof Error ? error.message : "photo-job-failed";
    const errorClass: PhotoJobErrorClass = error instanceof PhotoPipelineError ? error.errorClass : "retryable";
    const deadLettered = errorClass === "permanent" || attempt >= MAX_ATTEMPTS;
    const quotaCooldown = /4006|daily free allocation|neurons/i.test(message);
    await markJob(env, job.jobId, deadLettered ? "dead_lettered" : "failed", {
      error: message,
      errorClass,
      nextAttemptMinutes: deadLettered ? undefined : quotaCooldown ? 24 * 60 : Math.min(60, 2 ** attempt),
    });
    if (job.operation === "sync_index") {
      const failedAsset = await getAsset(env, job.assetId);
      if (failedAsset?.status !== "published" && failedAsset?.candidate_vector_status === "pending") {
        await env.DB.prepare("UPDATE assets SET candidate_vector_status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND asset_revision = ?")
          .bind(job.assetId, job.assetRevision).run();
      } else {
        await env.DB.prepare("UPDATE assets SET vector_index_status = 'error', index_terminal_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND asset_revision = ?")
          .bind(deadLettered ? "dead_lettered" : "retry_pending", job.assetId, job.assetRevision).run();
      }
    } else {
      await env.DB.prepare(`UPDATE assets SET status = 'needs_review', workflow_stage = ?, metadata_review_status = ?,
        metadata_review_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND asset_revision = ?`)
        .bind(
          deadLettered ? "curator_correction" : "ai_tagging",
          deadLettered ? "blocked" : "needs_context",
          deadLettered ? `AI enrichment stopped after a ${errorClass} failure; an editor can correct metadata or replay the job.` : "AI enrichment will retry; seller metadata is preserved.",
          job.assetId, job.assetRevision,
        ).run();
    }
    await recordProvenance(env, job, attempt, deadLettered ? "dead_lettered" : "failed", { errorClass, validation: { message } });
    recordMetric(env, "photo_pipeline_error", trace, 1, [job.operation, errorClass, deadLettered ? "dead-lettered" : "retry"]);
    if (!deadLettered) throw error;
  }
}

function ftsQuery(value: string): string {
  return searchTokens(value).map((token) => `"${token.replaceAll('"', '""')}"*`).join(" OR ");
}

function filterClauses(filters: { kind: "all" | "image" | "video"; status: "published" | "needs_review" | "all"; location?: string; locationType?: string; category?: string }): { clauses: string[]; values: string[] } {
  const clauses = [filters.status === "all" ? "1 = 1" : "a.status = ?", "a.id NOT LIKE 'asset-test-photo-%'", "COALESCE(a.preview_key, a.original_key, '') <> ''"];
  const values: string[] = filters.status === "all" ? [] : [filters.status];
  if (filters.kind !== "all") { clauses.push("a.kind = ?"); values.push(filters.kind); }
  if (filters.location) {
    clauses.push("(a.country LIKE ? OR a.city LIKE ? OR a.province LIKE ? OR a.locality LIKE ? OR a.landmark LIKE ?)");
    const location = `%${filters.location}%`;
    values.push(location, location, location, location, location);
  }
  if (filters.locationType) { clauses.push("a.visual_location_type = ?"); values.push(filters.locationType); }
  if (filters.category) { clauses.push("a.primary_category = ?"); values.push(filters.category); }
  return { clauses, values };
}

export async function searchPhotoIndex(
  env: PhotoPipelineBindings,
  query: string,
  filters: { kind: "all" | "image" | "video"; status: "published" | "needs_review" | "all"; location?: string; locationType?: string; category?: string },
): Promise<{ rows: Record<string, unknown>[]; usedVectorIndex: boolean; mode: "keyword" | "semantic-preview" | "hybrid"; fallbackReason?: "embedding_failed" | "embedding_empty" | "vector_query_failed" }> {
  const filter = filterClauses(filters);
  const match = ftsQuery(query);
  const keywordResult = match
    ? await env.DB.prepare(`SELECT a.*, u.display_name AS contributor
        FROM asset_search_fts JOIN assets a ON a.id = asset_search_fts.asset_id AND a.approved_revision = CAST(asset_search_fts.revision AS INTEGER)
        JOIN users u ON u.id = a.owner_id
        WHERE asset_search_fts MATCH ? AND ${filter.clauses.join(" AND ")}
        ORDER BY bm25(asset_search_fts, 0, 0, 0, 3.2, 1.6, 1.8, 2.5, 1.7, 3.0, 2.8, 2.6, 2.0, 2.7) LIMIT 120`)
      .bind(match, ...filter.values).all<Record<string, unknown>>()
    : { results: [] as Record<string, unknown>[] };
  const keywordRows = keywordResult.results as Record<string, unknown>[];
  if (!env.PHOTO_INDEX || !env.AI || filters.status !== "published" || !query.trim()) {
    return { rows: mergeHybridSearchRows([], keywordRows, query, new Map()), usedVectorIndex: false, mode: "keyword" };
  }
  let vector: number[] | undefined;
  try {
    const embeddingResult = await env.AI.run(env.PHOTO_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL, { text: query, pooling: "cls" }) as { data?: number[][] };
    vector = embeddingResult.data?.[0];
  } catch (error) {
    console.warn(JSON.stringify({
      level: "warn",
      event: "photo.search.embedding_failed",
      model: env.PHOTO_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL,
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown-error",
    }));
    return { rows: mergeHybridSearchRows([], keywordRows, query, new Map()), usedVectorIndex: false, mode: "keyword", fallbackReason: "embedding_failed" as const };
  }
  if (!vector?.length) {
    console.warn(JSON.stringify({ level: "warn", event: "photo.search.embedding_empty", model: env.PHOTO_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL }));
    return { rows: mergeHybridSearchRows([], keywordRows, query, new Map()), usedVectorIndex: false, mode: "keyword", fallbackReason: "embedding_empty" as const };
  }
  const namespace = env.PHOTO_INDEX_NAMESPACE?.trim() || undefined;
  let matches: VectorizeMatches;
  try {
    matches = await env.PHOTO_INDEX.query(vector, { topK: 80, returnMetadata: "none", ...(namespace ? { namespace } : {}) });
  } catch (error) {
    console.warn(JSON.stringify({
      level: "warn",
      event: "photo.search.vector_query_failed",
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown-error",
    }));
    return { rows: mergeHybridSearchRows([], keywordRows, query, new Map()), usedVectorIndex: false, mode: "keyword", fallbackReason: "vector_query_failed" as const };
  }
  const currentMatches = matches.matches.map((item) => ({ vectorId: item.id, assetId: vectorAssetId(item.id), score: item.score })).filter((item) => item.assetId);
  const ids = [...new Set(currentMatches.map((item) => item.assetId))];
  if (!ids.length) return { rows: keywordRows, usedVectorIndex: true, mode: keywordRows.length ? "hybrid" : "semantic-preview" };
  const semanticFilter = filterClauses(filters);
  semanticFilter.clauses.push(`a.id IN (${ids.map(() => "?").join(",")})`);
  semanticFilter.values.push(...ids);
  const semanticResult = await env.DB.prepare(`SELECT a.*, u.display_name AS contributor FROM assets a JOIN users u ON u.id = a.owner_id
    WHERE ${semanticFilter.clauses.join(" AND ")}`).bind(...semanticFilter.values).all<Record<string, unknown>>();
  const validVectors = new Map((semanticResult.results as Record<string, unknown>[]).map((row) => [String(row.vector_index_id), String(row.id)]));
  const semanticScores = new Map<string, number>();
  for (const item of currentMatches) if (validVectors.get(item.vectorId) === item.assetId) semanticScores.set(item.assetId, Number(item.score ?? 0));
  const semanticRows = (semanticResult.results as Record<string, unknown>[]).filter((row) => semanticScores.has(String(row.id)));
  return {
    rows: mergeHybridSearchRows(semanticRows, keywordRows, query, semanticScores),
    usedVectorIndex: true,
    mode: keywordRows.length ? "hybrid" : "semantic-preview",
  };
}
