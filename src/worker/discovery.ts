import type { Asset } from "../shared";

const SEARCH_STOP_WORDS = new Set(["and", "for", "from", "into", "near", "the", "this", "that", "with"]);

export function normalizeSavedQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 240);
}

export function discoveryTokens(values: string[]): string[] {
  return [...new Set(values
    .flatMap((value) => normalizeSavedQuery(value).toLowerCase().split(/[^a-z0-9]+/))
    .filter((token) => token.length > 2 && !SEARCH_STOP_WORDS.has(token)))]
    .slice(0, 24);
}

export function scoreRecommendation(asset: Asset, tokens: string[]): { score: number; reason: string } {
  const fields = [
    { label: "title", value: asset.title, weight: 5 },
    { label: "place", value: [asset.city, asset.province, asset.locality, asset.landmark].filter(Boolean).join(" "), weight: 4 },
    { label: "subject", value: asset.subjectTags.join(" "), weight: 3 },
    { label: "context", value: asset.culturalTags.join(" "), weight: 3 },
    { label: "description", value: `${asset.description} ${asset.caption}`, weight: 1 },
  ];
  const hits = fields.flatMap((field) => {
    const matched = tokens.filter((token) => field.value.toLowerCase().includes(token));
    return matched.map((token) => ({ token, label: field.label, weight: field.weight }));
  });
  const score = hits.reduce((total, hit) => total + hit.weight, 0) + (asset.humanVerified ? 2 : 0);
  const strongest = [...hits].sort((a, b) => b.weight - a.weight)[0];
  return {
    score,
    reason: strongest
      ? `Matches your saved interest in ${strongest.token} through its ${strongest.label} metadata.`
      : "A recently published, human-verified archive record.",
  };
}

export function isDemoAssetRow(row: Record<string, unknown>): boolean {
  return Number(row.demo_seed ?? 0) === 1
    || String(row.id ?? "").startsWith("asset-demo-")
    || String(row.id ?? "").startsWith("asset-test-photo-")
    || String(row.contributor ?? "").toLowerCase().includes("demo archive");
}

export function isPublishedPreviewAssetRow(row: Record<string, unknown>): boolean {
  return String(row.status ?? "") === "published"
    && ["image", "video"].includes(String(row.kind ?? ""))
    && String(row.rights_status ?? "") === "verified"
    && Number(row.human_verified ?? 0) === 1
    && Boolean(String(row.source_url ?? "").trim())
    && Boolean(String(row.source_license ?? "").trim())
    && Boolean(String(row.source_attribution ?? "").trim())
    && Boolean(String(row.preview_key ?? row.original_key ?? "").trim());
}

export function isProductionDemoAssetRow(row: Record<string, unknown>): boolean {
  return isDemoAssetRow(row) && !isPublishedPreviewAssetRow(row);
}
