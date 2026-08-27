# Stockvel brand

Stockvel is a trusted visual archive and licensing workspace for South African
stories. Use `Stockvel` in prose and the lowercase `stockvel` lockup in visual
brand treatments.

## Logo system

- `public/stockvel-mark.svg` is the compact mark for favicons, app icons, and
  tight spaces.
- `public/stockvel-logo.svg` is the standalone lockup for documents and launch
  material.
- The shared `StockvelLogo` component is the source for the web application
  shell and media studio.
- The mark is a single S monogram in a rounded square. Keep it intact and do
  not redraw, stretch, rotate, or add effects to it.

## Palette

| Token | Hex | Use |
| --- | --- | --- |
| Forest | `#173A31` | primary mark, dark surfaces, headings |
| Saffron | `#E7A365` | the `vel` accent and warm emphasis |
| Sage | `#75B69B` | positive context |
| Paper | `#F7F2E8` | light mark details and editorial backgrounds |

## Live-system note

The customer-facing product is rebranded to Stockvel. Existing Cloudflare
Worker, Pages, D1, R2, queue, analytics, WordPress, and provider identifiers
remain stable until a separately planned migration can verify DNS, auth,
catalogue, media-key resolution, external webhooks, and app update continuity.
Do not rename those physical resources as part of a UI-only brand change.
