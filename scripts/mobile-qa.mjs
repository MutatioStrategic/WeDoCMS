import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const port = "4174";
const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const server = spawn(process.execPath, [viteBin, "preview", "--host", "127.0.0.1", "--port", port], { stdio: "ignore" });
const profiles = [
  { name: "iPhone 14", width: 390, height: 844 },
  { name: "Redmi Note", width: 393, height: 873 },
  { name: "Samsung Galaxy", width: 360, height: 800 },
];

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { await fetch(`http://127.0.0.1:${port}`); return; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  throw new Error("Vite preview did not start in time");
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  for (const profile of profiles) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
    const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    await expect(page.getByRole("button", { name: "Campaign intelligence. Sign in required.", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("button", { name: "Community", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Make the archive/ })).toBeVisible();
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("button", { name: "Veld Archive home" }).click();
    const assetCards = page.locator("button.asset-card");
    if (await assetCards.count()) {
      await expect(assetCards.first()).toBeVisible();
      await assetCards.first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: /Close/ }).click();
    } else {
      await expect(page.getByText("No assets matched this brief yet.")).toBeVisible();
    }
    await page.getByLabel("Search photo and video").fill("Garden Route");
    await page.getByLabel("Search photo and video").press("Enter");
    await expect(page.locator("#search-results")).toBeVisible();
    await expect(page.locator(".search-status")).toContainText(/Searching the archive for|matching records found|verified results found/);
    await expect(page.getByText("SEARCH PROCESS")).toBeVisible();
    if (await page.locator(".search-trace-card").count()) await expect(page.locator(".search-trace-card").first()).toBeVisible();
    else await expect(page.getByText("No records matched this brief closely enough.")).toBeVisible();
    if (errors.length) throw new Error(`${profile.name}: ${errors.join("; ")}`);
    console.log(`✓ ${profile.name}: navigation, search, modal, touch layout, and no horizontal overflow`);
    await context.close();
  }
  await browser.close();
} finally {
  server.kill();
}
