import { chromium, expect } from "@playwright/test";
import { existsSync } from "node:fs";

const baseUrl = process.env.DEMO_BASE_URL ?? "http://127.0.0.1:8787";
const purchaseAssetTitle = process.env.DEMO_PURCHASE_ASSET_TITLE ?? "Aerial view of Simon's Town";
const liveDeployment = /^https:\/\//i.test(baseUrl);
const expectedMediaMinimum = Number(process.env.DEMO_EXPECT_MIN_MEDIA ?? (liveDeployment ? "100" : "1"));
const roles = ["buyer", "contributor", "editor", "admin"];
const screens = [
  ["Explore archive", "Explore archive"],
  ["Search workbench", "Search workbench"],
  ["Campaign intelligence", "Campaign intelligence"],
  ["Creator marketplace", "Creator marketplace"],
  ["Buyer ROI", "Buyer ROI"],
  ["Contributor insights", "Contributor insights"],
  ["Editorial review", "Editorial review"],
  ["Governance", "Governance"],
  ["Community", "Community"],
  ["Account", "Account"],
  ["Media studio", "Media studio"],
  ["Rights guide", "Rights guide"],
  ["System overview", "System overview"],
  ["WordPress", "WordPress"],
];
const screensByRole = {
  buyer: screens.filter(([label]) => !["Contributor insights", "Editorial review", "Governance", "WordPress"].includes(label)),
  contributor: screens.filter(([label]) => ["Explore archive", "Search workbench", "Creator marketplace", "Buyer ROI", "Contributor insights", "Community", "Account", "Rights guide", "System overview"].includes(label)),
  editor: screens.filter(([label]) => ["Explore archive", "Search workbench", "Creator marketplace", "Buyer ROI", "Contributor insights", "Editorial review", "Governance", "Community", "Account", "Rights guide", "System overview", "WordPress"].includes(label)),
  admin: screens,
};

async function waitUntil(check, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

function installedBrowserPath() {
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) return process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  if (process.platform !== "win32") return undefined;
  return [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((candidate) => existsSync(candidate));
}

const browser = await chromium.launch({ headless: true, executablePath: installedBrowserPath() });
try {
  for (const role of roles) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const failures = [];
    page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
    page.on("response", (response) => { if (response.status() >= 500) failures.push(`HTTP ${response.status()}: ${response.url()}`); });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("combobox", { name: "Demo role" }).selectOption(role);
    await page.getByRole("button", { name: "Enter demo" }).click();
    await page.getByRole("combobox", { name: "Switch role" }).waitFor();
    if (role === "buyer") {
      let purchaseAssetId = "";
      const catalogResponse = await page.request.get(`${baseUrl}/api/assets`);
      if (!catalogResponse.ok()) failures.push(`catalog request returned HTTP ${catalogResponse.status()}`);
      else {
        const catalog = await catalogResponse.json();
        const previewAssets = Array.isArray(catalog.results) ? catalog.results.filter((asset) => asset?.previewUrl) : [];
        const libraryAssets = previewAssets.filter((asset) => !String(asset.id ?? "").startsWith("asset-demo-"));
        const expectedAssets = liveDeployment ? libraryAssets : previewAssets;
        if (expectedAssets.length < expectedMediaMinimum) failures.push(`media catalogue has ${expectedAssets.length} usable previews; expected at least ${expectedMediaMinimum}`);
        for (const asset of expectedAssets.slice(0, 5)) {
          const response = await page.request.fetch(new URL(asset.previewUrl, baseUrl).toString(), { method: "HEAD" });
          if (!response.ok()) failures.push(`preview ${asset.id} returned HTTP ${response.status()}`);
        }
        purchaseAssetId = String(expectedAssets.find((asset) => asset.title === purchaseAssetTitle)?.id ?? "");
      }
      const assetCard = page.locator('article.asset-card[role="button"]').filter({ hasText: purchaseAssetTitle }).first();
      if (await assetCard.count()) {
        if (!purchaseAssetId) failures.push("buyer checkout asset id was not present in the catalogue");
        const assetUrl = `${baseUrl}/?asset=${encodeURIComponent(purchaseAssetId)}&purchase=1`;
        await assetCard.click();
        await page.getByRole("button", { name: /^(Purchase \d+ credits|Buy this asset with \d+ credits)/ }).first().click();
        const creditAction = page.locator(".asset-purchase-panel .credit-purchase-button");
        await creditAction.waitFor();
        await waitUntil(async () => !(await creditAction.isDisabled()), "Credit access action did not become enabled after validation");
        const actionLabel = await creditAction.innerText();
        if (/^Buy \d+ credits$/.test(actionLabel)) {
          await creditAction.click();
          await page.waitForURL(/\/account\?credits=complete[^#]*demo=1/, { waitUntil: "domcontentloaded" });
          await page.goto(assetUrl, { waitUntil: "domcontentloaded" });
        }
        await page.getByRole("dialog").waitFor();
        const purchasePanel = page.locator(".asset-purchase-panel");
        await purchasePanel.waitFor();
        const purchaseAction = purchasePanel.locator(".credit-purchase-button");
        await purchaseAction.waitFor();
        await waitUntil(async () => !(await purchaseAction.isDisabled()), "Credit purchase action did not become enabled after validation");
        await expect(purchasePanel.getByRole("heading", { name: /^Buy this asset with \d+ credits$/ })).toBeVisible();
        await expect(purchasePanel.getByText(/Credits unlock downloads\/streams for/)).toBeVisible();
        await page.locator("details.purchase-terms summary").click();
        await page.locator(".purchase-terms-check input").check();
        await purchaseAction.click();
        await page.getByText("Media unlocked", { exact: true }).waitFor();
        await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
        await page.getByRole("dialog").waitFor({ state: "detached" });
      } else {
        failures.push("buyer checkout asset was not present");
      }
    }
    for (const [label, contextLabel] of screensByRole[role]) {
      await page.locator(".better-nav-item").filter({ hasText: label }).click();
      await page.locator(".better-context strong").filter({ hasText: contextLabel }).waitFor();
      const body = await page.locator("body").innerText();
      if (!body.includes(contextLabel)) failures.push(`${role}/${label}: screen label missing`);
      if (body.includes("The live demo session is unavailable")) failures.push(`${role}/${label}: demo session unavailable`);
    }
    if (failures.length) throw new Error(`${role} screen smoke failed:\n- ${failures.join("\n- ")}`);
    console.log(`✓ ${role}: ${screensByRole[role].length} screens loaded`);
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ ok: true, baseUrl, roles, expectedMediaMinimum, screensByRole: Object.fromEntries(Object.entries(screensByRole).map(([role, roleScreens]) => [role, roleScreens.map(([label]) => label)])) }, null, 2));
