# Veld Archive UX process flows

These flows define the minimum product journeys covered by browser QA. The solid path must work in the live read-only demo; authenticated write steps require the Worker and D1 resources.

## Explore and search

```mermaid
flowchart LR
  A[Landing page] --> B[Enter a story brief]
  B --> C[Search archive]
  C --> D{Content API available?}
  D -->|yes| E[Keyword or semantic results]
  D -->|no| F[Demo archive fallback]
  E --> G[Filter media type]
  F --> G
  G --> H[Open asset evidence]
  H --> I[Inspect rights, provenance, match signals]
  I --> J[Request access or save lightbox]
```

## Identity and workspaces

```mermaid
flowchart TD
  A[Workspace navigation] --> B{Authenticated?}
  B -->|no| C[Explain sign-in requirement]
  B -->|yes| D[Load role workspace]
  D --> E{Role}
  E -->|contributor| F[Insights and submit record]
  E -->|buyer| G[ROI and licensed campaigns]
  E -->|editor/admin| H[Review and governance queue]
```

## Contributor to publication

```mermaid
sequenceDiagram
  participant C as Contributor
  participant UI as Veld UI
  participant API as Worker API
  participant DB as D1
  C->>UI: Complete profile and seller tender
  UI->>API: Submit authenticated forms with CSRF token
  API->>DB: Create tender and asset record
  API-->>UI: Pending review confirmation
  C->>UI: Submit metadata and media
  UI->>API: Create asset / upload session
  API->>DB: Scan upload and advance media revision
  API-->>UI: AI enrichment queued
  API->>DB: Store description, visible setting, category, attributes and visible text as suggestions
  C->>UI: Review/correct suggestions and evidence-backed location
  UI->>API: Save reviewed metadata revision
  C->>UI: Approve reviewed revision
  API->>DB: Add approved revision to FTS5 and queue Vectorize upsert
  API-->>UI: Published; index current or pending
  C->>UI: Check contributor insights
```

## Rights case

```mermaid
flowchart LR
  A[Open resolution case] --> B[Enter asset ID and evidence]
  B --> C[Choose remedy and mediation]
  C --> D[Submit]
  D --> E{Authenticated API available?}
  E -->|yes| F[Create case ID and notify reviewers]
  E -->|no| G[Explain required sign-in/backend]
  F --> H[Review, mediate, or appeal]
```

## QA acceptance criteria

- Every navigation control changes view or gives a clear prerequisite message.
- Search submits on Enter and button click; suggestion chips never submit the form accidentally.
- Search results remain useful when the read-only API is unavailable.
- Asset cards open a detail/evidence modal and the modal closes by close button, backdrop, and Escape.
- Protected workflows explain sign-in and backend requirements rather than silently failing.
- Form validation prevents incomplete submissions and successful actions show confirmation state.
- AI may classify a visible setting such as `market_scene`; only seller, EXIF, or editor evidence may populate geographic location fields.
- Approval is unavailable until the current metadata revision is explicitly reviewed, and buyer search ignores stale revisions.
