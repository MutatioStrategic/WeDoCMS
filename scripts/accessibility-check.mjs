import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const port = "4173";
const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const server = spawn(process.execPath, [viteBin, "preview", "--host", "127.0.0.1", "--port", port], { stdio: "ignore" });

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { await fetch(`http://127.0.0.1:${port}`); return; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  throw new Error("Vite preview did not start in time");
}

function report(label, results) {
  if (!results.violations.length) { console.log(`✓ ${label}: no WCAG 2.2 AA violations`); return true; }
  console.error(`✗ ${label}: ${results.violations.length} accessibility violation(s)`);
  for (const violation of results.violations) {
    console.error(`  ${violation.id}: ${violation.help} (${violation.nodes.length} node(s))`);
    for (const node of violation.nodes) console.error(`    ${node.target.join(", ")}`);
  }
  return false;
}

function installedBrowserPath() {
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) return process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  if (process.platform !== "win32") return undefined;
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true, executablePath: installedBrowserPath() });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("**/api/search?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [{
      id: "fixture-published-preview", kind: "image", status: "published", title: "Table Mountain preview", description: "A published preview-backed archive record.", caption: "Table Mountain above Cape Town.", country: "South Africa", province: "Western Cape", city: "Cape Town", locality: "City Bowl", landmark: "Table Mountain", subjectTags: ["landscape"], culturalTags: ["South African landscape"], rightsStatus: "pending", modelReleaseStatus: "not_required", propertyReleaseStatus: "not_required", authenticityConfidence: 0.8, humanVerified: true, contributor: "Fixture archive", workflowStage: "approval", aiTags: ["mountain"], curatorNotes: "", previewUrl: "/api/assets/fixture-published-preview/media?variant=preview"
    }] }) });
  });
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
  const scan = () => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  const initial = await scan();
  const initialPassed = report("archive landing page", initial);
  await page.waitForFunction(() => {
    const button = document.querySelector("form.search-box button");
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await page.getByLabel("Search photo and video").fill("Table Mountain");
  await page.locator("form.search-box button[type=submit]").click();
  await page.locator(".search-trace-card.is-loading .search-trace-scan").first().waitFor();
  console.log("\\u2713 archive search: scanning feedback is visible while results load");
  await page.locator(".search-status-dot.complete").waitFor();
  const searchResults = await scan();
  const searchPassed = report("archive search results", searchResults);
  await page.locator(".asset-card").first().click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: /purchase|buy|access/i }).last().waitFor();
  const assetDialog = await scan();
  const assetDialogPassed = report("asset purchase dialog", assetDialog);
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.locator(".better-nav-item").filter({ hasText: "System overview" }).click();
  const stakeholderOverview = await scan();
  const stakeholderOverviewPassed = report("stakeholder system overview", stakeholderOverview);
  // Role-gated workspaces are intentionally omitted from anonymous navigation;
  // their sign-up affordance is exposed in the header instead of a dead-end link.
  await expect(page.locator(".better-nav-item").filter({ hasText: "Media studio" })).toHaveCount(0);
  await page.locator(".better-nav-item").filter({ hasText: "Community" }).click();
  await page.getByRole("button", { name: "Open a resolution case" }).click();
  const resolution = await scan();
  const resolutionPassed = report("community and resolution workspace", resolution);
  await context.close();
  await browser.close();
  if (!initialPassed || !searchPassed || !assetDialogPassed || !stakeholderOverviewPassed || !resolutionPassed) process.exitCode = 1;
} finally {
  server.kill();
}
