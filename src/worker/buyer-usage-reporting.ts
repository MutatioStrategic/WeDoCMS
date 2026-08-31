import type { D1Database } from "@cloudflare/workers-types";

type UsageEnvironment = { DB: D1Database };

export type BuyerUsageReport = {
  id: string;
  organizationId: string;
  buyerId: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  summary: {
    totalLicences: number;
    totalSpentCents: number;
    creditsUsed: number;
    downloadCount: number;
    uniqueAssetsLicensed: number;
  };
  assets: Array<{
    assetId: string;
    title: string;
    kind: string;
    licenceCount: number;
    downloadCount: number;
    totalSpentCents: number;
    creditsUsed: number;
    firstLicensedAt: string;
    lastLicensedAt: string;
  }>;
  licences: Array<{
    id: string;
    assetId: string;
    assetTitle: string;
    licenceType: string;
    territory: string;
    durationDays: number;
    priceCents: number;
    royaltyCents: number;
    createdAt: string;
  }>;
  downloads: Array<{ assetId: string; assetTitle: string; downloadedAt: string; licenceId: string | null }>;
};

function validPeriod(value: string): boolean {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp);
}

function asRows<T>(result: { results: T[] }): T[] {
  return result.results;
}

export async function generateBuyerUsageReport(
  env: UsageEnvironment,
  organizationId: string,
  buyerId: string,
  periodStart: string,
  periodEnd: string,
): Promise<BuyerUsageReport> {
  if (!validPeriod(periodStart) || !validPeriod(periodEnd) || new Date(periodStart) > new Date(periodEnd)) throw new Error("A valid usage-report period is required");
  const generatedAt = new Date().toISOString();
  const existing = await env.DB.prepare("SELECT id FROM buyer_usage_reports WHERE organization_id = ? AND buyer_id = ? AND report_period_start = ? AND report_period_end = ?")
    .bind(organizationId, buyerId, periodStart, periodEnd).first<{ id: string }>();
  const reportId = existing?.id ?? crypto.randomUUID();

  const [summaryRow, assetResult, licenceResult, downloadResult] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS total_licences,
        COALESCE(SUM(CASE WHEN l.status IN ('paid', 'refunded') THEN l.price_cents ELSE 0 END), 0) AS total_spent_cents,
        COALESCE(SUM(CASE WHEN l.payment_provider = 'credits' THEN l.credit_cost ELSE 0 END), 0) AS credits_used
      FROM licences l
      WHERE l.organization_id = ? AND l.buyer_id = ? AND l.created_at >= ? AND l.created_at <= ?`)
      .bind(organizationId, buyerId, periodStart, periodEnd)
      .first<{ total_licences: number; total_spent_cents: number; credits_used: number }>(),
    env.DB.prepare(`SELECT a.id AS asset_id, a.title, a.kind, COUNT(l.id) AS licence_count,
        COALESCE(SUM(CASE WHEN l.status IN ('paid', 'refunded') THEN l.price_cents ELSE 0 END), 0) AS total_spent_cents,
        COALESCE(SUM(CASE WHEN l.payment_provider = 'credits' THEN l.credit_cost ELSE 0 END), 0) AS credits_used,
        MIN(l.created_at) AS first_licensed_at, MAX(l.created_at) AS last_licensed_at
      FROM licences l JOIN assets a ON a.id = l.asset_id AND a.organization_id = l.organization_id
      WHERE l.organization_id = ? AND l.buyer_id = ? AND l.created_at >= ? AND l.created_at <= ?
      GROUP BY a.id, a.title, a.kind ORDER BY total_spent_cents DESC`)
      .bind(organizationId, buyerId, periodStart, periodEnd)
      .all<{ asset_id: string; title: string; kind: string; licence_count: number; total_spent_cents: number; credits_used: number; first_licensed_at: string; last_licensed_at: string }>(),
    env.DB.prepare(`SELECT l.id, l.asset_id, a.title AS asset_title, l.licence_type, l.territory, l.duration_days,
        l.price_cents, COALESCE((SELECT SUM(le.amount_cents) FROM ledger_entries le WHERE le.licence_id = l.id AND le.entry_type = 'sale'), 0) AS royalty_cents, l.created_at
      FROM licences l JOIN assets a ON a.id = l.asset_id AND a.organization_id = l.organization_id
      WHERE l.organization_id = ? AND l.buyer_id = ? AND l.created_at >= ? AND l.created_at <= ?
      ORDER BY l.created_at DESC LIMIT 500`)
      .bind(organizationId, buyerId, periodStart, periodEnd)
      .all<{ id: string; asset_id: string; asset_title: string; licence_type: string; territory: string; duration_days: number; price_cents: number; royalty_cents: number; created_at: string }>(),
    env.DB.prepare(`SELECT log.asset_id, a.title AS asset_title, log.created_at AS downloaded_at, log.licence_id
      FROM asset_usage_logs log JOIN assets a ON a.id = log.asset_id AND a.organization_id = log.organization_id
      WHERE log.organization_id = ? AND log.user_id = ? AND log.action_type = 'download' AND log.created_at >= ? AND log.created_at <= ?
      ORDER BY log.created_at DESC LIMIT 500`)
      .bind(organizationId, buyerId, periodStart, periodEnd)
      .all<{ asset_id: string; asset_title: string; downloaded_at: string; licence_id: string | null }>(),
  ]);

  const downloads = asRows(downloadResult);
  const downloadCounts = new Map<string, number>();
  for (const row of downloads) downloadCounts.set(row.asset_id, (downloadCounts.get(row.asset_id) ?? 0) + 1);
  const assets = asRows(assetResult).map((row) => ({
    assetId: row.asset_id,
    title: row.title,
    kind: row.kind,
    licenceCount: Number(row.licence_count),
    downloadCount: downloadCounts.get(row.asset_id) ?? 0,
    totalSpentCents: Number(row.total_spent_cents),
    creditsUsed: Number(row.credits_used),
    firstLicensedAt: row.first_licensed_at,
    lastLicensedAt: row.last_licensed_at,
  }));
  const summary = {
    totalLicences: Number(summaryRow?.total_licences ?? 0),
    totalSpentCents: Number(summaryRow?.total_spent_cents ?? 0),
    creditsUsed: Number(summaryRow?.credits_used ?? 0),
    downloadCount: downloads.length,
    uniqueAssetsLicensed: assets.length,
  };
  const report: BuyerUsageReport = {
    id: reportId,
    organizationId,
    buyerId,
    periodStart,
    periodEnd,
    generatedAt,
    summary,
    assets,
    licences: asRows(licenceResult).map((row) => ({ id: row.id, assetId: row.asset_id, assetTitle: row.asset_title, licenceType: row.licence_type, territory: row.territory, durationDays: Number(row.duration_days), priceCents: Number(row.price_cents), royaltyCents: Number(row.royalty_cents), createdAt: row.created_at })),
    downloads: downloads.map((row) => ({ assetId: row.asset_id, assetTitle: row.asset_title, downloadedAt: row.downloaded_at, licenceId: row.licence_id })),
  };

  await env.DB.prepare(`INSERT INTO buyer_usage_reports
      (id, organization_id, buyer_id, report_period_start, report_period_end, generated_at, total_licences, total_spent_cents, credits_used, assets_licensed_json, download_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(organization_id, buyer_id, report_period_start, report_period_end) DO UPDATE SET
      generated_at = excluded.generated_at, total_licences = excluded.total_licences, total_spent_cents = excluded.total_spent_cents,
      credits_used = excluded.credits_used, assets_licensed_json = excluded.assets_licensed_json, download_count = excluded.download_count`)
    .bind(report.id, organizationId, buyerId, periodStart, periodEnd, generatedAt, summary.totalLicences, summary.totalSpentCents, summary.creditsUsed, JSON.stringify(assets.map((asset) => ({ assetId: asset.assetId, title: asset.title }))), summary.downloadCount)
    .run();
  return report;
}

export async function getBuyerUsageReports(env: UsageEnvironment, organizationId: string, buyerId: string, limit = 12) {
  const boundedLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  const result = await env.DB.prepare(`SELECT id, report_period_start, report_period_end, generated_at, total_licences, total_spent_cents, credits_used, download_count
    FROM buyer_usage_reports WHERE organization_id = ? AND buyer_id = ? ORDER BY report_period_start DESC LIMIT ?`)
    .bind(organizationId, buyerId, boundedLimit)
    .all<{ id: string; report_period_start: string; report_period_end: string; generated_at: string; total_licences: number; total_spent_cents: number; credits_used: number; download_count: number }>();
  return asRows(result).map((row) => ({ id: row.id, periodStart: row.report_period_start, periodEnd: row.report_period_end, generatedAt: row.generated_at, totalLicences: Number(row.total_licences), totalSpentCents: Number(row.total_spent_cents), creditsUsed: Number(row.credits_used), downloadCount: Number(row.download_count) }));
}
