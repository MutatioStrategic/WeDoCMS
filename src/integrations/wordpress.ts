export const WORDPRESS_SCOPES = [
  "assets:search",
  "assets:import",
  "notices:read",
] as const;

export type WordPressScope = (typeof WORDPRESS_SCOPES)[number];

export function normalizeWordPressSiteUrl(value: string, production = false): string | null {
  try {
    const url = new URL(value.trim());
    if (!['https:'].includes(url.protocol) && !(url.protocol === 'http:' && !production && ['localhost', '127.0.0.1'].includes(url.hostname))) return null;
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function bearerToken(request: Request): string | null {
  const value = request.headers.get('Authorization') ?? '';
  if (!value.startsWith('Bearer ')) return null;
  const token = value.slice(7).trim();
  return /^wpa_[A-Za-z0-9_-]{40,180}$/.test(token) ? token : null;
}

export function wordPressApiBaseUrl(request: Request, configured?: string): string {
  return (configured?.trim() || new URL(request.url).origin).replace(/\/$/, '');
}

export function wordPressNoticeSeverity(status: { assetStatus: string; rightsStatus: string; licenceStatus: string; expiresAt: string | null }): "warning" | "blocked" {
  if (status.assetStatus !== "published" || ["restricted", "pending"].includes(status.rightsStatus) || !["paid"].includes(status.licenceStatus)) return "blocked";
  if (status.expiresAt && Date.parse(status.expiresAt) <= Date.now() + 30 * 86_400_000) return "warning";
  return "warning";
}
