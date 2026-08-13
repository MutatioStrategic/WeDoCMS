const baseUrl = (process.env.CHAOS_BASE_URL ?? "http://localhost:8787").replace(/\/$/, "");
const token = process.env.CHAOS_TEST_TOKEN;

if (!token) throw new Error("Set CHAOS_TEST_TOKEN to the configured chaos secret.");

const scenarios = [
  ["fail-before-session", 503],
  ["fail-after-session", 503],
  ["r2-signing-failure", 503],
  ["r2-missing", 409],
  ["partial-upload", 409],
];

const results = [];
for (const [scenario, expectedStatus] of scenarios) {
  const createResponse = await fetch(`${baseUrl}/api/uploads`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-chaos-scenario": scenario,
      "x-chaos-token": token,
    },
    body: JSON.stringify({ filename: `chaos-${scenario}.jpg`, contentType: "image/jpeg", sizeBytes: 1 }),
  });
  const createBody = await createResponse.json();
  let observedStatus = createResponse.status;

  if (createResponse.ok && createBody.uploadId) {
    const completeResponse = await fetch(`${baseUrl}/api/uploads/${createBody.uploadId}/complete`, {
      method: "POST",
      headers: { "x-chaos-scenario": scenario, "x-chaos-token": token },
    });
    observedStatus = completeResponse.status;
  }

  results.push({ scenario, expectedStatus, observedStatus, passed: observedStatus === expectedStatus });
}

console.log(JSON.stringify({ baseUrl, results }, null, 2));
if (results.some((result) => !result.passed)) process.exitCode = 1;
