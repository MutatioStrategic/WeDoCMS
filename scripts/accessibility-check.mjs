import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
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
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
  const scan = () => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  const initial = await scan();
  const initialPassed = report("archive landing page", initial);
  await page.locator("button.stakeholder-nav-link").click();
  const stakeholderOverview = await scan();
  const stakeholderOverviewPassed = report("stakeholder system overview", stakeholderOverview);
  await page.getByRole("button", { name: /Media studio/ }).click();
  const studio = await scan();
  const studioPassed = report("media formatting studio", studio);
  await page.getByRole("button", { name: "Community & collections" }).click();
  await page.getByRole("button", { name: "Open a resolution case" }).click();
  const resolution = await scan();
  const resolutionPassed = report("community and resolution workspace", resolution);
  await context.close();
  await browser.close();
  if (!initialPassed || !stakeholderOverviewPassed || !studioPassed || !resolutionPassed) process.exitCode = 1;
} finally {
  server.kill();
}
