# win-lot architecture (v2: static Next.js)

Sri Lankan lottery (NLB + DLB) history, statistics and "next draw" picks, served as **static files**
on the Cloudflare free plan. No runtime server code, no database.

```
GitHub Actions cron (14:30 / 16:30 UTC)
  npm run update -> scripts/update.ts -> lib/scrape.ts + lib/parsers.ts
                 -> data/draws/<id>.json, data/fetch-log.json
  git commit + push (only if data/ changed)
       |
       v
Cloudflare build on every push (Workers Builds or Pages)
  prebuild: scripts/export-public.ts -> public/data/*.json (open data)
  next build (output: export): app/ server components call lib/data.ts -> out/
       |
       v
Cloudflare static assets serve out/  (/l/govisetha -> l/govisetha.html, unknown -> 404.html)
```

## Code
- `lib/types.ts` - data shapes (identical to the former `/api/*` contract).
- `lib/data.ts` - build-time only (fs, memoized): `getLotteries, getLottery, getDraws, getStats,
  getPrediction, getStatus, LOTTERY_IDS`.
- `lib/model.ts` (prediction), `lib/stats.ts` (descriptive stats), `lib/parsers.ts` (regex HTML parsers),
  `lib/scrape.ts` (fetch, NLB cookie challenge, DLB paging), `lib/lotteries.ts` (reads `data/lotteries.json`).
- `lib/jackpots.ts` (jackpot parsers + merge, pure), `lib/jackpot-sources.ts` (jackpot fetching + files).
- `scripts/update.ts` - daily scrape and merge (plus the light jackpot step); `scripts/jackpots.ts` - jackpot rebuild; `scripts/export-public.ts` - prebuild open-data export.
- Routes (UI): `/` home, `/l/[id]` detail (`generateStaticParams` over `LOTTERY_IDS`), `/about`, 404.

## Data files
- `data/lotteries.json` - metadata, camelCase: `{id, name, board, sourceUrl, sourceKey, letterKind,
  mainCount, mainMin, mainMax, hasBonus, bonusLabel, bonusMin, bonusMax}`.
- `data/draws/<id>.json` - `DrawSummary[]` `{drawNo, date, letter, numbers, bonus}`, newest first, one draw
  per line (small git diffs). Append-only: dedupe on `drawNo`, never delete.
- `data/prizes/<id>.json` - `PrizeRow[]` `{drawNo, date, superPrizeAmount, superPrizeWinners, tier}`, newest first.
  NLB: jackpot tier of every archived draw (from the per-draw Prize Structure table; `tier: "none"` with nulls when NLB
  no longer serves it). DLB: daily snapshot of the jackpot at stake in the next draw (`tier: "advertised"`, `date` and
  winners `null`) from the dlb.lk home page NEXT JACKPOT column.
- `data/jackpots.json` - `Jackpot[]` (lib/jackpots.ts) `{lotteryId, drawNo, date, letter, numbers, bonus,
  jackpotWinners, superPrizeAmount, source, inDrawHistory, listedIn?}`: only draws whose jackpot was won, newest first.
  Built by `npm run jackpots` (full rebuild; also renders `docs/JACKPOT-WINS.md`) and refreshed by a light,
  non-fatal step at the end of `npm run update` (prize tables of new and the 3 newest NLB draws, winners
  directory page 1, DLB next-jackpot snapshot). No winner names or towns are stored.
- `data/fetch-log.json` - `FetchRun[]` `{id, run_at, lottery_id, inserted, status, message}`, newest first, last 100.
- Generated at build (gitignored): `public/data/lotteries.json`, `public/data/<id>.json`
  (`{lottery, draws, prediction}`), `public/data/<id>/draws.json`.

Lottery ids: `dhana-nidhanaya, mega-power, govisetha, ada-kotipathi, super-ball, shanida, kapruka`.

## Data shapes (lib/types.ts, same as the old API)
- Lottery: `{id,name,board,letterKind,mainCount,mainMin,mainMax,hasBonus,bonusLabel,drawCount,firstDate,lastDraw}`.
- Stats (`window` = `all|500|100`, i.e. last N draws): `{lotteryId, window, drawCount,
  frequency:[{n,count,lastSeenDrawsAgo,expectedGap}], hot[10], cold[10], overdue[10], letterFrequency,
  sumSeries (last 200), oddEven, highLow, pairs (top 20), positionHeat}`.
  `lastSeenDrawsAgo` is `null` for a number never drawn in the window (as in the old API).
