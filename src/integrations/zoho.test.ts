import { describe, expect, it, vi } from "vitest";
import { ZohoIntegration } from "./zoho";

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Zoho integration", () => {
  it("reports app-level configuration without exposing credentials", () => {
    const integration = new ZohoIntegration({ ZOHO_SOCIAL_FLOW_WEBHOOK_URL: "https://flow.test/social", ZOHO_REFRESH_TOKEN: "refresh", ZOHO_CLIENT_ID: "client", ZOHO_CLIENT_SECRET: "secret", ZOHO_CRM_EXTERNAL_FIELD: "Veld_Archive_ID" });
    expect(integration.status()).toEqual({ provider: "zoho", apps: expect.arrayContaining([
      { id: "social", configured: true, mode: "flow_webhook" },
      { id: "crm", configured: true, mode: "oauth_api" },
      { id: "desk", configured: false, mode: "flow_webhook" },
    ]) });
    expect(JSON.stringify(integration.status())).not.toContain("refresh");
  });

  it("refreshes OAuth and upserts a CRM campaign with the configured external field", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "access", api_domain: "https://api.zoho.test" }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ status: "success", details: { id: "crm-1" } }] }));
    const integration = new ZohoIntegration({ ZOHO_ACCOUNTS_URL: "https://accounts.zoho.test", ZOHO_CLIENT_ID: "client", ZOHO_CLIENT_SECRET: "secret", ZOHO_REFRESH_TOKEN: "refresh", ZOHO_CRM_EXTERNAL_FIELD: "Veld_Archive_ID", ZOHO_CRM_APPROVED_ASSETS_FIELD: "Approved_Assets", fetcher });
    const result = await integration.syncCampaignToCrm({ id: "campaign-1", name: "Launch", brief: "A brief", status: "active", approvedAssetCount: 2, platforms: ["instagram"], usageRights: "commercial" });
    expect(result.providerReference).toBe("crm-1");
    expect(String(fetcher.mock.calls[1][0])).toBe("https://api.zoho.test/crm/v8/Campaigns/upsert");
    const request = fetcher.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(request.body)).data[0].Veld_Archive_ID).toBe("campaign-1");
    expect(JSON.parse(String(request.body)).data[0].Approved_Assets).toBe(2);
    expect(JSON.parse(String(request.body)).data[0].Veld_Archive_Platforms).toBeUndefined();
    expect((request.headers as Record<string, string>).Authorization).toBe("Zoho-oauthtoken access");
  });

  it("sends a reviewable Social handoff with idempotency", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ id: "handoff-1" }));
    const integration = new ZohoIntegration({ ZOHO_SOCIAL_FLOW_WEBHOOK_URL: "https://flow.test/social", fetcher });
    const result = await integration.sendSocialDraft({ id: "campaign-1", name: "Launch", brief: "Brief", status: "active", approvedAssetCount: 1, platforms: ["instagram"], usageRights: "social", channels: ["instagram"], copy: "Hello", media: [{ assetId: "asset-1", title: "Cape Town", url: "https://app.test/image.jpg" }] }, "sync-1");
    expect(result.providerReference).toBe("handoff-1");
    expect((fetcher.mock.calls[0][1] as RequestInit).headers).toMatchObject({ "X-Idempotency-Key": "sync-1" });
    const body = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body));
    expect(body.contractVersion).toBe("1.0");
    expect(body.action).toBe("create_reviewable_social_draft");
  });

  it("rejects malformed Social boundary data before sending it", async () => {
    const fetcher = vi.fn();
    const integration = new ZohoIntegration({ ZOHO_SOCIAL_FLOW_WEBHOOK_URL: "https://flow.test/social", fetcher });
    await expect(integration.sendSocialDraft({ id: "campaign-1", name: "Launch", brief: "Brief", status: "active", approvedAssetCount: 1, platforms: ["instagram"], usageRights: "social", channels: ["instagram"], copy: "Hello", media: [{ assetId: "asset-1", title: "Cape Town", url: "not-a-url" }] }, "sync-1")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
