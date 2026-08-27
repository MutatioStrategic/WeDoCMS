import assert from "node:assert/strict";
import JSZip from "jszip";
import { chromium } from "@playwright/test";

const baseUrl = process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:5173";
const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const fixtureAsset = {
  id: "studio-sanity-asset",
  kind: "image",
  status: "published",
  title: "Studio sanity fixture",
  description: "A local browser smoke fixture.",
  caption: "Studio sanity fixture",
  country: "South Africa",
  province: "Western Cape",
  city: "Cape Town",
  locality: null,
  landmark: null,
  subjectTags: ["test"],
  culturalTags: [],
  rightsStatus: "verified",
  modelReleaseStatus: "not_required",
  propertyReleaseStatus: "not_required",
  authenticityConfidence: 1,
  humanVerified: true,
  contributor: "Sanity fixture",
  workflowStage: "approval",
  aiTags: [],
  curatorNotes: "",
  previewUrl: null,
  sourceFileName: "studio-sanity.jpg",
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  await page.route("**/api/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    authenticated: true,
    user: { id: "studio-sanity-user", email: "sanity@example.test", displayName: "Studio sanity", role: "buyer", organizationId: "org-demo", organizationName: "Studio sanity" },
    csrfToken: "studio-sanity-csrf",
  }) }));
  await page.route("**/api/search?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [fixtureAsset], suggestions: [] }) }));
  await page.route("**/api/auth/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ provider: "demo", redirectUrl: baseUrl }) }));
  await page.route("**/api/lightboxes", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) }));
  await page.route("**/api/discovery", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ trending: [], savedSearches: [], recommendations: [], personalized: false }) }));
  await page.route("**/api/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) }));
  await page.route("**/api/assets/studio-sanity-asset/original", (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "A paid licence is required to download this original." }) }));

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Media studio" }).click();
  await page.getByRole("button", { name: "Download selected photo" }).click();
  await page.locator(".studio-notice").filter({ hasText: "A paid licence is required" }).waitFor();
  await page.locator("input[type=file][accept='image/*']").setInputFiles({ name: "studio-sanity.png", mimeType: "image/png", buffer: onePixelPng });
  await page.locator(".studio-photo-editor").waitFor();
  await page.getByLabel(/Text overlay/).fill("A simple message");
  const imageDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download image" }).click();
  const imageDownload = await imageDownloadPromise;
  assert.match(imageDownload.suggestedFilename(), /studio-sanity-edited\.png$/);

  await page.getByRole("button", { name: "Back to workspace" }).click();
  await page.getByRole("button", { name: "Campaign editor" }).click();
  await page.locator(".studio-campaign-editor .gjs-block").first().waitFor();
  assert.ok(await page.locator(".studio-campaign-editor .gjs-block").count() >= 5, "GrapesJS block palette did not initialize");
  await page.locator(".studio-campaign-editor .studio-editor-status").waitFor({ state: "detached" });

  const zipDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download campaign ZIP" }).click();
  const zipDownload = await zipDownloadPromise;
  const stream = await zipDownload.createReadStream();
  assert.ok(stream, "Campaign ZIP download stream was not created");
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const zip = await JSZip.loadAsync(Buffer.concat(chunks));
  const names = Object.keys(zip.files);
  assert.ok(names.includes("index.html"), "ZIP is missing index.html");
  assert.ok(names.includes("styles.css"), "ZIP is missing styles.css");
  assert.ok(names.includes("campaign.json"), "ZIP is missing campaign.json");
  assert.ok(names.some((name) => name.startsWith("images/") && name !== "images/"), "ZIP is missing image assets");
  assert.deepEqual(pageErrors, [], `Studio browser errors: ${pageErrors.join("; ")}`);
  console.log(JSON.stringify({ ok: true, baseUrl, image: imageDownload.suggestedFilename(), zip: names.filter((name) => !name.endsWith("/")) }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
