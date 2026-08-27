import { readFile } from "node:fs/promises";
import { chromium, firefox, webkit } from "@playwright/test";
import newman from "newman";
import Enforcer from "openapi-enforcer";
import { parse } from "yaml";
import { createQaReport, pathOnly, redact } from "./qa-report.mjs";

const baseUrl = (process.env.QA_BASE_URL || process.env.E2E_BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const purchaseAssetId = process.env.QA_PURCHASE_ASSET_ID || "asset-demo-simons-town-aerial";
const runWrites = process.env.QA_RUN_WRITES === "true" || /https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(baseUrl);
const writeStoriesEnabled = runWrites && process.env.QA_SKIP_WRITES !== "true";
const spec = parse(await readFile(new URL("../docs/openapi.yaml", import.meta.url), "utf8"));
const openapi = await Enforcer(spec, { hideWarnings: true });
const report = await createQaReport({ suite: "Stockvel browser handoffs and Newman contracts", baseUrl });
const allBrowserDefinitions = [
  ["Chromium", chromium],
  ["Firefox", firefox],
  ["WebKit", webkit],
];
const requestedBrowsers = new Set((process.env.QA_BROWSERS || "Chromium,Firefox,WebKit").split(",").map((value) => value.trim()).filter(Boolean));
const browserDefinitions = allBrowserDefinitions.filter(([name]) => requestedBrowsers.has(name));
assertion(browserDefinitions.length > 0, "QA_BROWSERS did not select a supported browser");

function assertion(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitUntil(check, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message + (lastError ? ": " + redact(lastError.message) : ""));
}

function contractParts(contract) {
  const separator = contract.indexOf(" ");
  return { method: contract.slice(0, separator), path: contract.slice(separator + 1) };
}

function pathPattern(contractPath) {
  const escaped = contractPath.replace(/[\^$.*+?()[\]{}|]/g, "\\$&");
  return new RegExp("^" + escaped.replace(/\\\{[^}]+\\\}/g, "[^/]+") + "$");
}

function responseFor(logs, contract, status) {
  const { method, path } = contractParts(contract);
  const pattern = pathPattern(path);
  return logs.find((entry) => entry.type === "response"
    && entry.method === method
    && pattern.test(entry.path)
    && (status === undefined || entry.status === status));
}

async function waitForResponse(logs, contract, status) {
  await waitUntil(() => Boolean(responseFor(logs, contract, status)), "Expected " + contract + " response " + (status ?? "any"));
}

function assertContractCoverage(logs, expected, featureName) {
  const missingSpec = expected.filter((contract) => {
    const { method, path } = contractParts(contract);
    return !spec.paths?.[path]?.[method.toLowerCase()];
  });
  assertion(!missingSpec.length, featureName + " uses paths missing from OpenAPI: " + missingSpec.join(", "));
  const missingObserved = expected.filter((contract) => !logs.some((entry) => {
    if (entry.type !== "request" || entry.method !== contractParts(contract).method) return false;
    return pathPattern(contractParts(contract).path).test(entry.path);
  }));
  assertion(!missingObserved.length, featureName + " did not trigger expected browser calls: " + missingObserved.join(", "));
}

function assertNoServerErrors(logs, featureName) {
  const errors = logs.filter((entry) => entry.type === "response" && entry.status >= 500);
  assertion(!errors.length, featureName + " received server errors: " + errors.map((entry) => entry.status + " " + entry.path).join(", "));
  const failed = logs.filter((entry) => entry.type === "requestfailed"
    && !["image", "media"].includes(entry.resourceType)
    && !/abort|cancelled|canceled/i.test(entry.error || ""));
  assertion(!failed.length, featureName + " had failed API requests: " + failed.map((entry) => entry.method + " " + entry.path).join(", "));
}

async function loginDemo(page, logs, role) {
  await page.getByRole("combobox", { name: "Demo role" }).selectOption(role);
  await page.getByRole("button", { name: "Enter demo" }).click();
  await page.getByRole("combobox", { name: "Switch role" }).waitFor();
  await waitForResponse(logs, "POST /api/auth/demo-login", 200);
}

async function openDemoPage(page, logs, role) {
  await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Find the image/ }).waitFor();
  await loginDemo(page, logs, role);
}

