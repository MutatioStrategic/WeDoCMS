import { bearerHeaders, IntegrationError, joinUrl, readJson, type HttpClient } from "./http";

export type StreamTokenStore = { get(): Promise<string> };

export type StreamDirectUploadRequest = {
  assetId: string;
  organizationId: string;
  creator: string;
  filename: string;
  maxDurationSeconds: number;
  idempotencyKey?: string;
};

export type StreamDirectUpload = { uid: string; uploadUrl: string; expiresAt: string };

export interface StreamProvider {
  createDirectUpload(request: StreamDirectUploadRequest): Promise<StreamDirectUpload>;
  createSignedPlaybackToken(uid: string): Promise<{ uid: string; token: string; iframeUrl: string; expiresInSeconds: number }>;
}

type StreamApiResponse = { success?: boolean; errors?: unknown[]; result?: Record<string, unknown> | string };

/** Cloudflare Stream REST adapter; API credentials never cross this seam. */
export class CloudflareStreamAdapter implements StreamProvider {
  readonly provider = "cloudflare_stream";
  private readonly fetcher: HttpClient;

  constructor(private readonly config: {
    accountId: string;
    token?: string;
    tokenStore?: StreamTokenStore;
    allowedOrigins?: string[];
    customerCode?: string;
    endpoint?: string;
    fetcher?: HttpClient;
  }) {
    this.fetcher = config.fetcher ?? ((input, init) => globalThis.fetch(input, init));
  }

  private async token(): Promise<string> {
    if (this.config.token?.trim()) return this.config.token.trim();
    if (this.config.tokenStore) return this.config.tokenStore.get();
    throw new IntegrationError(this.provider, "Stream API token is not configured");
  }

  private api(path: string): string {
    return joinUrl(this.config.endpoint ?? "https://api.cloudflare.com/client/v4", `/accounts/${encodeURIComponent(this.config.accountId)}/stream${path}`);
  }

  async createDirectUpload(request: StreamDirectUploadRequest): Promise<StreamDirectUpload> {
    const response = await this.fetcher(this.api("/direct_upload"), {
      method: "POST",
      headers: { ...bearerHeaders(await this.token()), "Content-Type": "application/json", ...(request.idempotencyKey ? { "Idempotency-Key": request.idempotencyKey } : {}) },
      body: JSON.stringify({
        maxDurationSeconds: request.maxDurationSeconds,
        allowedOrigins: this.config.allowedOrigins ?? [],
        creator: request.creator,
        meta: { assetId: request.assetId, organizationId: request.organizationId, filename: request.filename },
        requireSignedURLs: true,
      }),
    });
    const value = await readJson<StreamApiResponse>(response, this.provider);
    const result = value.result && typeof value.result === "object" ? value.result : null;
    const uid = typeof result?.uid === "string" ? result.uid : "";
    const uploadUrl = typeof result?.uploadURL === "string" ? result.uploadURL : typeof result?.uploadUrl === "string" ? result.uploadUrl : "";
    if (value.success !== true || !uid || !uploadUrl) throw new IntegrationError(this.provider, "Stream returned no direct-upload URL", { details: value });
    return { uid, uploadUrl, expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() };
  }

  async createSignedPlaybackToken(uid: string): Promise<{ uid: string; token: string; iframeUrl: string; expiresInSeconds: number }> {
    const cleanUid = uid.trim();
    if (!cleanUid) throw new IntegrationError(this.provider, "Stream UID is required");
    const response = await this.fetcher(this.api(`/${encodeURIComponent(cleanUid)}/token`), { method: "POST", headers: bearerHeaders(await this.token()) });
    const value = await readJson<StreamApiResponse>(response, this.provider);
    const token = typeof value.result === "string" ? value.result : value.result && typeof value.result === "object" && typeof value.result.token === "string" ? value.result.token : "";
    if (value.success !== true || !token) throw new IntegrationError(this.provider, "Stream returned no playback token", { details: value });
    const customerCode = this.config.customerCode?.trim();
    if (!customerCode) throw new IntegrationError(this.provider, "Stream customer code is not configured");
    return { uid: cleanUid, token, iframeUrl: `https://customer-${encodeURIComponent(customerCode)}.cloudflarestream.com/${encodeURIComponent(cleanUid)}/iframe?token=${encodeURIComponent(token)}`, expiresInSeconds: 3600 };
  }
}
