import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PactV3, MatchersV3 } from "@pact-foundation/pact";

const pactDir = fileURLToPath(new URL("../contracts/pacts/", import.meta.url));
await mkdir(pactDir, { recursive: true });

const jsonContentType = MatchersV3.regex(/^application\/json(?:;\s*charset=utf-8)?$/i, "application/json");

async function assertContractResponse(response, interaction) {
  const contentType = response.headers.get("content-type") ?? "";
  const contentTypes = contentType.split(",").map((value) => value.trim()).filter(Boolean);
  if (!contentTypes.length || contentTypes.some((value) => !/^application\/json(?:;\s*charset=utf-8)?$/i.test(value))) {
    throw new Error(`${interaction.description} returned an unexpected content type: ${contentType}`);
  }

  const body = interaction.assertBody ? await response.json() : undefined;
  interaction.assertBody?.(body);
}

const interactions = [
  {
    description: "a frontend health check",
    request: { method: "GET", path: "/api/health" },
    response: {
      status: 200,
      headers: { "content-type": jsonContentType },
      body: { ok: true, service: "stockvel-api", environment: MatchersV3.string("test") },
    },
    assertBody: (body) => {
      if (body.ok !== true || body.service !== "stockvel-api" || typeof body.environment !== "string") {
        throw new Error("Health response did not satisfy the consumer contract");
      }
    },
  },
  {
    description: "an anonymous browser session request",
    request: { method: "GET", path: "/api/auth/session" },
    response: {
      status: 200,
      headers: { "content-type": jsonContentType },
      body: { authenticated: false, user: null },
    },
    assertBody: (body) => {
      if (JSON.stringify(body) !== JSON.stringify({ authenticated: false, user: null })) {
        throw new Error("Anonymous session response did not satisfy the consumer contract");
      }
    },
  },
  {
    description: "a browser authentication configuration request",
    request: { method: "GET", path: "/api/auth/config" },
    response: {
      status: 200,
      headers: { "content-type": jsonContentType },
      body: { provider: "supabase", supabaseUrl: MatchersV3.string("https://tenant.supabase.co"), publishableKey: MatchersV3.string("sb_publishable_contract_test"), redirectUrl: MatchersV3.string("https://archive.example.com") },
    },
    assertBody: (body) => {
      if (body.provider !== "supabase" || !/^https:\/\/[^/]+/.test(body.supabaseUrl) || typeof body.publishableKey !== "string" || typeof body.redirectUrl !== "string") {
        throw new Error("Auth configuration response did not satisfy the consumer contract");
      }
    },
  },
  {
    description: "a request with an invalid bearer token",
    request: {
      method: "POST",
      path: "/api/auth/exchange",
      headers: { Authorization: "Bearer consumer-contract-invalid-token", "content-type": "application/json" },
      body: { organizationId: "org-demo" },
    },
    response: {
      status: 401,
      headers: { "content-type": jsonContentType },
      body: { error: "Verified identity token required" },
    },
    assertBody: (body) => {
      if (body.error !== "Verified identity token required") {
        throw new Error("Bearer-token error response did not satisfy the consumer contract");
      }
    },
  },
  {
    description: "an unauthenticated asset creation request",
    request: {
      method: "POST",
      path: "/api/assets",
      headers: { "content-type": "application/json" },
      body: {
        kind: "image",
        title: "Contract sample asset",
        description: "A contract test asset",
        caption: "Contract test context",
        subjectTags: ["test"],
        culturalTags: ["South African archive"],
        rightsStatus: "pending",
        modelReleaseStatus: "unknown",
        propertyReleaseStatus: "unknown",
        monetizationModel: "membership",
        licensePriceCents: null,
      },
    },
    response: {
      status: 403,
      headers: { "content-type": jsonContentType },
      body: { error: "Contributor access required" },
    },
    assertBody: (body) => {
      if (body.error !== "Contributor access required") {
        throw new Error("Asset authorization response did not satisfy the consumer contract");
      }
    },
  },
  {
    description: "an unauthenticated notification request",
    request: { method: "GET", path: "/api/notifications" },
    response: {
      status: 401,
      headers: { "content-type": jsonContentType },
      body: { error: "Authentication required" },
    },
    assertBody: (body) => {
      if (body.error !== "Authentication required") {
        throw new Error("Notification authorization response did not satisfy the consumer contract");
      }
    },
  },
];

for (const interaction of interactions) {
  const pact = new PactV3({
    consumer: "Stockvel React Frontend",
    provider: "Stockvel API",
    dir: pactDir,
    logLevel: process.env.PACT_LOG_LEVEL ?? "warn",
  });

  await pact.addInteraction({
    uponReceiving: interaction.description,
    withRequest: interaction.request,
    willRespondWith: interaction.response,
  }).executeTest(async (mockServer) => {
    const url = new URL(interaction.request.path, mockServer.url);
    const request = interaction.request;
    const response = await fetch(url, {
      method: request.method,
      headers: request.headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
    if (response.status !== interaction.response.status) {
      throw new Error(`Consumer contract mock returned ${response.status}, expected ${interaction.response.status}`);
    }
    await assertContractResponse(response, interaction);
  });
}

console.log(`Generated ${interactions.length} Pact interactions in ${pactDir}`);