async function runBrowserStory(browser, browserName, featureName, expectedPaths, story) {
  const startedAt = Date.now();
  let context;
  let page;
  let logs = [];
  console.log("[qa] start " + browserName + " / " + featureName);
  let screenshots = [];
  try {
    context = await browser.newContext({ baseURL: baseUrl });
    context.setDefaultTimeout(Number(process.env.QA_TIMEOUT_MS || 20_000));
    page = await context.newPage();
    await page.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
    await page.route("https://fonts.gstatic.com/**", (route) => route.fulfill({ status: 200, contentType: "font/woff2", body: Buffer.alloc(0) }));
    logs = report.attachPageLogging(page, browserName);
    const outcome = await story({ page, logs, screenshot: async (step) => {
      const file = await report.screenshot(page, browserName, featureName, step);
      screenshots.push(file);
      return file;
    } });
    const storyExpectedPaths = Array.isArray(outcome?.expectedPaths) ? outcome.expectedPaths : expectedPaths;
    assertNoServerErrors(logs, featureName);
    assertContractCoverage(logs, storyExpectedPaths, featureName);
    report.addResult({
      featureName,
      browser: browserName,
      backendPaths: storyExpectedPaths,
      status: "passed",
      durationMs: Date.now() - startedAt,
      screenshots,
      details: outcome || {},
    });
    console.log("[qa] pass " + browserName + " / " + featureName);
  } catch (error) {
    if (page) {
      try {
        screenshots.push(await report.screenshot(page, browserName, featureName, "failure"));
      } catch {
        // The browser may have failed before a page could be captured.
      }
    }
    report.addResult({
      featureName,
      browser: browserName,
      backendPaths: expectedPaths,
      status: "failed",
      durationMs: Date.now() - startedAt,
      screenshots,
      details: {},
      error: error instanceof Error ? error.message : String(error),
    });
    console.log("[qa] fail " + browserName + " / " + featureName + ": " + redact(error instanceof Error ? error.message : String(error)));
  } finally {
    await context?.close();
  }
}

async function exploreAndSearch({ page, logs, screenshot }) {
  await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Find the image/ }).waitFor();
  await waitForResponse(logs, "GET /api/auth/session", 200);
  await waitForResponse(logs, "GET /api/search", 200);
  await waitForResponse(logs, "GET /api/discovery", 200);
  await screenshot("landing");
  const input = page.getByLabel("Search photo and video").first();
  await input.fill("Table Mountain");
  await input.press("Enter");
  await page.locator(".search-status-dot.complete").waitFor();
  await screenshot("search-results");
  const firstCard = page.locator("article.asset-card").first();
  await firstCard.waitFor();
  await firstCard.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assertion((await dialog.innerText()).includes("Rights:"), "Asset evidence dialog did not show rights context");
  await screenshot("asset-evidence");
  await dialog.getByRole("button", { name: "Close" }).click();
  await dialog.waitFor({ state: "detached" });
  return { message: "Anonymous search, evidence inspection, and modal close completed." };
}

