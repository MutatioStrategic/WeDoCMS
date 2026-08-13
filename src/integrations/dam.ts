import { bearerHeaders, idempotencyHeaders, IntegrationError, joinUrl, readJson, type HttpClient } from "./http";

export type DamProvider = "aem" | "bynder";
export type DamAsset = {
  id: string;
  filename: string;
  contentType: string;
  sourceUrl: string;
  title: string;
  description?: string;
  tags?: string[];
  metadata?: Record<string, string>;
  folder?: string;
};

export type DamAssetResult = { provider: DamProvider; assetId: string; assetUrl?: string; status: "synced" | "processing"; raw?: unknown };

export interface DamProviderAdapter {
  readonly provider: DamProvider;
  syncAsset(asset: DamAsset, idempotencyKey: string): Promise<DamAssetResult>;
  updateMetadata(providerAssetId: string, metadata: Record<string, string>): Promise<void>;
}

export class AemAssetsAdapter implements DamProviderAdapter {
  readonly provider = "aem" as const;
  private readonly fetcher: HttpClient;
  constructor(private readonly config: { baseUrl: string; token: string; uploadPath?: string; fetcher?: HttpClient }) { this.fetcher = config.fetcher ?? fetch; }

  async syncAsset(asset: DamAsset, idempotencyKey: string): Promise<DamAssetResult> {
    const source = await this.fetchSource(asset, this.provider);
    const folder = asset.folder ?? "veld-archive";
    const initiateUrl = joinUrl(this.config.baseUrl, this.config.uploadPath ?? `/content/dam/${encodeURIComponent(folder)}.initiateUpload.json`);
    const initiated = await readJson<AemInitiateResponse>(await this.fetcher(initiateUrl, {
      method: "POST",
      headers: { ...bearerHeaders(this.config.token), "Content-Type": "application/x-www-form-urlencoded", ...idempotencyHeaders(idempotencyKey) },
      body: new URLSearchParams({ fileName: asset.filename, fileSize: String(source.byteLength) }),
    }), this.provider);
    const file = initiated.files?.[0];
    if (!file?.uploadURIs?.length || !initiated.completeURI || !file.uploadToken) throw new IntegrationError(this.provider, "AEM upload initialization returned incomplete upload details", { details: initiated });
    const maxPartSize = Math.max(1, file.maxPartSize ?? source.byteLength);
    const partCount = Math.max(1, Math.ceil(source.byteLength / maxPartSize));
    if (partCount > file.uploadURIs.length) throw new IntegrationError(this.provider, "AEM returned fewer upload URIs than required binary parts", { details: { partCount, uploadUriCount: file.uploadURIs.length } });
    for (let offset = 0, part = 0; offset < source.byteLength; offset += maxPartSize, part += 1) {
      const uploadUri = file.uploadURIs[part];
      const chunk = source.slice(offset, Math.min(source.byteLength, offset + maxPartSize));
      const uploadResponse = await this.fetcher(uploadUri, { method: "PUT", headers: { "Content-Type": asset.contentType }, body: chunk });
      if (!uploadResponse.ok) throw new IntegrationError(this.provider, `AEM binary upload failed with HTTP ${uploadResponse.status}`, { status: uploadResponse.status, retryable: uploadResponse.status >= 500 });
    }
    const completeUrl = initiated.completeURI.startsWith("http") ? initiated.completeURI : joinUrl(this.config.baseUrl, initiated.completeURI);
    const completed = await readJson<Record<string, unknown> | undefined>(await this.fetcher(completeUrl, {
      method: "POST",
      headers: { ...bearerHeaders(this.config.token), "Content-Type": "application/x-www-form-urlencoded", ...idempotencyHeaders(idempotencyKey) },
      body: new URLSearchParams({ fileName: file.fileName ?? asset.filename, mimeType: file.mimeType ?? asset.contentType, uploadToken: file.uploadToken, fileSize: String(source.byteLength) }),
    }), this.provider);
    const assetId = `${folder}/${asset.filename}`;
    await this.updateMetadata(assetId, { "dc:title": asset.title, ...(asset.description ? { "dc:description": asset.description } : {}), ...(asset.tags?.length ? { "cq:tags": asset.tags.join(",") } : {}), ...(asset.metadata ?? {}) });
    return { provider: this.provider, assetId, status: "synced", raw: { initiated, completed } };
  }

  async updateMetadata(providerAssetId: string, metadata: Record<string, string>): Promise<void> {
    const response = await this.fetcher(joinUrl(this.config.baseUrl, `/api/assets/${providerAssetId.replace(/^\//, "")}`), { method: "PUT", headers: { ...bearerHeaders(this.config.token), "Content-Type": "application/json" }, body: JSON.stringify({ class: "asset", properties: metadata }) });
    await readJson<unknown>(response, this.provider);
  }

