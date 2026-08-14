export type AssetKind = "image" | "video";
export type AssetStatus = "draft" | "processing" | "needs_review" | "published" | "rejected" | "withdrawn";
export type WorkflowStage = "ingestion" | "ai_tagging" | "curator_correction" | "approval";
export type ReleaseStatus = "unknown" | "not_required" | "pending" | "verified";
export type LicenceType = "editorial" | "commercial" | "advertising" | "social" | "broadcast" | "exclusive";
export type MonetizationModel = "membership" | "individual_license" | "custom_quote";
export type MetadataReviewStatus = "reviewed" | "needs_context" | "blocked";
export type MetadataProvenance = "contributor" | "editor" | "ai_suggested";
export type VisualLocationType = "urban_street" | "coastal_landscape" | "market_scene" | "indoor" | "residential" | "rural_landscape" | "industrial" | "event" | "transport" | "nature" | "sports" | "food" | "other" | "unknown";
export type SceneContext = "animal_close_up" | "plant_close_up" | "garden" | "field" | "mountain" | "street" | "shoreline" | "indoor_object" | "unknown";
export type PhotoCategory = "people" | "lifestyle" | "travel" | "nature" | "architecture" | "food" | "business" | "transport" | "arts_culture" | "sport" | "news_editorial" | "objects" | "other";
export type AiMetadataSuggestion = Record<string, unknown>;

export type MatchSignal = {
  field: "title" | "description" | "caption" | "location" | "subject" | "context" | "trust";
  label: string;
  detail: string;
  score: number;
  source: "ai" | "editorial";
};

export type MetadataUsed = { field: string; value: string; source: MetadataProvenance };

export type MatchExplanation = {
  matchConfidence: number;
  signals: MatchSignal[];
  metadataUsed: MetadataUsed[];
  metadataReviewStatus: MetadataReviewStatus;
  metadataReviewNote: string;
};

export type ContributorRelease = {
  type: "model" | "property";
  status: ReleaseStatus;
  label: string;
  documentName?: string | null;
};

export type Asset = {
  id: string;
  kind: AssetKind;
  status: AssetStatus;
  title: string;
  description: string;
  caption: string;
  country: string;
  province: string | null;
  city: string | null;
  locality: string | null;
  landmark: string | null;
  subjectTags: string[];
  culturalTags: string[];
  rightsStatus: "pending" | "verified" | "restricted" | "editorial_only";
  modelReleaseStatus: ReleaseStatus;
  propertyReleaseStatus: ReleaseStatus;
  authenticityConfidence: number;
  aiConfidence?: number;
  humanVerified: boolean;
  contributor: string;
  workflowStage: WorkflowStage;
  aiTags: string[];
  aiSuggestedMetadata?: AiMetadataSuggestion;
  visualLocationType?: VisualLocationType;
  sceneContext?: SceneContext;
  primaryCategory?: PhotoCategory;
  sceneAttributes?: string[];
  visibleText?: string;
  detectedLanguage?: string;
  textReadability?: "clear" | "partial" | "unreadable" | "no_text";
  ocrConfidence?: number | null;
  aiFieldConfidences?: Record<string, number>;
  enrichmentValidation?: { accepted?: boolean; issues?: string[]; [key: string]: unknown };
  geographicLocationSource?: "none" | "seller" | "exif" | "evidence" | "editor";
  assetRevision?: number;
  enrichedRevision?: number | null;
  reviewedRevision?: number | null;
  approvedRevision?: number | null;
  indexedRevision?: number | null;
  vectorIndexStatus?: "not_indexed" | "pending" | "indexed" | "error";
  curatorNotes: string;
  metadataReviewStatus?: MetadataReviewStatus;
  metadataReviewNote?: string;
  metadataProvenance?: MetadataProvenance;
  matchExplanation?: MatchExplanation;
  sourceFileName?: string | null;
  sourceUrl?: string | null;
  sourceLicense?: string | null;
  sourceAttribution?: string | null;
  previewUrl?: string | null;
  posterUrl?: string | null;
  streamUid?: string | null;
  streamEmbedUrl?: string | null;
  releases?: ContributorRelease[];
  monetizationModel?: MonetizationModel;
  licensePriceCents?: number | null;
};

export type SearchResponse = {
  query: string;
  mode: "keyword" | "semantic-preview" | "hybrid";
  results: Asset[];
  facets: { label: string; value: string; count: number }[];
};

export type ModerationQueueResponse = {
  results: Asset[];
  counts: { needsReview: number; needsContext: number; total: number };
};

