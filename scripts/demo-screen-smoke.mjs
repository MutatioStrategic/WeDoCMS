import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";

const baseUrl = process.env.DEMO_BASE_URL ?? "http://127.0.0.1:8787";
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
      }
    }
    for (const [label, contextLabel] of screens) {
      await page.locator(".better-nav-item").filter({ hasText: label }).click();
      await page.locator(".better-context strong").filter({ hasText: contextLabel }).waitFor();
      const body = await page.locator("body").innerText();
      if (!body.includes(contextLabel)) failures.push(`${role}/${label}: screen label missing`);
      if (body.includes("The live demo session is unavailable")) failures.push(`${role}/${label}: demo session unavailable`);
    }
    if (failures.length) throw new Error(`${role} screen smoke failed:\n- ${failures.join("\n- ")}`);
    console.log(`✓ ${role}: ${screens.length} screens loaded`);
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ ok: true, baseUrl, roles, expectedMediaMinimum, screens: screens.map(([label]) => label) }, null, 2));
