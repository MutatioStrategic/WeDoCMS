import { describe, expect, it } from "vitest";
import {
  assetSchema,
  assetCreateRequestSchema,
  authConfigResponseSchema,
  errorResponseSchema,
  governanceActionRequestSchema,
  healthResponseSchema,
  licenceRequestSchema,
  paymentWebhookRequestSchema,
  sessionResponseSchema,
  streamWebhookRequestSchema,
  uploadRequestSchema,
  validateContractResponse,
} from "./schemas";

describe("API contract Zod schemas", () => {
  it("accepts the frontend asset payload and applies documented defaults", () => {
    const payload = assetCreateRequestSchema.parse({ kind: "image", title: "A valid contract asset" });
    expect(payload.description).toBe("");
    expect(payload.subjectTags).toEqual([]);
    expect(payload.monetizationModel).toBe("membership");
    expect(payload.freeDownloadEnabled).toBe(false);
  });

  it("rejects malformed requests with actionable issues", () => {
    const result = assetCreateRequestSchema.safeParse({ kind: "audio", title: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.path)).toEqual([["kind"], ["title"]]);
  });

  it("trims bounded metadata and rejects invalid nested tags", () => {
    const payload = assetCreateRequestSchema.parse({
      kind: "video",
      title: "  Garden Route drive  ",
      description: "  A road study.  ",
      subjectTags: ["  road  "],
      culturalTags: ["  South African road  "],
    });

    expect(payload.title).toBe("Garden Route drive");
    expect(payload.description).toBe("A road study.");
    expect(payload.subjectTags).toEqual(["road"]);
    expect(payload.culturalTags).toEqual(["South African road"]);

    expect(assetCreateRequestSchema.safeParse({ kind: "image", title: "Valid title", subjectTags: [" "] }).success).toBe(false);
  });

  it("enforces upload, licence, governance, and confidence boundaries", () => {
    expect(uploadRequestSchema.safeParse({ filename: "photo.jpg", contentType: "image/jpeg", sizeBytes: 1 }).success).toBe(true);
    expect(uploadRequestSchema.safeParse({ filename: "photo.jpg", contentType: "application/octet-stream", sizeBytes: 1 }).success).toBe(false);
    expect(uploadRequestSchema.safeParse({ filename: "photo.jpg", contentType: "image/jpeg", sizeBytes: 30_000_000_001 }).success).toBe(false);

    expect(licenceRequestSchema.safeParse({ assetId: "asset-1", licenceType: "commercial", territory: "ZA", durationDays: 365 }).success).toBe(true);
    expect(licenceRequestSchema.safeParse({ assetId: "asset-1", licenceType: "commercial", territory: "ZA", durationDays: 0 }).success).toBe(false);
    expect(governanceActionRequestSchema.safeParse({ action: "approve", aiTags: ["context"] }).success).toBe(true);
    expect(governanceActionRequestSchema.safeParse({ action: "publish" }).success).toBe(false);

    expect(assetSchema.safeParse({
      id: "asset-1",
      kind: "image",
      status: "published",
      title: "A title",
      description: "Description",
      caption: "Caption",
      country: "South Africa",
      province: null,
      city: null,
      locality: null,
      landmark: null,
      subjectTags: [],
      culturalTags: [],
      rightsStatus: "verified",
      modelReleaseStatus: "not_required",
      propertyReleaseStatus: "not_required",
      authenticityConfidence: 1,
      humanVerified: true,
      contributor: "Contributor",
      workflowStage: "approval",
      aiTags: [],
      curatorNotes: "",
      previewUrl: "/api/assets/asset-1/preview",
    }).success).toBe(true);
    expect(assetSchema.safeParse({ authenticityConfidence: 1.01 }).success).toBe(false);
  });

  it("covers health, anonymous session, and JSON error responses", () => {
    expect(healthResponseSchema.parse({ ok: true, service: "veld-archive-api", environment: "test" })).toBeTruthy();
    expect(sessionResponseSchema.parse({ authenticated: false, user: null })).toEqual({ authenticated: false, user: null });
    expect(authConfigResponseSchema.parse({ provider: "supabase", supabaseUrl: "https://project.supabase.co", publishableKey: "sb_publishable_public", redirectUrl: "https://veld-archive.pages.dev" }).provider).toBe("supabase");
    expect(authConfigResponseSchema.parse({ provider: "demo", redirectUrl: "https://demo.example.com" }).provider).toBe("demo");
    expect(authConfigResponseSchema.parse({ provider: "unavailable", redirectUrl: "https://veld-archive.pages.dev", reason: "identity_provider_key_invalid" }).provider).toBe("unavailable");
    expect(authConfigResponseSchema.safeParse({ provider: "supabase", supabaseUrl: "https://project.supabase.co", redirectUrl: "https://veld-archive.pages.dev" }).success).toBe(false);
    expect(errorResponseSchema.parse({ error: "Authentication required" })).toEqual({ error: "Authentication required" });
    expect(() => validateContractResponse("health", healthResponseSchema, { ok: false })).toThrow(/Contract response validation failed/);
  });

  it("keeps payment and Stream webhook mismatches at the contract boundary", () => {
    expect(paymentWebhookRequestSchema.safeParse({
      provider: "test-provider",
      eventId: "event-1234",
      type: "payment_succeeded",
      licenceId: "licence-1",
      amountCents: "1000",
      currency: "ZAR",
    }).success).toBe(false);
    expect(paymentWebhookRequestSchema.safeParse({
      provider: "test-provider",
      eventId: "event-membership-1",
      type: "payment_succeeded",
      productType: "platform_subscription",
      subscriptionId: "membership-1",
      amountCents: 129900,
      currency: "ZAR",
    }).success).toBe(true);
    expect(paymentWebhookRequestSchema.safeParse({
      provider: "test-provider",
      eventId: "event-credit-1",
      type: "payment_succeeded",
      productType: "credit_purchase",
      amountCents: 10000,
      currency: "ZAR",
    }).success).toBe(false);
    expect(streamWebhookRequestSchema.safeParse({ uid: 42, status: { state: "ready" } }).success).toBe(false);
    expect(streamWebhookRequestSchema.parse({ uid: "stream-1", status: { state: "ready" } })).toEqual({ uid: "stream-1", status: { state: "ready" } });
  });
});
