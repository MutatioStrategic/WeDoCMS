import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const base = (process.argv[2] ?? process.env.E2E_BASE_URL ?? process.env.QA_URL ?? "").replace(/\/$/, "");
if (!base) throw new Error("Usage: npm run test:e2e:ledger -- https://your-worker.example");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: base });
const page = await context.newPage();

try {
  await page.goto("/", { waitUntil: "networkidle" });
  const login = await page.evaluate(async () => {
    const response = await fetch("/api/auth/dev-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(login.status, "live admin login").toBe(200);
  expect(login.body.user?.role, "live session role").toBe("admin");
  expect(login.body.user?.organizationId, "live session organization").toBeTruthy();
  expect(login.body.csrfToken, "live session CSRF token").toBeTruthy();

  const ledger = await page.evaluate(async () => {
    const response = await fetch("/api/admin/approval-ledger?category=all&limit=250");
    return { status: response.status, body: await response.json() };
  });
  expect(ledger.status, "live approval ledger API").toBe(200);
  expect(ledger.body.summary).toEqual(expect.objectContaining({ total: expect.any(Number), userAccount: expect.any(Number), image: expect.any(Number) }));
  expect(ledger.body.results).toEqual(expect.any(Array));
  for (const entry of ledger.body.results) {
    expect(["user_account", "image"]).toContain(entry.category);
    expect(entry.actor?.name).toBeTruthy();
    expect(entry.actor?.role).toBeTruthy();
    expect(entry.subject?.name).toBeTruthy();
    expect(entry.resource?.title).toBeTruthy();
    expect(["signed_audit", "workflow_event"]).toContain(entry.source);
    expect(["verified", "failed", "legacy"]).toContain(entry.integrity?.status);
  }

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Governance/ }).click();
  await expect(page.getByRole("button", { name: "Admin ledger" })).toBeVisible();
  await page.getByRole("button", { name: "Admin ledger" }).click();
  await expect(page.getByRole("heading", { name: /Every sign-off in one record/ })).toBeVisible();
  await expect(page.getByText("TOP ADMIN / APPROVAL LEDGER")).toBeVisible();
  await expect(page.getByRole("tab", { name: /All events/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /User accounts/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Images/ })).toBeVisible();
  await page.getByRole("tab", { name: /Images/ }).click();
  await expect(page.getByRole("tab", { name: /Images/ })).toHaveAttribute("aria-selected", "true");
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(accessibility.violations, "live admin ledger WCAG 2.2 AA scan").toEqual([]);

  const logout = await page.evaluate(async (csrfToken) => {
    const response = await fetch("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken } });
    return response.status;
  }, login.body.csrfToken);
  expect(logout, "live admin logout").toBe(200);
  console.log(JSON.stringify({ ok: true, base, organizationId: login.body.user.organizationId, events: ledger.body.summary.total }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
