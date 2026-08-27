import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const base = (process.argv[2] ?? process.env.E2E_BASE_URL ?? process.env.QA_URL ?? "").replace(/\/$/, "");
if (!base) throw new Error("Usage: npm run test:e2e:buyer-finance -- https://your-worker.example");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: base });
const page = await context.newPage();

try {
  await page.goto("/", { waitUntil: "networkidle" });
  const login = await page.evaluate(async () => {
    const response = await fetch("/api/auth/dev-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "buyer" }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(login.status, "buyer login").toBe(200);
  expect(login.body.user?.role, "buyer session role").toBe("buyer");
  expect(login.body.csrfToken, "buyer session CSRF token").toBeTruthy();

  const [purchases, credits, membership] = await Promise.all([
    page.evaluate(async () => { const response = await fetch("/api/my/purchases"); return { status: response.status, body: await response.json() }; }),
    page.evaluate(async () => { const response = await fetch("/api/my/credits"); return { status: response.status, body: await response.json() }; }),
    page.evaluate(async () => { const response = await fetch("/api/subscription"); return { status: response.status, body: await response.json() }; }),
  ]);
  expect(purchases.status, "purchase history API").toBe(200);
  expect(purchases.body.results).toEqual(expect.any(Array));
  expect(purchases.body.summary).toEqual(expect.objectContaining({ total: expect.any(Number), totalPaidCents: expect.any(Number) }));
  expect(credits.status, "credit ledger API").toBe(200);
  expect(credits.body.oneCreditCents, "credit unit price").toBe(10000);
  expect(credits.body.balanceCredits).toEqual(expect.any(Number));
  expect(membership.status, "membership API").toBe(200);

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Buyer ROI" }).click();
  await expect(page.getByRole("heading", { name: /Your purchase history and buying power/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Keep access ready for the next brief/ })).toBeVisible();
  await expect(page.getByLabel("Credits to buy")).toBeVisible();
  await expect(page.getByText("1 credit = R100").first()).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include("#buyer-finance").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(accessibility.violations, "buyer finance WCAG 2.2 AA scan").toEqual([]);

  const logout = await page.evaluate(async (csrfToken) => {
    const response = await fetch("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken } });
    return response.status;
  }, login.body.csrfToken);
  expect(logout, "buyer logout").toBe(200);
  console.log(JSON.stringify({ ok: true, base, purchases: purchases.body.summary.total, balanceCredits: credits.body.balanceCredits, membership: membership.body.subscription?.status ?? "not_started" }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