async function buyerLicenceHandoff({ page, logs, screenshot }) {
  await openDemoPage(page, logs, "buyer");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("combobox", { name: "Switch role" }).waitFor();
  await screenshot("session-continuity");
  const assetUrl = baseUrl + "/?asset=" + encodeURIComponent(purchaseAssetId) + "&purchase=1";
  await page.goto(assetUrl, { waitUntil: "domcontentloaded" });
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const purchasePanel = page.locator(".asset-purchase-panel");
  await purchasePanel.waitFor();
  const purchaseButton = purchasePanel.locator(".credit-purchase-button");
  await purchaseButton.waitFor();
  await waitUntil(async () => !(await purchaseButton.isDisabled()), "Credit access action did not become enabled after validation");
  let creditTopUpRequired = false;
  if (/^Buy \d+ credits/.test(await purchaseButton.innerText())) {
    creditTopUpRequired = true;
    await purchaseButton.click();
    await page.waitForURL(/\/account\?credits=complete[^#]*demo=1/, { waitUntil: "domcontentloaded" });
    await page.goto(assetUrl, { waitUntil: "domcontentloaded" });
    await page.getByRole("dialog").waitFor();
    await purchasePanel.waitFor();
    await purchaseButton.waitFor();
    await waitUntil(async () => !(await purchaseButton.isDisabled()), "Credit purchase action did not become enabled after top-up");
  }
  await page.locator("details.purchase-terms summary").click();
  await page.locator(".purchase-terms-check input").check();
  await screenshot("checkout-ready");
  await purchaseButton.click();
  await page.getByText("Media unlocked", { exact: true }).waitFor();
  await waitUntil(() => Boolean(responseFor(logs, "POST /api/checkout", 201) || responseFor(logs, "POST /api/checkout", 200)), "Credit-funded checkout did not return a success response");
  await page.goto(baseUrl + "/account", { waitUntil: "domcontentloaded" });
  assertion(new URL(page.url()).origin === new URL(baseUrl).origin, "Buyer account handoff left the configured origin");
  await page.getByText("PURCHASE HISTORY & RECEIPTS", { exact: true }).waitFor();
  await waitForResponse(logs, "GET /api/account/lifecycle", 200);
  await waitForResponse(logs, "GET /api/my/purchases", 200);
  await waitForResponse(logs, "GET /api/my/credits", 200);
  await waitForResponse(logs, "GET /api/subscription", 200);
  await waitForResponse(logs, "GET /api/my/free-downloads", 200);
  await screenshot("account-after-payment");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Proof of what your team can use", { exact: true }).waitFor();
  return {
    expectedPaths: [
      "POST /api/auth/demo-login",
      "GET /api/auth/session",
      "GET /api/search",
      "GET /api/discovery",
      "GET /api/lightboxes",
      "GET /api/notifications",
      "POST /api/checkout/validate",
      ...(creditTopUpRequired ? ["POST /api/buyer/credits/checkout", "GET /api/demo/payments/{licenceId}/complete"] : []),
      "POST /api/checkout",
      "GET /api/account/lifecycle",
      "GET /api/my/purchases",
      "GET /api/my/credits",
      "GET /api/subscription",
      "GET /api/my/free-downloads",
    ],
    message: creditTopUpRequired
      ? "Buyer credit top-up, credit-funded media unlock, account handoff, and reload continuity completed."
      : "Credit-funded media unlock, account handoff, and reload continuity completed.",
  };
}

const roleStories = [
  {
    role: "contributor",
    featureName: "Contributor workspace handoff",
    navigation: "Contributor insights",
    context: "Contributor insights",
    paths: [
      "POST /api/auth/demo-login",
      "GET /api/auth/session",
      "GET /api/analytics/contributor",
      "GET /api/my/assets",
      "GET /api/legal/agreements",
    ],
  },
  {
    role: "editor",
    featureName: "Editor review workspace handoff",
    navigation: "Editorial review",
    context: "Editorial review",
    paths: [
      "POST /api/auth/demo-login",
      "GET /api/auth/session",
      "GET /api/admin/review",
    ],
  },
  {
    role: "admin",
    featureName: "Admin governance workspace handoff",
    navigation: "Governance",
    context: "Governance",
    paths: [
      "POST /api/auth/demo-login",
      "GET /api/auth/session",
      "GET /api/governance/assets",
      "GET /api/legal/agreements",
    ],
  },
];

async function roleWorkspace({ page, logs, screenshot }, story) {
  await openDemoPage(page, logs, story.role);
  await page.locator(".better-nav-item").filter({ hasText: story.navigation }).click();
  await waitUntil(async () => (await page.locator(".better-context strong").textContent()) === story.context, "Workspace navigation did not reach " + story.context);
  for (const path of story.paths.filter((item) => item.startsWith("GET "))) {
    if (path === "GET /api/auth/session") continue;
    await waitForResponse(logs, path, 200);
  }
  await screenshot("workspace-loaded");
  return { message: story.context + " loaded with its role-authorized API calls." };
}

async function createContributorAsset({ page, logs, screenshot }, state) {
  await openDemoPage(page, logs, "contributor");
  await page.locator(".better-nav-item").filter({ hasText: "Contributor insights" }).click();
  await page.getByRole("heading", { name: "Submit a record" }).waitFor();
  const title = "QA handoff asset " + Date.now();
  const form = page.locator("form").filter({ hasText: "Submit a record" }).first();
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Caption").fill("A browser-to-Worker ingestion contract fixture.");
  await form.getByLabel("Licence version / terms").fill("QA fixture licence: editorial review required before publication.");
  await form.getByLabel("City").fill("Cape Town");
  await form.getByLabel("Locality").fill("City Bowl");
  await form.getByLabel("Subject tags").fill("landscape, archive");
  await form.getByLabel("Cultural context tags").fill("South African landscape");
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && pathOnly(response.url()) === "/api/assets");
  await form.getByRole("button", { name: /Submit for review/ }).click();
  const response = await responsePromise;
  const body = await response.json();
  assertion(response.status() === 201 && body.status === "needs_review" && typeof body.id === "string", "Asset ingestion response did not match the 201 contract");
  state.createdAsset = { id: body.id, title };
  await screenshot("asset-submitted");
  return { message: "Contributor metadata was created as a needs_review record.", createdAssetId: body.id };
}

async function publishContributorAsset({ page, logs, screenshot }, state) {
  assertion(state.createdAsset, "Publication handoff has no asset created by the ingestion story");
  await openDemoPage(page, logs, "editor");
  await page.locator(".better-nav-item").filter({ hasText: "Governance" }).click();
  await page.locator(".governance-item").filter({ hasText: state.createdAsset.title }).first().waitFor();
  await page.locator(".governance-item").filter({ hasText: state.createdAsset.title }).first().click();
  const workingTitle = page.getByLabel("Working title");
  await workingTitle.fill(state.createdAsset.title + " published");
  const saveCorrectionPromise = page.waitForResponse((response) => response.request().method() === "POST" && pathOnly(response.url()) === "/api/governance/assets/" + state.createdAsset.id + "/action");
  await page.getByRole("button", { name: /Save correction/ }).click();
  assertion((await saveCorrectionPromise).status() === 200, "Governance correction did not return 200");
  const publishPromise = page.waitForResponse((response) => response.request().method() === "POST" && pathOnly(response.url()) === "/api/governance/assets/" + state.createdAsset.id + "/action");
  await page.getByRole("button", { name: /Approve asset/ }).click();
  assertion((await publishPromise).status() === 200, "Governance approval did not return 200");
  const published = await page.evaluate(async (assetId) => {
    const response = await fetch("/api/assets/" + encodeURIComponent(assetId));
    return { status: response.status, body: await response.json() };
  }, state.createdAsset.id);
  assertion(published.status === 200 && published.body.title === state.createdAsset.title + " published" && published.body.status === "published", "Published asset was not returned by the asset detail contract");
  await screenshot("asset-published");
  return { message: "Editor governance correction and publication handoff completed.", publishedAssetId: state.createdAsset.id };
}

function responseHeaders(response) {
  const headers = {};
  const values = response?.headers?.toJSON?.() || response?.headers || [];
  for (const header of values) {
    if (header?.key) headers[String(header.key).toLowerCase()] = String(header.value ?? "");
  }
  return headers;
}

function responseBody(execution) {
  const stream = execution.response?.stream;
  if (stream === undefined || stream === null) return undefined;
  const text = Buffer.isBuffer(stream) ? stream.toString("utf8") : String(stream);
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function normalizeEnforcerDates(value) {
  if (Array.isArray(value)) return value.map(normalizeEnforcerDates);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeEnforcerDates(entry)]));
  if (typeof value !== "string") return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + "T00:00:00.000Z");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return new Date(value);
  return value;
}

