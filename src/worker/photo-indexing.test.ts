import { describe, expect, it, vi } from "vitest";
import {
  buildPhotoSearchDocument,
  classifyVisionResult,
  normalizeVisionResult,
  mergeHybridSearchRows,
  parseVisionMetadata,
  mergeAiMetadataFallback,
  normalizeSceneContext,
  preparePhotoForVision,
  runPhotoVision,
  photoJobMatchesAsset,
  enqueuePhotoJob,
  replayPhotoJob,
  requeuePhotoEnrichment,
  searchPhotoIndex,
  type PhotoPipelineBindings,
} from "./photo-indexing";

function imageObject(size: number, bytes = new Uint8Array([1, 2, 3])): R2ObjectBody {
  return {
    size,
    arrayBuffer: async () => bytes.buffer,
  } as unknown as R2ObjectBody;
}

describe("photo AI indexing", () => {
  it("parses constrained vision JSON and removes unsafe identity guesses", () => {
    const metadata = parseVisionMetadata("```json\n{\"description\":\"A market stall displaying bread outdoors\",\"visibleText\":\"Fresh bread\",\"subjectTags\":[\"market\",\"black people\",\"bread\"],\"locationType\":\"market_scene\",\"primaryCategory\":\"food\",\"sceneAttributes\":[\"outdoor\",\"daylight\"],\"detectedLanguage\":\"en\",\"textReadability\":\"clear\",\"imageQuality\":\"readable\",\"confidence\":0.88,\"fieldConfidences\":{\"description\":0.9,\"visibleText\":0.92,\"locationType\":0.86,\"primaryCategory\":0.84,\"sceneAttributes\":0.8}}\n```");
    expect(metadata.description).toBe("A market stall displaying bread outdoors");
    expect(metadata.visibleText).toBe("Fresh bread");
    expect(metadata.subjectTags).toEqual(["market", "bread"]);
    expect(metadata.confidence).toBe(0.88);
    expect(metadata.locationType).toBe("market_scene");
    expect(metadata.primaryCategory).toBe("food");
  });

  it("normalizes Workers AI response wrappers before classifying metadata", () => {
    const wrapped = { result: { answer: JSON.stringify({
      description: "A dog standing outdoors on a grassy field",
      locationType: "rural_landscape",
      primaryCategory: "nature",
      sceneAttributes: ["outdoor", "landscape"],
      confidence: 0.8,
      fieldConfidences: { description: 0.8, locationType: 0.8, primaryCategory: 0.8 },
      imageQuality: "readable",
      textReadability: "no_text",
      detectedLanguage: "none",
    }) } };
    expect(normalizeVisionResult(wrapped)).toEqual(expect.any(String));
    expect(classifyVisionResult(wrapped).metadata.description).toContain("dog standing outdoors");
  });

  it("refines broad landscape labels into a specific visual scene context", () => {
    expect(normalizeSceneContext({
      description: "A tabby cat sitting outdoors among fallen leaves",
      subjectTags: ["cat", "animal"],
      locationType: "rural_landscape",
      primaryCategory: "nature",
      sceneAttributes: ["outdoor", "close_up"],
      sceneContext: "unknown",
    })).toBe("animal_close_up");
    expect(normalizeSceneContext({
      description: "A close-up of golden corn kernels",
      subjectTags: ["corn", "plant"],
      locationType: "food",
      primaryCategory: "food",
      sceneAttributes: ["close_up", "food_present"],
      sceneContext: "unknown",
    })).toBe("plant_close_up");
    expect(normalizeSceneContext({
      description: "A narrow street lined with old buildings and a car",
      subjectTags: ["street", "vehicle"],
      locationType: "urban_street",
      primaryCategory: "architecture",
      sceneAttributes: ["outdoor", "vehicle", "building"],
      sceneContext: "unknown",
    })).toBe("street");
    expect(normalizeSceneContext({
      description: "Aerial view of a circular plaza with radial stone sections and a central memorial flame",
      subjectTags: ["architecture"],
      locationType: "unknown",
      primaryCategory: "architecture",
      sceneAttributes: ["aerial", "wide_view"],
      sceneContext: "garden",
    })).toBe("unknown");
    expect(normalizeSceneContext({
      description: "Interior of a large church with vaulted ceilings, pews, and an organ",
      subjectTags: ["architecture"],
      locationType: "indoor",
      primaryCategory: "architecture",
      sceneAttributes: ["indoor", "building"],
      sceneContext: "indoor_object",
    })).toBe("unknown");
  });

  it("routes malformed, low-confidence, unreadable, and unsupported-language output to review", () => {
    const malformed = classifyVisionResult("not-json");
    expect(malformed.accepted).toBe(false);
    expect(malformed.issues).toContain("malformed_json");

    const lowQuality = classifyVisionResult(JSON.stringify({
      description: "Unclear frame",
      visibleText: "Texte",
      subjectTags: ["street"],
      locationType: "urban_street",
      primaryCategory: "travel",
      sceneAttributes: ["outdoor"],
      detectedLanguage: "fr",
      textReadability: "unreadable",
      imageQuality: "unreadable",
      confidence: 0.3,
      fieldConfidences: { description: 0.4, visibleText: 0.2, locationType: 0.4, primaryCategory: 0.4, sceneAttributes: 0.4 },
    }));
    expect(lowQuality.accepted).toBe(false);
    expect(lowQuality.issues).toEqual(expect.arrayContaining(["low_confidence", "unreadable_image", "unsupported_language"]));
  });

  it("rejects stale queue messages by both revision and source etag", () => {
    const asset = { asset_revision: 8, source_etag: "etag-new" };
    expect(photoJobMatchesAsset({ assetRevision: 8, sourceEtag: "etag-new" }, asset)).toBe(true);
    expect(photoJobMatchesAsset({ assetRevision: 7, sourceEtag: "etag-new" }, asset)).toBe(false);
    expect(photoJobMatchesAsset({ assetRevision: 8, sourceEtag: "etag-old" }, asset)).toBe(false);
  });

  it("does not create a second enrichment job for the same upload revision", async () => {
    const firstResults = [
      { asset_revision: 3, source_etag: "etag-3" },
      { id: "enrich-job-3" },
    ];
    const run = vi.fn();
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => firstResults.shift()),
          run,
        })),
      })),
    };
    const queue = { send: vi.fn() };
    const jobId = await enqueuePhotoJob({ DB: db, PHOTO_ENRICHMENT_QUEUE: queue } as unknown as PhotoPipelineBindings, "asset-3", "enrich");
    expect(jobId).toBe("enrich-job-3");
    expect(queue.send).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("does not replay an upload-time enrichment job", async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => ({ id: "enrich-job-1", asset_id: "asset-1", operation: "enrich", asset_revision: 1, source_etag: "etag-1" })),
        })),
      })),
    };
    const queue = { send: vi.fn() };
    const replayed = await replayPhotoJob({ DB: db, PHOTO_ENRICHMENT_QUEUE: queue } as unknown as PhotoPipelineBindings, "enrich-job-1");
    expect(replayed).toBeNull();
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("keeps AI description and tags as blank-field fallbacks even when review is required", () => {
    const metadata = parseVisionMetadata({
      description: "A blue minibus parked beside a paved road",
      subjectTags: ["minibus", "road"],
      locationType: "transport",
      primaryCategory: "transport",
      sceneAttributes: ["outdoor", "vehicle"],
      confidence: 0.4,
      fieldConfidences: { description: 0.4, locationType: 0.4, primaryCategory: 0.4 },
    });
    expect(mergeAiMetadataFallback({ description: "", caption: "", subjectTags: [] }, metadata)).toEqual({
      description: "A blue minibus parked beside a paved road",
      caption: "A blue minibus parked beside a paved road",
      subjectTags: ["minibus", "road"],
    });
    expect(mergeAiMetadataFallback({ description: "Editor description", caption: "Editor caption", subjectTags: ["editor"] }, metadata)).toEqual({
      description: "Editor description",
      caption: "Editor caption",
      subjectTags: ["editor", "minibus", "road"],
    });
  });

  it("requeues an explicit admin re-enrichment for the same upload revision", async () => {
    const statements = [
      { id: "enrich-job-1", asset_id: "asset-1", operation: "enrich", status: "needs_review", asset_revision: 1, source_etag: "etag-1" },
      { kind: "image", status: "needs_review", asset_revision: 1, source_etag: "etag-1" },
    ];
    const run = vi.fn(async () => ({ meta: { changes: 1 } }));
    const db = { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first: vi.fn(async () => statements.shift()), run })) })) };
    const queue = { send: vi.fn() };
    await expect(requeuePhotoEnrichment({ DB: db, PHOTO_ENRICHMENT_QUEUE: queue } as unknown as PhotoPipelineBindings, "enrich-job-1"))
      .resolves.toBe("enrich-job-1");
    expect(run).toHaveBeenCalled();
    expect(queue.send).toHaveBeenCalledWith(expect.objectContaining({ jobId: "enrich-job-1", operation: "enrich" }));
  });

  it("resizes oversized private R2 images before sending them to AI", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array(256), { headers: { "content-type": "image/jpeg", "cf-resized": "width=1600" } }));
    try {
      const prepared = await preparePhotoForVision({
        R2_ACCOUNT_ID: "account",
        R2_ACCESS_KEY_ID: "access",
        R2_SECRET_ACCESS_KEY: "secret",
        R2_BUCKET_NAME: "media",
      } as unknown as PhotoPipelineBindings, "originals/mountain.jpg", "job-1", imageObject(22_500_000), "image/jpeg");
      expect(prepared.transformed).toBe(true);
      expect(prepared.contentType).toBe("image/jpeg");
      expect(prepared.bytes?.byteLength).toBe(256);
      expect(prepared.aiInput).toBeNull();
      expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("X-Amz-Algorithm"), expect.objectContaining({ cf: expect.objectContaining({ image: expect.objectContaining({ width: 1600, fit: "scale-down" }) }) }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("normalizes WebP originals to JPEG before local vision inference", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array(256), { headers: { "content-type": "image/jpeg" } }));
    try {
      const prepared = await preparePhotoForVision({
        R2_ACCOUNT_ID: "account",
        R2_ACCESS_KEY_ID: "access",
        R2_SECRET_ACCESS_KEY: "secret",
        R2_BUCKET_NAME: "media",
      } as unknown as PhotoPipelineBindings, "originals/preview.webp", "job-webp", imageObject(1024), "image/webp");
      expect(prepared).toMatchObject({ transformed: true, contentType: "image/jpeg" });
      expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("X-Amz-Algorithm"), expect.objectContaining({
        cf: expect.objectContaining({ image: expect.objectContaining({ format: "jpeg" }) }),
      }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("calls the authenticated HTTPS tunnel without using Workers AI", async () => {
    const originalFetch = globalThis.fetch;
    const aiRun = vi.fn();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ response: '{"description":"A forest path in warm light"}' }), {
      headers: { "content-type": "application/json" },
    }));
    try {
      await expect(runPhotoVision({
        PHOTO_VISION_PROVIDER: "ollama-tunnel",
        REMOTE_VISION_URL: "https://veld-vision.example/api/generate",
        REMOTE_VISION_TOKEN: "secret-token",
        LOCAL_VISION_MODEL: "qwen3-vl:8b",
        AI: { run: aiRun },
      } as unknown as PhotoPipelineBindings, "ignored-cloud-model", new Uint8Array([1, 2, 3]), "unused")).resolves.toContain("forest path");
      expect(aiRun).not.toHaveBeenCalled();
      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const [, request] = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(request?.headers).toMatchObject({ authorization: "Bearer secret-token" });
      expect(JSON.parse(String(request?.body))).toMatchObject({ model: "qwen3-vl:8b", stream: false, think: false });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports missing private R2 signing instead of silently dropping an oversized image", async () => {
    await expect(preparePhotoForVision({} as PhotoPipelineBindings, "originals/mountain.jpg", "job-1", imageObject(22_500_000), "image/jpeg"))
      .rejects.toThrow("private R2 GET signing and the AI source origin are not configured");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array(256), { headers: { "content-type": "image/jpeg" } }));
    try {
      const prepared = await preparePhotoForVision({
        PHOTO_AI_SOURCE_ORIGIN: "https://archive.example",
      } as PhotoPipelineBindings, "originals/mountain.jpg", "job-1", imageObject(22_500_000), "image/jpeg");
      expect(prepared.aiInput).toBeNull();
      expect(prepared.bytes?.byteLength).toBe(256);
      expect(globalThis.fetch).toHaveBeenCalledWith("https://archive.example/internal/photo-ai-source/job-1", expect.objectContaining({ headers: { "x-photo-ai-job": "job-1" }, cf: expect.objectContaining({ image: expect.objectContaining({ width: 1600, fit: "scale-down" }) }) }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("hybrid-ranks exact structured matches alongside semantic candidates", () => {
    const semantic = [
      { id: "coast", title: "Ocean view", description: "Waves at dusk", subject_tags: "[]", ai_tags: "[]", ocr_text: "", visual_location_type: "coastal_landscape", primary_category: "nature", human_verified: 1 },
      { id: "market", title: "Street scene", description: "People outdoors", subject_tags: '["people"]', ai_tags: "[]", ocr_text: "", visual_location_type: "market_scene", primary_category: "lifestyle", human_verified: 1 },
    ];
    const keyword = [
      { ...semantic[1], title: "Fresh bread market", ocr_text: "Fresh bread" },
    ];
    const ranked = mergeHybridSearchRows(semantic, keyword, "fresh bread market", new Map([["coast", 0.91], ["market", 0.76]]));
    expect(ranked[0]?.id).toBe("market");
  });

  it("keeps enough D1 bind slots after the Vectorize candidate query", async () => {
    const query = vi.fn(async () => ({ count: 0, matches: [] }));
    const all = vi.fn(async () => ({ results: [] }));
    const prepare = vi.fn(() => ({ bind: vi.fn(() => ({ all })) }));
    const result = await searchPhotoIndex({
      DB: { prepare },
      AI: { run: vi.fn(async () => ({ data: [[0.1, 0.2, 0.3]] })) },
      PHOTO_INDEX: { query },
      PHOTO_INDEX_NAMESPACE: "published-photos-v1",
    } as unknown as PhotoPipelineBindings, "forest path", { kind: "image", status: "published" });

    expect(query).toHaveBeenCalledWith([0.1, 0.2, 0.3], {
      topK: 80,
      returnMetadata: "none",
      namespace: "published-photos-v1",
    });
    expect(result).toMatchObject({ usedVectorIndex: true, mode: "semantic-preview" });
  });

  it("builds a stable searchable record from persisted metadata", () => {
    const document = buildPhotoSearchDocument({
      title: "Cape Town market",
      description: "A busy open-air market.",
      caption: "Sellers arrange bread at a stall.",
      country: "South Africa",
      province: "Western Cape",
      city: "Cape Town",
      locality: "Woodstock",
      subject_tags: '["market","food"]',
      ai_tags: '["stall","bread"]',
      ocr_text: "Fresh bread",
      visual_location_type: "market_scene",
      primary_category: "food",
      scene_attributes: '["outdoor","daylight"]',
      cultural_tags: '["South African market"]',
    });
    expect(document).toContain("Title: Cape Town market");
    expect(document).toContain("Subject tags: market, food");
    expect(document).toContain("Visible text in image: Fresh bread");
    expect(document).toContain("Visible location type: market scene");
    expect(document).toContain("Primary category: food");
  });
});
