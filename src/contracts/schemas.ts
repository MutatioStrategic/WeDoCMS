import { z } from "zod";

export const errorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), code: z.string() })).optional(),
  retryAfter: z.number().int().nonnegative().optional(),
  quotaBytes: z.number().int().positive().optional(),
  uploadId: z.string().optional(),
}).passthrough();

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("veld-archive-api"),
  environment: z.string(),
});

export const sessionUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  displayName: z.string(),
  role: z.string().min(1),
  onboardingStatus: z.string().min(1),
  organizationId: z.string().min(1),
  organizationName: z.string().min(1),
  residencyRegion: z.enum(["za", "eu"]),
  sessionId: z.string().min(1),
  csrfToken: z.string().min(1),
});

export const sessionResponseSchema = z.union([
  z.object({ authenticated: z.literal(false), user: z.null() }),
  z.object({ authenticated: z.literal(true), user: sessionUserSchema, csrfToken: z.string().min(1) }),
]);

const releaseStatusSchema = z.enum(["unknown", "not_required", "pending", "verified"]);
const mediaReferenceSchema = z.string().refine((value) => value.startsWith("/") || /^https?:\/\//i.test(value), "Media reference must be a same-origin path or HTTPS URL");

export const assetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["image", "video"]),
  status: z.enum(["draft", "processing", "needs_review", "published", "rejected", "withdrawn"]),
  title: z.string(),
  description: z.string(),
  caption: z.string(),
  country: z.string(),
  province: z.string().nullable(),
  city: z.string().nullable(),
  locality: z.string().nullable(),
  landmark: z.string().nullable(),
  subjectTags: z.array(z.string()),
  culturalTags: z.array(z.string()),
  rightsStatus: z.enum(["pending", "verified", "restricted", "editorial_only"]),
  modelReleaseStatus: releaseStatusSchema,
  propertyReleaseStatus: releaseStatusSchema,
  authenticityConfidence: z.number().min(0).max(1),
  aiConfidence: z.number().min(0).max(1).optional(),
  humanVerified: z.boolean(),
  contributor: z.string(),
  workflowStage: z.enum(["ingestion", "ai_tagging", "curator_correction", "approval"]),
  aiTags: z.array(z.string()),
  aiSuggestedMetadata: z.record(z.string(), z.unknown()).optional(),
  visualLocationType: z.enum(["urban_street", "coastal_landscape", "market_scene", "indoor", "residential", "rural_landscape", "industrial", "event", "transport", "nature", "sports", "food", "other", "unknown"]).optional(),
  primaryCategory: z.enum(["people", "lifestyle", "travel", "nature", "architecture", "food", "business", "transport", "arts_culture", "sport", "news_editorial", "objects", "other"]).optional(),
  sceneAttributes: z.array(z.string()).optional(),
  visibleText: z.string().optional(),
  detectedLanguage: z.string().optional(),
  textReadability: z.enum(["clear", "partial", "unreadable", "no_text"]).optional(),
  ocrConfidence: z.number().min(0).max(1).nullable().optional(),
  aiFieldConfidences: z.record(z.number().min(0).max(1)).optional(),
  enrichmentValidation: z.object({ accepted: z.boolean().optional(), issues: z.array(z.string()).optional() }).passthrough().optional(),
  geographicLocationSource: z.enum(["none", "seller", "exif", "evidence", "editor"]).optional(),
  assetRevision: z.number().int().positive().optional(),
  enrichedRevision: z.number().int().positive().nullable().optional(),
  reviewedRevision: z.number().int().positive().nullable().optional(),
  approvedRevision: z.number().int().positive().nullable().optional(),
  indexedRevision: z.number().int().positive().nullable().optional(),
  vectorIndexStatus: z.enum(["not_indexed", "pending", "indexed", "error"]).optional(),
  curatorNotes: z.string(),
  metadataReviewStatus: z.enum(["reviewed", "needs_context", "blocked"]).optional(),
  metadataReviewNote: z.string().optional(),
  metadataProvenance: z.enum(["contributor", "editor", "ai_suggested"]).optional(),
  sourceFileName: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
  sourceLicense: z.string().nullable().optional(),
  sourceAttribution: z.string().nullable().optional(),
  artistLicenseKey: z.enum(["custom", "cc_by_4_0", "cc_by_sa_4_0", "mit", "other"]).optional(),
  artistLicenseVersion: z.string().nullable().optional(),
  artistLicenseUrl: z.string().url().nullable().optional(),
  artistLicenseTerms: z.string().nullable().optional(),
  previewUrl: mediaReferenceSchema.nullable().optional(),
  streamUid: z.string().nullable().optional(),
  streamEmbedUrl: z.string().url().nullable().optional(),
  monetizationModel: z.enum(["membership", "individual_license", "custom_quote"]).optional(),
  licensePriceCents: z.number().int().nonnegative().nullable().optional(),
}).passthrough();

