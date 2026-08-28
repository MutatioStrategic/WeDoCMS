import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const workerOutput = [];
const worker = spawn(process.execPath, [
  wrangler, "dev", "--local", "--port", "8787",
  "--var", "SESSION_SECRET:contract-session-secret-that-is-long-enough",
  "--var", "PAYMENT_WEBHOOK_SECRET:contract-payment-secret-that-is-long-enough",
  "--var", "AUTH_PROVIDER:supabase",
  "--var", "SUPABASE_URL:https://tenant.supabase.co",
  "--var", "SUPABASE_ANON_KEY:sb_publishable_contract_test",
  "--var", "APP_PUBLIC_URL:https://archive.example.com",
], { cwd: root, env: { ...process.env, PACT_DO_NOT_TRACK: "true" }, stdio: ["ignore", "pipe", "pipe"] });

for (const stream of [worker.stdout, worker.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    workerOutput.push(chunk);
    if (workerOutput.length > 200) workerOutput.shift();
  });
}

async function waitForWorker() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (worker.exitCode !== null) throw new Error(`Contract Worker exited early with ${worker.exitCode}.\n${workerOutput.join("")}`);
    try {
      const response = await fetch("http://127.0.0.1:8787/api/health", { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Wrangler is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Contract Worker did not become healthy.\n${workerOutput.join("")}`);
}

function stopWorker() {
  if (worker.exitCode !== null || !worker.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(worker.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    worker.kill("SIGTERM");
  }
}

try {
  await waitForWorker();
  for (const script of ["contracts-openapi.mjs", "contracts-consumer.mjs", "contracts-provider.mjs"]) {
    const result = spawnSync(process.execPath, [`scripts/${script}`], {
      cwd: root,
      env: { ...process.env, CONTRACT_PROVIDER_URL: "http://127.0.0.1:8787", PACT_DO_NOT_TRACK: "true" },
      stdio: "inherit",
    });
    if (result.status !== 0) process.exitCode = result.status ?? 1;
    if (process.exitCode) break;
  }
} finally {
  stopWorker();
}
