export type AssetKind = "image" | "video";
export type AssetStatus = "draft" | "processing" | "needs_review" | "published" | "rejected" | "withdrawn";
export type WorkflowStage = "ingestion" | "ai_tagging" | "curator_correction" | "approval";
export type ReleaseStatus = "unknown" | "not_required" | "pending" | "verified";
export type LicenceType = "editorial" | "commercial" | "advertising" | "social" | "broadcast" | "exclusive";
export type MonetizationModel = "membership" | "individual_license" | "custom_quote";
export type MetadataReviewStatus = "reviewed" | "needs_context" | "blocked";
export type MetadataProvenance = "contributor" | "editor" | "ai_suggested";

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
  curatorNotes: string;
  metadataReviewStatus?: MetadataReviewStatus;
  metadataReviewNote?: string;
  metadataProvenance?: MetadataProvenance;
  matchExplanation?: MatchExplanation;
  sourceFileName?: string | null;
  sourceUrl?: string | null;
  sourceLicense?: string | null;
  sourceAttribution?: string | null;
  artistLicenseKey?: "custom" | "cc_by_4_0" | "cc_by_sa_4_0" | "mit" | "other";
  artistLicenseVersion?: string | null;
  artistLicenseUrl?: string | null;
  artistLicenseTerms?: string | null;
  artistLicenseSha256?: string | null;
  releases?: ContributorRelease[];
  monetizationModel?: MonetizationModel;
  licensePriceCents?: number | null;
  previewUrl?: string | null;
  mediaContentType?: string | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  mediaDurationSeconds?: number | null;
  mediaOrientation?: "landscape" | "portrait" | "square" | null;
  mediaHasPeople?: boolean;
  mediaUsageType?: "commercial" | "editorial";
  mediaAiGenerated?: boolean;
};

export type SearchResponse = {
  query: string;
  mode: "keyword" | "semantic-preview";
  results: Asset[];
  facets: { label: string; value: string; count: number }[];
  nextCursor?: string | null;
  total?: number;
};

export type ModerationQueueResponse = {
  results: Asset[];
  counts: { needsReview: number; needsContext: number; total: number };
};

const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "that", "this", "real", "verified", "after"]);

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

/** Builds an evidence-led explanation without turning visual guesses into identity or cultural facts. */
export function buildMatchExplanation(asset: Asset, query = ""): MatchExplanation {
  const queryTokens = tokens(query);
  const fields: Array<{ field: MatchSignal["field"]; label: string; value: string; weight: number }> = [
    { field: "title", label: "Title", value: asset.title, weight: 0.82 },
    { field: "description", label: "Description", value: asset.description, weight: 0.7 },
    { field: "caption", label: "Caption", value: asset.caption, weight: 0.74 },
    { field: "location", label: "Location", value: [asset.country, asset.province, asset.city, asset.locality, asset.landmark].filter(Boolean).join(" "), weight: 0.9 },
    { field: "subject", label: "Subject tags", value: asset.subjectTags.join(" "), weight: 0.84 },
    { field: "context", label: "Context tags", value: asset.culturalTags.join(" "), weight: 0.78 },
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
  productCode?: "standard" | "enhanced" | "editorial" | "custom";
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

export type CreatorProfile = {
  id: string;
  slug: string;
  name: string;
  headline: string;
  bio: string;
  location: string;
  specialties: string[];
  websiteUrl: string | null;
  assetCount: number;
  collectionCount: number;
  featuredAssetId: string | null;
};

export type PortfolioCollection = {
  id: string;
  slug: string;
  title: string;
  description: string;
  assetCount: number;
  coverAssetId: string | null;
  creator: Pick<CreatorProfile, "slug" | "name">;
};

export type ContributorPerformance = {
  range: string;
  summary: { views: number; saves: number; downloads: number; licences: number; conversionRate: number };
  topAssets: Array<{ assetId: string; title: string; views: number; saves: number; downloads: number; licences: number; conversionRate: number }>;
  downloadHistory: Array<{ id: string; assetId: string; assetTitle: string; licenceId: string; occurredAt: string }>;
};

export type LicenceProduct = {
  code: "standard" | "enhanced" | "editorial" | "custom";
  name: string;
  description: string;
  termsVersion: string;
  restrictions: Record<string, boolean | number | string>;
};

export type AccountLifecycle = {
  emailVerified: boolean;
  mfaEnrolled: boolean;
  emailNotifications: boolean;
  productNotifications: boolean;
  exportStatus: "not_requested" | "queued" | "ready" | "expired" | "failed";
  deletionStatus: "none" | "requested" | "cancelled" | "scheduled" | "completed";
};

export type UserLightbox = {
  id: string;
  name: string;
  description: string;
  visibility: "private" | "shared";
  assetIds: string[];
  assetCount: number;
  createdAt: string;
  updatedAt: string;
};

export type SavedSearch = {
  id: string;
  name: string;
  query: string;
  mediaKind: "all" | "image" | "video";
  alertFrequency: "none" | "daily" | "weekly";
  createdAt: string;
  updatedAt: string;
};

export type TrendingSearch = { query: string; searchCount: number };

export type DiscoveryRecommendation = {
  asset: Asset;
  reason: string;
};

export type DiscoveryResponse = {
  trending: TrendingSearch[];
  savedSearches: SavedSearch[];
  recommendations: DiscoveryRecommendation[];
  personalized: boolean;
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

  evaluateLicenceRequest(asset: Asset, request: LicenceRequest): LicenceValidation {
    return evaluateLicenceRequest(asset, request);
  }
}

/** One shared, stateless domain object for the browser and Worker composition roots. */
export const archiveDomain = Object.freeze(new ArchiveDomain());