const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "that", "this", "real", "verified", "after", "before", "image", "photo", "photos", "media"]);
const BROAD_VISUAL_TERMS = new Set(["landscape", "mountain", "mountains", "golden", "hour", "light", "scene", "story", "visual", "footage", "record", "records"]);

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function storedList(row: Record<string, unknown>, key: string): string[] {
  try {
    const parsed = JSON.parse(String(row[key] ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function hybridSearchTerms(value: string): string[] {
  return [...new Set(value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((token) => token.length > 1)
    .slice(0, 20);
}

function hybridKeywordScore(row: Record<string, unknown>, query: string): number {
  const queryTerms = hybridSearchTerms(query);
  if (!queryTerms.length) return 0;
  const text = (value: unknown): string => typeof value === "string" ? value : "";
  const fields: Array<[string, number]> = [
    [text(row.title), 3.2], [text(row.ocr_text), 3], [text(row.visual_location_type).replaceAll("_", " "), 2.8], [text(row.scene_context).replaceAll("_", " "), 2.4],
    [text(row.primary_category).replaceAll("_", " "), 2.6], [storedList(row, "subject_tags").join(" "), 2.5],
    [storedList(row, "ai_tags").join(" "), 2.1], [storedList(row, "scene_attributes").join(" "), 2],
    [text(row.caption), 1.8], [text(row.description), 1.6],
    [[row.country, row.province, row.city, row.locality, row.landmark].filter(Boolean).join(" "), 2.7],
  ];
  let weightedHits = 0;
  for (const term of queryTerms) {
    let strongest = 0;
    for (const [value, weight] of fields) if (value.toLowerCase().includes(term)) strongest = Math.max(strongest, weight);
    weightedHits += strongest;
  }
  const phrase = query.trim().toLowerCase();
  const phraseBonus = phrase.length > 3 && fields.some(([value]) => value.toLowerCase().includes(phrase)) ? 0.2 : 0;
  return Math.min(1, weightedHits / (queryTerms.length * 3.2) + phraseBonus);
}

export function rankHybridSearchRows(
  semanticRows: Record<string, unknown>[],
  keywordRows: Record<string, unknown>[],
  query: string,
  semanticScores: Map<string, number>,
): Record<string, unknown>[] {
  const merged = new Map<string, Record<string, unknown>>();
  for (const row of [...semanticRows, ...keywordRows]) merged.set(String(row.id), row);
  return [...merged.values()].sort((left, right) => {
    const score = (row: Record<string, unknown>): number =>
      (semanticScores.get(String(row.id)) ?? 0) * 0.58
      + hybridKeywordScore(row, query) * 0.38
      + (Boolean(row.human_verified) ? 0.04 : 0);
    return score(right) - score(left);
  }).slice(0, 60);
}

export function canApproveMetadataRevision(asset: { assetRevision?: number; reviewedRevision?: number | null; metadataReviewStatus?: MetadataReviewStatus }): boolean {
  return Number(asset.assetRevision) > 0
    && Number(asset.reviewedRevision) === Number(asset.assetRevision)
    && asset.metadataReviewStatus === "reviewed";
}

/** Builds an evidence-led explanation without turning visual guesses into identity or cultural facts. */
export function buildMatchExplanation(asset: Asset, query = ""): MatchExplanation {
  const queryTokens = tokens(query);
  const fields: Array<{ field: MatchSignal["field"]; label: string; value: string; weight: number }> = [
    { field: "title", label: "Title", value: asset.title, weight: 0.82 },
    { field: "description", label: "Description", value: asset.description, weight: 0.7 },
    { field: "caption", label: "Caption", value: asset.caption, weight: 0.74 },
    { field: "location", label: "Evidence-backed location", value: [asset.country, asset.province, asset.city, asset.locality, asset.landmark].filter(Boolean).join(" "), weight: 0.9 },
    { field: "subject", label: "Subject tags", value: asset.subjectTags.join(" "), weight: 0.84 },
    { field: "context", label: "Visual classification", value: [asset.visualLocationType?.replaceAll("_", " "), asset.sceneContext?.replaceAll("_", " "), asset.primaryCategory?.replaceAll("_", " "), ...(asset.sceneAttributes ?? []), ...asset.culturalTags].filter(Boolean).join(" "), weight: 0.78 },
  ];
  const matched = fields
    .map((field) => ({ ...field, hits: queryTokens.filter((token) => field.value.toLowerCase().includes(token)) }))
    .filter((field) => field.hits.length > 0);
  const signals: MatchSignal[] = matched.slice(0, 4).map((field) => ({
    field: field.field,
    label: field.label,
    detail: query ? `Matched ${field.hits.slice(0, 3).join(", ")} in this field.` : "Included as archive context for this result.",
    score: Math.min(0.99, field.weight + Math.min(0.1, (field.hits.length - 1) * 0.04)),
    source: "ai",
  }));
  if (!signals.length || !query) signals.push({
    field: "trust",
    label: "Archive trust signal",
    detail: asset.humanVerified ? "A human editor has verified this record." : "This record is awaiting human verification.",
    score: asset.humanVerified ? 0.96 : Math.max(0.55, asset.authenticityConfidence),
    source: "editorial",
  });
  const baseMatch = matched.length ? matched.reduce((total, field) => total + field.weight, 0) / matched.length : 0.56;
  const matchConfidence = Math.max(0.5, Math.min(0.99, baseMatch * 0.72 + asset.authenticityConfidence * 0.18 + (asset.humanVerified ? 0.1 : 0)));
  const metadataUsed: MetadataUsed[] = [];
  const provenance = asset.metadataProvenance ?? (asset.humanVerified ? "editor" : "contributor");
  const addMetadata = (field: string, value: string | null | undefined) => { if (value) metadataUsed.push({ field, value, source: provenance }); };
  addMetadata("Location", [asset.city, asset.province, asset.country].filter(Boolean).join(", "));
  addMetadata("Landmark", asset.landmark);
  addMetadata("Subject tags", asset.subjectTags.join(", "));
  addMetadata("Visible location type", [asset.visualLocationType, asset.sceneContext].filter(Boolean).map((value) => value!.replaceAll("_", " ")).join(", "));
  addMetadata("Primary category", asset.primaryCategory?.replaceAll("_", " "));
  addMetadata("Visible text", asset.visibleText);
  addMetadata("Context tags", asset.culturalTags.join(", "));
  return {
    matchConfidence,
    signals,
    metadataUsed,
    metadataReviewStatus: asset.metadataReviewStatus ?? (asset.humanVerified ? "reviewed" : "needs_context"),
    metadataReviewNote: asset.metadataReviewNote ?? `${asset.humanVerified ? "Human-verified context." : "Human context check required."} Metadata fields used: ${metadataUsed.map((item) => `${item.field} (${item.source})`).join(", ") || "none"}. AI suggestions never infer identity or culture from pixels.`,
  };
}

export function withMatchExplanation(asset: Asset, query = ""): Asset {
  return { ...asset, matchExplanation: buildMatchExplanation(asset, query) };
}

function assetSearchText(asset: Asset): Array<[string, number]> {
  return [
    [asset.title, 3.2],
    [asset.landmark ?? "", 3],
    [[asset.city, asset.locality, asset.province, asset.country].filter(Boolean).join(" "), 2.7],
    [asset.subjectTags.join(" "), 2.6],
    [asset.culturalTags.join(" "), 2.5],
    [asset.aiTags.join(" "), 2.1],
    [asset.caption, 1.9],
    [asset.description, 1.7],
    [[asset.visualLocationType?.replaceAll("_", " "), asset.sceneContext?.replaceAll("_", " "), asset.primaryCategory?.replaceAll("_", " "), ...(asset.sceneAttributes ?? [])].filter(Boolean).join(" "), 1.6],
  ];
}

export function searchRelevanceScore(asset: Asset, query = ""): { score: number; hits: number; phraseMatched: boolean; matchedTokens: string[] } {
  const queryTokens = tokens(query);
  if (!queryTokens.length) return { score: 1, hits: 0, phraseMatched: false, matchedTokens: [] };
  const fields = assetSearchText(asset);
  const fullText = fields.map(([value]) => value).join(" ").toLowerCase();
  const phrase = query.trim().toLowerCase();
  const phraseMatched = phrase.length > 3 && fullText.includes(phrase);
  let weightedHits = 0;
  let hits = 0;
  const matchedTokens: string[] = [];
  for (const token of queryTokens) {
    let strongest = 0;
    for (const [value, weight] of fields) if (value.toLowerCase().includes(token)) strongest = Math.max(strongest, weight);
    if (strongest > 0) {
      hits += 1;
      matchedTokens.push(token);
    }
    weightedHits += strongest;
  }
  const score = Math.min(1, weightedHits / (queryTokens.length * 3.2) + (phraseMatched ? 0.18 : 0));
  return { score, hits, phraseMatched, matchedTokens };
}

export function isRelevantSearchResult(asset: Asset, query = ""): boolean {
  const queryTokens = tokens(query);
  if (!queryTokens.length) return true;
  const relevance = searchRelevanceScore(asset, query);
  if (relevance.phraseMatched) return true;
  const distinctiveTokens = queryTokens.filter((token) => !BROAD_VISUAL_TERMS.has(token));
  if (distinctiveTokens.length > 0 && !distinctiveTokens.some((token) => relevance.matchedTokens.includes(token))) return false;
  if (queryTokens.length === 1) return relevance.hits >= 1;
  if (queryTokens.length <= 3) return relevance.hits >= 2 || relevance.score >= 0.52;
  return relevance.hits >= 2 && relevance.score >= 0.24;
}

export function rankSearchAssets(assets: Asset[], query = ""): Asset[] {
  return assets
    .filter((asset) => isRelevantSearchResult(asset, query))
    .sort((left, right) => {
      const leftScore = searchRelevanceScore(left, query).score + (left.humanVerified ? 0.03 : 0);
      const rightScore = searchRelevanceScore(right, query).score + (right.humanVerified ? 0.03 : 0);
      return rightScore - leftScore;
    });
}

export function confidenceLabel(value: number): "high" | "medium" | "low" {
  if (value >= 0.85) return "high";
  if (value >= 0.7) return "medium";
  return "low";
}

export function percent(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

export type DemandPoint = { label: string; value: number };

export type ContributorAnalytics = {
  role: "contributor";
  range: string;
  summary: { searches: number; views: number; saves: number; demandChange: number };
  searchTrends: DemandPoint[];
  popularTags: DemandPoint[];
  geographicDemand: { label: string; value: number; detail: string }[];
  opportunities: { title: string; detail: string; tone: "warm" | "cool" }[];
};

export type BuyerAnalytics = {
  role: "buyer";
  range: string;
  summary: { spendCents: number; licensedAssets: number; impressions: number; conversions: number; roi: number };
  campaigns: {
    id: string;
    name: string;
    assetTitle: string;
    assetId: string;
    spendCents: number;
    impressions: number;
    conversions: number;
    roi: number;
    status: string;
  }[];
  performance: DemandPoint[];
};

export type LicenceRequest = {
  assetId: string;
  licenceType: LicenceType;
  territory: string;
  durationDays: number;
};

export type LicenceCheck = {
  label: string;
  passed: boolean;
  detail: string;
};

export type LicenceValidation = {
  allowed: boolean;
  checks: LicenceCheck[];
  blockingReasons: string[];
};

export type CommunityForum = {
  id: string;
  name: string;
  description: string;
  topicCount: number;
  postCount: number;
  moderationPolicy: string;
};

export type ForumThread = {
  id: string;
  forumId: string;
  title: string;
  excerpt: string;
  author: string;
  replies: number;
  lastActivity: string;
  featured: boolean;
};

export type CuratedShowcase = {
  id: string;
  title: string;
  description: string;
  curator: string;
  theme: string;
  assetIds: string[];
};

export type FeaturedCollection = {
  id: string;
  title: string;
  description: string;
  location: string;
  assetCount: number;
  contributorCount: number;
  featuredLabel: string;
};

export type CommunityOverview = {
  forums: CommunityForum[];
  threads: ForumThread[];
  showcases: CuratedShowcase[];
  collections: FeaturedCollection[];
};

export type TakedownReason = "copyright" | "consent" | "cultural_harm" | "privacy" | "metadata" | "other";
export type ResolutionStatus = "lodged" | "under_review" | "mediation" | "resolved" | "appealed" | "closed";

export type RightsCase = {
  id: string;
  assetId: string;
  assetTitle: string;
  reason: TakedownReason;
  summary: string;
  status: ResolutionStatus;
  dueAt: string;
  mediationRequested: boolean;
  createdAt: string;
};

export type MediationMessage = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  visibility: "participants" | "facilitator_only" | "case_record";
  createdAt: string;
};

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  resourceType: string | null;
  resourceId: string | null;
  readAt: string | null;
  createdAt: string;
};

export type SavedSearch = {
  id: string;
  label: string;
  query: string;
  kind: "all" | "image" | "video";
  location: string | null;
  locationType: string | null;
  category: string | null;
  notifyOnNew: boolean;
  lastNotifiedAt: string | null;
  createdAt: string;
};

export type BuyerLightbox = {
  id: string;
  title: string;
  status: "active" | "archived";
  assetCount: number;
  createdAt: string;
  updatedAt: string;
};

export type BuyerLightboxDetail = BuyerLightbox & { assets: Asset[] };

export type WebhookSubscription = {
  id: string;
  targetUrl: string;
  events: string[];
  status: "active" | "disabled";
  createdAt: string;
};

export type AssetVersionEvent = {
  id: string;
  assetRevision: number | null;
  eventType: string;
  actorName: string;
  createdAt: string;
  summary: string;
};

export type PayoutBatchSummary = {
  id: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  totalCents: number;
  status: string;
  itemCount: number;
  createdAt: string;
};

export type PayoutBatchItem = {
  id: string;
  contributorName: string;
  amountCents: number;
  currency: string;
  status: string;
  failureReason: string | null;
};

export type PhotoJobSummary = {
  id: string;
  assetId: string;
  title: string;
  operation: string;
  status: string;
  attempts: number;
  errorClass: string | null;
  lastError: string | null;
  updatedAt: string;
};

const RELEASE_REQUIRED: Record<LicenceType, { model: boolean; property: boolean }> = {
  editorial: { model: false, property: false },
  commercial: { model: true, property: true },
  advertising: { model: true, property: true },
  social: { model: true, property: false },
  broadcast: { model: true, property: true },
  exclusive: { model: true, property: true },
};

function releasePasses(status: ReleaseStatus, required: boolean): boolean {
  return !required || status === "verified" || status === "not_required";
}

export function evaluateLicenceRequest(asset: Asset, request: LicenceRequest): LicenceValidation {
  const requirements = RELEASE_REQUIRED[request.licenceType];
  const checks: LicenceCheck[] = [
    {
      label: "Asset approved",
      passed: asset.status === "published" && asset.workflowStage === "approval",
      detail: asset.status === "published" ? "Curator approval is recorded" : "Asset is still in governance review",
    },
    {
      label: "Rights scope",
      passed: asset.rightsStatus === "verified" || (asset.rightsStatus === "editorial_only" && request.licenceType === "editorial"),
      detail: asset.rightsStatus === "editorial_only" ? "Editorial use only" : `Contributor rights are ${asset.rightsStatus}`,
    },
    {
      label: "Model release",
      passed: releasePasses(asset.modelReleaseStatus, requirements.model),
      detail: requirements.model ? `Required for ${request.licenceType}; currently ${asset.modelReleaseStatus}` : "Not required for this licence",
    },
    {
      label: "Property release",
      passed: releasePasses(asset.propertyReleaseStatus, requirements.property),
      detail: requirements.property ? `Required for ${request.licenceType}; currently ${asset.propertyReleaseStatus}` : "Not required for this licence",
    },
  ];

  return {
    allowed: checks.every((check) => check.passed),
    checks,
    blockingReasons: checks.filter((check) => !check.passed).map((check) => `${check.label}: ${check.detail}`),
  };
}

/**
 * Shared archive domain facade.
 *
 * UI and Worker code should depend on this object for archive rules instead
 * of importing each rule separately. The underlying functions remain
 * exported so existing integrations and focused unit tests stay compatible.
 */
export class ArchiveDomain {
  buildMatchExplanation(asset: Asset, query = ""): MatchExplanation {
    return buildMatchExplanation(asset, query);
  }

  withMatchExplanation(asset: Asset, query = ""): Asset {
    return withMatchExplanation(asset, query);
  }

  confidenceLabel(value: number): "high" | "medium" | "low" {
    return confidenceLabel(value);
  }

  percent(value: number): number {
    return percent(value);
  }

  rankHybridSearchRows(semanticRows: Record<string, unknown>[], keywordRows: Record<string, unknown>[], query: string, semanticScores: Map<string, number>): Record<string, unknown>[] {
    return rankHybridSearchRows(semanticRows, keywordRows, query, semanticScores);
  }

  rankSearchAssets(assets: Asset[], query = ""): Asset[] {
    return rankSearchAssets(assets, query);
  }

  canApproveMetadataRevision(asset: { assetRevision?: number; reviewedRevision?: number | null; metadataReviewStatus?: MetadataReviewStatus }): boolean {
    return canApproveMetadataRevision(asset);
  }

  evaluateLicenceRequest(asset: Asset, request: LicenceRequest): LicenceValidation {
    return evaluateLicenceRequest(asset, request);
  }
}

/** One shared, stateless domain object for the browser and Worker composition roots. */
export const archiveDomain = Object.freeze(new ArchiveDomain());
