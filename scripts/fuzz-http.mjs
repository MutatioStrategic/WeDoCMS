const baseUrl = (process.env.FUZZ_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const iterations = Number.parseInt(process.env.FUZZ_ITERATIONS ?? "100", 10);

const targets = [
  "/api/auth/exchange",
  "/api/security/turnstile",
  "/api/checkout/validate",
  "/api/analytics/events",
  "/api/webhooks/payments",
];

const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const malformedBodies = [
  "",
  "null",
  "[]",
  "{}",
  "{\"token\":null}",
  "{\"token\":\"",
  "{\"value\":\"" + "x".repeat(4096) + "\"}",
  "not-json",
  "\u0000\u0001\u0002",
];

function choose(values, index) {
  return values[index % values.length];
}

const failures = [];
for (let index = 0; index < iterations; index += 1) {
  const method = choose(methods, index * 7 + 3);
  const target = choose(targets, index * 11 + 1);
  const body = method === "GET" || method === "DELETE" ? undefined : choose(malformedBodies, index * 13 + 5);
  const url = `${baseUrl}${target}?fuzz=${encodeURIComponent("%".repeat((index % 8) + 1))}&n=${index}`;

  try {
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json", "x-fuzz-case": String(index) },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (response.status >= 500 && response.status !== 503) {
      failures.push({ index, method, target, status: response.status });
    }
  } catch (error) {
    failures.push({ index, method, target, error: error instanceof Error ? error.message : String(error) });
  }
}

console.log(JSON.stringify({ baseUrl, iterations, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
