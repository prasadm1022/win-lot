# win-lot

Sri Lankan lottery (NLB + DLB) results history, statistics and "next draw" picks for
Dhana Nidhanaya, Mega Power, Govisetha (NLB) and Ada Kotipathi, Super Ball, Shanida, Kapruka (DLB).

A **pure static Next.js site** (`output: 'export'`) on the **Cloudflare free plan**. No server, no
database: the draw history lives in `data/*.json` in this repo, a **GitHub Actions cron** scrapes new
results daily and commits them, and every push triggers a Cloudflare build that recomputes all
statistics and picks at build time. Design and sources: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

> Lottery draws are random. The picks are a transparent statistical heuristic for entertainment
> and are backtested against random chance; they do not improve anyone's odds.

## Layout

```
app/, components/, styles/   Next.js App Router UI (server components read lib/data.ts at build)
lib/          data.ts (build-time data API), model.ts, stats.ts, parsers.ts, scrape.ts, lotteries.ts, types.ts
data/         lotteries.json, draws/<id>.json (newest first), fetch-log.json (last 100 runs) - the archive
scripts/      update.ts (daily scrape + merge), export-public.ts (prebuild: public/data/*.json)
test/         vitest: parsers (real-page fixtures), model, frozen Python parity, lib/data
.github/      workflows/update.yml (daily cron), workflows/ci.yml (typecheck + test + build)
wrangler.jsonc  static-assets-only Worker config (serves ./out)
```

`data/draws/*.json` is the archive of record: NLB only publishes its latest ~208 draws, so history
scraped once cannot be scraped again. The update script only ever adds draws, never deletes.

## Setup and development

Requires Node.js 22+.

```sh
npm install
npm run dev          # http://localhost:3000
npm test             # vitest
npm run typecheck
npm run build        # prebuild writes public/data/, then next build -> out/
```

## Updating the data

```sh
npm run update                       # scrape the latest page of every lottery, merge into data/
npm run update -- --backfill-dlb     # DLB: page further back until a page holds only known draws
npm run update -- --only=kapruka,shanida
```

Per lottery: NLB `results/<slug>` (answers the `human` cookie challenge for every URL) or the DLB
latest page + `pagination_re` with its `resultID`. New draws are deduped on `drawNo` and merged newest
first; one fetch-log entry per lottery is prepended to `data/fetch-log.json` (capped at 100).
A failing lottery is logged with `status: "error"` and does not block the others; the script exits
non-zero only when **all** lotteries fail.

## How the daily cron works

`.github/workflows/update.yml` runs at `30 14 * * *` (20:00 Asia/Colombo, after the evening draws)
and `30 16 * * *` (retry), plus manual `workflow_dispatch` (optional DLB backfill). It runs
`npm ci && npm run update` and commits `data/` as `github-actions[bot]` **only if it changed**.
That push auto-triggers the Cloudflare build, so the site is rebuilt at most twice a day by the cron.
If pushes are rejected, check repo Settings -> Actions -> General -> Workflow permissions (Read and write).

## Deploy (Cloudflare free plan)

**Option A - Workers static assets (recommended).** Dashboard -> Workers & Pages -> Create ->
Import a repository -> this repo. Build command `npm run build`, deploy command `npx wrangler deploy`
(uses `wrangler.jsonc`: name `win-lot`, `assets.directory: ./out`, `not_found_handling: 404-page`;
no Worker script, no D1, no cron). Manual deploy: `npx wrangler login`, then `npm run deploy`.

**Option B - Cloudflare Pages.** Connect the repo; build command `npm run build`, build output
directory `out`, environment variable `NODE_VERSION=22`.

Either way, every push to the production branch (including the cron data commit) triggers a build.

### Free-plan limits (verify current values on the Cloudflare and GitHub pricing pages)

| Item | Free plan | win-lot usage |
|---|---|---|
| Static asset requests (Workers assets / Pages) | free, unlimited | all traffic |
| Worker script invocations | 100,000/day | none (assets only, no `main`) |
| Files per deployment | 20,000 files, 25 MiB per file | a few dozen files, largest < 1 MB |
| Pages builds | 500/month | <= 2/day from cron (~60/month) + your pushes |
| Workers Builds | 3,000 build minutes/month | ~1-2 min per build |
| GitHub Actions | free for public repos (2,000 min/month for private) | ~1 min x 2/day |

## License

Licensed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE) for attribution
and for the status of the scraped NLB/DLB result data, which is not covered by the license.

Lottery draws are random. The picks are statistical patterns for entertainment only and are
provided "AS IS", without warranty of any kind. Please play responsibly.
