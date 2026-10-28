# win-lot architecture

Sri Lankan lottery (NLB + DLB) history, statistics and "next draw" picks, hosted as one
Cloudflare **Worker** (static assets + API + cron) with a **D1** database.

```
scraper/   Python 3 (requests, bs4, pandas, numpy) - one-off/backfill scrape, deep analysis, seed SQL
worker/    TypeScript Worker - /api/*, daily cron scrape -> D1, prediction engine (TS port of the model)
web/       Vite + React + TypeScript UI (built to web/dist, served via the ASSETS binding)
migrations/ D1 SQL schema
```

## Sources (verified 2026-10-28)
- **NLB** `https://www.nlb.lk/results/<slug>` - first response is a JS cookie challenge that sets
  `human=<sha1>` and reloads. Send that cookie (parse it from the challenge page each time; do not hardcode).
  Draw rows: `<ol class="B"><li class="Letter ...">A</li><li class="Number-2 ...">32</li>...`.
  Individual draws: `results/<slug>/<drawNo>`. Pagination to discover.
  Slugs: `dhana-nidhanaya`, `mega-power`, `govisetha`.
- **DLB** `https://www.dlb.lk/result/<id>/` - history via
  `POST https://www.dlb.lk/result/pagination_re` form `pageId=<n>&resultID=&lotteryID=<id>&lastsegment=<id>`.
  Rows: `3129 | 2026-Oct-03 Saturday`, `li.res_eng_letter`, `li.res_number`, sometimes zodiac/special.
  IDs: 11 Ada Kotipathi, 3 Super Ball, 1 Shanida, 12 Kapruka.

Be polite: 1 request at a time, ~0.5-1 s delay, real User-Agent.

## Data model (D1 / SQLite)
```sql
lotteries(id TEXT PK, name TEXT, board TEXT /*NLB|DLB*/, source_url TEXT,
          letter_kind TEXT /*none|letter|zodiac*/, main_count INT, main_min INT, main_max INT,
          has_bonus INT, bonus_label TEXT, bonus_min INT, bonus_max INT)
draws(lottery_id TEXT, draw_no INT, draw_date TEXT /*YYYY-MM-DD*/, letter TEXT NULL,
      numbers TEXT /*JSON int[] in drawn order*/, bonus TEXT NULL /*JSON*/, fetched_at TEXT,
      PRIMARY KEY(lottery_id, draw_no))
predictions(lottery_id TEXT PK, generated_at TEXT, payload TEXT /*JSON, see /prediction*/)
fetch_log(id INTEGER PK, run_at TEXT, lottery_id TEXT, inserted INT, status TEXT, message TEXT)
```
Lottery ids: `dhana-nidhanaya, mega-power, govisetha, ada-kotipathi, super-ball, shanida, kapruka`.

## API contract (JSON, all GET, CORS same-origin)
- `GET /api/lotteries` ->
  `[{id,name,board,letterKind,mainCount,mainMin,mainMax,hasBonus,bonusLabel,drawCount,firstDate,lastDraw:{drawNo,date,letter,numbers,bonus}}]`
- `GET /api/lotteries/:id/draws?limit=50&offset=0` -> `{total, draws:[{drawNo,date,letter,numbers:int[],bonus:any|null}]}` newest first
- `GET /api/lotteries/:id/stats?window=all|500|100` ->
  ```
  {lotteryId, window, drawCount,
   frequency:[{n,count,lastSeenDrawsAgo,expectedGap}],
   hot:int[10], cold:int[10], overdue:int[10],
   letterFrequency:[{letter,count}],
   sumSeries:[{drawNo,date,sum}],        // last 200
   oddEven:[{odd,even,count}], highLow:[{high,low,count}],
   pairs:[{a,b,count}],                  // top 20
   positionHeat:[[count per number] per position]}
  ```
- `GET /api/lotteries/:id/prediction` ->
  ```
  {lotteryId, generatedAt, basedOnDraws, nextDrawDate, nextDrawNo,
   sets:[{label,letter,numbers:int[],bonus:any|null,score:0..1}],   // 3-5 sets
   numberScores:[{n,score}], method:string, disclaimer:string,
   backtest:{draws:int, avgHits:number, randomBaseline:number}}
  ```
- `GET /api/status` -> `{lastRun, runs:[fetch_log rows, last 20]}`
- `POST /api/admin/refresh` (header `x-admin-token` == secret `ADMIN_TOKEN`) -> runs the scrape now.

## Prediction model
Lottery draws are random; the model is an honest statistical heuristic, not a forecast.
Score per number = weighted blend of long-run frequency, recent frequency (last 30/100 draws, exponentially
decayed), and overdue-ness (gap vs expected gap), normalised 0..1. Sets are sampled from the score
distribution under realistic constraints (odd/even and sum within the historic interquartile range),
letter picked by decayed letter frequency. Backtest: walk-forward over the last 200 draws, average
main-number hits vs. the random baseline `mainCount^2 / range`. The UI always shows the disclaimer.

## Daily refresh
Worker `scheduled()` cron `30 14 * * *` (20:00 Asia/Colombo, after evening draws) and `30 16 * * *` retry:
for each lottery fetch page 1 (latest ~10 draws), upsert new draws, recompute that lottery's prediction,
write `fetch_log`. Python `scraper/backfill.py` covers the full history once and emits `seed/*.sql`.

## Implementation notes (engineering, 2026-10-28) - clarifications, no breaking contract changes
- **History depth**: NLB list pages serve only the latest **208** draws (no pagination; per-draw pages
  for older draws are empty), so NLB history starts 2026-03-27 and grows daily via cron. DLB pagination
  (`pageId=0..158`, 12 rows/page, needs `resultID` from the `/result/<id>/` page) reaches back to 2021-04-01.
  `data/lottery.sqlite` + `seed/*.sql` are therefore the archive of record.
- **Formats / metadata**: all 7 = letter (A-Z, DLB occasionally lowercase -> uppercased) + 4 numbers.
  Ranges: 1..80, except Dhana Nidhanaya 1..82. Bonus shapes in `bonus`:
  Mega Power `int` (Super Number, 1..26 observed); Kapruka `int` (5th number, 1..40 observed);
  Dhana Nidhanaya `{"label":"Sunday Bonus","digits":[d,d,d,d]}` on some draws; others `null`.
  Prediction `sets[].bonus` is an int for Mega Power / Kapruka, otherwise `null`.
- **Field types**: `hasBonus` is a boolean. `/prediction` carries one extra additive field `modelVersion`.
  `/api/status.runs` are raw fetch_log rows (snake_case): `{id, run_at, lottery_id, inserted, status, message}`;
  `lastRun` is the newest `run_at` (or null).
- **Errors**: unknown lottery -> 404 `{error}`; `/api/admin/refresh` -> 401 bad token, 503 secret unset;
  optional `?lottery=<id>`. GET cache: `Cache-Control: public, max-age=300` (status 60).
- **Local cron test**: use `/cdn-cgi/handler/scheduled?cron=...` (with the SPA asset fallback,
  `/__scheduled` is served by the assets layer).