- Prediction: `{lotteryId, generatedAt, basedOnDraws, nextDrawDate, nextDrawNo, sets[5], numberScores,
  method, disclaimer, backtest, modelVersion}`. `generatedAt` = `run_at` of the newest fetch that inserted
  draws for that lottery, else the newest draw date at 00:00Z, so rebuilding the same data is byte-identical.
- Status: `{lastRun, runs: FetchRun[]}`.

## Sources (verified 2026-10-28)
- **NLB** `https://www.nlb.lk/results/<slug>` - first response is a JS cookie challenge that sets
  `human=<sha1>` and reloads. Parse it from the challenge page for every URL/request (it changes); never hardcode.
  Draw rows: `<ol class="B"><li class="Letter ...">A</li><li class="Number-2 ...">32</li>...`.
  Only the latest **208** draws are served (no pagination; per-draw pages of older draws are empty), so NLB
  history starts 2026-03-27 and grows daily. Slugs: `dhana-nidhanaya`, `mega-power`, `govisetha`.
- **DLB** `https://www.dlb.lk/result/<id>/` lists the latest draw of every DLB lottery and its `resultID`.
  History: `POST https://www.dlb.lk/result/pagination_re` form
  `pageId=<n>&resultID=<rid>&lotteryID=<id>&lastsegment=<id>` (12 rows/page; `pageId=0..158` reaches 2021-04-01).
  Rows: `3129 | 2026-Oct-03 Saturday`, `li.res_eng_letter` (sometimes lowercase, upper-cased), `li.res_number`.
  IDs: 11 Ada Kotipathi, 3 Super Ball, 1 Shanida, 12 Kapruka.
- **Jackpots** (verified 2026-10-28). NLB per-draw page `https://www.nlb.lk/results/<slug>/<drawNo>` has a
  "Prize Structure - <date>" table (`div.tStruct`) only for the ~208 draws NLB still serves; the first
  `... Super Prize` row is the jackpot (Mega Power: "Mega Super Prize"; "Power Super Prize" is a fixed 10M tier).
  `https://www.nlb.lk/winners[/YYYY/MM]` (months back to 2014) shows publicity cards "Mega Power 2440 / Super Prize"
  (also "Power Super Prize", excluded) without date or amount; incomplete. Old (emptied) per-draw pages still show
  "Draw No.: N Date: ...", which dates those cards. DLB has no text winners list: per-draw prizes are only an image
  (`result/more_result` -> `front_img/*_PRIZE_<date>_<draw>.PNG`), so we snapshot `/home/en` daily
  (`p.lottery_n_d` "Kapruka - 2504 | 2026-Oct-28" + `p.next_jkpt`) and infer a win when the jackpot drops for two
  draws in a row (`inferJackpotResets`; on the NLB prize tables it finds exactly the real wins).

Be polite: one request at a time, ~0.5-1 s delay, real User-Agent, 3 retries with backoff.

## Formats
All 7 = letter (A-Z) + 4 numbers. Ranges 1..80, except Dhana Nidhanaya 1..82. `bonus`:
Mega Power `int` (Super Number); Kapruka `int` (5th number); Dhana Nidhanaya
`{"label":"Sunday Bonus","digits":[d,d,d,d]}` on some draws; others `null`.
Prediction `sets[].bonus` is an int for Mega Power / Kapruka, otherwise `null`.

## Prediction model
Lottery draws are random; the model is an honest statistical heuristic, not a forecast.
Score per number = weighted blend of long-run frequency, recent frequency (exponentially decayed) and
overdue-ness (gap vs expected gap), normalised 0..1. Sets are sampled from the score distribution with a
seeded PRNG (`mulberry32(fnv1a("<id>:<lastDrawNo>"))`) under realistic constraints (odd/even and sum within
the historic interquartile range); the letter is picked by decayed letter frequency. Backtest: walk-forward
over the last 200 draws, average main-number hits vs. the random baseline `mainCount^2 / range`.
The UI always shows the disclaimer.

Output is deterministic for the same history. `test/model.parity.test.ts` pins it to the frozen output of
the original Python reference model (`test/fixtures/model-parity.json`, last 260 draws, and
`model-parity-full.json`, full history as of 2026-10-28). Any change in picks for the same data fails the
test; change the model only deliberately (bump `MODEL_VERSION`, regenerate the fixtures).

## Hosting
`wrangler.jsonc` is a static-assets-only Worker (`assets.directory: ./out`, `not_found_handling: 404-page`,
no `main`, no bindings, no crons). Alternative: Cloudflare Pages with build output directory `out`.
Free-plan limits: see README.
