import { IntegrationError, joinUrl, readJson, type HttpClient } from "./http";
import { z } from "zod";

export type ZohoIntegrationEnvironment = {
  ZOHO_ACCOUNTS_URL?: string;
  ZOHO_CLIENT_ID?: string;
  ZOHO_CLIENT_SECRET?: string;
  ZOHO_REFRESH_TOKEN?: string;
  ZOHO_ACCESS_TOKEN?: string;
  ZOHO_API_DOMAIN?: string;
  ZOHO_CRM_MODULE?: string;
  ZOHO_CRM_EXTERNAL_FIELD?: string;
  ZOHO_CRM_NAME_FIELD?: string;
  ZOHO_CRM_DESCRIPTION_FIELD?: string;
  ZOHO_CRM_STATUS_FIELD?: string;
  ZOHO_CRM_APPROVED_ASSETS_FIELD?: string;
  ZOHO_CRM_PLATFORMS_FIELD?: string;
  ZOHO_CRM_USAGE_RIGHTS_FIELD?: string;
  ZOHO_CRM_URL_FIELD?: string;
  ZOHO_SOCIAL_FLOW_WEBHOOK_URL?: string;
  ZOHO_DESK_FLOW_WEBHOOK_URL?: string;
  ZOHO_CAMPAIGNS_FLOW_WEBHOOK_URL?: string;
  ZOHO_ANALYTICS_FLOW_WEBHOOK_URL?: string;
};

export type ZohoAppStatus = {
  id: "social" | "crm" | "desk" | "campaigns" | "analytics";
  configured: boolean;
  mode: "flow_webhook" | "oauth_api" | "planned";
};

export type ZohoCampaignSync = {
  id: string;
  name: string;
  brief: string;
  status: string;
  approvedAssetCount: number;
  platforms: string[];
  usageRights: string;
  publicUrl?: string;
};

export type ZohoSocialDraft = ZohoCampaignSync & {
  copy: string;
  channels: string[];
  scheduleAt?: string;
  media: Array<{ assetId: string; title: string; url: string; attribution?: string | null }>;
};

export type ZohoDeskCase = {
  id: string;
  assetId: string;
  assetTitle: string;
  reason: string;
  summary: string;
  status: string;
  responseDueAt: string;
  publicUrl?: string;
};

export const zohoCampaignSyncSchema = z.object({
  id: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(180),
  brief: z.string().max(5000),
  status: z.string().trim().min(1).max(40),
  approvedAssetCount: z.number().int().nonnegative(),
  platforms: z.array(z.string().trim().min(1).max(40)).max(20),
  usageRights: z.string().trim().min(1).max(40),
  publicUrl: z.string().url().optional(),
}).strict();

export const zohoSocialDraftSchema = zohoCampaignSyncSchema.extend({
  copy: z.string().trim().max(5000),
  channels: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
  scheduleAt: z.string().datetime({ offset: true }).optional(),
  media: z.array(z.object({ assetId: z.string().trim().min(1).max(160), title: z.string().trim().min(1).max(240), url: z.string().url(), attribution: z.string().max(500).nullable().optional() }).strict()).min(1).max(100),
}).strict();

export const zohoDeskCaseSchema = z.object({
  id: z.string().trim().min(1).max(160),
  assetId: z.string().trim().min(1).max(160),
  assetTitle: z.string().trim().min(1).max(240),
  reason: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(5000),
  status: z.string().trim().min(1).max(40),
  responseDueAt: z.string().trim().min(1).max(80),
  publicUrl: z.string().url().optional(),
}).strict();

export const zohoAnalyticsEventSchema = z.object({
  contractVersion: z.literal("1.0"),
  eventName: z.string().trim().min(1).max(120),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  organizationId: z.string().trim().min(1).max(160).optional(),
  assetId: z.string().trim().min(1).max(160).optional(),
  campaignId: z.string().trim().min(1).max(160).nullable().optional(),
  licenceId: z.string().trim().min(1).max(160).optional(),
  metricType: z.string().trim().min(1).max(80).optional(),
  metricKey: z.string().trim().max(160).optional(),
  country: z.string().trim().max(80).nullable().optional(),
  province: z.string().trim().max(120).nullable().optional(),
  provider: z.string().trim().max(80).optional(),
  providerEventId: z.string().trim().max(160).optional(),
  providerReference: z.string().trim().max(160).nullable().optional(),
  status: z.string().trim().max(80).optional(),
  amountCents: z.number().int().nonnegative().optional(),
  currency: z.string().trim().length(3).optional(),
}).passthrough();

export type ZohoTokenResponse = { access_token?: string; refresh_token?: string; api_domain?: string; expires_in?: number; scope?: string };

