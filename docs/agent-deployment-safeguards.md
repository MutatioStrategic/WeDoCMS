# Agent deployment safeguards

This is the required runbook for an agent building or deploying Veld Archive.
It exists because a Worker can return a healthy catalogue from D1 while every
preview fails when its R2 binding points at an empty or unrelated bucket.

The recorded incident followed this pattern: a demo environment changed the
effective media binding while continuing to read the catalogue from the
production D1. The UI therefore showed records, but the preview keys were
looked up in a bucket that did not contain them. A screen-only smoke passed
because it did not request real media. Any future change that touches an
environment block or media binding must guard against this exact failure.

## Non-negotiable invariants

1. `wrangler.jsonc` is the source of truth for the selected Cloudflare
   environment. Inspect the complete `env.production` or `env.demo` block;
   do not assume values from the root block are inherited.
2. Production uses the production resources:

   - D1: `veld-archive`
   - primary media R2: `veld-archive-media`
   - `R2_BUCKET_NAME`: `veld-archive-media`

3. Demo is allowed to use demo-only resources for writes and operational
   data. If it reads catalogue records from the shared production D1, every
   production media key must still be readable through the explicit,
   read-only `MEDIA_LIBRARY_BUCKET` binding, or the demo R2 must contain a
   verified complete copy of the referenced objects.
4. `MEDIA_LIBRARY_BUCKET` is read-only fallback infrastructure. It may be
   used with `head()` and `get()` only. Never write, delete, or multipart-upload
   through it.
5. A screen smoke that only checks labels is insufficient. A release is not
   healthy until it checks D1 result count, usable preview count, and real
   preview responses.
6. Production authentication is Worker-owned and Supabase-backed. The
   selected environment must declare `AUTH_PROVIDER=supabase` or `both`,
   `SUPABASE_URL`, and `SUPABASE_AUDIENCE`, and require the
   `SUPABASE_ANON_KEY` secret. The public `/api/auth/config` route must return
   only a publishable/anon key and the configured HTTPS redirect origin.
   Production sessions remain host-only unless the cookie domain exactly
   matches the serving host. Demo uses explicit demo authentication and must
   not receive the production Supabase key.

## Before editing

Map the change before touching code:

- identify the surface, actor, route, selected Worker environment, D1 binding,
  primary media bucket, fallback media bucket, build mode, and deployment
  command;
- inspect the callers of any shared media helper, route, schema, migration,
  or binding;
- read the relevant README, security/launch documentation, and
  `docs/ux-process-flows.md`;
- check `git status` and preserve unrelated user changes;
- never print `.env`, Worker secrets, tokens, presigned URLs, or raw R2 keys.

If a demo and production environment are both present, compare their bindings
side-by-side. Specifically verify that demo `MEDIA_BUCKET` is not silently
being used as the only source for production-keyed catalogue records.

## Required validation sequence

For a production build:

```powershell
npm run typecheck
npm test
npm run build
npm run release:check
npm run auth:check
node scripts/release-gate.mjs --production
npx wrangler deploy --env production --dry-run
npm run worker:deploy
```

For the public demo:

```powershell
npm run typecheck
npm test
npm run build:demo
npm run release:check
npm run auth:check
npx wrangler deploy --env demo --dry-run
npm run worker:deploy:demo
$env:DEMO_BASE_URL = "https://<exact-demo-worker-host>"
$env:DEMO_EXPECT_MIN_MEDIA = "100"
npm run test:demo
```

Run the live smoke only against the URL returned by the deployment. The smoke
must exercise all intended roles and screens and must also:

- call `/api/health`;
- call `/api/assets`;
- count non-demo assets with usable `previewUrl` values;
- require the expected minimum for a live deployment;
- `HEAD` or `GET` at least five actual preview URLs and fail on any non-2xx
  response.

If the catalogue is intentionally smaller than the normal live minimum, set
the expected threshold explicitly for that environment and record why in the
handoff. Do not silently lower the default threshold to make a smoke pass.

## Stop and rollback rules

Stop the release immediately when any of these occur:

- D1 returns records but preview URLs return 404, 403, or 5xx;
- the selected environment binds the wrong D1 or R2 resource;
- production configuration contains demo, localhost, placeholder, or test
  values;
- the build mode and Worker environment do not match;
- a dry run reports an unexpected binding, asset directory, queue, or cron;
- Cloudflare reports a quota or provisioning error that changes the intended
  deployment shape.

Do not apply destructive “repairs” to production data while diagnosing this
class of failure. First compare D1 keys with `R2.head(key)` in the intended
bucket(s). If the last deployment is known good, use Wrangler’s version list
and rollback flow, then re-run the live media smoke before investigating a new
build.

## Required handoff

The agent must report:

- commit or working-tree revision deployed;
- Worker environment, exact URL, and version ID;
- build command and smoke command used;
- D1 database name/ID and media binding-to-bucket mapping;
- D1 asset count, usable preview count, and sampled preview statuses;
- `/api/auth/config` provider, redirect origin, and presence of the remote
  `SUPABASE_ANON_KEY` secret (report the name only, never its value);
- roles/screens covered;
- migrations applied, if any;
- warnings, quota failures, or skipped checks.

“The page loaded” is not an acceptable deployment result without the media
integrity evidence above.
