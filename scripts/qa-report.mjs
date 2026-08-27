import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function isoNow() {
  return new Date().toISOString();
}

export function safeSlug(value) {
  return String(value ?? "value")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "value";
}

export function redact(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(?:StockvelSession|VeldSession)\s+[A-Za-z0-9._~+/=-]+/gi, "StockvelSession [redacted]")
    .replace(/(cookie|authorization|x-csrf-token|apikey|token|secret|password)\s*[:=]\s*[^,\s}]+/gi, "$1=[redacted]")
    .slice(0, 2000);
}

export function pathOnly(value) {
  try {
    return new URL(String(value)).pathname;
  } catch {
    return String(value).split("?")[0] || "/";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function relativePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function linkFor(root, filePath, label) {
  const relative = relativePath(root, filePath);
  return '<a href="' + escapeHtml(relative) + '">' + escapeHtml(label) + "</a>";
}

export async function createQaReport({ suite, baseUrl }) {
  const branch = process.env.GITHUB_REF_NAME || process.env.GITHUB_HEAD_REF || "local";
  const runId = process.env.QA_RUN_ID || new Date().toISOString().replace(/[:.]/g, "-") + "-" + safeSlug(branch);
  const root = path.resolve(process.env.QA_ARTIFACT_DIR || path.join(process.cwd(), "artifacts", "qa", runId));
  const screenshotRoot = path.join(root, "screenshots");
  const logRoot = path.join(root, "logs");
  await mkdir(screenshotRoot, { recursive: true });
  await mkdir(logRoot, { recursive: true });

  const results = [];
  const logEntries = new Map();
  const screenshotFiles = [];

  function logFileFor(browser) {
    return path.join(logRoot, safeSlug(browser) + ".json");
  }

  function attachPageLogging(page, browser) {
    const entries = [];
    const browserEntries = logEntries.get(browser) || [];
    logEntries.set(browser, browserEntries);
    const add = (type, payload) => {
      const entry = { at: isoNow(), type, ...payload };
      entries.push(entry);
      browserEntries.push(entry);
    };
    const isApi = (value) => pathOnly(value).startsWith("/api/");

    page.on("request", (request) => {
      if (!isApi(request.url())) return;
      add("request", {
        method: request.method(),
        path: pathOnly(request.url()),
        resourceType: request.resourceType(),
      });
    });
    page.on("response", (response) => {
      if (!isApi(response.url())) return;
      add("response", {
        method: response.request().method(),
        path: pathOnly(response.url()),
        status: response.status(),
        resourceType: response.request().resourceType(),
      });
    });
    page.on("requestfailed", (request) => {
      if (!isApi(request.url())) return;
      add("requestfailed", {
        method: request.method(),
        path: pathOnly(request.url()),
        resourceType: request.resourceType(),
        error: redact(request.failure()?.errorText || "request failed"),
      });
    });
    page.on("console", (message) => {
      if (message.type() === "debug") return;
      add("console", { level: message.type(), text: redact(message.text()) });
    });
    page.on("pageerror", (error) => add("pageerror", { text: redact(error.message) }));
    return entries;
  }

  async function screenshot(page, browser, feature, step) {
    const filePath = path.join(screenshotRoot, safeSlug(browser), safeSlug(feature) + "-" + safeSlug(step) + ".png");
    await mkdir(path.dirname(filePath), { recursive: true });
    await page.screenshot({ path: filePath, fullPage: true });
    screenshotFiles.push(filePath);
    return relativePath(root, filePath);
  }

  function addResult({ featureName, browser, backendPaths = [], status, durationMs, screenshots = [], details = {}, error = null }) {
    const paths = Array.isArray(backendPaths) ? backendPaths : [backendPaths];
    const logPath = logFileFor(browser);
    results.push({
      featureName,
      browser,
      backendPath: paths.filter(Boolean).join(", "),
      backendPaths: paths.filter(Boolean),
      status,
      durationMs: Math.round(durationMs ?? 0),
      evidence: {
        screenshots: screenshots.filter(Boolean),
        logs: relativePath(root, logPath),
      },
      details,
      ...(error ? { error: redact(error) } : {}),
    });
  }

  async function write(extra = {}) {
    for (const [browser, entries] of logEntries) {
      await writeFile(logFileFor(browser), JSON.stringify({ browser, entries }, null, 2) + "\n", "utf8");
    }
    for (const browser of new Set(results.map((result) => result.browser))) {
      if (!logEntries.has(browser)) await writeFile(logFileFor(browser), JSON.stringify({ browser, entries: [] }, null, 2) + "\n", "utf8");
    }
    for (const filePath of screenshotFiles) {
      if (!filePath.startsWith(root)) throw new Error("QA evidence escaped its artifact directory");
    }
    const summary = {
      passed: results.filter((result) => result.status === "passed").length,
      failed: results.filter((result) => result.status === "failed").length,
      skipped: results.filter((result) => result.status === "skipped").length,
      total: results.length,
    };
    const payload = {
      suite,
      generatedAt: isoNow(),
      branch,
      baseUrl,
      summary,
      results,
      ...extra,
    };
    const jsonPath = path.join(root, "qa-report.json");
    const htmlPath = path.join(root, "qa-report.html");
    await writeFile(jsonPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

    const rows = results.map((result) => {
      const evidence = [
        ...(result.evidence?.screenshots ?? []).map((item) => '<a href="' + escapeHtml(item) + '">screenshot</a>'),
        result.evidence?.logs ? '<a href="' + escapeHtml(result.evidence.logs) + '">logs</a>' : "",
      ].filter(Boolean).join(" &middot; ");
      const detail = result.error || result.details?.message || "";
      return "<tr class=\"" + escapeHtml(result.status) + "\">"
        + "<td>" + escapeHtml(result.featureName) + "</td>"
        + "<td>" + escapeHtml(result.browser) + "</td>"
        + "<td><code>" + escapeHtml(result.backendPath) + "</code></td>"
        + "<td>" + escapeHtml(result.status) + "</td>"
        + "<td>" + escapeHtml(result.durationMs) + " ms</td>"
        + "<td>" + evidence + (detail ? "<br><small>" + escapeHtml(detail) + "</small>" : "") + "</td>"
        + "</tr>";
    }).join("\n");
    const html = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>"
      + escapeHtml(suite)
      + "</title><style>body{font:14px system-ui,sans-serif;margin:2rem;color:#20251f}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cfd6ca;padding:.55rem;text-align:left;vertical-align:top}th{background:#e8eee4}.passed{background:#f1f8ef}.failed{background:#fff0ed;color:#8a2418}code{font-size:12px;white-space:pre-wrap}a{color:#315f49}</style></head><body>"
      + "<h1>" + escapeHtml(suite) + "</h1>"
      + "<p><strong>" + escapeHtml(summary.passed) + "</strong> passed &middot; <strong>" + escapeHtml(summary.failed) + "</strong> failed &middot; <strong>" + escapeHtml(summary.skipped) + "</strong> skipped &middot; " + escapeHtml(summary.total) + " total</p>"
      + "<p>Branch: <code>" + escapeHtml(branch) + "</code> &middot; Base URL: <code>" + escapeHtml(baseUrl) + "</code></p>"
      + "<table><thead><tr><th>Feature</th><th>Browser</th><th>Backend path verified</th><th>Status</th><th>Duration</th><th>Evidence</th></tr></thead><tbody>"
      + rows + "</tbody></table></body></html>\n";
    await writeFile(htmlPath, html, "utf8");
    return { root, jsonPath, htmlPath, payload };
  }

  return {
    root,
    results,
    logEntries,
    addResult,
    attachPageLogging,
    screenshot,
    write,
  };
}
