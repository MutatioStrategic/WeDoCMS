import type { Asset } from "./shared";

export type CampaignPlatform = "instagram" | "facebook" | "tiktok" | "linkedin" | "web" | "print" | "billboard" | "email" | "ads";
export type CampaignStage = "shortlisted" | "rejected" | "approved" | "needs_review";

export type CampaignBrief = {
  audience: string;
  platforms: CampaignPlatform[];
  locations: string[];
  tone: string[];
  industry: string;
  productService: string;
  usageRights: "editorial" | "commercial" | "advertising" | "social" | "broadcast" | "exclusive";
  licenceType: string;
  modelReleaseRequired: boolean;
  formatNeeded: string[];
  keywords: string[];
};

export type BrandKit = {
  colours: string[];
  logoNotes: string;
  tone: string;
  industry: string;
  forbiddenStyles: string[];
  preferredVisuals: string;
};

export type Readiness = Record<CampaignPlatform, number>;
export type ComplianceWarning = { severity: "blocker" | "warning" | "info"; code: string; label: string; detail: string };
export type CampaignRecommendation = {
  asset: Asset;
  score: number;
  scoreBreakdown: { relevance: number; rightsSafety: number; brandFit: number; visualQuality: number; commercialSuitability: number; cropFlexibility: number };
  reasons: string[];
  warnings: ComplianceWarning[];
  readiness: Readiness;
  suggestions: string[];
  usable: boolean;
};

const platforms: CampaignPlatform[] = ["instagram", "facebook", "tiktok", "linkedin", "web", "print", "billboard", "email", "ads"];
const terms = (value: string): string[] => [...new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length > 2))];
const has = (value: string, needles: string[]): boolean => needles.some((needle) => value.toLowerCase().includes(needle.toLowerCase()));

export function parseCampaignBrief(input: string, requestedPlatforms: string[] = []): CampaignBrief {
  const text = input.trim();
  const lower = text.toLowerCase();
  const detectedPlatforms = platforms.filter((platform) => lower.includes(platform));
  const selectedPlatforms = [...new Set([...requestedPlatforms.filter((item): item is CampaignPlatform => platforms.includes(item as CampaignPlatform)), ...detectedPlatforms])];
  const rights = lower.includes("editorial") && !lower.includes("commercial") ? "editorial" : lower.includes("exclusive") ? "exclusive" : lower.includes("advertising") || lower.includes("paid ad") ? "advertising" : lower.includes("social") ? "social" : "commercial";
  const locationMatches = [...text.matchAll(/(?:in|around|from|at)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})/g)].map((match) => match[1].trim());
  const toneWords = ["warm", "bold", "premium", "playful", "natural", "editorial", "documentary", "minimal", "energetic", "calm", "authentic", "aspirational"].filter((word) => lower.includes(word));
  const formatNeeded = [
    ...(lower.includes("story") || lower.includes("portrait") || lower.includes("vertical") ? ["portrait"] : []),
    ...(lower.includes("banner") || lower.includes("hero") || lower.includes("wide") || lower.includes("billboard") ? ["landscape"] : []),
    ...(lower.includes("square") || lower.includes("feed") ? ["square"] : []),
  ];
  const audienceMatch = text.match(/(?:audience|for)\s*[:\-]?\s*([^.;\n]+)/i);
  const industryMatch = text.match(/(?:industry|sector)\s*[:\-]?\s*([^.;\n]+)/i);
  const productMatch = text.match(/(?:product|service|offer|campaign for)\s*[:\-]?\s*([^.;\n]+)/i);
  return {
    audience: audienceMatch?.[1]?.trim() ?? "Not specified",
    platforms: selectedPlatforms.length ? selectedPlatforms : ["web", "instagram"],
    locations: locationMatches.length ? [...new Set(locationMatches)] : [],
    tone: toneWords.length ? toneWords : ["authentic"],
    industry: industryMatch?.[1]?.trim() ?? "Not specified",
    productService: productMatch?.[1]?.trim() ?? "Not specified",
    usageRights: rights,
    licenceType: rights,
    modelReleaseRequired: rights !== "editorial" && (lower.includes("people") || lower.includes("person") || lower.includes("model") || lower.includes("audience") || lower.includes("traveller") || lower.includes("traveler") || lower.includes("guest") || lower.includes("customer") || lower.includes("family")),
    formatNeeded: formatNeeded.length ? [...new Set(formatNeeded)] : ["flexible"],
    keywords: terms(text).slice(0, 30),
  };
}

function releaseOk(status: Asset["modelReleaseStatus"], required: boolean): boolean {
  return !required || status === "verified" || status === "not_required";
}

function warningList(asset: Asset, brief: CampaignBrief): ComplianceWarning[] {
  const warnings: ComplianceWarning[] = [];
  if (asset.rightsStatus === "editorial_only" && brief.usageRights !== "editorial") warnings.push({ severity: "blocker", code: "editorial_only", label: "Editorial-only media", detail: "This asset cannot be used for a commercial or advertising campaign." });
  if (asset.rightsStatus !== "verified") warnings.push({ severity: asset.rightsStatus === "restricted" ? "blocker" : "warning", code: "rights_not_verified", label: "Rights need review", detail: `Rights are marked ${asset.rightsStatus}; confirm the licence scope before approval.` });
  if (!releaseOk(asset.modelReleaseStatus, brief.modelReleaseRequired)) warnings.push({ severity: "blocker", code: "model_release_missing", label: "Model release missing", detail: `A model release is required for ${brief.usageRights} use and is currently ${asset.modelReleaseStatus}.` });
  if (brief.usageRights !== "editorial" && asset.propertyReleaseStatus === "pending") warnings.push({ severity: "warning", code: "property_release_pending", label: "Property release pending", detail: "Confirm property permissions before paid use." });
  if (asset.metadataReviewStatus === "blocked" || !asset.humanVerified) warnings.push({ severity: "warning", code: "context_review", label: "Context review required", detail: "The location or cultural context has not completed human review." });
  if (asset.monetizationModel === "custom_quote") warnings.push({ severity: "info", code: "custom_quote", label: "Custom quote", detail: "Commercial availability and price require a rights-team quote." });
  return warnings;
}