/**
 * Server-side Zoho composition boundary.
 *
 * Social and Desk use Flow webhooks intentionally: Zoho Social's connected
 * brands and Zoho Desk's departments remain owned by the Zoho administrator,
 * while this Worker sends a rights-aware, auditable handoff. CRM uses the
 * documented v8 REST API and an external field for idempotent campaign sync.
 */
export class ZohoIntegration {
  readonly provider = "zoho";
  private readonly fetcher: HttpClient;
  private accessToken?: string;
  private apiDomain?: string;

  constructor(private readonly config: ZohoIntegrationEnvironment & { fetcher?: HttpClient }) {
    this.fetcher = config.fetcher ?? ((input, init) => globalThis.fetch(input, init));
    this.accessToken = config.ZOHO_ACCESS_TOKEN?.trim() || undefined;
    this.apiDomain = config.ZOHO_API_DOMAIN?.trim() || undefined;
  }

  status(): { provider: "zoho"; apps: ZohoAppStatus[] } {
    const oauth = Boolean(this.config.ZOHO_REFRESH_TOKEN && this.config.ZOHO_CLIENT_ID && this.config.ZOHO_CLIENT_SECRET);
    return {
      provider: "zoho",
      apps: [
        { id: "social", configured: Boolean(this.config.ZOHO_SOCIAL_FLOW_WEBHOOK_URL), mode: "flow_webhook" },
        { id: "crm", configured: oauth && Boolean(this.config.ZOHO_CRM_EXTERNAL_FIELD), mode: "oauth_api" },
        { id: "desk", configured: Boolean(this.config.ZOHO_DESK_FLOW_WEBHOOK_URL), mode: "flow_webhook" },
        { id: "campaigns", configured: Boolean(this.config.ZOHO_CAMPAIGNS_FLOW_WEBHOOK_URL), mode: "flow_webhook" },
        { id: "analytics", configured: Boolean(this.config.ZOHO_ANALYTICS_FLOW_WEBHOOK_URL), mode: "flow_webhook" },
      ],
    };
  }

  async sendSocialDraft(payload: ZohoSocialDraft, idempotencyKey: string): Promise<{ providerReference?: string; raw?: unknown }> {
    const validated = zohoSocialDraftSchema.parse(payload);
    return this.sendFlow("social", this.config.ZOHO_SOCIAL_FLOW_WEBHOOK_URL, {
      contractVersion: "1.0",
      event: "veld_archive.campaign.social_draft",
      action: "create_reviewable_social_draft",
      idempotencyKey,
      source: "veld-archive",
      campaign: validated,
    }, idempotencyKey);
  }