function collectionTestScript(caseDefinition) {
  const lines = [
    "const expected = JSON.parse(pm.variables.get('expectedStatuses') || '[]');",
    "pm.test('HTTP status matches the contract', () => pm.expect(expected).to.include(pm.response.code));",
    "if (pm.response.code !== 303) {",
    "  pm.test('API response is JSON', () => pm.response.to.have.jsonBody());",
    "  if (pm.response.code >= 400) pm.test('error response exposes error', () => pm.expect(pm.response.json()).to.have.property('error'));",
    "}",
  ];
  if (caseDefinition.key === "demoLogin") {
    lines.push("const body = pm.response.json(); if (body.csrfToken) pm.collectionVariables.set('csrfToken', body.csrfToken);");
  }
  if (caseDefinition.key === "checkout") {
    lines.push("const body = pm.response.json(); pm.collectionVariables.set('licenceId', body.licenceId);");
  }
  if (caseDefinition.key === "creditCheckout") {
    lines.push("const body = pm.response.json(); pm.collectionVariables.set('creditPurchaseId', body.purchaseId); pm.test('demo provider credit checkout URL is returned', () => pm.expect(body.provider).to.eql('demo'));");
  }
  if (caseDefinition.key === "creditCompletion") {
    lines.push("const location = pm.response.headers.get('Location') || ''; pm.test('demo credit completion redirects to account', () => pm.expect(location).to.match(/\\/account(?:\\?|$)/));");
  }
  lines.push("pm.collectionVariables.unset('expectedStatuses');");
  return lines;
}

