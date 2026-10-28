# Next.js static conversion (branch next-static)

Goal: one Next.js (App Router, TypeScript) project, `output: 'export'`, served as static files on the
Cloudflare free plan. No Python, Vite, Worker runtime code or D1. Daily refresh = GitHub Actions cron
that runs a Node/TS script, commits data/*.json, and the push triggers a Cloudflare build.

## Ownership (parallel work)
- Data engineer (Opus): `data/`, `lib/` (except types already fixed), `scripts/`, `.github/`, `next.config.ts`,
  root `package.json`, `tsconfig.json`, `vitest.config.ts`, `wrangler.jsonc`, tests, removal of the old stack
  (`worker/`, `scraper/`, `migrations/`, `seed/`, `data/lottery.sqlite` AFTER export).
- UI engineer (Fable): `app/`, `components/`, `styles/`, `public/` (non-data). Removes `web/` at the end.

## Server data module: `lib/data.ts` (build-time only, reads data/*.json with fs)
```ts
import type { Lottery, DrawSummary, Stats, StatsWindow, Prediction, StatusInfo } from './types'
export function getLotteries(): Lottery[]
export function getLottery(id: string): Lottery | null
export function getDraws(id: string): DrawSummary[]          // newest first, full history
export function getStats(id: string, window: StatsWindow): Stats
export function getPrediction(id: string): Prediction
export function getStatus(): StatusInfo                      // { lastRun, runs: FetchRun[] } from data/fetch-log.json
export const LOTTERY_IDS: string[]
```
Types are in `lib/types.ts` (identical to the old API contract). Pages are server components that call
these and pass plain props to client components. The window switcher receives all three Stats objects.
History table: client-side pagination over a `draws` prop (≈1,900 rows max; fine) or over
`/data/<id>/draws.json` emitted to `public/` by the build — UI engineer's choice; data engineer also emits
`public/data/<id>.json` ({lottery, draws, prediction}) for open-data consumers.

## Data files
- `data/lotteries.json` — metadata (array, lotteries table rows in camelCase)
- `data/draws/<id>.json` — `DrawSummary[]`, newest first
- `data/fetch-log.json` — `FetchRun[]`, newest first, last 100
Predictions/stats are computed at build from these (deterministic, seeded; generatedAt = newest draw date run time).

## Routes
`/` home, `/l/[id]` detail (generateStaticParams), `/about` method & status, 404 via `app/not-found.tsx`.
`trailingSlash` off; Cloudflare static assets serve `/l/govisetha.html` for `/l/govisetha`.
