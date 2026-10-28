# win-lot

Sri Lankan lottery (NLB + DLB) results history, statistics and "next draw" picks for
Dhana Nidhanaya, Mega Power, Govisetha (NLB) and Ada Kotipathi, Super Ball, Shanida, Kapruka (DLB).

One Cloudflare **Worker** serves the UI (`web/dist` via the `ASSETS` binding), the JSON API (`/api/*`)
and a daily **cron** that scrapes new results into **D1** and recomputes predictions.
Design, sources, schema and the API contract: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

> Lottery draws are random. The picks are a transparent statistical heuristic for entertainment
> and are backtested against random chance; they do not improve anyone's odds.

## Layout

```
scraper/      Python backfill scraper, model reference implementation, offline analysis
  backfill.py   full-history scrape -> data/lottery.sqlite, migrations/0001_schema.sql, seed/*.sql
  analysis.py   statistics + walk-forward backtest -> data/analysis_report.md
  model.py      prediction model (worker/src/model.ts is a 1:1 port)
worker/       TypeScript Worker (API, cron, parsers, model, stats) + vitest tests
migrations/   D1 schema
seed/         D1 seed data (lotteries, draws, initial predictions) - the historic archive
data/         lottery.sqlite (local copy of all scraped draws) and analysis_report.md
web/          UI (Vite + React), built to web/dist
```

`data/lottery.sqlite` and `seed/*.sql` are the archive: NLB only publishes its latest ~208 draws, so
history scraped once cannot be scraped again. Re-running the backfill merges into the SQLite file
(`INSERT OR REPLACE`), it never drops rows.

## Prerequisites

- Node.js 20+ and npm
- Python 3.12 (only for the scraper / analysis)
- A Cloudflare account (for deploy)

```sh
npm install
# Python venv (Windows paths shown; use scraper/.venv/bin/python on macOS/Linux)
python -m venv scraper/.venv
scraper/.venv/Scripts/python -m pip install -r scraper/requirements.txt
```

## Scrape and analyse (optional - seed files are already committed)

```sh
scraper/.venv/Scripts/python scraper/backfill.py          # ~10 min, polite (sequential, 0.5 s delay)
scraper/.venv/Scripts/python scraper/backfill.py --sql-only   # regenerate SQL from data/lottery.sqlite
scraper/.venv/Scripts/python scraper/analysis.py          # writes data/analysis_report.md
```

Raw pages are cached per day in `scraper/.cache/` so an interrupted run resumes.

## Run locally

```sh
npm run build              # builds web/ (or writes a placeholder page if web/ is missing)
npm run db:migrate:local   # schema into the local D1 (.wrangler/state)
npm run db:seed:local      # all seed/*.sql files, in order
npm run dev                # http://localhost:8787  (API under /api/*)
```

Test the cron locally:

```sh
npm run dev:cron           # wrangler dev --test-scheduled
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=30+14+*+*+*"   # /__scheduled is swallowed by the SPA asset fallback
curl http://localhost:8787/api/status
```

Admin refresh locally: put `ADMIN_TOKEN=<any-local-value>` in `.dev.vars` (gitignored), then
`curl -X POST -H "x-admin-token: <value>" http://localhost:8787/api/admin/refresh`.

## Tests

```sh
npm test               # vitest: parsers (real-page fixtures) + model + Python/TS parity fixture
npm run typecheck
npm run check:model    # Python vs TypeScript model parity over the FULL local history
```

## Deploy to Cloudflare

```sh
npx wrangler login
npx wrangler d1 create win-lot          # copy the printed database_id
#   -> paste it into wrangler.jsonc  d1_databases[0].database_id
npm run db:migrate:remote
npm run db:seed:remote                  # ~20 files; each is a small batched INSERT OR IGNORE
npx wrangler secret put ADMIN_TOKEN     # choose a long random value; never commit it
npm run deploy                          # builds web/ and deploys the Worker + assets + cron
```

Then open the `*.workers.dev` URL (or attach a custom domain in the dashboard).

## How the daily refresh works

`wrangler.jsonc` registers two cron triggers (UTC):

- `30 14 * * *` - 20:00 Asia/Colombo, after the evening draws
- `30 16 * * *` - 22:00 Asia/Colombo, retry for late publications

On each run `scheduled()` (in `worker/src/scrape.ts`):

1. NLB: fetches `https://www.nlb.lk/results/<slug>` (answering the `human` cookie challenge) and parses
   the results table (latest ~208 draws).
2. DLB: fetches one `/result/<id>/` page (it lists the latest draw of every DLB lottery and the
   `resultID`) and then `POST result/pagination_re` `pageId=0` per lottery (next 12 draws).
3. Upserts with `INSERT OR IGNORE` (existing draws are never changed), recomputes the lottery's
   prediction when new draws arrived, and writes one `fetch_log` row per lottery
   (visible at `/api/status`).

A lottery that fails (site down, markup change) logs `status=error` and does not affect the others.
`POST /api/admin/refresh` (header `x-admin-token`) runs the same refresh on demand
(`?lottery=<id>` for one lottery).