function readiness(asset: Asset, brief: CampaignBrief): Readiness {
  const pixels = (asset.mediaWidth ?? 0) * (asset.mediaHeight ?? 0);
  const largeEnough = pixels === 0 || pixels >= 2_000_000;
  const orientation = asset.mediaOrientation ?? "landscape";
  const flexible = orientation === "landscape" && (asset.mediaWidth ?? 0) >= 1600 || orientation === "square";
  const safe = warningList(asset, brief).some((warning) => warning.severity === "blocker") ? 25 : 86;
  const result = {} as Readiness;
  for (const platform of platforms) {
    let value = safe;
    if (["instagram", "facebook", "tiktok"].includes(platform) && orientation === "portrait") value += 10;
    if (["web", "billboard"].includes(platform) && flexible) value += 8;
    if (platform === "print" && largeEnough) value += 8;
    if (platform === "email" && (orientation === "landscape" || orientation === "square")) value += 5;
    if (brief.formatNeeded.includes(orientation)) value += 5;
    result[platform] = Math.min(100, value);
  }
  return result;
}

export function rankCampaignAsset(asset: Asset, brief: CampaignBrief, brandKit: BrandKit = { colours: [], logoNotes: "", tone: "", industry: "", forbiddenStyles: [], preferredVisuals: "" }): CampaignRecommendation {
  const corpus = [asset.title, asset.description, asset.caption, asset.country, asset.province, asset.city, asset.locality, asset.landmark, ...asset.subjectTags, ...asset.culturalTags, ...asset.aiTags].filter(Boolean).join(" ");
  const matched = brief.keywords.filter((keyword) => corpus.toLowerCase().includes(keyword));
  const locationHit = brief.locations.find((location) => has(corpus, terms(location)));
  const relevance = Math.min(100, 35 + matched.length * 7 + (locationHit ? 20 : 0) + (asset.humanVerified ? 10 : 0));
  const warnings = warningList(asset, brief);
  const rightsSafety = warnings.some((item) => item.severity === "blocker") ? 20 : asset.rightsStatus === "verified" ? 100 : 62;
  const brandFit = brandKit.forbiddenStyles.some((style) => has(corpus, terms(style))) ? 25 : 70 + (brandKit.industry && has(corpus, terms(brandKit.industry)) ? 15 : 0) + (brandKit.tone && has(corpus, terms(brandKit.tone)) ? 10 : 0);
  const visualQuality = Math.round((asset.authenticityConfidence * 65) + (asset.humanVerified ? 25 : 0) + (asset.mediaWidth ? 10 : 0));
  const commercialSuitability = brief.usageRights === "editorial" ? 100 : rightsSafety;
  const cropFlexibility = asset.mediaOrientation === "landscape" && (asset.mediaWidth ?? 0) >= 1600 ? 92 : asset.mediaOrientation === "square" ? 78 : 58;
  const score = Math.round(relevance * .28 + rightsSafety * .25 + brandFit * .15 + visualQuality * .14 + commercialSuitability * .1 + cropFlexibility * .08);
  const reasons = [
    ...(locationHit ? [`Location matches ${locationHit}.`] : []),
    ...(matched.length ? [`Matches ${matched.slice(0, 3).join(", ")} in stored title, caption, or tags.`] : []),
    ...(asset.rightsStatus === "verified" ? ["Licence status is verified."] : []),
    ...(asset.humanVerified ? ["Human-verified archive context."] : []),
  ];
  if (!reasons.length) reasons.push("Closest available archive match; inspect the evidence before approval.");
  const suggestions: string[] = [];
  if (score >= 78 && asset.kind === "image") suggestions.push("Use this as hero image");
  if (asset.mediaOrientation === "portrait") suggestions.push("Better for Instagram Story");
  if (cropFlexibility < 70 && brief.platforms.some((platform) => ["web", "billboard"].includes(platform))) suggestions.push("Needs wider crop for web banner");
  if (warnings.some((warning) => warning.severity === "blocker")) suggestions.push("Resolve rights before approval");
  return { asset, score, scoreBreakdown: { relevance, rightsSafety, brandFit, visualQuality, commercialSuitability, cropFlexibility }, reasons, warnings, readiness: readiness(asset, brief), suggestions, usable: !warnings.some((warning) => warning.severity === "blocker") };
}

export function rankCampaignAssets(assets: Asset[], brief: CampaignBrief, brandKit?: BrandKit): CampaignRecommendation[] {
  return assets.map((asset) => rankCampaignAsset(asset, brief, brandKit)).sort((a, b) => b.score - a.score || b.asset.authenticityConfidence - a.asset.authenticityConfidence);
}
