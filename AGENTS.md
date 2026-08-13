# CMS engineering and UX guardrails

These instructions apply to the Veld Archive CMS repository. The goal is to make
the first implementation correct enough that later work is refinement, not a
cycle of avoidable UX, security, and architecture repairs.

## Product north star

- Make the next action obvious.
- Make evidence, provenance, rights, status, and risk understandable before a
  user commits to an action.
- Preserve a calm, editorial visual language. Use the Legato finance project's
  evidence-led hierarchy as inspiration for governance, rights, and insights
  surfaces: clear titles, restrained panels, meaningful metrics, source/context,
  risk notes, and an explicit next action. Do not copy finance-specific styling
  into unrelated archive surfaces.
- Prefer a small, reliable vertical slice over a broad feature that is only
  partially connected to its API, persistence, or QA path.

## Before editing

For any non-trivial change, answer these questions from the codebase before
writing code. If the repository already answers one, do not ask the user again.

1. Which surface is changing: public exploration, search/results, asset detail,
   contributor workspace, buyer workspace, editor/admin governance, rights
   resolution, or an integration/Worker route?
2. Who is the actor, what are they trying to decide, and what is the next
   successful action?
3. Is the state anonymous, session-authenticated, role-gated, tenant-scoped,
   persisted in D1, stored in R2, or derived from an integration?
4. What is the existing user journey in `docs/ux-process-flows.md` and which
   existing tests or smoke scripts prove it?
5. What is the smallest module/seam where the behavior belongs? Check callers
   before changing a shared rule, route, schema, or adapter.
6. What validation gate will prove the change: unit/integration test, a11y
   check, authenticated smoke, migration smoke, build, or a live Worker check?

Read the relevant README and docs before editing. For changes involving
authentication, tenancy, uploads, payments, rights, external providers, or
production behavior, also read the relevant security and launch documentation.

## UX guardrails

### Forms and content

- Keep question/prompt text visually separate from its answer control.
- Put persistent labels above fields. Never use placeholder text as the only
  label; placeholders are examples, not field identity.
- Ask only for information that is variable, necessary, and not derivable.
- Keep one concept per field. Split compound questions when the answer affects
  different workflow decisions.
- Mark optional fields explicitly when omission is acceptable.
- Keep help text, legal notes, provenance, evidence notes, and system guidance
  visually distinct from editable inputs. Collapse long guidance behind an
  explicit help affordance where it would interrupt scanning.
- Use progressive disclosure for advanced, conditional, or rarely used fields.
- Preserve entered data on recoverable errors and explain how to continue.

### Controls and interaction

- Use radio buttons for short mutually exclusive choices that should be
  compared at a glance.
- Use checkboxes for independent choices.
- Use a select only when the list is too long to scan inline. Known enums must
  be discoverable by pointer and keyboard; do not require typing to reveal them.
- Use a searchable combobox for large or unfamiliar datasets.
- Use a real upload control for media/evidence, with accepted types, size
  limits, progress, retry, and a clear completed/needs-review state.
- Search must work from Enter and an explicit button. Suggestion chips must not
  submit the form accidentally.
- Asset cards must expose evidence/provenance and rights context before a
  consequential request. Detail modals close through a visible close control,
  backdrop, and Escape, and return focus to the opener.
- Every loading, empty, error, success, and unavailable-backend state needs a
  useful explanation and a recovery or next action. Never fail silently.
- Prevent duplicate submissions and make idempotent actions visibly safe to
  retry.
- Avoid decorative controls, ambiguous icons, button-like narrative copy, and
  nested cards that make scanability worse.

### Layout and accessibility

- Target WCAG 2.2 AA: semantic elements, associated labels/descriptions,
  keyboard access, visible focus, logical tab order, useful error semantics,
  and no color-only state communication.
- Keep touch targets comfortably tappable and test narrow phone and tablet
  widths, not only desktop.
- Prefer one primary scroll region. Avoid page-plus-drawer or card-plus-panel
  double-scroll behavior; lock background scroll when an overlay is open.
- Use spacing, typography, contrast, and hierarchy before adding borders,
  gradients, badges, or ornament.
- Use badges only for status, rights, risk, or workflow state.
- For governance and insights views, make objective, source/provenance, risk,
  confidence, and next action explicit where they support a decision.

## Surface, identity, and data boundaries

- Confirm route ownership before reusing UI or state between public,
  contributor, buyer, editor, and admin surfaces.
- The server is authoritative for authentication, organisation membership,
  roles, rights, payment, upload, and business-rule validation.
- Do not trust `x-user-id`, `x-user-role`, `x-demo-user-id`, browser storage, or
  client-provided tenant IDs as identity in production. Use verified session
  claims, HttpOnly cookies, CSRF protection, and server-side authorization.
