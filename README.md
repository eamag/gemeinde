# Gemeinde

Interactive map and link aggregator for municipal property listings (Grundstücksausschreibungen) and official gazettes (Amtsblätter) in the Berlin metropolitan area.

Built with [SvelteKit](https://svelte.dev/docs/kit), [Tailwind CSS](https://tailwindcss.com), [Leaflet](https://leafletjs.com), and deployed to [Cloudflare Workers](https://developers.cloudflare.com/workers/).

## Features

- **Interactive map** of municipalities in the Berliner Umland with clickable markers
- **Automated source discovery** — crawls municipal websites via sitemaps, homepage links, and DuckDuckGo to find Amtsblatt and property listing pages
- **Link indexing pipeline** — fetches source pages and extracts relevant PDF and HTML links
- **50+ municipalities** seeded from the [Wikipedia list of Berliner Umland locations](https://de.wikipedia.org/wiki/Liste_von_Orten_im_Berliner_Umland) with official websites resolved via Wikidata

## Prerequisites

- [Bun](https://bun.sh) (recommended) or Node.js 22+

## Getting Started

```sh
bun install
bun run dev -- --open
```

## Source Pipeline

The pipeline has two steps: **discovery** (find source pages) and **update** (fetch and extract links).

### 1. Discover sources

Scans municipal websites to find Amtsblatt and Grundstücksangebote pages:

```sh
bun run sources:discover
```

This writes:

- `data/sources.seed.json` — municipality list with discovered source URLs
- `data/generated/source-discovery-report.json` — coverage report

### 2. Update sources

Fetches each source page and extracts relevant links (PDFs, announcements):

```sh
bun run sources:update
```

This writes:

- `data/raw/*.json` — per-municipality snapshots
- `data/generated/sources-index.json` — aggregated index consumed by the web UI

## Building

```sh
bun run build
```

Preview the production build locally with Wrangler:

```sh
bun run preview
```

## Testing

```sh
bun run test:e2e
```

## Linting & Type Checking

```sh
bun run lint
bun run check
bun run format
```

## Deployment

The app is configured for Cloudflare Workers via `@sveltejs/adapter-cloudflare`. Deploy with:

```sh
bun run build
npx wrangler deploy
```

## Project Structure

```
├── data/
│   ├── sources.seed.json          # Municipality source registry
│   ├── raw/                       # Per-municipality fetch snapshots
│   └── generated/                 # Pipeline output (index, reports, coordinates)
├── scripts/
│   ├── discover-sources.ts        # Source discovery pipeline
│   └── update-sources.ts          # Link extraction pipeline
├── src/
│   ├── lib/
│   │   ├── components/            # Svelte components (MunicipalityMap)
│   │   ├── server/                # Server-side data loaders
│   │   └── types/                 # Shared TypeScript types
│   └── routes/                    # SvelteKit routes
└── wrangler.jsonc                 # Cloudflare Workers config
```
