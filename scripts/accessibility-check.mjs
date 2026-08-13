import { spawn } from "node:child_process";
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

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
  const scan = () => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  const initial = await scan();
  const initialPassed = report("archive landing page", initial);
  const firstAsset = page.locator("button.asset-card").first();
  await firstAsset.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close asset details" })).toBeFocused();
  await expect(page.getByText("Model release:")).toBeVisible();
  await expect(page.getByText("Property release:")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(firstAsset).toBeFocused();
  await page.getByRole("button", { name: "Community & collections" }).click();
  await page.getByRole("button", { name: "Open a resolution case" }).click();
  const resolution = await scan();
  const resolutionPassed = report("community and resolution workspace", resolution);
  await context.close();
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
  const overflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (overflow) { console.error("✗ mobile archive layout overflows horizontally"); process.exitCode = 1; } else console.log("✓ mobile archive layout fits viewport");
  const suggestion = mobilePage.locator("button.suggestion").first();
  await suggestion.click();
  await expect(mobilePage.locator("input[aria-label='Search media']")).toHaveValue(/.+/);
  const mobileScan = await new AxeBuilder({ page: mobilePage }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  const mobilePassed = report("mobile archive landing page", mobileScan);
  await mobileContext.close();
  await browser.close();
  if (!initialPassed || !resolutionPassed || !mobilePassed) process.exitCode = 1;
} finally {
  server.kill();
}
