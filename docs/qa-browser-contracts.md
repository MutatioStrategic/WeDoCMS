# Browser handoffs and API contract QA

`npm run test:qa` runs the user-story validation suite. It launches Chromium,
Firefox, and WebKit, records API requests/responses from each browser page,
checks redirect origin and session continuity, and runs Newman against the
same user-story paths. Each Newman response is validated with
`docs/openapi.yaml` before the result is recorded.

The suite writes:

- `qa-report.json` - feature, browser, backend path(s), status, duration, and
  evidence links;
- `qa-report.html` - an easy-to-scan version of the same report;
- `screenshots/<browser>/` - handoff screenshots;
- `logs/<browser>.json` and `logs/newman.json` - redacted request, response,
  console, page-error, and failed-request logs.

For a local demo Worker:

```powershell
npm run build:demo
npx wrangler dev --local --port 8788 --var APP_ENV:demo --var DEMO_AUTH_ENABLED:true --var PAYMENT_PROVIDER:demo --var ALLOWED_ORIGINS:http://127.0.0.1:8788,http://localhost:8788 --var TURNSTILE_HOSTNAMES:127.0.0.1,localhost --var APP_PUBLIC_URL:http://127.0.0.1:8788 --var SESSION_SECRET:qa-session-secret-that-is-long-enough
$env:QA_BASE_URL = "http://127.0.0.1:8788"
$env:QA_RUN_WRITES = "true"
$env:QA_ARTIFACT_DIR = "artifacts/qa/local"
npm run test:qa
```

Use `QA_BROWSERS=Chromium` to shorten a local iteration. Set
`QA_SKIP_WRITES=true` when the target is not an isolated demo Worker. The
workflow runs the full suite on pushes to both `main` and `better-2`; any
browser, redirect, request, status, or OpenAPI schema mismatch fails CI and
uploads the report/evidence artifact.
