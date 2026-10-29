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
  prebuild: scripts/export-public.ts -> predictions v1 + v2 computed once -> .cache/predictions.json
                                     -> public/data/*.json (open data)
  next build (output: export): app/ server components call lib/data.ts (predictions read from .cache/) -> out/
       |
       v
Cloudflare static assets serve out/  (/l/govisetha -> l/govisetha.html, unknown -> 404.html)
```

## Code
- `lib/types.ts` - data shapes (the former `/api/*` contract, plus the additive jackpot and model v2 fields).
- `lib/data.ts` - build-time only (fs, memoized): `getLotteries, getLottery, getDraws, getStats,
  getPrediction` (v2), `getPredictionV1, getPredictions, getJackpots, getJackpotStatus, getStatus, LOTTERY_IDS`.
- `lib/model-v2/` - the published prediction model `win-lot-jackpot-v2` (pure functions, no fs; see
  [Prediction model](#prediction-model)). `lib/model.ts` - the previous model `win-lot-heuristic-v1`, unchanged.
- `lib/stats.ts` (descriptive stats), `lib/parsers.ts` (regex HTML parsers),
  `lib/scrape.ts` (fetch, NLB cookie challenge, DLB paging), `lib/lotteries.ts` (reads `data/lotteries.json`).
- `lib/jackpots.ts` (jackpot parsers + merge, pure), `lib/jackpot-sources.ts` (jackpot fetching + files).
- `scripts/update.ts` - daily scrape and merge (plus the light jackpot step); `scripts/jackpots.ts` - jackpot rebuild; `scripts/export-public.ts` - prebuild: computes the predictions once (`.cache/`) and writes the open-data export.
- Routes (UI): `/` home, `/l/[id]` detail (`generateStaticParams` over `LOTTERY_IDS`), `/about`, 404.

## Data files
- `data/lotteries.json` - metadata, camelCase: `{id, name, board, sourceUrl, sourceKey, letterKind,
  mainCount, mainMin, mainMax, hasBonus, bonusLabel, bonusMin, bonusMax}`.
- `data/draws/<id>.json` - `DrawSummary[]` `{drawNo, date, letter, numbers, bonus}`, newest first, one draw
  per line (small git diffs). Append-only: dedupe on `drawNo`, never delete. The files never carry the `jackpot`
  flag; `getDraws` adds it when reading (see Data shapes).
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
  (`{lottery, draws, prediction, jackpots}`: `prediction` is v2, `jackpots` is the `JackpotStatus`),
  `public/data/<id>/draws.json` (jackpot-won draws carry `jackpot`).
- `.cache/predictions.json` (gitignored) - `{key, v1, v2}`: v1 and v2 predictions of every lottery, keyed by
  lottery id. Written by the prebuild, read by the `next build` workers. Safe to delete at any time (the next
  build or `next dev` recomputes it). See [Compute once per build](#compute-once-per-build).

Lottery ids: `dhana-nidhanaya, mega-power, govisetha, ada-kotipathi, super-ball, shanida, kapruka`.

## Data shapes (lib/types.ts, the old API plus additive fields)
- Lottery: `{id,name,board,letterKind,mainCount,mainMin,mainMax,hasBonus,bonusLabel,drawCount,firstDate,lastDraw}`.
- DrawSummary: `{drawNo, date, letter, numbers, bonus, jackpot?}`. `jackpot: {winners, amount, source}` is present
  only on a draw of this lottery whose jackpot (Super Prize) was won: `getDraws` joins this lottery's own
  `data/jackpots.json` items with `inDrawHistory` on `drawNo`. It is a fact, so it is not gated by `knownFrom`; another
  lottery's jackpot never marks a draw, every other draw is returned exactly as stored, and the models ignore it.
  On the data of 2026-10-27, 5 draws carry it (Dhana Nidhanaya 2234, 2289, 2319; Govisetha 4415, 4419).
- `getJackpots(id)`: `JackpotWin[]`, every known jackpot win of this lottery, newest first, from all sources
  (including undated wins and wins older than the archive): the draw fields, `winners, amount, source, inArchive,
  listedIn?`, `knownFrom` (the single publication rule of `lib/model-v2/evidence.ts`) and `usedAs`
  (`["combination", "date"]`, `["date"]` or `[]`: how the v2 picks for the next draw use the win). `usedAs` always
  agrees with the prediction's `evidence.used`.
- `getJackpotStatus(id)`: `JackpotStatus` `{lotteryId, wins, lastWin, drawsSinceLastWin, daysSinceLastWin, current,
  latestDraw, checked, notes}`. `current` is the newest NLB prize row ("last-draw") or the newest DLB advertised jackpot
  ("advertised-next"); `latestDraw` is the newest archived draw with its jackpot outcome: `won` when it is marked or its
  NLB prize row shows winners, `not-won` only from an NLB prize row of 0 winners (the UI then says "Jackpot not won - it
  rolls over"), else `unknown`, always so for DLB (on the data of 2026-10-27: the 3 NLB lotteries `not-won`, the 4 DLB
  `unknown`); `checked` counts the NLB draws with a known winners count (`null` for DLB); `notes` are plain
  sentences (DLB inference lag, wins without numbers or dates, known amount typos). Facts and counts only, never a
  chance per draw. The model never reads amounts or prizes.
- Stats (`window` = `all|500|100`, i.e. last N draws): `{lotteryId, window, drawCount,
  frequency:[{n,count,lastSeenDrawsAgo,expectedGap}], hot[10], cold[10], overdue[10], letterFrequency,
  sumSeries (last 200), oddEven, highLow, pairs (top 20), positionHeat}`.
  `lastSeenDrawsAgo` is `null` for a number never drawn in the window (as in the old API).
- Prediction: `{lotteryId, generatedAt, basedOnDraws, nextDrawDate, nextDrawNo, sets[5], numberScores,
  method, disclaimer, backtest, modelVersion}`. `generatedAt` = `run_at` of the newest fetch that inserted
  draws for that lottery, else the newest draw date at 00:00Z, so rebuilding the same data is byte-identical.
  These fields keep their v1 type and meaning in v2. v2 adds optional fields (`docs/MODEL-V2.md` section 3.3):
  per-set `source, parts, orderHeld, pastJackpotNumbers, maxSharedWithOneJackpot, note`, and `evidence, weights,
  influence, damping, patternLean, numberLean, letterLean, bonusLean, shapeLean, liveBalls, odds, backtestDetail,
  previousModel, explanation, notes`.
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
Lottery draws are random and every combination has the same chance: the models summarise patterns in the
evidence, they do not forecast. The UI always shows the disclaimer (v1's text, verbatim).

### v2: `win-lot-jackpot-v2` (published by `getPrediction`; full specification in `docs/MODEL-V2.md`)
- **Fair start.** A fair-balls prior over the balls in use, worth 50 draws per channel. A ball unseen for about 270
  draws (277 on 1..82) counts as retired: Ada Kotipathi and Kapruka currently use 1-76 and 1-75.
- **Three evidence sources in the owner's order**, as pseudo-draws: a jackpot-winning combination counts as 12 draws,
  a jackpot-winning date as 4 and an ordinary daily draw as 1. Only the lottery's own jackpots are used, and only once
  they were public before the draw (`knownFrom` in `lib/model-v2/evidence.ts`: NLB prize tables from the day after
  the draw, winners-directory cards from the end of the listing month (a card read from page 1 is labelled with the
  month it was read in), DLB inferred wins from draw K+2). A jackpot
  draw counts once, as a combination, never again as a daily draw.
  - Combinations act only through what they have in common (decades, odd/even mix, spread, letter), with 2 average
    pseudo-jackpots added; never through their exact numbers.
  - Dates act through a calendar fit on the lottery's own dates (moon phase, day of month, weekday; von Mises,
    de-clustered in windows of 7 days from a cluster's first date, each cluster counting as one independent date,
    refitted at every backtest step): draws held on calendar-similar days count a little more, as a contrast with
    ordinary days. A feature without a pattern switches itself off. The dates text calls the peaks chance unless one
    stays clear after Holm over the 3 features (none does today).
- **Order cap**, in every channel (numbers, letters, bonus, odd count, spread): a lower source may pull at most 0.75
  times as hard as the source above it. It is damped; a higher source is never inflated. A silent source holds every
  lower source at 0 (strict chain). Every lean stays within 0.75-1.25 and the per-source parts add up exactly
  (`lean - 1 = j + t + d`); `influence`, `damping` and `evidence` report what was used and how much it moved.
- **Five cards** (`sets`): Top pick (all sources; the best ticket among the 24 highest-lean numbers whose parts keep
  combinations >= dates >= daily draws over the sources present, `orderHeld`), Jackpot pattern, Jackpot days and Daily draws (each the best
  ticket of its own source alone, by the same search on that source's lean, so its part for that source comes out positive (tested);
  a balanced pick, the best ticket of all the evidence, while that source cannot move the picks) and Lucky dip (a random
  ticket that follows the same pick rules). The cards are chosen in this order, each sharing at most 2 numbers with
  every card chosen before it: Top pick, the cards whose source moves the picks (combinations, dates, daily draws), the
  balanced cards, Lucky dip; they are shown in the fixed order above. A balanced card is a clearly different
  alternative: it shares at most 1 number with every card chosen before it (`BALANCED_OVERLAP`; the 2-number rule only
  if no ticket passes that) and takes the best letter and bonus that no earlier card uses. `label` is always one of these five names (the UI title); `note` is the
  one-line "why", which also says when and why a card is a balanced pick. Every card passes a chance-calibrated copy
  guard (today at most 1 number from any one past jackpot and 2 from all of them; it never excludes more than 5% of
  tickets), looks like an ordinary draw and is not a past result. Cards 1-4 are deterministic; ties are broken by
  seeded keys from `mulberry32(fnv1a("<id>:<lastDrawNo>:win-lot-jackpot-v2"))`, and only the Lucky dip draws from that
  stream after the keys.
- **Texts** (`explanation`, `notes`, card notes): plain language, true for every evidence status (they credit only the
  sources that move the picks, name only the sources present when they state the order the Top pick keeps, and never
  call a listed but not yet usable win unknown). A split printed in a text uses
  `wholePercents` (`lib/model-v2/explain.ts`): whole percents that add up to exactly 100 (largest remainder, ties in the
  order combinations, dates, daily draws), e.g. Dhana Nidhanaya 54% / 26% / 20%.
- **Walk-forward backtest** on v1's window (the last 200 draws, or fewer so that each has 30 earlier draws: 178 for
  NLB today; stride 1). Each step sees only the earlier draws and
  the jackpots known before its date, through the same code path as production. `backtest` holds the Top pick's
  average hits and the honest random level `mean k^2 / L` over the balls in use; `backtestDetail` adds 95% intervals,
  the paired comparison with v1, rank and log scores, the pooled result over all 7 lotteries (the headline), Holm,
  power (the effect that would show up in 4 cases out of 5 after allowing for the checks made for that lottery: taken at
  the first Holm step over them, not at the 95% range alone) and a plain-language verdict that says "the same as random" exactly
  when the 95% range contains 0, and otherwise how the result stands after allowing for the checks made for that
  lottery (Holm); the Holm note names the most unusual check whenever one lands outside its 95% range. A check that
  survives Holm is also printed as a warning by the prebuild. A check that starts with the evidence (how often past
  jackpot numbers come up, each source's lean) is formed only after 30 test draws, so a lottery's first jackpot cannot
  set off a false alarm from a couple of lucky draws. On the data of 2026-10-27: 0.2016 hits against 0.2029
  for a random ticket over 1,334 draws, the same as random (pooled z -0.11).
- **Deterministic**: no clock, `Math.random`, `localeCompare` or unordered iteration, and `r4` on every payload float.
  `V2_CONSTANTS` (`lib/model-v2/constants.ts`) is frozen owner policy, never tuned on backtest results: changing it is
  a model change (bump `MODEL_VERSION_V2` or record it in `docs/MODEL-V2.md` Appendix B, then regenerate
  `test/fixtures/model-v2-golden.json` with `npm run golden:model`; its frozen snapshot is one line, the expected
  payloads one field per line, so the diff shows what moved). The version string is part of the stream seed, so
  bumping it also changes every tie key, the Top picks and the backtests. CI runs `npm run bench:model` after the
  tests (runtime budgets) and, after `npm run build`, `test/model-v2.copy.test.ts` again with `REQUIRE_BUILT_PAGES=1`
  (the forbidden words of the copy rules on the built pages in `out/`, which a plain `npm test` skips while `out/` is
  missing); a test pins the sha256 of `lib/model.ts`.

### v1: `win-lot-heuristic-v1` (the previous model, kept as `previousModel`)
Score per number = weighted blend of long-run frequency, recent frequency (exponentially decayed) and
overdue-ness (gap vs expected gap), normalised 0..1. Sets are sampled from the score distribution with a
seeded PRNG (`mulberry32(fnv1a("<id>:<lastDrawNo>"))`) under realistic constraints (odd/even and sum within
the historic interquartile range); the letter is picked by decayed letter frequency. Backtest: walk-forward
over the last 200 draws, average main-number hits vs. the random baseline `mainCount^2 / range`.
`getPredictionV1(id)` returns it, v2 carries its sets and backtest as `previousModel`, and the UI shows it only in the
comparison and the details view.

Output is deterministic for the same history. `lib/model.ts` is frozen (zero diff): `test/model.parity.test.ts` pins
it to the frozen output of the original Python reference model (`test/fixtures/model-parity.json`, last 260 draws, and
`model-parity-full.json`, full history as of 2026-10-28). Any change in picks for the same data fails the
test; change the model only deliberately (bump `MODEL_VERSION`, regenerate the fixtures).

### Compute once per build
The v2 backtests take a few seconds and need all lotteries at once (pooled result, Holm), so `getPredictions()`
(`lib/data.ts`) returns `{key, v1, v2}` for every lottery once per process. `key` is a sha256 over `MODEL_VERSION_V2`,
the JSON of `V2_CONSTANTS`, `MODEL_VERSION`, the bytes of `data/lotteries.json`, `data/jackpots.json`,
`data/fetch-log.json` and every `data/draws/<id>.json` in id order, and the source of `lib/data.ts`,
`lib/lotteries.ts`, `lib/model.ts` and `lib/model-v2/*.ts` (`predictionsKeyInputs`, `predictionsKey`). When
`.cache/predictions.json` holds that key it is read silently; otherwise both models are computed and
`model-v2: cache miss, computing` is logged once per process. The prebuild (`scripts/export-public.ts`) calls it and
writes the cache, so one `npm run build` computes the model at most once and the `next build` workers only read the
file. `next dev` reads a matching cache or computes on the first page that needs a prediction. Delete `.cache/` to
force a recomputation.

## Hosting
`wrangler.jsonc` is a static-assets-only Worker (`assets.directory: ./out`, `not_found_handling: 404-page`,
no `main`, no bindings, no crons). Alternative: Cloudflare Pages with build output directory `out`.
Free-plan limits: see README.