const contractCases = [
  { key: "health", featureName: "Public health contract", method: "GET", path: "/api/health", expectedStatuses: [200] },
  { key: "anonymousSession", featureName: "Anonymous session contract", method: "GET", path: "/api/auth/session", expectedStatuses: [200] },
  { key: "anonymousAssets", featureName: "Public asset search contract", method: "GET", path: "/api/assets", expectedStatuses: [200] },
  { key: "discovery", featureName: "Discovery contract", method: "GET", path: "/api/discovery", expectedStatuses: [200] },
  { key: "invalidExchange", featureName: "Invalid identity exchange contract", method: "POST", path: "/api/auth/exchange", expectedStatuses: [401], headers: [{ key: "Authorization", value: "Bearer invalid-contract-token" }], body: { organizationId: "org-demo" } },
  { key: "unauthenticatedAssetCreate", featureName: "Unauthenticated asset creation contract", method: "POST", path: "/api/assets", expectedStatuses: [403], body: { kind: "image", title: "New contract asset", description: "Contract fixture", caption: "Contract fixture", subjectTags: ["test"], culturalTags: ["South African archive"], rightsStatus: "pending", modelReleaseStatus: "unknown", propertyReleaseStatus: "unknown", monetizationModel: "membership", licensePriceCents: null } },
  { key: "unauthenticatedAccountLifecycle", featureName: "Unauthenticated account lifecycle contract", method: "GET", path: "/api/account/lifecycle", expectedStatuses: [401] },
  { key: "demoLogin", featureName: "Demo login contract", method: "POST", path: "/api/auth/demo-login", expectedStatuses: [200], body: { role: "buyer" } },
  { key: "authenticatedSession", featureName: "Authenticated session contract", method: "GET", path: "/api/auth/session", expectedStatuses: [200] },
  { key: "licenceProducts", featureName: "Licence products contract", method: "GET", path: "/api/licence-products", expectedStatuses: [200] },
  { key: "legalAgreements", featureName: "Versioned agreements contract", method: "GET", path: "/api/legal/agreements", expectedStatuses: [200] },
  { key: "checkoutValidation", featureName: "Licence validation contract", method: "POST", path: "/api/checkout/validate", expectedStatuses: [200], body: { assetId: purchaseAssetId, licenceType: "commercial", territory: "Worldwide", durationDays: 365, includeCustomBuying: false } },
  { key: "creditCheckout", featureName: "Media credit checkout contract", method: "POST", path: "/api/buyer/credits/checkout", expectedStatuses: [201], body: { credits: 100, successUrl: baseUrl + "/account?credits=complete", cancelUrl: baseUrl + "/account?credits=cancelled" } },
  { key: "creditCompletion", featureName: "Demo credit completion contract", method: "GET", path: "/api/demo/payments/{{creditPurchaseId}}/complete", expectedStatuses: [303] },
  { key: "checkout", featureName: "Licence creation contract", method: "POST", path: "/api/checkout", expectedStatuses: [200, 201], body: { assetId: purchaseAssetId, licenceType: "commercial", territory: "Worldwide", durationDays: 365, buyerAgreementVersion: "buyer-marketplace-v2", paymentAgreementVersion: "payment-split-v2", acceptBuyerTerms: true, includeCustomBuying: false } },
  { key: "purchases", featureName: "Buyer purchase history contract", method: "GET", path: "/api/my/purchases", expectedStatuses: [200] },
  { key: "credits", featureName: "Buyer credits contract", method: "GET", path: "/api/my/credits", expectedStatuses: [200] },
  { key: "accountLifecycle", featureName: "Account lifecycle contract", method: "GET", path: "/api/account/lifecycle", expectedStatuses: [200] },
  { key: "freeDownloads", featureName: "Introductory downloads contract", method: "GET", path: "/api/my/free-downloads", expectedStatuses: [200] },
];

