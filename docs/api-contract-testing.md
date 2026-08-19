# API contract testing

The React consumer contract is generated with Pact JS and verified against the Hono/Cloudflare Worker provider. Consumer tests call a Pact mock server, assert the response shape they depend on, and publish the resulting pact as the provider-facing stub. The contract surface currently covers:

- health and anonymous session responses;
- bearer-token authentication failures;
- authenticated asset and notification authorization failures;
- JSON content types, request bodies, status codes, and response bodies.

Zod schemas are shared by the Worker routes and contract tests. The OpenAPI document is parsed and exercised with the same examples before Pact verification runs.

## Local commands

```text
npm run test:contracts:openapi
npm run test:contracts:consumer
npm run worker:dev
npm run test:contracts:provider
```

The provider verifier uses `CONTRACT_PROVIDER_URL` when set and otherwise targets `http://127.0.0.1:8787`. It verifies every `.json` pact in `contracts/pacts/`, so external clients can add their own consumer pact without changing the provider harness. CI starts Wrangler locally, generates the frontend pact, and verifies all pacts before the authenticated, penetration, and payment smoke tests. Any Pact mismatch fails the job and prints Pact's path-level expected/actual diff.

Generated pacts are written to `contracts/pacts/`. Provider verification output is written to `contracts/reports/`, which is ignored because it contains run-specific timings and ANSI output.

To publish verification results to Pactflow, provide a Pact Broker URL and credentials, then extend `scripts/contracts-provider.mjs` with `pactBrokerUrl`, `pactBrokerUsername`, `pactBrokerPassword`, and `publishVerificationResult: true` from CI secrets. These values must remain secrets and must not be committed.