export const searchResponseSchema = z.object({
  query: z.string(),
  mode: z.enum(["keyword", "semantic-preview", "hybrid"]),
  results: z.array(assetSchema),
  facets: z.array(z.object({ label: z.string(), value: z.string(), count: z.number().int().nonnegative() })),
  nextCursor: z.string().nullable().optional(),
  total: z.number().int().nonnegative().optional(),
});

export const assetCreateRequestSchema = z.object({
  kind: z.enum(["image", "video"]),
  title: z.string().trim().min(3).max(240),
  description: z.string().trim().max(4000).default(""),
  caption: z.string().trim().max(4000).default(""),
  province: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  locality: z.string().trim().max(160).optional(),
  landmark: z.string().trim().max(160).optional(),
  subjectTags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  culturalTags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  rightsStatus: z.enum(["pending", "verified", "restricted", "editorial_only"]).default("pending"),
  modelReleaseStatus: releaseStatusSchema.default("unknown"),
  propertyReleaseStatus: releaseStatusSchema.default("unknown"),
  monetizationModel: z.enum(["membership", "individual_license", "custom_quote"]).default("membership"),
  licensePriceCents: z.number().int().nonnegative().max(100_000_000).nullable().optional(),
  artistLicenseKey: z.enum(["custom", "cc_by_4_0", "cc_by_sa_4_0", "mit", "other"]).default("custom"),
  artistLicenseVersion: z.string().trim().max(80).optional(),
  artistLicenseUrl: z.string().url().max(1000).optional().or(z.literal("")),
  artistLicenseTerms: z.string().trim().max(20_000).optional(),
});

export const assetCreateResponseSchema = z.object({
  id: z.string().min(1),
  status: z.literal("needs_review"),
});

export const governanceActionRequestSchema = z.object({
  action: z.enum(["run_ai_tagging", "save_correction", "approve", "reject"]),
  title: z.string().trim().min(1).max(180).optional(),
  caption: z.string().trim().max(1000).optional(),
  subjectTags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  culturalTags: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  curatorNotes: z.string().trim().max(2000).optional(),
  rightsStatus: z.enum(["pending", "verified", "restricted", "editorial_only"]).optional(),
  modelReleaseStatus: releaseStatusSchema.optional(),
  propertyReleaseStatus: releaseStatusSchema.optional(),
  aiTags: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  visualLocationType: z.enum(["urban_street", "coastal_landscape", "market_scene", "indoor", "residential", "rural_landscape", "industrial", "event", "transport", "nature", "sports", "food", "other", "unknown"]).optional(),
  sceneContext: z.enum(["animal_close_up", "plant_close_up", "garden", "field", "mountain", "street", "shoreline", "indoor_object", "unknown"]).optional(),
  primaryCategory: z.enum(["people", "lifestyle", "travel", "nature", "architecture", "food", "business", "transport", "arts_culture", "sport", "news_editorial", "objects", "other"]).optional(),
  sceneAttributes: z.array(z.enum(["indoor", "outdoor", "daylight", "night", "sunrise_sunset", "people_present", "no_people", "crowd", "single_person", "group", "vehicle", "building", "landscape", "close_up", "wide_view", "aerial", "food_present", "text_present", "copy_space"])).max(30).optional(),
  visibleText: z.string().trim().max(2000).optional(),
  monetizationModel: z.enum(["membership", "individual_license", "custom_quote"]).optional(),
  licensePriceCents: z.number().int().nonnegative().max(100_000_000).nullable().optional(),
});