  async syncCampaignToCrm(campaign: ZohoCampaignSync): Promise<{ providerReference?: string; raw?: unknown }> {
    const token = await this.getAccessToken();
    const moduleName = this.config.ZOHO_CRM_MODULE?.trim() || "Campaigns";
    const externalField = this.config.ZOHO_CRM_EXTERNAL_FIELD?.trim();
    if (!externalField) throw new IntegrationError(this.provider, "ZOHO_CRM_EXTERNAL_FIELD is required for idempotent CRM sync");
    const nameField = this.config.ZOHO_CRM_NAME_FIELD?.trim() || "Campaign_Name";
    const descriptionField = this.config.ZOHO_CRM_DESCRIPTION_FIELD?.trim() || "Description";
    const record: Record<string, unknown> = {
      [externalField]: campaign.id,
      [nameField]: campaign.name,
      [descriptionField]: campaign.brief.slice(0, 5000),
    };
    const optionalFields: Array<[string | undefined, unknown]> = [
      [this.config.ZOHO_CRM_STATUS_FIELD, campaign.status],
      [this.config.ZOHO_CRM_APPROVED_ASSETS_FIELD, campaign.approvedAssetCount],
      [this.config.ZOHO_CRM_PLATFORMS_FIELD, campaign.platforms.join(", ")],
      [this.config.ZOHO_CRM_USAGE_RIGHTS_FIELD, campaign.usageRights],
      [this.config.ZOHO_CRM_URL_FIELD, campaign.publicUrl ?? null],
    ];
    for (const [field, value] of optionalFields) if (field?.trim()) record[field.trim()] = value;
    const response = await this.fetcher(joinUrl(this.apiDomain ?? "https://www.zohoapis.com", `/crm/v8/${encodeURIComponent(moduleName)}/upsert`), {
      method: "POST",
      headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [record],
        trigger: [],
      }),
    });
    const raw = await readJson<Record<string, unknown>>(response, this.provider);
    const providerReference = String((raw.data as Array<Record<string, unknown>> | undefined)?.[0]?.details && ((raw.data as Array<Record<string, unknown>>)[0].details as Record<string, unknown>).id || "") || undefined;
    return { providerReference, raw };
  }

  async sendDeskCase(payload: ZohoDeskCase, idempotencyKey: string): Promise<{ providerReference?: string; raw?: unknown }> {
    const validated = zohoDeskCaseSchema.parse(payload);
    return this.sendFlow("desk", this.config.ZOHO_DESK_FLOW_WEBHOOK_URL, {
      contractVersion: "1.0",
      event: "veld_archive.rights.case",
      action: "create_desk_ticket",
      idempotencyKey,
      source: "veld-archive",
      case: validated,
    }, idempotencyKey);
  }

  async sendCampaignsHandoff(payload: ZohoCampaignSync, idempotencyKey: string): Promise<{ providerReference?: string; raw?: unknown }> {
    const validated = zohoCampaignSyncSchema.parse(payload);
    return this.sendFlow("campaigns", this.config.ZOHO_CAMPAIGNS_FLOW_WEBHOOK_URL, {
      contractVersion: "1.0",
      event: "veld_archive.campaign.email_handoff",
      action: "prepare_zoho_campaign",
      idempotencyKey,
      source: "veld-archive",
      campaign: validated,
    }, idempotencyKey);
  }

  async sendAnalyticsEvent(payload: Record<string, unknown>, idempotencyKey: string): Promise<{ providerReference?: string; raw?: unknown }> {
    const validated = zohoAnalyticsEventSchema.parse(payload);
    return this.sendFlow("analytics", this.config.ZOHO_ANALYTICS_FLOW_WEBHOOK_URL, {
      contractVersion: "1.0",
      event: "veld_archive.analytics.event",
      action: "ingest_cms_event",
      idempotencyKey,
      source: "veld-archive",
      payload: validated,
    }, idempotencyKey);
  }

  async exchangeAuthorizationCode(code: string, redirectUri: string): Promise<ZohoTokenResponse> {
    const { ZOHO_ACCOUNTS_URL, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET } = this.config;
    if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET) throw new IntegrationError(this.provider, "Zoho OAuth client credentials are not configured");
    const body = new URLSearchParams({ code, client_id: ZOHO_CLIENT_ID, client_secret: ZOHO_CLIENT_SECRET, grant_type: "authorization_code", redirect_uri: redirectUri });
    const response = await this.fetcher(joinUrl(ZOHO_ACCOUNTS_URL ?? "https://accounts.zoho.com", "/oauth/v2/token"), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    return readJson<ZohoTokenResponse>(response, this.provider);
  }

  async getCrmModules(): Promise<Record<string, unknown>> {
    const token = await this.getAccessToken();
    const response = await this.fetcher(joinUrl(this.apiDomain ?? "https://www.zohoapis.com", "/crm/v8/settings/modules"), { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    return readJson<Record<string, unknown>>(response, this.provider);
  }

  async getCrmFields(moduleName = this.config.ZOHO_CRM_MODULE?.trim() || "Campaigns"): Promise<Record<string, unknown>> {
    const token = await this.getAccessToken();
    const response = await this.fetcher(joinUrl(this.apiDomain ?? "https://www.zohoapis.com", `/crm/v8/settings/fields?module=${encodeURIComponent(moduleName)}`), { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    return readJson<Record<string, unknown>>(response, this.provider);
  }

  private async sendFlow(app: string, endpoint: string | undefined, body: unknown, idempotencyKey: string): Promise<{ providerReference?: string; raw?: unknown }> {
    if (!endpoint) throw new IntegrationError(this.provider, `Zoho ${app} Flow webhook is not configured`);
    const response = await this.fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    });
    const raw = await readJson<Record<string, unknown> | undefined>(response, this.provider);
    const providerReference = raw && (typeof raw.id === "string" ? raw.id : typeof raw.reference === "string" ? raw.reference : undefined);
    return { providerReference, raw };
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    const { ZOHO_ACCOUNTS_URL, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN } = this.config;
    if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) throw new IntegrationError(this.provider, "Zoho CRM OAuth credentials are not configured");
    const body = new URLSearchParams({ client_id: ZOHO_CLIENT_ID, client_secret: ZOHO_CLIENT_SECRET, refresh_token: ZOHO_REFRESH_TOKEN, grant_type: "refresh_token" });
    const response = await this.fetcher(joinUrl(ZOHO_ACCOUNTS_URL ?? "https://accounts.zoho.com", "/oauth/v2/token"), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const token = await readJson<ZohoTokenResponse>(response, this.provider);
    if (!token.access_token) throw new IntegrationError(this.provider, "Zoho OAuth refresh returned no access token", { details: token });
    this.accessToken = token.access_token;
    this.apiDomain = token.api_domain || this.apiDomain;
    return token.access_token;
  }
}