- Never put admin credentials, reusable bearer tokens, presigned secrets, raw
  R2 keys, or private evidence in public UI or local storage.
- Keep uploads private until ownership, media signature, size, scanning, and
  workflow approval succeed. Expose authenticated preview/download routes, not
  raw storage keys.
- Do not expose internal provider, audit, KYC, payment, or operational context
  to a public assistant or public route.
- Do not log upload contents, access tokens, presigned URLs, webhook secrets,
  identity tokens, or sensitive evidence. Log identifiers, sizes, statuses, and
  correlation data only.
- Preserve idempotency and deduplication for uploads, payment webhooks,
  retries, queue jobs, and external callbacks.

## Architecture guardrails

- Put shared matching, confidence, formatting, and licence rules behind the
  stateless `archiveDomain` facade in `src/shared.ts`. Do not duplicate a rule
  in a component and a Worker route.
- Construct external providers through `IntegrationContainer` in
  `src/integrations/index.ts`. Route handlers consume provider registries; they
  do not instantiate vendor adapters directly.
- Keep vendor protocol details inside adapters. Domain code should depend on
  narrow interfaces and normalized results, not SDK types.
- Prefer deep modules: a small interface with meaningful behavior behind it.
  Apply the deletion test—if deleting a module merely removes a pass-through,
  do not add or preserve it as an abstraction.
- Treat one adapter as a possible seam and two adapters as evidence of a real
  seam. Make seams where behavior can be tested and replaced without editing
  every caller.
- Keep feature objects cohesive. Do not create a global service object that
  becomes a dumping ground.
- When changing a shared schema, route, migration, or integration contract,
  inspect every caller and update the OpenAPI contract, tests, and failure
  behavior together.
- Avoid speculative frameworks, generic form layers, broad rewrites, and
  premature optimization. Fix measured bottlenecks and preserve locality.

## Delivery workflow from the skills MCP

Use this sequence for meaningful feature work:

1. **Zoom out.** Map the relevant modules, callers, route, persistence, and
   user journey before editing locally.
2. **Align.** Resolve surface, actor, terminology, invariants, out-of-scope
   behavior, and acceptance criteria. Use existing docs and code to answer
   questions first.
3. **Specify.** For multi-surface work, write a short behavior-focused plan or
   PRD section covering user stories, module seams, contracts, testing, and
   explicit out-of-scope items.
4. **Build a tracer bullet.** Write one behavior test through the public
   interface, make it fail, implement the smallest change, and make it pass.
   Repeat as vertical red-green slices; do not write all tests first and all
   implementation afterward.
5. **Deepen while green.** Refactor duplication and improve module locality
   only after the behavior passes. Do not refactor while a test is red.
6. **Diagnose failures scientifically.** Reproduce, minimize, hypothesize,
   instrument narrowly, fix, and rerun the original scenario. Use uniquely
   tagged temporary logs and remove them before completion.
7. **Close the loop.** Record the root cause, regression coverage, and the
   guardrail that would have prevented the issue when the lesson is reusable.

## Testing and QA gates

Run the smallest relevant checks during development and the full proportionate
set before handoff:

```text
npm run typecheck
npm test
npm run build
npm run test:a11y
```

For protected or infrastructure changes, also run the relevant scripts:

```text
npm run test:auth
npm run test:penetration
npm run test:fuzz
npm run test:migrations
npm run test:payments
npm run test:backup
npm run test:dr
npm run test:local-smoke
```

For every changed UX journey, verify the corresponding flow in
`docs/ux-process-flows.md`, including unavailable API/backend states. For every
changed public interaction, check keyboard use, focus, errors, mobile reflow,
and the single-scroll-region rule.

Tests should describe observable behavior and use public interfaces. Prefer
integration-style tests for route, auth, upload, payment, and workflow paths;
mock only at a genuine external-provider seam. If no correct regression seam
exists, document that architectural gap instead of creating a shallow test that
gives false confidence.

## Definition of done

- The correct surface, actor, auth/session model, and tenant boundary were
  verified.
- The happy path, empty state, loading state, error state, retry path, and
  unavailable-backend state are intentional.
- UX guardrails, accessibility semantics, responsive layout, and focus behavior
  were checked.
- Shared rules remain behind `archiveDomain`; providers remain behind adapters
  and `IntegrationContainer`.
- Persistence, API/OpenAPI contracts, idempotency, auditability, and migration
  impact were checked where relevant.
- Relevant automated checks pass, temporary diagnostics are removed, and the
  root cause or reusable lesson is captured in documentation when appropriate.
