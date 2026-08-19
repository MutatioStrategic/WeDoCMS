import { readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";

const libraryDir = resolve(process.env.PHOTO_LIBRARY_DIR ?? "fixtures/test-photo-library");
const manifest = JSON.parse((await readFile(resolve(libraryDir, "manifest.json"), "utf8")).replace(/^\uFEFF/, ""));
const selectedSequences = [1, 11, 21, 31, 41, 51, 61, 71, 81, 91];
const cases = manifest.filter((item) => selectedSequences.includes(item.sequence));
const defaultModels = [
  { name: "moondream", url: "http://127.0.0.1:11434" },
  { name: "qwen2.5vl:3b", url: "http://127.0.0.1:11435" },
  { name: "qwen3-vl:8b", url: "http://127.0.0.1:11435" },
];
const models = process.env.LOCAL_VISION_BENCHMARK_MODELS
  ? JSON.parse(process.env.LOCAL_VISION_BENCHMARK_MODELS)
  : defaultModels;
const required = [
  "description", "visibleText", "subjectTags", "locationType", "sceneContext", "primaryCategory",
  "sceneAttributes", "detectedLanguage", "textReadability", "imageQuality",
  "confidence", "fieldConfidences",
];
const jsonSchema = {
  type: "object",
  additionalProperties: false,
  required,
  properties: {
    description: { type: "string" }, visibleText: { type: "string" }, subjectTags: { type: "array", items: { type: "string" } },
    locationType: { type: "string", enum: ["urban_street", "coastal_landscape", "market_scene", "indoor", "residential", "rural_landscape", "industrial", "event", "transport", "nature", "sports", "food", "other", "unknown"] },
    sceneContext: { type: "string", enum: ["animal_close_up", "plant_close_up", "garden", "field", "mountain", "street", "shoreline", "indoor_object", "unknown"] },
    primaryCategory: { type: "string", enum: ["people", "lifestyle", "travel", "nature", "architecture", "food", "business", "transport", "arts_culture", "sport", "news_editorial", "objects", "other"] },
    sceneAttributes: { type: "array", items: { type: "string", enum: ["indoor", "outdoor", "daylight", "night", "sunrise_sunset", "people_present", "no_people", "crowd", "single_person", "group", "vehicle", "building", "landscape", "close_up", "wide_view", "aerial", "food_present", "text_present", "copy_space"] } },
    detectedLanguage: { type: "string", enum: ["none", "en", "af", "nr", "nso", "st", "ss", "tn", "ts", "ve", "xh", "zu"] },
    textReadability: { type: "string", enum: ["clear", "partial", "unreadable", "no_text"] }, imageQuality: { type: "string", enum: ["readable", "poor", "unreadable"] },
    confidence: { type: "number", minimum: 0, maximum: 1 }, fieldConfidences: { type: "object", additionalProperties: { type: "number", minimum: 0, maximum: 1 } },
  },
};
const unsafe = /\b(ethnic|racial|tribe|tribal|religion|muslim|christian|black[ _]people|white[ _]people|colou?red[ _]people|native[ _]people|indigenous[ _]people|criminal|illegal|exotic)\b/i;
const prompt = "Return JSON only with keys description, visibleText, subjectTags, locationType, sceneContext, primaryCategory, sceneAttributes, detectedLanguage, textReadability, imageQuality, confidence, fieldConfidences. Answer these visual questions in order: indoors; road/street or dense buildings; sea/shoreline; wide field or mountain; close-up animal or plant; garden/home; indoor object. Use sceneContext animal_close_up, plant_close_up, garden, field, mountain, street, shoreline, indoor_object, or unknown. A close-up animal without a road, building, horizon, or wide landscape is animal_close_up, not rural_landscape. Describe only visible pixels. Never infer country, province, city, locality, landmark, identity, ethnicity, race, religion, culture, intent, legality, authenticity, or rights. Use unknown or other when unsure. Keep description factual and concise.";

function parseJson(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

function score(output, expectedTopic) {
  const text = JSON.stringify(output ?? "").toLowerCase();
  const present = required.filter((key) => output && Object.prototype.hasOwnProperty.call(output, key));
  const topicHit = text.includes(String(expectedTopic).toLowerCase());
  const descriptionLength = typeof output?.description === "string" ? output.description.trim().length : 0;
  const safetyViolation = unsafe.test(text);
  return {
    schemaFields: present.length,
    schemaFieldsTotal: required.length,
    schemaComplete: present.length === required.length && descriptionLength >= 12,
    topicHit,
    safetyViolation,
    descriptionLength,
    score: (present.length / required.length) * 0.55 + (topicHit ? 0.3 : 0) + (safetyViolation ? 0 : 0.15),
  };
}

function resolveLibraryImage(fileName) {
  if (typeof fileName !== "string" || basename(fileName) !== fileName || !/^photo-\d{3}\.jpg$/i.test(fileName)) throw new Error(`Unsafe benchmark image filename: ${fileName}`);
  const imagePath = resolve(libraryDir, fileName);
  const relativePath = relative(libraryDir, imagePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error(`Benchmark image escaped library directory: ${fileName}`);
  return imagePath;
}

async function run(model, item) {
  const image = (await readFile(resolveLibraryImage(item.fileName))).toString("base64");
  const started = performance.now();
  try {
    const response = await fetch(`${model.url.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: model.name, prompt, images: [image], format: jsonSchema, stream: false, think: false, options: { temperature: 0 } }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = body.response || body.thinking;
    const parsed = parseJson(raw);
    return {
      sequence: item.sequence,
      fileName: item.fileName,
      expectedTopic: item.searchTopic,
      latencyMs: Math.round(performance.now() - started),
      raw: typeof raw === "string" ? raw : null,
      output: parsed,
      ...(parsed ? score(parsed, item.searchTopic) : { schemaFields: 0, schemaFieldsTotal: required.length, schemaComplete: false, topicHit: false, safetyViolation: false, descriptionLength: 0, score: 0 }),
    };
  } catch (error) {
    return { sequence: item.sequence, fileName: item.fileName, expectedTopic: item.searchTopic, latencyMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error), score: 0 };
  }
}

const report = { generatedAt: new Date().toISOString(), libraryDir, cases: selectedSequences, models: [] };
for (const model of models) {
  const results = [];
  for (const item of cases) results.push(await run(model, item));
  const successful = results.filter((result) => !result.error);
  report.models.push({
    ...model,
    results,
    summary: {
      completed: successful.length,
      errors: results.length - successful.length,
      schemaComplete: successful.filter((result) => result.schemaComplete).length,
      sceneContextPresent: successful.filter((result) => ["animal_close_up", "plant_close_up", "garden", "field", "mountain", "street", "shoreline", "indoor_object", "unknown"].includes(result.output?.sceneContext)).length,
      sceneContextDistribution: Object.fromEntries([...new Set(successful.map((result) => result.output?.sceneContext ?? "missing"))].map((context) => [context, successful.filter((result) => (result.output?.sceneContext ?? "missing") === context).length])),
      topicHits: successful.filter((result) => result.topicHit).length,
      safetyViolations: successful.filter((result) => result.safetyViolation).length,
      averageLatencyMs: successful.length ? Math.round(successful.reduce((sum, result) => sum + result.latencyMs, 0) / successful.length) : null,
      meanScore: successful.length ? Number((successful.reduce((sum, result) => sum + result.score, 0) / successful.length).toFixed(3)) : 0,
    },
  });
}

const reportPath = resolve("contracts/reports/local-vision-benchmark.json");
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ reportPath, summaries: report.models.map(({ name, summary }) => ({ name, ...summary })) }, null, 2));