  private async fetchSource(asset: DamAsset, provider: string): Promise<ArrayBuffer> {
    const response = await this.fetcher(asset.sourceUrl);
    if (!response.ok) throw new IntegrationError(provider, `Could not fetch source asset (${response.status})`, { status: response.status, retryable: response.status >= 500 });
    return response.arrayBuffer();
  }
}

type AemInitiateResponse = {
  completeURI?: string;
  files?: Array<{ fileName?: string; mimeType?: string; uploadToken?: string; uploadURIs?: string[]; maxPartSize?: number }>;
};

type BynderInit = { uploadId?: string; id?: string; targetId?: string; targetid?: string; s3?: { url?: string; multipart_params?: Record<string, string> }; uploadUrl?: string; multipart_params?: Record<string, string> };

export class BynderAdapter implements DamProviderAdapter {
  readonly provider = "bynder" as const;
  private readonly fetcher: HttpClient;
  constructor(private readonly config: { baseUrl: string; token: string; brandId: string; fetcher?: HttpClient }) { this.fetcher = config.fetcher ?? fetch; }

  async syncAsset(asset: DamAsset, idempotencyKey: string): Promise<DamAssetResult> {
    const source = await this.fetchSource(asset);
    const initResponse = await this.fetcher(joinUrl(this.config.baseUrl, "/api/upload/init"), { method: "POST", headers: { ...bearerHeaders(this.config.token), "Content-Type": "application/x-www-form-urlencoded", ...idempotencyHeaders(idempotencyKey) }, body: new URLSearchParams({ filename: asset.filename }) });
    const init = await readJson<BynderInit>(initResponse, this.provider);
    const uploadId = init.uploadId ?? init.id;
    const targetId = init.targetId ?? init.targetid;
    const uploadUrl = init.s3?.url ?? init.uploadUrl;
    const params = init.s3?.multipart_params ?? init.multipart_params;
    if (!uploadId || !targetId || !uploadUrl || !params) throw new IntegrationError(this.provider, "Bynder upload initialization returned incomplete upload details", { details: init });
    const form = new FormData();
    Object.entries(params).forEach(([key, value]) => form.append(key, value));
    form.append("name", asset.filename);
    form.append("chunk", "1");
    form.append("chunks", "1");
    form.append("Filename", `${targetId}/p1`);
    form.append("File", new Blob([source], { type: asset.contentType }), asset.filename);
    await readJson<unknown>(await this.fetcher(uploadUrl, { method: "POST", body: form }), this.provider);
    const finalizeForm = new URLSearchParams({ targetid: targetId, s3_filename: String(params.key ?? `${targetId}/p1`), chunks: "1", original_filename: asset.filename });
    await readJson<unknown>(await this.fetcher(joinUrl(this.config.baseUrl, `/api/v4/upload/${encodeURIComponent(uploadId)}/`), { method: "POST", headers: { ...bearerHeaders(this.config.token), "Content-Type": "application/x-www-form-urlencoded" }, body: finalizeForm }), this.provider);
    const saveForm = new URLSearchParams({ brandId: this.config.brandId, name: asset.title, description: asset.description ?? "", tags: (asset.tags ?? []).join(",") });
    const save = await readJson<Record<string, unknown>>(await this.fetcher(joinUrl(this.config.baseUrl, `/api/v4/media/save/${encodeURIComponent(uploadId)}`), { method: "POST", headers: { ...bearerHeaders(this.config.token), "Content-Type": "application/x-www-form-urlencoded" }, body: saveForm }), this.provider);
    return { provider: this.provider, assetId: String(save["id"] ?? save["mediaid"] ?? uploadId), status: "processing", raw: save };
  }

  async updateMetadata(providerAssetId: string, metadata: Record<string, string>): Promise<void> {
    const response = await this.fetcher(joinUrl(this.config.baseUrl, `/api/v4/media/${encodeURIComponent(providerAssetId)}`), { method: "POST", headers: { ...bearerHeaders(this.config.token), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(metadata) });
    await readJson<unknown>(response, this.provider);
  }

  private async fetchSource(asset: DamAsset): Promise<ArrayBuffer> {
    const response = await this.fetcher(asset.sourceUrl);
    if (!response.ok) throw new IntegrationError(this.provider, `Could not fetch source asset (${response.status})`, { status: response.status, retryable: response.status >= 500 });
    return response.arrayBuffer();
  }
}

export class DamProviderRegistry {
  private readonly providers = new Map<DamProvider, DamProviderAdapter>();
  register(provider: DamProviderAdapter): this { this.providers.set(provider.provider, provider); return this; }
  get(provider: DamProvider): DamProviderAdapter { const adapter = this.providers.get(provider); if (!adapter) throw new Error(`No DAM provider registered for ${provider}`); return adapter; }
}
