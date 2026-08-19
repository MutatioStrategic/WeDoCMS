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
let cookie = "";
function rememberCookie(response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") ?? ""];
  const session = values.find((value) => value.startsWith("va_session="));
  if (session) cookie = session.split(";", 1)[0];
}

const login = await fetch(`${baseUrl}/api/auth/dev-login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ role: "contributor" }),
});
rememberCookie(login);
if (!login.ok || !cookie) throw new Error(`chaos smoke could not create an authenticated session: ${login.status}`);

for (const [scenario, expectedStatus] of scenarios) {
  const authenticatedHeaders = scenario === "fail-before-session" ? {} : { Cookie: cookie };
  const createResponse = await fetch(`${baseUrl}/api/uploads`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-chaos-scenario": scenario,
      "x-chaos-token": token,
      ...authenticatedHeaders,
    },
    body: JSON.stringify({ filename: `chaos-${scenario}.jpg`, contentType: "image/jpeg", sizeBytes: 1 }),
  });
  const createBody = await createResponse.json();
  let observedStatus = createResponse.status;

  if (createResponse.ok && createBody.uploadId) {
    const completeResponse = await fetch(`${baseUrl}/api/uploads/${createBody.uploadId}/complete`, {
      method: "POST",
      headers: { "x-chaos-scenario": scenario, "x-chaos-token": token, ...authenticatedHeaders },
    });
    observedStatus = completeResponse.status;
  }

  results.push({ scenario, expectedStatus, observedStatus, passed: observedStatus === expectedStatus });
}

console.log(JSON.stringify({ baseUrl, results }, null, 2));
if (results.some((result) => !result.passed)) process.exitCode = 1;
