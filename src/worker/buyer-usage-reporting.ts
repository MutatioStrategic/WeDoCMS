/**
 * Buyer usage reporting for transparency.
 * Provides buyers with detailed reports on their licensing activity, downloads, and spending.
 */

export type UsageReportPeriod = "weekly" | "monthly" | "quarterly" | "yearly" | "custom";

export type AssetUsageSummary = {
  assetId: string;
  title: string;
  kind: "image" | "video";
  licenceCount: number;
  downloadCount: number;
  totalSpentCents: number;
  creditsUsed: number;
  firstLicensedAt: string;
  lastLicensedAt: string;
};

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
    cashPaidCents: number;
    downloadCount: number;
    uniqueAssetsLicensed: number;
  };
  assets: AssetUsageSummary[];
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
  downloads: Array<{
    assetId: string;
    assetTitle: string;
    downloadedAt: string;
    licenceId: string;
  }>;
};

/** Generate a comprehensive usage report for a buyer */
export async function generateBuyerUsageReport(
  env: Env,
  organizationId: string,
  buyerId: string,
  periodStart: string,
  periodEnd: string
): Promise<BuyerUsageReport> {
  const reportId = crypto.randomUUID();
  const now = new Date().toISOString();
  
  // Get licence summary
  const licenceSummary = await env.DB.prepare(`
    SELECT 
      COUNT(*) AS total_licences,
      COALESCE(SUM(price_cents), 0) AS total_spent_cents,
      COALESCE(SUM(royalty_cents), 0) AS total_royalty_cents
    FROM licences l
    WHERE l.organization_id = ? AND l.buyer_id = ?
      AND l.created_at >= ? AND l.created_at <= ?
  `).bind(organizationId, buyerId, periodStart, periodEnd)
    .first<{ total_licences: number; total_spent_cents: number; total_royalty_cents: number }>();
  
  // Get credit transactions in period
  const creditTransactions = await env.DB.prepare(`
    SELECT COALESCE(SUM(ABS(credits)), 0) AS credits_used
    FROM buyer_credit_transactions
    WHERE organization_id = ? AND buyer_id = ?
      AND transaction_type = 'spend'
      AND created_at >= ? AND created_at <= ?
  `).bind(organizationId, buyerId, periodStart, periodEnd)
    .first<{ credits_used: number }>();
  
  const creditsUsed = creditTransactions?.credits_used ?? 0;
  const creditsAppliedCents = creditsUsed * 10000;
  const cashPaidCents = Math.max(0, (licenceSummary?.total_spent_cents ?? 0) - creditsAppliedCents);
  
  // Get asset-level aggregation
  const assetRows = await env.DB.prepare(`
    SELECT 
      a.id AS asset_id,
      a.title,
      a.kind,
      COUNT(l.id) AS licence_count,
      COALESCE(SUM(l.price_cents), 0) AS total_spent_cents,
      MIN(l.created_at) AS first_licensed_at,
      MAX(l.created_at) AS last_licensed_at
    FROM licences l
    JOIN assets a ON a.id = l.asset_id
    WHERE l.organization_id = ? AND l.buyer_id = ?
      AND l.created_at >= ? AND l.created_at <= ?
    GROUP BY a.id, a.title, a.kind
    ORDER BY total_spent_cents DESC
  `).bind(organizationId, buyerId, periodStart, periodEnd)
    .all<{ 
      asset_id: string; 
      title: string; 
      kind: string; 
      licence_count: number; 
      total_spent_cents: number;
      first_licensed_at: string;
      last_licensed_at: string;
    }>();
  
  // Get download counts per asset
  const downloadCounts = new Map<string, number>();
  const downloadRows = await env.DB.prepare(`
    SELECT asset_id, COUNT(*) AS download_count
    FROM asset_usage_logs
    WHERE organization_id = ? AND user_id = ?
      AND action_type = 'download'
      AND created_at >= ? AND created_at <= ?
    GROUP BY asset_id
  `).bind(organizationId, buyerId, periodStart, periodEnd)
    .all<{ asset_id: string; download_count: number }>();
  
  for (const row of downloadRows) {
    downloadCounts.set(row.asset_id, row.download_count);
  }
  
  // Get individual licences
  const licenceRows = await env.DB.prepare(`
    SELECT 
      l.id, l.asset_id, a.title AS asset_title, l.licence_type, l.territory, 
      l.duration_days, l.price_cents, l.royalty_cents, l.created_at
    FROM licences l
    JOIN assets a ON a.id = l.asset_id
    WHERE l.organization_id = ? AND l.buyer_id = ?
      AND l.created_at >= ? AND l.created_at <= ?
    ORDER BY l.created_at DESC
    LIMIT 500
  `).bind(organizationId, buyerId, periodStart, periodEnd)
    .all<{
      id: string; asset_id: string; asset_title: string; licence_type: string;
      territory: string; duration_days: number; price_cents: number;
      royalty_cents: number; created_at: string;
    }>();
  
  // Get recent downloads
  const downloadRows2 = await env.DB.prepare(`
    SELECT asset_id, a.title AS asset_title, created_at AS downloaded_at, licence_id
    FROM asset_usage_logs log
    JOIN assets a ON a.id = log.asset_id
    WHERE log.organization_id = ? AND log.user_id = ?
      AND log.action_type = 'download'
      AND log.created_at >= ? AND log.created_at <= ?
    ORDER BY log.created_at DESC
    LIMIT 200
  `).bind(organizationId, buyerId, periodStart, periodEnd)
    .all<{ asset_id: string; asset_title: string; downloaded_at: string; licence_id: string }>();
  
  const assets: AssetUsageSummary[] = assetRows.map(row => ({
    assetId: row.asset_id,
    title: row.title,
    kind: row.kind as "image" | "video",
    licenceCount: row.licence_count,
    downloadCount: downloadCounts.get(row.asset_id) ?? 0,
    totalSpentCents: row.total_spent_cents,
    creditsUsed: 0, // Would need more complex calculation to attribute credits per asset
    firstLicensedAt: row.first_licensed_at,
    lastLicensedAt: row.last_licensed_at,
  }));
  
  const report: BuyerUsageReport = {
    id: reportId,
    organizationId,
    buyerId,
    periodStart,
    periodEnd,
    generatedAt: now,
    summary: {
      totalLicences: licenceSummary?.total_licences ?? 0,
      totalSpentCents: licenceSummary?.total_spent_cents ?? 0,
      creditsUsed,
      cashPaidCents,
      downloadCount: Array.from(downloadCounts.values()).reduce((a, b) => a + b, 0),
      uniqueAssetsLicensed: assets.length,
    },
    assets,
    licences: licenceRows.map(row => ({
      id: row.id,
      assetId: row.asset_id,
      assetTitle: row.asset_title,
      licenceType: row.licence_type,
      territory: row.territory,
      durationDays: row.duration_days,
      priceCents: row.price_cents,
      royaltyCents: row.royalty_cents,
      createdAt: row.created_at,
    })),
    downloads: downloadRows2.map(row => ({
      assetId: row.asset_id,
      assetTitle: row.asset_title,
      downloadedAt: row.downloaded_at,
      licenceId: row.licence_id,
    })),
  };
  
  // Persist report
  await env.DB.prepare(`
    INSERT INTO buyer_usage_reports (id, organization_id, buyer_id, report_period_start, report_period_end,
      total_licences, total_spent_cents, credits_used, assets_licensed_json, download_count, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    reportId, organizationId, buyerId, periodStart, periodEnd,
    report.summary.totalLicences, report.summary.totalSpentCents, report.summary.creditsUsed,
    JSON.stringify(assets.map(a => ({ assetId: a.assetId, title: a.title }))),
    report.summary.downloadCount, now
  ).run();
  
  return report;
}

/** Get historical reports for a buyer */
export async function getBuyerUsageReports(
  env: Env,
  organizationId: string,
  buyerId: string,
  limit = 12
): Promise<Array<{ id: string; periodStart: string; periodEnd: string; generatedAt: string; totalLicences: number; totalSpentCents: number }>> {
  const rows = await env.DB.prepare(`
    SELECT id, report_period_start, report_period_end, generated_at, total_licences, total_spent_cents
    FROM buyer_usage_reports
    WHERE organization_id = ? AND buyer_id = ?
    ORDER BY report_period_start DESC
    LIMIT ?
  `).bind(organizationId, buyerId, limit)
    .all<{ id: string; report_period_start: string; report_period_end: string; generated_at: string; total_licences: number; total_spent_cents: number }>();
  
  return rows.map(row => ({
    id: row.id,
    periodStart: row.report_period_start,
    periodEnd: row.report_period_end,
    generatedAt: row.generated_at,
    totalLicences: row.total_licences,
    totalSpentCents: row.total_spent_cents,
  }));
}

/** Log an asset usage event */
export async function logAssetUsage(
  env: Env,
  organizationId: string,
  assetId: string,
  licenceId: string,
  userId: string,
  actionType: "view" | "download" | "share" | "publish",
  contextUrl?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const logId = crypto.randomUUID();
  
  await env.DB.prepare(`
    INSERT INTO asset_usage_logs (id, organization_id, asset_id, licence_id, user_id, action_type, context_url, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    logId, organizationId, assetId, licenceId, userId, actionType,
    contextUrl ?? null, metadata ? JSON.stringify(metadata) : null
  ).run();
}