function collectionItem(caseDefinition) {
  const headers = [
    { key: "Accept", value: "application/json" },
    ...(caseDefinition.body ? [{ key: "Content-Type", value: "application/json" }] : []),
    ...(caseDefinition.key === "invalidExchange" ? [] : caseDefinition.key === "demoLogin" ? [] : caseDefinition.key === "unauthenticatedAssetCreate" ? [] : caseDefinition.key === "unauthenticatedAccountLifecycle" ? [] : [{ key: "X-CSRF-Token", value: "{{csrfToken}}" }]),
  ];
  return {
    name: caseDefinition.featureName,
    request: {
      method: caseDefinition.method,
      header: headers.concat(caseDefinition.headers || []),
      url: "{{baseUrl}}" + caseDefinition.path,
      ...(caseDefinition.body ? { body: { mode: "raw", raw: JSON.stringify(caseDefinition.body) } } : {}),
    },
    event: [{
      listen: "test",
      script: {
        type: "text/javascript",
        exec: collectionTestScript(caseDefinition),
      },
    }],
  };
}

async function runNewmanContracts() {
  const startedAt = Date.now();
  console.log("[qa] start Newman / OpenAPI contracts");
  const collection = {
    info: {
      name: "Stockvel user-story OpenAPI contracts",
      _postman_id: "veld-archive-qa-contracts",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [
      { key: "baseUrl", value: baseUrl },
      { key: "csrfToken", value: "" },
      { key: "licenceId", value: "" },
      { key: "creditPurchaseId", value: "" },
      { key: "expectedStatuses", value: "" },
    ],
    item: contractCases.map((caseDefinition) => {
      const item = collectionItem(caseDefinition);
      return {
        ...item,
        event: [{
          listen: "prerequest",
          script: {
            type: "text/javascript",
            exec: ["pm.collectionVariables.set('expectedStatuses', '" + JSON.stringify(caseDefinition.expectedStatuses).replaceAll("'", "\\'") + "');"],
          },
        }, ...item.event],
      };
    }),
  };
  const newmanLog = [];
  let summary;
  let runError;
  await new Promise((resolve) => {
    const run = newman.run({
      collection,
      reporters: ["cli"],
      timeoutRequest: 20_000,
      bail: false,
      followRedirect: false,
      ignoreRedirects: true,
    }, (error, result) => {
      runError = error;
      summary = result;
      resolve();
    });
    run.on("request", (error, execution) => {
      if (error) newmanLog.push({ type: "request-error", error: redact(error.message) });
      else newmanLog.push({ type: "request", method: execution.request.method, path: pathOnly(execution.request.url.toString()) });
    });
    run.on("response", (error, execution) => {
      if (error) newmanLog.push({ type: "response-error", error: redact(error.message) });
      else newmanLog.push({ type: "response", method: execution.request.method, path: pathOnly(execution.request.url.toString()), status: execution.response.code });
    });
  });

  const executions = summary?.run?.executions || [];
  const byName = new Map(contractCases.map((item) => [item.featureName, item]));
  for (const execution of executions) {
    const definition = byName.get(execution.item?.name);
    if (!definition) continue;
    const actualUrl = execution.request?.url?.toString?.() || "";
    const actualPath = pathOnly(actualUrl);
    const status = Number(execution.response?.code || 0);
    const body = responseBody(execution);
    const headers = responseHeaders(execution.response);
    let contractError = null;
    try {
      const [request, requestError] = openapi.request({
        method: definition.method,
        path: actualPath,
        headers: { "content-type": "application/json" },
        ...(definition.body ? { body: definition.body } : {}),
      });
      if (requestError) throw new Error(String(requestError));
      const [, responseError] = request.response(status, normalizeEnforcerDates(body), headers);
      if (responseError) throw new Error(String(responseError));
    } catch (error) {
      contractError = error instanceof Error ? error.message : String(error);
    }
    const testFailures = (execution.assertions || []).filter((item) => item.error).map((item) => item.error.message);
    const errors = [contractError, ...testFailures].filter(Boolean);
    report.addResult({
      featureName: definition.featureName,
      browser: "Newman",
      backendPaths: [definition.method + " " + definition.path],
      status: errors.length || !definition.expectedStatuses.includes(status) ? "failed" : "passed",
      durationMs: execution.request?.duration || Date.now() - startedAt,
      details: {
        status,
        expectedStatuses: definition.expectedStatuses,
        schema: errors.length ? "mismatch" : "matched",
        ...(errors.length ? { message: errors.join("; ") } : {}),
      },
      error: errors.length ? errors.join("; ") : null,
    });
  }
  report.logEntries.set("Newman", newmanLog);
  if (runError && !executions.length) throw runError;
  if (!executions.length) throw new Error("Newman did not produce any contract executions");
  if (executions.length !== contractCases.length) throw new Error("Newman executed " + executions.length + " of " + contractCases.length + " contract cases");
  const failed = report.results.filter((result) => result.browser === "Newman" && result.status === "failed").length;
  console.log("[qa] " + (failed ? "fail" : "pass") + " Newman / OpenAPI contracts (" + executions.length + " requests)");
  return { requestCount: executions.length };
}

try {
  for (const [browserName, engine] of browserDefinitions) {
    let browser;
    const state = { createdAsset: null };
    try {
      browser = await engine.launch({ headless: true });
    } catch (error) {
      report.addResult({
        featureName: "Browser engine startup",
        browser: browserName,
        backendPaths: [],
        status: "failed",
        durationMs: 0,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    await runBrowserStory(browser, browserName, "Explore and search", [
      "GET /api/auth/session",
      "GET /api/search",
      "GET /api/discovery",
    ], exploreAndSearch);
    await runBrowserStory(browser, browserName, "Buyer licence checkout handoff", [
      "POST /api/auth/demo-login",
      "GET /api/auth/session",
      "GET /api/search",
      "GET /api/discovery",
      "GET /api/lightboxes",
      "GET /api/notifications",
      "POST /api/checkout/validate",
      "POST /api/buyer/credits/checkout",
      "GET /api/demo/payments/{licenceId}/complete",
      "POST /api/checkout",
      "GET /api/account/lifecycle",
      "GET /api/my/purchases",
      "GET /api/my/credits",
      "GET /api/subscription",
      "GET /api/my/free-downloads",
    ], buyerLicenceHandoff);
    for (const story of roleStories) {
      await runBrowserStory(browser, browserName, story.featureName, story.paths, (context) => roleWorkspace(context, story));
    }
    if (writeStoriesEnabled) {
      await runBrowserStory(browser, browserName, "Contributor asset ingestion", [
        "POST /api/auth/demo-login",
        "GET /api/auth/session",
        "GET /api/analytics/contributor",
        "GET /api/my/assets",
        "GET /api/legal/agreements",
        "POST /api/assets",
      ], (context) => createContributorAsset(context, state));
      if (state.createdAsset) {
        await runBrowserStory(browser, browserName, "Editor publication handoff", [
          "POST /api/auth/demo-login",
          "GET /api/auth/session",
          "GET /api/governance/assets",
          "GET /api/legal/agreements",
          "POST /api/governance/assets/{id}/action",
          "GET /api/assets/{id}",
        ], (context) => publishContributorAsset(context, state));
      }
    } else {
      report.addResult({
        featureName: "Contributor asset ingestion",
        browser: browserName,
        backendPaths: ["POST /api/assets"],
        status: "skipped",
        durationMs: 0,
        details: { message: "Write stories require a local QA Worker or QA_RUN_WRITES=true." },
      });
      report.addResult({
        featureName: "Editor publication handoff",
        browser: browserName,
        backendPaths: ["POST /api/governance/assets/{id}/action"],
        status: "skipped",
        durationMs: 0,
        details: { message: "Write stories require a local QA Worker or QA_RUN_WRITES=true." },
      });
    }
    await browser.close();
  }
  await runNewmanContracts();
} finally {
  const result = await report.write({
    configuration: {
      browsers: browserDefinitions.map(([name]) => name),
      purchaseAssetId,
      writeStoriesEnabled,
      newman: true,
    },
  });
  console.log(JSON.stringify({
    ...result.payload.summary,
    reportJson: result.jsonPath,
    reportHtml: result.htmlPath,
  }, null, 2));
  if (result.payload.summary.failed > 0) process.exitCode = 1;
}