export const governanceActionResponseSchema = z.object({
  ok: z.literal(true),
  assetId: z.string().min(1),
  stage: z.enum(["ai_tagging", "curator_correction", "approval"]),
  status: z.enum(["needs_review", "published", "rejected"]),
  indexing: z.string().min(1),
});

export const uploadRequestSchema = z.object({
  filename: z.string().min(1).max(180),
  contentType: z.string().regex(/^(image|video)\//),
  sizeBytes: z.number().int().positive().max(30_000_000_000),
  assetId: z.string().optional(),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
});

export const uploadResponseSchema = z.object({
  uploadId: z.string().min(1),
  objectKey: z.string().min(1),
  strategy: z.literal("r2-presigned-put"),
  uploadUrl: z.string().url(),
  expiresInSeconds: z.number().int().positive(),
  message: z.string(),
  idempotent: z.boolean().optional(),
});

export const uploadCompleteResponseSchema = z.object({
  uploadId: z.string().min(1),
  assetId: z.string().min(1).optional(),
  objectKey: z.string().min(1).optional(),
  status: z.literal("uploaded"),
  idempotent: z.boolean().optional(),
  enrichment: z.string().optional(),
  etag: z.string().optional(),
});

export const licenceRequestSchema = z.object({
  assetId: z.string().min(1),
  licenceType: z.enum(["editorial", "commercial", "advertising", "social", "broadcast", "exclusive"]),
  productCode: z.enum(["standard", "enhanced", "editorial", "custom"]).optional(),
  territory: z.string().min(1).max(80),
  durationDays: z.number().int().positive().max(3650),
});

export const paymentWebhookRequestSchema = z.object({
  provider: z.string().trim().min(2).max(80),
  eventId: z.string().trim().min(4).max(240),
  type: z.enum(["payment_succeeded", "payment_failed", "refund", "chargeback"]),
  licenceId: z.string().min(1).max(120).optional(),
  subscriptionId: z.string().min(1).max(120).optional(),
  creditPurchaseId: z.string().min(1).max(120).optional(),
  productType: z.enum(["licence", "photographer_subscription", "platform_subscription", "credit_purchase"]).default("licence"),
  paymentReference: z.string().trim().max(240).optional(),
  amountCents: z.number().int().positive().max(100_000_000),
  currency: z.string().length(3),
}).refine((value) => value.productType === "licence" ? Boolean(value.licenceId) : value.productType === "credit_purchase" ? Boolean(value.creditPurchaseId) : Boolean(value.subscriptionId), { message: "A product reference is required" });

export const streamWebhookRequestSchema = z.object({
  uid: z.string().trim().max(240).optional(),
  readyToStream: z.boolean().optional(),
  status: z.object({
    state: z.string().trim().max(80).optional(),
    pctComplete: z.string().trim().max(40).optional(),
    errorReasonCode: z.string().trim().max(120).optional(),
    errorReasonText: z.string().trim().max(500).optional(),
  }).optional(),
  meta: z.object({
    filename: z.string().trim().max(240).optional(),
    filetype: z.string().trim().max(120).optional(),
    name: z.string().trim().max(240).optional(),
  }).optional(),
});

export const contractResponseValidationErrorSchema = z.object({
  error: z.literal("Contract response validation failed"),
  code: z.literal("contract_response_invalid"),
  contract: z.string(),
  issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), code: z.string(), message: z.string() })),
});

export class ContractResponseValidationError extends Error {
  constructor(readonly contract: string, readonly issues: z.ZodIssue[]) {
    super(`Contract response validation failed for ${contract}`);
    this.name = "ContractResponseValidationError";
  }
}

export function validateContractResponse<T>(contract: string, schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ContractResponseValidationError(contract, result.error.issues);
  return result.data;
}
