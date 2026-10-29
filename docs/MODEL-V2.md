# win-lot model v2: jackpot-weighted picks (`win-lot-jackpot-v2`)

Specification for task **win-lot-003** ("jackpot-weighted prediction model and jackpot day"). This is the final design-phase
output and is meant to be implemented as written. TypeScript only, computed at `next build` time in Node 22.

**Where it comes from.** The base is the *ordered-evidence Dirichlet* design ("bayesian"), which all three judges ranked first.
Every judge must-fix is resolved, and ideas from the kernel, energy and risk designs are grafted in (Appendix A maps each must-fix
to its resolution). Section 2.18 lists every place where this spec departs from all four designs, and why.

**Reference prototype.** The design-phase "measured" numbers came from a scratch prototype of this specification
(`<session scratchpad>/model-v2/synth/jv2.ts`, not project code), run on the data as of 2026-10-27. Since 2026-10-29 every
measured number in this document is the **implementation's** (`lib/model-v2/`) on that same data, after the PM decisions of
Appendix B (in particular `n_eff` = number of date clusters, 2.7). The golden fixture (section 6) pins them.

---

## 1. Plain-language summary (for the owner)

**What the model does**

1. **It starts fair.** Every ball that is actually in the machine is treated as equally likely. Balls that have not come out for
   about 270 draws are treated as no longer in use. In recent years Ada Kotipathi has only used 1-76 and Kapruka only 1-75.
2. **It adds your three kinds of evidence, strongest first.**
   - A **jackpot-winning combination** counts like **12** ordinary draws.
   - A **jackpot-winning date** counts like **4** draws.
   - An ordinary **daily draw** counts **once**.
3. **It keeps your order in the result, not only in the weights.** Jackpot dates may never move the picks more than three
   quarters as much as the jackpot combinations. Daily draws may never move them more than three quarters as much as the dates.
   With only a few jackpots known, the model turns the daily draws down rather than blowing the few jackpots up. The page shows
   the actual split, in whole percents that add up to 100. For example, Dhana Nidhanaya today: **jackpot combinations 54% ·
   jackpot dates 26% · daily draws 20%**.
4. **Jackpot numbers are not treated as lucky numbers.** Three jackpots are far too few to say anything about single numbers.
   The model learns only what they have in common:
   - which tens their numbers fall in (1-10, 11-20, ...);
   - how many of the numbers are odd;
   - how spread out the numbers are;
   - their letter.

   It also counts two imaginary "perfectly average" jackpots alongside the real ones, so that one jackpot cannot swing the pattern
   on its own. Today no card shares more than 1 number with any single past jackpot.
5. **How jackpot dates are used.** The model checks whether jackpot dates bunch up on the calendar, looking at three things: the
   moon phase (Poya), the day of the month (paydays) and the weekday. Where they do bunch up, draws held on similar days count a
   little more. Where they do not, that calendar feature is switched off automatically. Today weekday shows nothing anywhere. The
   dates gather around the days before the full moon (Dhana Nidhanaya, Mega Power) and around the turn of the month (Govisetha,
   Mega Power), but none of this is clear after allowing for the three checks, so it may well be chance, and the page says so.
   If it is real, it is most likely about ticket sales: more tickets sold means a better chance that *someone* wins. The balls
   do not know the date.
6. **Jackpot-winning days are marked.** Every draw in the history where the jackpot was won is marked "Jackpot won". Each lottery
   also gets a list of all known jackpot wins, including older ones whose winning numbers are not in our archive.
7. **When there is no evidence, the page says so.** The four DLB lotteries have no known jackpot yet. Their pages say so, and their
   picks use daily draws only. Mega Power has 9 known jackpot dates but no winning numbers, so its picks use dates and daily
   draws.
8. **Five cards:**
   - **Top pick:** all the evidence together, jackpot combinations first.
   - **Jackpot pattern**, **Jackpot days** and **Daily draws:** what each source points to on its own: the ticket that
     follows that source most closely, worked out the same way every time (not drawn at random). The sources that move
     the picks choose first, so they get the strongest tickets. When a source has nothing to say (no jackpot numbers
     known yet, or no calendar pattern yet), its card is a balanced pick from all the evidence, and the card's one-line
     note says why. A balanced card is a clearly different alternative: it shares at most one number with each card
     chosen before it, and its letter (and bonus) is one no earlier card has.
   - **Lucky dip:** a random ticket that follows the same pick rules, shown on purpose. It has exactly the same chance as
     every other card.

**What it cannot do**

- **No method beats chance.** Draws are random and every combination is equally likely: 1 in 1,749,060 for the four Dhana
  Nidhanaya numbers, and 1 in 1,581,580 for the 1-80 lotteries.
- **Jackpot data describes the players, not the machine.** Whether a jackpot is won depends on which tickets were sold, not on
  which balls fall. So jackpot combinations and dates tell us about the players.
- **The honest test shows no edge.** We replayed the last 200 draws of every lottery (178 for NLB), each time using only what was
  known before that draw. The Top pick matched **0.20** numbers per draw. A random ticket matches **0.20** (0.2016 against 0.2029
  over 1,334 draws). That is the same as random, and the difference is luck. The site says "the same as random" wherever the 95%
  range of the difference contains 0 (today the pooled result and 6 of the 7 lotteries; for Super Ball it explains why its
  result is still within luck after allowing for its checks), and it keeps the existing disclaimer word for word.

---

## 2. Algorithm

### 2.1 Notation

| Symbol | Meaning |
|---|---|
| lottery `ℓ` | configured range `[lo, hi]`, `M = hi - lo + 1`, `k = 4` main numbers |
| `d_0 .. d_{N-1}` | daily draws, **oldest first**; `date(d_i)`, `drawNo(d_i)`, `letter(d_i)`, `numbers(d_i)`, `bonus(d_i)` |
| step `t` | a prediction that may use only `d_0 .. d_{t-1}`. Production: `t = N`. Backtest: `t` = index of the test draw |
| target date `τ_t` | production: `nextDrawDate(dates)` (the v1 function, imported); backtest: `date(d_t)` |
| `Λ_t`, `L = |Λ_t|` | live balls at step `t` (2.3) |
| `r_t` | regime start index (2.3) |
| sources | `J` = jackpot-winning combinations, `T` = jackpot-winning dates, `D` = daily draws (owner order J > T > D) |
| payload names | `jackpotCombinations`, `jackpotDates`, `dailyDraws`, used everywhere: influence, parts, counts and UI keys |

Production and the backtest run **one code path**: `posteriorAt(ctx, t, τ)` followed by `topPickAt(...)`.

### 2.2 Constants (`V2_CONSTANTS`, frozen owner policy)

All constants are fixed **before** any evaluation and must **never be tuned on backtest results**. They are exported as one frozen
object in `lib/model-v2/constants.ts`, printed in the `method` text, hashed into the build cache key and pinned by a unit test.

| Constant | Value | Rationale |
|---|---|---|
| `W_J`, `W_T`, `W_D` | 12, 4, 1 | Pseudo-draw weight per item (combination, date, daily draw): the owner's order as power-prior weights. The ×3 and ×4 steps make the per-item order unmistakable. These are policy values, not fitted. |
| `ORDER` | 0.75 | A lower source may pull at most 3/4 as hard as the source above it. "Clearly lower but still visible". With all three present, J always gets at least 43%. |
| `PRIOR` | 50 | The fair-balls prior is worth 50 draws in every channel, about a quarter of the NLB archive. It is raised automatically by `MAX_LIFT`. |
| `MAX_LIFT` | 1.25 | No category's lean leaves [0.75, 1.25]. This is a modesty bound on the pattern, **not** an odds statement. |
| `J_PRIOR` | 2 | Two "perfectly average" pseudo-jackpots are added to every jackpot-pattern estimate. One real jackpot then provides at most 1/3 of the pattern, 3 jackpots 60% and 10 jackpots 83%. This is a Dirichlet prior over decades, letters and shape bins. |
| `EXACT` | 0 (implicit) | Jackpot numbers act only through their decade. There is no exact-number weight: a judge measured that any exact weight lets past jackpot numbers take over the ranking. |
| `CAL_FEATURES` | `moonPhase`, `dayOfMonth`, `weekday` | Chosen **a priori** from the ticket-sales mechanism (Poya, paydays, weekly cycle), not from p-values. Day-of-year is excluded because the NLB archive is shorter than a year, so a seasonal weight would act as a recency weight. |
| `KAPPA_MAX` | 2 | A calendar kernel never gets narrower than a half-width of about ±4 days on the 29.5-day moon cycle. |
| `DECLUSTER_DAYS` | 7 | Wins within a week of a cluster's first date share one calendar position. In the calendar **fit** they count as one observation (`n_eff` = number of clusters, 2.7); each one still counts as a date in the weights. No cluster spans more than 7 days. |
| `SYNODIC`, `MOON_EPOCH` | 29.530588853 days, 2000-01-06T18:14Z | Mean synodic month with a new-moon epoch, evaluated at 12:00 UTC of the draw date. Error is under 1 day; no Poya table needed. |
| `PRIZE_TABLE_LAG_DAYS` | 1 | Conservative availability of NLB prize tables (2.4). |
| `GUARD_ALPHA` | 0.05 | The copy guards may never exclude more than 5% of all tickets (2.14). |
| `GUARD_LADDER` | (1,2), (1,3), (2,3), (2,4), (3,4) | (max shared with any one own jackpot combination, max from their union), from strictest to loosest. |
| `CAND` | 24 | The Top pick and each view card are chosen among the C(24,4) = 10,626 tickets built from the 24 numbers with the highest lean of the card (2.15). |
| `SIR`, `SIR_ROUNDS` | 64, 4 | Lucky dip sampling: 64 uniform candidates per round, at most 4 rounds. The other cards are deterministic (2.15; `TAU` was removed with the view-card sampling, Appendix B item 21). |
| `SET_OVERLAP` | 2 | Any two cards differ in at least 2 numbers. |
| `BALANCED_OVERLAP` | 1 | A balanced card (2.15) shares at most 1 number with every card selected before it, so it is a clearly different alternative, not a near copy of the cards above it (PM decision 15; Appendix B item 24). |
| `TYPICAL` | odd 1..3; sum within the null 10th-90th percentile; at most 1 consecutive pair | Presentation rule: cards look like ordinary draws. Every ticket has the same odds, so this costs nothing. |
| `DEAD_P` | 1e-6 | A live ball goes `R` draws unseen with probability at most 1e-6. R = 270 for M = 80 and 277 for M = 82. |
| `BT_DRAWS`, `BT_MIN` | 200, 30 | Same window as v1 (`start = max(30, N - 200)`, stride 1), so the v1 comparison is paired. |

### 2.3 Step 0: live balls and regime (draws `[0, t)` only)

This is the bayesian rule, kept unchanged.

```
R = ceil( ln(DEAD_P) / ln(1 - k/M) )                         // 270 (M=80), 277 (M=82)
last_t(n) = last index i < t with n in numbers(d_i), else -1
dead_t(n)  <=>  t >= R  and  ( last_t(n) = -1  or  t - last_t(n) > R )
Λ_t = { n in [lo,hi] : not dead_t(n) }
activation of n at i: n drawn at i and (first ever appearance with i >= R, or previous appearance p with i - p > R)
r_t = max( latest activation index < t,  max{ last_t(n)+1 : n dead, last_t(n) >= 0 },  0 )
```

Measured today:
- NLB: `r = 0` and all balls live, because there are fewer than R draws.
- Ada Kotipathi: 1..76 since 2023-07-04 (1,189 draws).
- Kapruka: 1..75 since 2023-07-04 (1,189 draws).
- Super Ball and Shanida: 1..80 since 2025-03-06 (587 draws).

Dead balls get θ = 0 and can never be picked. The honest random baseline uses `L` (2.17 and 5).

### 2.4 Step 1: evidence and availability

**Own evidence only.** Only `data/jackpots.json` items with `lotteryId = ℓ` are used. There is no borrowing across lotteries and
none across boards: borrowed evidence must never outrank or damp a lottery's own evidence.

**One availability function** is used by the build, the backtest, `lib/data.ts` and the tests (`lib/model-v2/evidence.ts`):

```
knownFrom(item, drawsOfLottery): ISO date | null
  item.date == null                       -> null                        (undated: never used, only counted and listed)
  source "nlb-prize-table"                -> item.date + PRIZE_TABLE_LAG_DAYS
  source "nlb-winners-directory"          -> max(item.date, last day of the earliest "YYYY-MM" in item.listedIn)
                                             (no YYYY-MM entry, e.g. only "latest" -> item.date + PRIZE_TABLE_LAG_DAYS;
                                             cards read from the winners page 1 are labelled with the month of the
                                             run in Asia/Colombo, never "latest", so this case occurs only in older data)
  source "dlb-jackpot-reset"              -> date of this lottery's draw with drawNo = item.drawNo + 2 (by drawNo, not +2 days);
                                             null while that draw is not in the archive
  any other source                        -> null
usable(item, τ) <=> knownFrom(item) != null && knownFrom(item) < τ       (plain ISO string comparison)
```

`knownFrom` is a *publication* rule: the earliest date the fact was public. It is deliberately not the date our scraper first saw
the item, because `jackpots.json` was rebuilt in full on 2026-10-28. It is identical in production and in the backtest, so the
test draw's own jackpot can never be used (strict `<`). The month label of a page-1 card is the conservative end of that rule: a
card claimed late (an old draw first shown months after it) counts only from the end of the month it was first read in, never
from the day after its draw, so it cannot reach the walk-forward steps before it was public (leakage test 5, section 6).

**Evidence sets at step `t`.** Items are sorted canonically by `drawNo` ascending.
- `𝒥_t` = usable own items with `numbers` (jackpot-winning combinations).
- `𝒯_t` = usable own items with a `date` (jackpot-winning dates). This includes the dates of the `𝒥_t` items and the older
  directory dates outside the archive (Mega Power has 9).
- **Partition rule (no double counting).** A draw is counted once, at its highest tier. `X_t` = archive indices `< t` of the draws
  of `𝒥_t`. The daily pool is `𝒫_t = { i : r_t <= i < t, i ∉ X_t }`. Before a jackpot becomes usable, its draw is an ordinary daily
  draw; once it is usable, it moves to `J`.

  Why: if the jackpot draw were also kept in `D`, its numbers would carry one guaranteed extra count. That is a selection effect
  which pushes past jackpot numbers up the daily ranking; the stats judge measured a 2.8x tilt with the daily source alone.

Measured today:
- Dhana Nidhanaya: 3 combinations, 7 dates (4 older than the archive), pool 205 of 208.
- Govisetha: 2 combinations, 7 dates (+4 undated, ignored), pool 206.
- Mega Power: 0 combinations, 9 dates (+2 undated), pool 208.
- DLB: no items.

### 2.5 Channels and their null distributions

Every channel `X` has categories with a null `p0^X` (the fair-draw distribution) and a mass unit (pseudo-counts per item):

| Channel | Categories | Null `p0` | Mass unit per item |
|---|---|---|---|
| `num` | live balls `Λ_t` | `1/L` | `k` (4 number slots) |
| `letter` | `U_t` = sorted distinct letters of `d_{r_t..t-1}` (26 today everywhere) | `1/|U_t|` | 1 |
| `bonus` | integer bonus only: Mega Power 1..26, Kapruka 1..40 (`B` values); the channel exists at step `t` only if an integer bonus was seen in draws `[0, t)` | `1/B` | 1 |
| `odd` | odd count classes {0-1, 2, 3-4} | exact hypergeometric on `Λ_t` | 1 |
| `spread` | terciles of `max - min` | exact null on `Λ_t` (edges where the null CDF first reaches 1/3 and 2/3) | 1 |

Exact nulls on the live support:
- **Sum distribution:** dynamic programme over subset sums. It is used for the typicality band, not as a channel.
- **Spread:** number of 4-subsets with min `a` and max `b` = `C(#live strictly between, 2)`.
- **Odd:** hypergeometric.

These are cached per live-ball signature (they change only at regime changes).

The **sum tercile is not a channel**. The bayesian design had it, but the sum is almost a function of the decades that `J` already
uses. Measured with 20,000 uniform tickets, the correlation of the J decade part with the J shape part is:

| Shape feature | Dhana | Govisetha |
|---|---|---|
| sum | +0.17 | +0.10 |
| odd | 0.00 | -0.01 |
| spread | -0.13 | +0.03 |

So the sum is where jackpot evidence was counted twice. Dropping it changed no conclusion (prototype, before Appendix B item 1:
pooled hits 0.2069 with it, 0.2009 without, both chance).

### 2.6 Source D: daily draws

```
for i in 𝒫_t:  e_D.num[n] += W_D for n in numbers(d_i) ∩ Λ_t;  e_D.letter[letter(d_i)] += W_D;
               e_D.bonus[bonus(d_i)] += W_D (int bonus draws only);  e_D.odd[bin(d_i)] += W_D;  e_D.spread[bin(d_i)] += W_D
m_D^X = Σ_x e_D^X(x)          (num: W_D·k·|𝒫_t|)
```

### 2.7 Source T: jackpot dates (calendar fitted inside the walk-forward, used as a contrast)

T is **absent** if `𝒯_t` is empty. Otherwise it is computed in three steps.

**(a) Calendar fit on the own usable dates only.**

```
dates sorted ascending; clusters = fixed windows: the earliest date not yet in a cluster starts one, which holds every
           later date at most DECLUSTER_DAYS after that FIRST date (so no cluster spans more than 7 days)
w_j = 1 / |cluster(j)|  (each cluster weighs 1 in total);  W = Σ w_j
n_eff = W = number of clusters        (each de-clustered cluster counts as ONE independent date)
angles:  moonPhase  φ = 2π·frac( (day(date @ 12:00Z) - MOON_EPOCH) / SYNODIC )
         dayOfMonth φ = 2π·(dom - 0.5) / daysInMonth
         weekday    φ = 2π·dow / 7            (dow 0 = Sunday)
per feature f:  R_f = |Σ_j w_j e^{iφ_f(j)}| / W ;  μ_f = arg(Σ_j w_j e^{iφ_f(j)})
                Rc²_f = (n_eff·R_f² - 1)/(n_eff - 1)   if n_eff > 1, else 0     (bias-corrected resultant length)
                κ_f   = Rc²_f <= 0 ? 0 : min(KAPPA_MAX, A1inv(√Rc²_f))
A1inv(r) = r < 0.53 ? 2r + r³ + 5r⁵/6 : r < 0.85 ? -0.4 + 1.39r + 0.43/(1-r) : 1/(r³ - 4r² + 3r)     (Best-Fisher; r >= 1: ∞,
           and R_f is clamped to 1, so a perfect concentration gives KAPPA_MAX)
rayleighP_f ≈ exp(-Z)·(1 + (2Z - Z²)/(4n) - (24Z - 132Z² + 76Z³ - 9Z⁴)/(288n²)),  Z = n·R_f², n = n_eff;  then Holm over the 3 features
```

Features with no concentration get `κ = 0` and switch themselves off. This replaces the bayesian design's full-sample choice of
moon and month with KAPPA = 4: nothing here is selected on p-values, and everything is refitted at every step.

Why `n_eff` is the number of clusters: dates within a week share one calendar position, so a cluster is one observation of
the calendar, however many wins it holds. The Kish size `W² / Σ w_j²` of the de-clustering weights (the first draft) measures
how unequal the weights are, not how dependent the dates are: it gives `n` for one cluster of `n` near-identical dates and is
never below the number of clusters (Dhana Nidhanaya: 6.55 from 6 clusters). The first implementation patched the single-cluster
case to 1, which made it jump: one cluster of 7 dates gave 1, the same 7 dates plus one more far away gave 3.5. The cluster
count has none of these problems and is used everywhere `n_eff` appears: the bias-corrected resultant length, the Rayleigh
p-value, the silence rule `n_eff <= 1` and `evidence.counts.jackpotDates.effective`.

Why fixed windows and not chains of gaps (the first implementation): a chain can span months. Nine wins on consecutive Fridays
were one cluster (`n_eff` = 1), so every κ was 0 although the dates share their weekday, the notes said "no calendar pattern"
and the strict chain zeroed the daily draws too; 30 dates over 188 days, or 99 synthetic combinations on every second draw,
were one "calendar position". With windows the Fridays are 5 clusters (weekday κ = 2) and the chain is 15. Today's real
clusters are unchanged (the widest, Mega Power's three wins of 2026-01-26 to 2026-02-01, spans 6 days), so no payload moved.

**(b) Jackpot-likeness of each pool draw.**

```
ρ(date) = exp( Σ_f κ_f·(cos(φ_f(date) - μ_f) - 1) )  ∈ (0, 1]
ω_i = ρ(date(d_i)) / Σ_{i'∈𝒫_t} ρ(date(d_i'))          for i ∈ 𝒫_t ;     ESS_T = 1 / Σ ω_i²
```

**(c) Contrast pseudo-counts.** The source says only what comes up more often on jackpot-like days *than on ordinary days*.

```
for each channel X:  F_ρ^X = ω-weighted category distribution over 𝒫_t ;  F_u^X = unweighted distribution over 𝒫_t
m_T^X = W_T · |𝒯_t| · (k for num, else 1)
e_T^X = m_T^X · ( p0^X + F_ρ^X - F_u^X )          =>  δ_T^X = m_T^X · (F_ρ^X - F_u^X)
```

If every `κ = 0` (or `n_eff <= 1`, or the pool is empty), then `ρ ≡ 1`, `δ_T = 0` and T is **present but silent**. With an
empty pool there are no weights, so `ESS_T` is `null` (`evidence.calendarEss`).

Why a contrast: in the bayesian design, a flat calendar made T simply the average daily draw. That is daily noise relabelled as
"dates", and it still received about 29% "date" share. The contrast grafts the energy and kernel idea (date lift minus daily lift)
into the power prior.

Measured today (own, de-clustered dates):

| Lottery | Dates | n_eff (= clusters) | moonPhase κ (raw p, Holm p) | dayOfMonth κ (raw p, Holm p) | weekday κ (raw p, Holm p) | ESS_T |
|---|---|---|---|---|---|---|
| Dhana Nidhanaya | 7 | 6 | 1.24 (0.087, 0.26) | 0.10 (0.38, 0.76) | 0 (0.70, 0.76) | 127 of 205 |
| Mega Power | 9 | 7 | 1.49 (0.037, 0.11) | 1.45 (0.041, 0.11) | 0 (0.67, 0.67) | 83 of 208 |
| Govisetha | 7 | 6 | 0 (0.75, 1) | 0.76 (0.20, 0.61) | 0 (0.59, 1) | 165 of 206 |

Where they peak:
- Dhana Nidhanaya moon peak: phase 0.43, about 2 days before the full moon.
- Mega Power moon peak: phase 0.40, about 3 days before the full moon.
- Day-of-month peaks: Mega Power around the 3rd, Govisetha around the 30th/1st.

After Holm, none of these is significant, so `explanation.dates` says so: "None of these is clear after allowing for the 3
checks, so they may well be chance; if real, it would most likely be a ticket-sales effect. The balls do not know the date." The
plain "Most likely a ticket-sales effect; the balls do not know the date." is used only when some feature has a Holm p below
0.05.

### 2.8 Source J: jackpot combinations (structure only, Dirichlet-shrunk)

J is **absent** if `𝒥_t` is empty. Otherwise `n_J = |𝒥_t|` and:

```
decade g(n) = min(floor((n-1)/10), 7)        (8 groups; 71-80 also holds 81-82)
G_g = Λ_t ∩ {n : g(n) = g},  π_g = |G_g| / L
c_g = number of live jackpot numbers (over 𝒥_t) in decade g,  C = Σ c_g
q_g = (c_g + J_PRIOR·k·π_g) / (C + J_PRIOR·k)                         (Dirichlet prior over decades, toward the null)
num:    e_J(n) = W_J·n_J·k · q_{g(n)} / |G_{g(n)}|                   (constant within a decade: exact numbers never favoured)
letter: q_l = (c_l + J_PRIOR/|U_t|)/(n_L + J_PRIOR),   e_J(l) = W_J·n_L·q_l      (n_L = usable combos with a letter in U_t)
bonus:  same with the combos that carry an integer bonus (none today)
odd, spread: q_b = (c_b + J_PRIOR·p0(b))/(n_J + J_PRIOR),   e_J(b) = W_J·n_J·q_b
```

### 2.9 Order cap: making J > T > D real in the totals

This step is applied **per channel**. Sources are taken in order J, T, D, and absent sources (mass 0) are skipped.

```
ceiling = +∞
for s in (J, T, D) present:
    δ_s = e_s - m_s·p0 ;  P_s = Σ_x |δ_s(x)|              (raw pull: L1 departure from fair)
    c_s = P_s > ceiling ? ceiling / P_s : 1                (damping; never > 1, so nothing is ever inflated)
    δ̃_s = c_s·δ_s
    ceiling = ORDER · c_s · P_s
influence_s = c_s·P_s / Σ_{s'} c_{s'}·P_{s'}                (0 for absent sources; all 0 if every source is silent)
```

The cap only damps lower-priority sources toward fair. NLB daily draws are statistically fair (dispersion 0.88-1.10), so this is
the James-Stein direction and harmless. A **silent** source (`P_s = 0`) sets the ceiling to 0 for every source below it. This is
the strict chain: if the dates show no pattern, the daily draws are held at 0 too (risk R3, decision D5).

### 2.10 Posterior predictive, leans and exact parts

This step is applied per channel.

```
m = Σ_s m_s ;  A0 = PRIOR·(k for num, else 1) ;  u(x) = Σ_s δ̃_s(x)
A = max( A0,  max_{x: p0(x)>0} |u(x)| / ((MAX_LIFT-1)·p0(x)) - m )        (raise the prior until every lean is in bounds)
θ(x) = (A·p0(x) + Σ_s (m_s·p0(x) + δ̃_s(x))) / (A + m) = p0(x) + u(x)/(A + m)
lean(x) = θ(x)/p0(x) ∈ [2 - MAX_LIFT, MAX_LIFT] = [0.75, 1.25]
part_s(x) = δ̃_s(x) / (p0(x)·(A + m))      and exactly   lean(x) - 1 = Σ_s part_s(x)
flatten = A / A0      (reported; 1 = bound not active)
patternLean = 100 · ½ Σ_x |θ_num(x) - p0(x)|      ("how far from all-numbers-equal", 0..100; not an advantage)
```

Set level, for a sorted 4-set `S ⊂ Λ_t`:

```
logScore(S) = Σ_{n∈S} ln θ_num(n) + Σ_{f∈{odd,spread}} ln lean_f(bin_f(S))
part_s(S)   = Σ_{n∈S} part_s^num(n) + Σ_f part_s^f(bin_f(S))          ("pattern points", shown per card)
```

The model inclusion probability `q(n) = k·θ_num(n)` is used only by the ball log-score in the backtest.

### 2.11 Where the owner's order J > T > D is guaranteed (each level tested)

| Level | Guarantee | How it is enforced | Test |
|---|---|---|---|
| (a) per item | A combination weighs 12, a date 4, a daily draw 1, before any damping | Constants | Constants pinned |
| (b) per source total, in **every** channel (numbers, letters, bonus, odd, spread) | `influence_T <= 0.75·influence_J` and `influence_D <= 0.75·influence_T` among present sources | Cap (2.9) | Property test on real data, plus synthetic growth from 0 to 100 combos |
| (c) the displayed Top pick | Its parts satisfy `J >= T >= D` over present sources | Selection constraint (2.15) with a fallback flag `orderHeld` | Regression test: `orderHeld` is true for all 7 lotteries today and for 100% of backtest steps (measured: the filter changed the pick in 50/178 Dhana and 4/178 Govisetha steps) |

The view cards (Jackpot pattern, Jackpot days, Daily draws) deliberately show **one** source each, so (c) is claimed only for the
Top pick. What a view card shows instead: when its source moves the picks, its part for that source comes out positive, because it
is the best ticket of that source alone (2.15). This is a tested property (real data and the synthetic growth cases), not a filter. Measured shares in the number
channel today:

| Lottery | J / T / D | Daily damping `c_D` | Letters J / T / D |
|---|---|---|---|
| Dhana Nidhanaya | 0.536 / 0.265 / 0.199 | 0.090 | 0.775 / 0.129 / 0.096 |
| Govisetha | 0.483 / 0.296 / 0.222 | 0.057 | 0.766 / 0.133 / 0.100 |
| Mega Power | 0 / 0.571 / 0.429 | 0.141 | 0 / 0.571 / 0.429 |
| Ada Kotipathi, Super Ball, Shanida, Kapruka | 0 / 0 / 1 | 1 (alone; leans flattened 4-18x by `MAX_LIFT`) | 0 / 0 / 1 |

The shares moved from the design-phase prototype (Dhana Nidhanaya 0.512 / 0.279 / 0.209, Govisetha 0.469 / 0.304 / 0.228)
because `n_eff` is now the number of date clusters (2.7): fewer effective dates give a weaker calendar fit and so a smaller
date pull. Mega Power keeps 4 : 3 because its dates are the top present source.

### 2.12 Zero and partial evidence (graceful degradation)

| Case | J | T | D | `evidence.status` | Note shown (plain language) |
|---|---|---|---|---|---|
| No own jackpot item (all 4 DLB today) | absent | absent | alone, uncapped | `none` | "No jackpot win is known for {name} yet, so the jackpot weights cannot apply. Picks use daily draws only." (wins known but none usable yet: "{name} has no jackpot win the picks can use yet, so ...") |
| Dates but no winning numbers (Mega Power) | absent (0%, not redistributed) | present | capped at 0.75·T | `dates-only` | "Mega Power's 9 dated jackpot wins are older than our draw archive, so their numbers are unknown. Only their dates are used." (it counts the dated wins, like the jackpot list next to it: 11 known, 2 of them undated) |
| Combinations (each with its date) | present | present | capped | `combinations` | none |
| Dates silent (all κ = 0, or n_eff <= 1) | as available | 0% ("no calendar pattern yet") | held at 0 (strict chain) | unchanged | "The jackpot dates show no calendar pattern yet, so they add nothing. Daily draws may never outweigh the dates, so they are held back too." |
| Undated items | not used | not used | none | none | Counted in `counts.jackpotDates.undated` and listed with "date unknown" |
| Item known but not yet usable | not used | not used | none | none | Listed in `evidence.pending` with its `knownFrom` |
| Fewer than 31 draws | none | none | none | none | `backtest.draws = 0`; prediction still produced |
| Dhana Nidhanaya Sunday Bonus | none | none | none | none | Bonus `null` as in v1; note "Sunday Bonus digits are not predicted." |
| First DLB inferred win | enters automatically at draw K+3 (known from draw K+2) | same | same | changes automatically | none; its backtest checks (jackpot numbers, combinations lean) join after 30 test draws (5.2) |

A flat posterior can occur, for example when every source is silent. In that case ties are broken by seeded tie keys (2.16), not
by number order, so the Top pick is never 1-2-3-4.

### 2.13 Letters and bonus

**Letters** use the same three sources, cap and bounds as numbers (sections 2.6-2.10).
- **Top pick:** letter = argmax θ_letter. Exact ties (equal θ) go to the letter with the **smallest seeded tie key** (2.16),
  never to alphabetical order. Today Shanida's G and Q tie exactly, and the tie key picks **Q**. The backtest's MAP letter
  (`letterHitRate`) is this same Top-pick letter at every step.
- **View cards:** the argmax of the source-only letter distribution (exact ties to the smallest tie key). A balanced card takes
  the letter with the highest θ_letter among those no card selected before it uses (exact ties to the smallest tie key; all
  letters if every one is used, which cannot happen with 26 letters and at most 4 earlier cards).
- **Lucky dip:** uniform over `U_t`.
- **Disclosure** (in `notes` and the details view): "While jackpot combinations are known, the Top pick's letter is always the
  letter of a past jackpot. Letters are drawn separately from the numbers, so this repeats no combination."

**Integer bonus** (Mega Power Super Number 1..26, Kapruka 1..40) uses the same channel mechanics.
- J has none today: no known jackpot with numbers carries an integer bonus.
- Top pick: argmax, exact ties to the smallest bonus tie key (as for letters; also the backtest's MAP bonus). View cards: the
  argmax of the source-only distribution (tie keys; a balanced card: the best θ_bonus value no earlier card uses). Lucky dip:
  uniform.

**Dhana Nidhanaya Sunday Bonus** (a digits object) is not modelled, as in v1. `bonus` is `null` and a note says so.

### 2.14 Pick rules (applied to every card) and the guard ladder

| Rule | Definition |
|---|---|
| R1 copy guard `(c, u)` | Shares at most `c` numbers with each usable own jackpot combination, and at most `u` numbers with their union |
| R2 typicality | Odd count 1..3; sum within `[s10, s90]` of the exact null sum distribution on `Λ_t`; at most 1 consecutive pair |
| R3 not a past result | The set is not identical to the numbers of any earlier draw of this lottery. This is presentation only: a past result is exactly as likely as any ticket, but a card equal to an old result looks like copying (decision D4). |
| R4 diversity | Shares at most `SET_OVERLAP = 2` numbers with every card selected before it (selection order of 2.15); so any two cards share at most 2. A balanced card (2.15) shares at most `BALANCED_OVERLAP = 1`, unless no ticket passes that after the CAND fallbacks |
| R5 live balls | Numbers only from `Λ_t` |

**Guard ladder.** The rule is chance-calibrated, so it scales with evidence. Take the first rung `(c, u)` of `GUARD_LADDER` whose
Bonferroni bound on the share of all tickets it excludes is at most `GUARD_ALPHA`:

```
H(L, j, c) = Σ_{x=c+1}^{min(4,j)} C(j,x)·C(L-j, 4-x) / C(L,4)          (hypergeometric tail)
excluded(c,u) = Σ_{combos} H(L, |combo ∩ Λ|, c) + H(L, |union ∩ Λ|, u)  <=  0.05
```

Today both Dhana Nidhanaya and Govisetha get rung **(1, 2)**:

| Lottery | Per-combination share excluded | Union share excluded | Total |
|---|---|---|---|
| Dhana Nidhanaya (L = 82, 12 distinct jackpot numbers) | 3 × 1.048% | 0.909% | 4.05% |
| Govisetha (L = 80, 8 numbers) | 2 × 1.100% | 0.259% | 2.46% |

This matches the stats and fidelity must-fix: at most 1 number per combination and at most 2 from the union.

As combinations accumulate, the rung loosens by itself. For disjoint combinations on 1..80:
- (1,3) at 4 combinations;
- (2,3) from 5;
- (2,4) from about 10;
- (3,4) ("never an exact past jackpot") beyond about 260.

So the guards **never exclude more than 5% of tickets**. They can never become an anti-jackpot filter and can never make the search
infeasible. This meets the engineering must-fix, which showed that a fixed union rule falls to a 45% pass rate at 20 combinations
and to 0% at 150.

Implementation note: precompute, for every number, the list of combinations that contain it. A guard check then costs O(4 × combos
per number), not O(#combos).

### 2.15 The five cards

| # | `label` (always exactly this) | `source` | Numbers | Letter / bonus |
|---|---|---|---|---|
| 1 | **Top pick** | `all` | Constrained best ticket (below) | argmax (tie keys) |
| 2 | **Jackpot pattern** | `jackpotCombinations` | Constrained best ticket of the J-only lean (balanced: of the full posterior, at most 1 number shared with each earlier card) | argmax of the J-only distribution (tie keys; balanced: the best θ value no earlier card uses) |
| 3 | **Jackpot days** | `jackpotDates` | Constrained best ticket of the T-only lean (balanced: as above) | argmax of the T-only distribution (tie keys; balanced: as above) |
| 4 | **Daily draws** | `dailyDraws` | Constrained best ticket of the D-only lean (balanced: as above) | argmax of the D-only distribution (tie keys; balanced: as above) |
| 5 | **Lucky dip** | `luckyDip` | Uniform over passing tickets (control card) | Uniform letter, uniform bonus |

Cards 1-4 are deterministic: they depend on the data and the tie keys only. The Lucky dip is the only random card.

**Labels and notes.** `label` is always the short base label above, whatever the evidence, so the five labels of a lottery
are unique. The UI shows `label` as the card title and `note` as the card's one-line "why"; it never parses label text. The
reason a card is a balanced pick is said only in its `note`: one plain sentence, true for every evidence status, within the
copy rules of 7.5. A source **moves the picks** when it is present and its damped pull in the number channel is above 0;
otherwise it is absent (nothing known), silent (no pattern: zero pull) or held back (damped to 0 because the source above it
shows no pattern, the strict chain of 2.9).

| Card | Its source moves the picks | Its source does not (the card is a balanced pick) |
|---|---|---|
| Top pick | All three do: "All three sources together, jackpot combinations first." | Otherwise the sources that do, then why the first other one does not: "Jackpot dates and daily draws together; no jackpot numbers are known yet." (Mega Power), "Daily draws only; no jackpot win is known yet." (DLB; wins known but none usable yet: "... no jackpot win can be used yet."), "Jackpot combinations only; the jackpot dates show no calendar pattern yet."; none does: "No source moves the picks yet, so every ball counts the same." |
| Jackpot pattern | "Follows the tens, odd/even mix, spread and letter of past jackpots." | "No jackpot numbers are known yet, so this card is a balanced pick from all the evidence." (numbers known but not usable yet: "No jackpot numbers can be used yet, so ..."; silent: "The jackpot numbers show no pattern yet, so ...") |
| Jackpot days | "Follows the draws held on calendar days similar to past jackpot dates." | "No jackpot dates are known yet, so this card is a balanced pick from all the evidence." (dates known but not usable yet: "No jackpot dates can be used yet, so ...") / "The jackpot dates show no calendar pattern yet, so this card is a balanced pick from all the evidence." (held: "Jackpot dates are held back while the jackpot numbers show no pattern, so this card is a balanced pick.") |
| Daily draws | "What the daily draws alone point to." | "Daily draws are held back while the dates show no pattern, so this card is a balanced pick." (when the dates are held back too: "... while the sources above them show no pattern ..."; absent: "There are no daily draws yet, so ..."; silent: "The daily draws show no pattern yet, so ...") |
| Lucky dip | "A random ticket that follows the same pick rules. It has exactly the same chance as every other card." (it is uniform over the tickets that pass R1-R4, not over every ticket) | (always) |

"Known yet" and "can be used yet" follow the jackpot list next to the cards (3.2): a win that is listed there but not usable
before the next draw (not public long enough yet, 2.4, or undated) is never called unknown.

Measured today (`orderHeld` is true for all 7):

| Lottery | Top pick | `note` |
|---|---|---|
| Dhana Nidhanaya | S 23 25 29 68 | All three sources together, jackpot combinations first. |
| Mega Power | N 6 50 61 74, Super Number 12 | Jackpot dates and daily draws together; no jackpot numbers are known yet. |
| Govisetha | T 10 63 65 67 | All three sources together, jackpot combinations first. |
| Ada Kotipathi | R 9 20 57 75 | Daily draws only; no jackpot win is known yet. |
| Super Ball | G 3 9 37 76 | Daily draws only; no jackpot win is known yet. |
| Shanida | Q 3 13 15 80 (Q ties exactly with G; the seeded letter tie key picks Q, 2.13) | Daily draws only; no jackpot win is known yet. |
| Kapruka | H 5 15 38 42, bonus 29 | Daily draws only; no jackpot win is known yet. |

Mega Power's Super Number was 15 before `n_eff` became the number of clusters; its letter and numbers did not change.

**Top pick:**

```
cand = the CAND live numbers with the highest θ_num (ties: tie key), enumerated in tie-key order
over all 4-subsets S of cand that pass R1-R3:
    best_all   = argmax logScore(S)
    best_order = argmax logScore(S) among S whose set parts satisfy J >= T >= D over present sources
Top pick = best_order if it exists (orderHeld = true), else best_all (orderHeld = false, plus a note)
ties (|Δ| <= 1e-12): the first in enumeration order
fallback when nothing passes: CAND = 32, then 48, then all of Λ_t (deterministic). This terminates because R1 admits >= 95% and R2
admits about 70% of all tickets
```

The Top pick is *defined* over the 24 highest-lean numbers. It is not claimed to be the global optimum (an oracle test checks the
implementation; the audit reports the global gap).

**View cards (2-4)** are deterministic constrained best tickets, like the Top pick. For source `s`, when it moves the picks
(present, not silent, not held back):

```
source-only lean, in every channel X (numbers, odd, spread, letters, bonus):
    λ_s^X(x) = 1 + part_s^X(x)·(A^X + m^X)/(A^X + m_s^X)        (1 where s is absent in X; floored at 1e-9)
source-only logScore(S) = Σ_{n∈S} ln λ_s(n) + Σ_{f∈{odd,spread}} ln λ_s^f(bin_f(S))
cand = the CAND live numbers with the highest λ_s (ties: tie key), enumerated in tie-key order
card = argmax source-only logScore(S) over the 4-subsets S of cand that pass R1-R4 against the cards selected before it
ties (|Δ| <= 1e-12): the first in enumeration order;  fallback when nothing passes: CAND = 32, then 48, then all of Λ_t
letter, bonus = argmax λ_s^letter, argmax λ_s^bonus (exact ties to the smallest tie key)
```

When the source does not move the picks (absent, silent or held back), the card is a **balanced pick**: the same search with the
full posterior instead (θ for ranking, the Top pick's logScore; like the Top pick without the order filter), against the cards
selected before it, and a clearly different alternative to them (PM decision 15):

```
balanced card = argmax logScore(S) over the 4-subsets S of cand (θ ranking, CAND fallbacks 32, 48, all of Λ_t) that pass R1-R3
                and share at most BALANCED_OVERLAP = 1 number with every card selected before it;
                if no ticket passes that even on all of Λ_t: the same search with R4 (at most 2), the rule of the other cards
letter, bonus = argmax θ_letter, argmax θ_bonus over the values that no card selected before it uses (exact ties to the
                smallest tie key; all values if every one is used)
```

Its label stays the same and its note says why. A card whose source moves the picks keeps R4 (at most 2 shared numbers) and the
argmax letter and bonus of its own source, even when they equal the Top pick's.

**Selection order.** The cards are chosen in this order, each passing R4 against every card chosen before it: the Top pick; then
the cards whose source moves the picks, in the owner's order (Jackpot pattern, Jackpot days, Daily draws); then the balanced
cards, in the same order; then the Lucky dip. So the sources that move the picks get the strongest tickets. The display order
and the labels stay those of the table above.

The source-only lean shows the *direction* of its source even when that source is heavily damped in the Top pick, and a card
whose source moves the picks therefore has a positive part for its own source (tested). The "Daily draws" card shows what daily
draws alone point to. Where only the daily draws move the picks (the four DLB lotteries today), λ_D is the full lean, so the
Daily draws card takes the best ticket after the Top pick (sharing up to 2 numbers with it, and its letter and bonus). The two
balanced cards then share at most 1 number with each earlier card and take letters (and Kapruka bonus values) no earlier card
has. Before PM decision 15 they were the next-best tickets of the same lean, so the highest-lean numbers, the letter and the
bonus reappeared on cards 1-4 (Ada Kotipathi 20 and 57 and letter R on all four, Kapruka 42 and bonus 29 on all four). A
single number may still reappear on every card, one at a time (Kapruka's 42 today), because the rule bounds the overlap with
each earlier card, not with all of them together.

**Lucky dip:** uniform over the tickets that pass R1-R4 against the four cards above it. Up to `SIR_ROUNDS` rounds of `SIR`
candidates, each 4 live balls drawn uniformly one by one without replacement from the stream; the first round with a passing
candidate returns one of its passing candidates, chosen uniformly by one more draw. If no round finds one, the first passing
ticket in tie-key order (deterministic fallback). Letter and bonus: uniform.

Measured today (view cards; the part shown is the card's own source, positive for every source that moves the picks):

| Lottery | Jackpot pattern | Jackpot days | Daily draws |
|---|---|---|---|
| Dhana Nidhanaya | D 22 26 28 29 (J +0.288) | B 29 33 59 68 (T +0.189) | E 19 37 52 77 (D +0.133) |
| Mega Power | S 11 22 56 74, Super Number 20 (balanced) | N 6 51 74 76, Super Number 12 (T +0.494) | U 7 22 50 65, Super Number 15 (D +0.255) |
| Govisetha | G 32 37 63 65 (J +0.205) | Q 10 41 50 63 (T +0.118) | I 10 32 36 45 (D +0.092) |
| Ada Kotipathi | B 2 11 43 57 (balanced) | M 14 20 43 73 (balanced) | R 13 20 57 69 (D +0.727) |
| Super Ball | I 3 30 38 48 (balanced) | T 21 30 74 76 (balanced) | G 9 30 37 61 (D +0.806) |
| Shanida | G 3 22 77 79 (balanced) | K 3 18 34 67 (balanced) | Q 3 26 73 80 (D +0.674) |
| Kapruka | X 40 42 43 63, bonus 23 (balanced) | S 9 21 42 47, bonus 30 (balanced) | H 38 42 45 69, bonus 29 (D +0.757) |

The balanced cards before PM decision 15 (Appendix B item 24; every other card, the Top picks and the backtests are
byte-identical): Mega Power Jackpot pattern N 11 51 61 74, Super Number 12; Ada Kotipathi R 2 20 43 57 and R 11 20 57 73;
Super Ball G 3 9 30 71 and G 30 37 38 76; Shanida Q 3 15 22 73 and Q 3 22 77 80; Kapruka H 15 42 63 69 and H 38 42 43 63,
bonus 29 on both.

Before Appendix B item 21 the view cards were seeded samples (SIR at temperature `TAU`) and could point away from their own
source: Mega Power's Daily draws card had T +0.12 > D +0.05, Dhana Nidhanaya's D -0.02, Kapruka's Daily draws card (+0.27) was
weaker than its balanced cards (+0.63, +0.19).

**Per-set fields:**
- `score` (existing field, 0..1): mean over the set's numbers of `(θ(n) - min θ)/(max θ - min θ)` over live numbers (0.5 if flat).
  This is the v1 convention, so the field keeps its meaning.
- Additive fields: `source`, `parts` (r4), `orderHeld`, `pastJackpotNumbers` (numbers in the union of usable own combinations),
  `maxSharedWithOneJackpot`, `note` (the one-line "why" above).

`numberScores` (existing field, every number lo..hi) = r4 of the min-max of θ over live numbers. Dead numbers get 0.

### 2.16 Determinism contract

There is one stream per prediction:

```
rng = mulberry32(fnv1a(`${id}:${lastDrawNo}:win-lot-jackpot-v2`))      (lastDrawNo = drawNo(d_{t-1}))
```

It is consumed in this fixed order:
1. `M` number tie keys (lo..hi);
2. `|U_t|` letter tie keys;
3. `B` bonus tie keys;
4. the Lucky dip: its numbers (one draw per ball of every candidate, round by round, then one draw to choose among the passing
   candidates of the first round that has any), then its letter (one draw, if the lottery has letters), then its bonus (one
   draw, if it has an integer bonus).

The Top pick and the view cards (cards 2-4) use only the tie keys of items 1-3 and consume nothing else, so they depend on the
data alone; the Lucky dip is the only card drawn from the stream. The backtest consumes only items 1-3, so its Top pick at step
`t` is byte-identical to the production Top pick that would have been published then.

Other rules:
- Canonical sort of jackpot items (by `drawNo`) and dates (ISO).
- Explicit tie-breaks.
- `r4` (from lib/model.ts) on every float in the payload.
- Never use `Date.now`, `Math.random`, `localeCompare`, or iteration over unsorted `Map`/`Set`.
- `generatedAt` is the same as v1 (fetch log).
- Pin Node 22 in CI.

### 2.17 Complexity and runtime

**Per step:**
- regime scan `O(t·k)`;
- D counts `O(|𝒫|·k)`;
- calendar fit `O(|𝒯|)`;
- ρ and contrast `O(|𝒫|·3)` (angles precomputed once per lottery);
- J `O(#combos·k + M)`;
- cap and posterior `O(M)` per channel;
- Top pick: 10,626 candidates, each costing O(1) for typicality, O(4·combos per number) for the guard and O(1) for shape lookup;
- shape nulls cached per live-ball signature.

**Production only** (the backtest computes the Top pick alone): the three view cards repeat the Top pick's search on their own
lean (3 × 10,626 candidates, plus O(4·cards) for R4), and the Lucky dip draws at most `SIR_ROUNDS · SIR` = 256 uniform
candidates (in practice one round).

**Measured with the prototype:**

| Item | Time |
|---|---|
| Prediction, per lottery | 6-11 ms |
| Walk-forward (178-200 steps), per lottery | 0.70-0.88 s |
| Full run: 7 predictions twice, 7 backtests, v1 traces, double-count Monte Carlo | 6.2 s |
| 30 placebo replicates for 2 lotteries | 54 s, which is why placebo runs are offline only |

The implementation (`npm run bench:model`, 2026-10-29, with the deterministic view cards of Appendix B item 21): `predictAllV2`
for all 7 lotteries, backtests and v1 traces included, in 2.3 s; the synthetic 100-combination Dhana Nidhanaya prediction with
its walk-forward in 0.46 s. After the third round (Appendix B items 24-30), measured while other builds ran on the same laptop:
3.2 s and 0.56 s (the balanced cards add at most one more 10,626-ticket search per card; the backtest computes no cards). CI runs
the benchmark after the tests. The full offline audit takes about 4-6 minutes (342 s on its last run).

The cost grows linearly with the number of combinations. There is no data-dependent branch-and-bound in the hot path.

### 2.18 Deviations from all four designs, and why

1. **Chance-calibrated guard ladder** (new). The judges conflict: stats and fidelity want at most 1 per combination plus a union
   of at most 2; engineering wants never a union rule. The ladder gives exactly the former today and provably never excludes more
   than 5% of tickets as evidence grows.
2. **T as a contrast, fitted per step on own dates only.** This deviates from bayesian (its fixed-κ analogue T was mostly
   relabelled daily noise) and from kernel and energy (their calendar fits pooled across lotteries). Own-only follows the fidelity
   must-fix that borrowed evidence must not shape or damp own evidence. The cost is noisier κ (e.g. Govisetha's moon κ = 0).
3. **Partition rule** in D as well as T. Kernel excluded jackpot draws from its dates voice only. This removes the guaranteed-count
   selection effect in the daily source.
4. **Sum tercile dropped** (measured overlap with the decades, 2.5).
5. **Seeded tie keys** instead of lexicographic ties, because a flat posterior would otherwise give 1-2-3-4.
6. **Strict chain for silent sources**, the honest consequence of the owner's order (decision D5).
7. **Placebo distributions only in the offline audit** (runtime). The payload carries the analytic random expectation.
8. **Per-draw v1 hits via a verified trace helper** outside `lib/model.ts`. The build asserts its average equals v1 `backtest()`
   exactly: paired comparison, with zero diff to v1.

---

## 3. Data contract changes

### 3.1 Marking jackpot-won draws (`lib/types.ts`, filled in `lib/data.ts`)

```ts
export type JackpotSource = "nlb-prize-table" | "nlb-winners-directory" | "dlb-jackpot-reset"; // same literals as lib/jackpots.ts

export interface DrawJackpot {
  winners: number | null; // jackpotWinners (null for DLB inferred wins)
  amount: number | null;  // superPrizeAmount (LKR)
  source: JackpotSource;
}

export interface DrawSummary {
  drawNo: number; date: string; letter: string | null; numbers: number[]; bonus: unknown | null;
  /** Present only on draws of THIS lottery whose jackpot was won (join of data/jackpots.json on lotteryId + drawNo). */
  jackpot?: DrawJackpot;
}
```

How `getDraws(id)` fills it:
- It joins the own `jackpots.json` items with `inDrawHistory`. The flag is written only on jackpot draws. Other draws stay
  byte-identical, so the public JSON grows by a few hundred bytes in total.
- The flag is a fact, so it is **not** gated by `knownFrom`.
- Another lottery's jackpot day is **never** marked.
- `modelDraws` ignores the field, so v1 is unaffected.
- Today exactly 5 draws carry it: Dhana Nidhanaya 2234, 2289, 2319 and Govisetha 4415, 4419.

### 3.2 Jackpot list and status for the UI (new, `lib/types.ts` + `lib/data.ts`)

```ts
export interface JackpotWin {
  drawNo: number; date: string | null; letter: string | null; numbers: number[] | null; bonus: unknown | null;
  winners: number | null; amount: number | null; source: JackpotSource;
  inArchive: boolean;                 // = inDrawHistory
  listedIn?: string[];
  knownFrom: string | null;           // knownFrom() of section 2.4 (single shared function)
  usedAs: ("combination" | "date")[]; // how v2 uses it for the NEXT draw ([] = undated or not yet known)
}

export interface JackpotStatus {
  lotteryId: string;
  wins: JackpotWin[];                                   // own lottery only, newest first (all sources, incl. undated)
  lastWin: { drawNo: number; date: string | null; inArchive: boolean } | null;
  drawsSinceLastWin: number | null;                     // latestDrawNo - lastWin.drawNo (draw numbers are consecutive)
  daysSinceLastWin: number | null;                      // latest draw date - lastWin.date
  current: { amount: number; drawNo: number; date: string | null; kind: "last-draw" | "advertised-next" } | null;
  latestDraw: { drawNo: number; date: string; outcome: "won" | "not-won" | "unknown" } | null; // the newest archived draw
  checked: { draws: number; wins: number; from: string | null; to: string | null } | null; // NLB rows with a known winners count
  notes: string[];                                      // DLB inference lag, older wins without numbers, known typos
}
```

Where the fields come from:
- `current`, NLB: the newest prize row, labelled "jackpot at the last draw".
- `current`, DLB: the newest `tier: "advertised"` row, "advertised for the next draw".
- `latestDraw`: `drawNo` and `date` of the newest archived draw, and its jackpot outcome. `won` when that draw is marked (3.1)
  or its NLB prize row shows winners > 0; `not-won` only when its NLB prize row shows **0** winners (the jackpot rolls over);
  `unknown` otherwise: no prize row with a winners count yet, and always for DLB, which publishes no winners (a DLB win is
  inferred two draws late, so the newest DLB draw is `won` only once it is marked). It never guesses `not-won`. Today the 3 NLB
  lotteries are `not-won` (Dhana Nidhanaya 2383, Mega Power 2701, Govisetha 4595) and the 4 DLB lotteries `unknown`.
- `checked` gives the base rate **as counts only**, e.g. "won 3 times in 207 checked draws". It is never shown as a chance.
  `from` / `to` are the dates of the first and the last NLB prize row with a known winners count (today 2026-03-28 to
  2026-10-27; the row of the archive's first draw, 2026-03-27, has no winners count).
- Known typos: export `suspiciousAmounts` from `lib/jackpots.ts` (an export only, no logic change) and note them.
- **The model never reads amounts or prizes.**

### 3.3 `Prediction` additions (all optional except `modelVersion`; existing fields keep their meaning)

```ts
export type EvidenceSource = "jackpotCombinations" | "jackpotDates" | "dailyDraws";
export type SourceSplit = Record<EvidenceSource, number>;          // shares sum to 1 over present sources; 0 = absent

export interface PredictionSet {
  label: string; letter: string | null; numbers: number[]; bonus: unknown | null; score: number;   // unchanged
  // v2: label is always one of the five base labels of 2.15 (unique per lottery; never carries a reason)
  source?: "all" | EvidenceSource | "luckyDip";
  parts?: SourceSplit;               // pattern points (lean units), not probabilities
  orderHeld?: boolean;               // parts follow J >= T >= D over present sources (claimed for the Top pick only)
  pastJackpotNumbers?: number;
  maxSharedWithOneJackpot?: number;
  note?: string;                     // the card's one-line "why" (2.15): one plain sentence, says when it is a balanced pick
}

export interface Prediction {
  /* existing: lotteryId, generatedAt, basedOnDraws, nextDrawDate, nextDrawNo, sets, numberScores, method, disclaimer, backtest */
  modelVersion: string;                                   // add to the shared type ("win-lot-heuristic-v1" | "win-lot-jackpot-v2")
  evidence?: {
    status: "combinations" | "dates-only" | "none";
    asOf: string;                                          // = nextDrawDate; evidence known strictly before it
    counts: {
      jackpotCombinations: { used: number; known: number };
      jackpotDates: { used: number; known: number; undated: number; olderThanArchive: number; clusters: number; effective: number };
                                                           // effective = n_eff = clusters (2.7)
      dailyDraws: { used: number; total: number; since: string; excludedAsJackpot: number };
                                                           // total = draws in the current regime [r_t, t); since = date(d_{r_t})
    };
    mass: SourceSplit;                                     // pseudo-draws actually spent before damping, e.g. {36, 28, 205}
    used: { drawNo: number; date: string | null; kind: "combination" | "date"; source: JackpotSource; knownFrom: string }[];
    pending: { drawNo: number; date: string | null; knownFrom: string | null }[];
    calendar: { feature: "moonPhase" | "dayOfMonth" | "weekday"; strength: number; peak: string; rayleighP: number; holmP: number }[] | null;
    calendarEss: number | null;
    guard: { perCombination: number; union: number; excludedShare: number };
  };
  weights?: { jackpotCombination: 12; jackpotDate: 4; dailyDraw: 1; orderRatio: 0.75; maxLean: 1.25; jackpotPrior: 2 };
  influence?: { numbers: SourceSplit; letters: SourceSplit | null; bonus: SourceSplit | null; odd: SourceSplit; spread: SourceSplit };
  damping?: { numbers: SourceSplit; letters: SourceSplit | null; bonus: SourceSplit | null };   // c_s (1 = not turned down)
  patternLean?: number;                                    // 0..100, section 2.10
  numberLean?: { n: number; lean: number; j: number; t: number; d: number }[];   // live numbers; lean - 1 = j + t + d
  letterLean?: { letter: string; lean: number; j: number; t: number; d: number }[] | null;
  bonusLean?: { n: number; lean: number; j: number; t: number; d: number }[] | null;
  shapeLean?: { feature: "odd" | "spread"; bins: { label: string; lean: number }[] }[];
  liveBalls?: { count: number; excluded: number[]; since: string };
  odds?: { numbers: number; numbersAndLetter: number | null; basis: string };   // C(L,4), ×|U|; identical for every set
  backtestDetail?: BacktestDetail;                         // section 5; omitted when backtest.draws = 0 (fewer than 31 draws)
  previousModel?: { modelVersion: "win-lot-heuristic-v1"; sets: PredictionSet[];
                    backtest: { draws: number; avgHits: number; randomBaseline: number }; honestRandomBaseline: number };
  explanation?: { summary: string; weights: string; combinations: string; dates: string; daily: string;
                  sets: string; backtest: string; odds: string; limits: string };
  notes?: string[];                                        // plain-language degradation and disclosure messages
}
```

Other v2 values:
- `modelVersion`: `"win-lot-jackpot-v2"`.
- `method`: the v2 text (below).
- `disclaimer`: the v1 `DISCLAIMER`, imported and unchanged.
- `backtest` (existing shape): `{draws, avgHits of the Top pick, randomBaseline = mean_t k²/L_t}` (r4).

`method` text (generated from `V2_CONSTANTS`, so it always matches the constants):
> "Fair-balls prior over the balls in use, plus three evidence sources in the owner's order. A jackpot-winning combination counts
> as 12 draws, acting only through its decades, odd/even mix, spread and letter, with 2 average pseudo-jackpots added. A
> jackpot-winning date counts as 4 draws, through draws held on calendar-similar days (moon phase, day of month, weekday; fitted on
> this lottery's own dates; contrast with ordinary days). A daily draw counts as 1. Each lower source is damped to at most 75% of
> the pull of the source above it, and no number's lean leaves 0.75-1.25. Cards follow copy, typicality and diversity rules.
> Walk-forward backtest over the last 200 draws, or fewer so that each replayed draw has at least 30 earlier draws, using only
> evidence known before each draw."

(The window clause was "over the last 200 draws" until Appendix B item 27: the three NLB lotteries replay 178 draws, because
their archives hold 208 and each replayed draw needs 30 before it.)

**Example** (Dhana Nidhanaya, abridged; the implementation's values on the data of 2026-10-27):

```json
{ "modelVersion": "win-lot-jackpot-v2",
  "evidence": { "status": "combinations",
    "counts": { "jackpotCombinations": {"used": 3, "known": 3},
                "jackpotDates": {"used": 7, "known": 7, "undated": 0, "olderThanArchive": 4, "clusters": 6, "effective": 6},
                "dailyDraws": {"used": 205, "total": 208, "since": "2026-03-27", "excludedAsJackpot": 3} },
    "mass": {"jackpotCombinations": 36, "jackpotDates": 28, "dailyDraws": 205},
    "calendar": [ {"feature": "moonPhase", "strength": 1.2394, "peak": "about 2 days before the full moon", "rayleighP": 0.0869, "holmP": 0.2608},
                  {"feature": "dayOfMonth", "strength": 0.0962, "peak": "around the 23rd", "rayleighP": 0.3803, "holmP": 0.7605},
                  {"feature": "weekday", "strength": 0, "peak": "none", "rayleighP": 0.7007, "holmP": 0.7605} ],
    "guard": {"perCombination": 1, "union": 2, "excludedShare": 0.0405} },
  "influence": { "numbers": {"jackpotCombinations": 0.5361, "jackpotDates": 0.2651, "dailyDraws": 0.1988} },
  "damping": { "numbers": {"jackpotCombinations": 1, "jackpotDates": 1, "dailyDraws": 0.0896} },
  "patternLean": 2.3814,
  "sets": [ {"label": "Top pick", "letter": "S", "numbers": [23, 25, 29, 68], "bonus": null, "score": 0.8661, "source": "all",
             "parts": {"jackpotCombinations": 0.242, "jackpotDates": 0.1477, "dailyDraws": 0.0289},
             "orderHeld": true, "pastJackpotNumbers": 0, "maxSharedWithOneJackpot": 0,
             "note": "All three sources together, jackpot combinations first."} ],
  "odds": {"numbers": 1749060, "numbersAndLetter": 45475560, "basis": "82 numbers in use, 26 letters"} }
```

A balanced card keeps its label and says why in its note (Mega Power, which has no jackpot numbers). It is the best ticket of the
full posterior after the Top pick and the two cards whose source moves the picks that shares at most 1 number with each of them
(74 with the Top pick and the Jackpot days card, 22 with the Daily draws card), and its letter and Super Number are the best ones
none of them uses (not N or U, not 12 or 15):

```json
{"label": "Jackpot pattern", "letter": "S", "numbers": [11, 22, 56, 74], "bonus": 20, "score": 0.7555, "source": "jackpotCombinations",
 "parts": {"jackpotCombinations": 0, "jackpotDates": 0.3321, "dailyDraws": 0.1088}, "orderHeld": true,
 "pastJackpotNumbers": 0, "maxSharedWithOneJackpot": 0,
 "note": "No jackpot numbers are known yet, so this card is a balanced pick from all the evidence."}
```

The `explanation` texts are plain language and true for every evidence status (Appendix B items 22 and 25-30). Dhana Nidhanaya
today:

```json
{"summary": "All balls start equal; three kinds of evidence then move the picks, strongest first. Share of the pull on the numbers today: Jackpot combinations 54% · Jackpot dates 26% · Daily draws 20%.",
 "combinations": "3 jackpot combinations, used only through their tens, odd/even mix, spread and letter, never their exact numbers. The pattern also counts 2 imaginary average jackpots, so one jackpot cannot swing it on its own.",
 "dates": "7 jackpot dates. Calendar peaks - moon phase: about 2 days before the full moon; day of month: around the 23rd; weekday: none. None of these is clear after allowing for the 3 checks, so they may well be chance; if real, it would most likely be a ticket-sales effect. The balls do not know the date.",
 "sets": "Top pick: the ticket that follows all the evidence most closely, keeping the order jackpot combinations, then jackpot dates, then daily draws. Jackpot pattern, Jackpot days and Daily draws: each the ticket that follows its own source most closely. Lucky dip: a random ticket that follows the same pick rules. No two cards share more than 2 numbers. Each card shares at most 1 number with any one past jackpot and at most 2 with all of them, and no card repeats a past result."}
```

Where some balls are out of use, the odds line says so, because the page header shows the configured range ("1-80"): Ada
Kotipathi "Every ticket has the same chance: 1 in 1,282,975 for the four numbers (76 balls in use; 1 in 33,357,350 with the
letter)." (C(76,4), not C(80,4) = 1,581,580). Where a balanced card applies, `explanation.sets` adds "(while that source cannot move
the picks, a balanced pick from all the evidence that differs clearly from the cards before it)".

A split printed in a text uses `wholePercents` (exported from `lib/model-v2/explain.ts`): whole percents that add up to exactly 100
when any share is above 0, by the largest-remainder method with ties in the owner's order J, T, D; a source with share 0 stays at
0, and all 0 gives all 0. Rounding each share on its own gave 54 / 27 / 20 = 101 for Dhana Nidhanaya. Where a source is absent,
its text no longer ends in ": 0%" (the page shows "0% - none known yet" next to it): "No jackpot-winning numbers are known yet."
(DLB), "The known jackpot wins are older than our draw archive, so their numbers are unknown." (Mega Power), "No jackpot dates
are known yet." (DLB).

### 3.4 Size budget

The v2 prediction object must stay at **24 KiB or less** (24,576 bytes of minified UTF-8 JSON) per lottery on real data. It
is embedded in `public/data/<id>.json` and in the pages. `evidence.used` is the one list that grows linearly with the evidence
(about 108 bytes per usable jackpot item, by design), so the synthetic evidence-growth cases may use 128 more bytes per item of
`evidence.used`: their budget is `24,576 + 128 × |evidence.used|`. A test enforces both (test/model-v2.invariants.test.ts).

Why not 16 KB: the first estimate (`numberLean` 4 KB, `numberScores` 1.6 KB, `backtestDetail` 1.5 KB, `explanation` 1.5 KB,
sets 1.3 KB, `previousModel` 1 KB, other fields 2 KB) left out `letterLean`, `bonusLean`, `evidence` and the `method` text, which
the contract of 3.3 requires. With them the three NLB payloads are 17.7-18.5 KiB; fitting 16 KiB would have meant dropping most
of the plain-language texts that 2.12, 2.13, 5.4 and 7 require (explanation, notes, verdicts and card notes: about 2.4-2.7 KB
per lottery, besides the verbatim disclaimer and the method text).

Measured today (bytes; DLB = the range over the 4 DLB lotteries; with the view cards and texts of Appendix B items 21-32):

| Field | Dhana Nidhanaya | Mega Power | Govisetha | DLB |
|---|---|---|---|---|
| `numberLean` | 4,636 | 4,136 | 4,308 | 3,479-3,725 |
| `numberScores` | 1,958 | 1,903 | 1,908 | 1,846-1,917 |
| `backtestDetail` | 2,015 | 1,578 | 1,916 | 1,495-1,874 |
| `letterLean` | 1,665 | 1,496 | 1,642 | 1,364-1,374 |
| `sets` | 1,694 | 1,692 | 1,687 | 1,653-1,665 |
| `explanation` | 1,993 | 1,895 | 1,977 | 1,305-1,443 |
| `evidence` (of which `used`) | 1,540 (760) | 1,737 (971) | 1,506 (759) | 462-465 (2) |
| `bonusLean` | null | 1,319 | null | null; Kapruka 1,860 |
| `method` | 796 | 796 | 796 | 796 |
| `previousModel` | 606 | 587 | 599 | 590-602 |
| `influence` + `damping` | 525 | 626 | 524 | 455-561 |
| `shapeLean` | 285 | 287 | 285 | 285-287 |
| `notes` | 232 | 136 | 191 | 118-254 |
| other fields | 745 | 719 | 736 | 731-754 |
| **Total** | **18,690** | **18,907** | **18,075** | **14,913-16,764** |

Synthetic growth (Dhana Nidhanaya): 0 / 1 / 3 / 10 / 30 / 100 combinations give 14,539 / 15,954 / 17,985 / 17,544 / 20,333 /
30,598 bytes against budgets of 24,576 / 24,704 / 24,960 / 25,856 / 28,288 / 37,248 (99 usable items at 100 combinations).

---

## 4. File-level implementation plan

**New files: `lib/model-v2/` (pure functions; no fs access; inputs passed in)**

| File | Contents |
|---|---|
| `constants.ts` | `MODEL_VERSION_V2 = "win-lot-jackpot-v2"`, `V2_CONSTANTS` (frozen), `methodText()` |
| `evidence.ts` | `knownFrom()`, `ownItems()` (canonical sort), `usableAt(τ)`, partition set, counts, `pending` |
| `regime.ts` | Live balls and regime start (2.3) |
| `calendar.ts` | Angles, de-clustering, von Mises fit (`A1inv`, bias correction), Rayleigh p, Holm, plain peak labels |
| `shape.ts` | Exact nulls on the live support (sum DP, spread, odd), bins, typicality band, cache by signature |
| `posterior.ts` | Sources J/T/D (2.6-2.8), order cap (2.9), posterior, leans and parts (2.10) for all channels |
| `sets.ts` | Guard ladder, R1-R5, Top pick, the deterministic view cards (selection order), Lucky dip, fallbacks, set parts and score |
| `backtest.ts` | Walk-forward (section 5): per-step record, metrics, pooled summary, Holm, power, verdict |
| `v1trace.ts` | `v1TopPickHits(history, lo, hi, k)`: per-draw hits of v1 "Top scores" (port of the v1 loop, about 40 lines). `predictAllV2` throws if its mean differs from `backtest()` of lib/model.ts (equal for all 7, in the prototype and in the implementation; test/model-v2.v1trace.test.ts pins it). |
| `explain.ts` | Plain-language strings and notes (card labels and notes of 2.15, templates in sections 5.4 and 7.5), `wholePercents` (3.3); no odds language |
| `index.ts` | `predictV2(lottery, draws, jackpots, generatedAt, v1Prediction)` and `predictAllV2(...)`. `predictAllV2` computes all 7, then attaches the pooled backtest summary and Holm to each. |

`lib/model.ts` stays **untouched** (zero diff). The new code imports `r4`, `fnv1a`, `mulberry32`, `nextDrawDate`, `backtest`,
`predict` and `DISCLAIMER` from it.

**Changes to existing files**

| File | Change |
|---|---|
| `lib/types.ts` | Add the types in 3.1-3.3 (additive; `modelVersion: string` added to `Prediction`). |
| `lib/data.ts` | `getDraws(id)`: add `jackpot` flags (3.1). New `getJackpots(id)` and `getJackpotStatus(id)` (3.2). New `getPredictions()`: memoised, reads `.cache/predictions.json` when its key matches, else computes v1 and v2 for all 7 once. `getPrediction(id)` returns v2. New `getPredictionV1(id)`. The key is the sha256 of `MODEL_VERSION_V2`, the JSON of `V2_CONSTANTS`, and the bytes of `data/lotteries.json`, `data/jackpots.json`, `data/fetch-log.json` and every `data/draws/<id>.json` in id order. |
| `scripts/export-public.ts` | Compute once (`getPredictions()`), write `.cache/predictions.json` `{key, v1, v2}`, then write public files as today. `public/data/<id>.json` becomes `{lottery, draws, prediction, jackpots: JackpotStatus}` (additive). |
| `lib/jackpots.ts` | Export `suspiciousAmounts` (export only). |
| `.gitignore` | Add `.cache/`. |
| `package.json` | Scripts `"audit:model": "tsx scripts/model-v2-audit.ts"` and `"bench:model": "tsx scripts/bench-model.ts"`. |
| `test/data.test.ts` | The v1-equality assertion moves to `getPredictionV1(id)`. A new assertion: `getPrediction(id).modelVersion === "win-lot-jackpot-v2"`. Other tests unchanged. |
| `docs/ARCHITECTURE.md` | Replace the "Prediction model" section with a summary of this document. Document `.cache/` and the jackpot flags. |
| `app/about/page.tsx` | Method text from `explanation`. |

**New scripts**

| Script | Purpose |
|---|---|
| `scripts/model-v2-audit.ts` | Offline, not part of the build. Writes the generated `docs/MODEL-V2-AUDIT.md` (5.3). |
| `scripts/bench-model.ts` | Times `predictAllV2` and the v1 predictions. Fails if the run exceeds 20 s, or if a synthetic 100-combination Dhana Nidhanaya backtest exceeds 10 s. |
| `scripts/model-v2-golden.ts` | Regenerates `test/fixtures/model-v2-golden.json`. Run only on a deliberate model change (bump the version, write a changelog line). |

**Compute once per build.** Today `export-public` (prebuild) and every `next build` worker each call `getPrediction`, so the backtest
runs 2-3 times per build. After the change, the prebuild computes it once. Workers read the cache, and a cache hit logs nothing to
stdout. A key mismatch logs `model-v2: cache miss, computing` once per process. `next dev` computes lazily.

---

## 5. Leakage-free walk-forward backtest and honest reporting

### 5.1 Protocol

- **Window.** Exactly v1's: `start = max(BT_MIN, N - BT_DRAWS)`, every draw `t` in `[start, N)`, stride 1. That is 178 test draws
  per NLB lottery and 200 per DLB lottery today, 1,334 in total.
- **What each step may see.** Step `t` runs `posteriorAt(ctx, t, date(d_t))` and `topPickAt` with the stream of 2.16. It uses
  only:
  - daily draws `d_0..d_{t-1}`;
  - jackpot items with `knownFrom < date(d_t)`;
  - live balls, regime, letter universe, shape nulls, typicality band and the R3 past-result set, all derived from `[0, t)`.
- **One code path.** Production is the same code with `t = N`. Nothing is warm-started, so incremental counts are only an
  optimisation and must give identical results.
- **v1 comparison.** v1 per-draw hits come from `v1trace.ts` on the same window, verified against `backtest()`.
- **Frozen constants.** Constants are frozen. The backtest is evaluation, never selection.

### 5.2 Metrics (`backtestDetail`)

| Metric | Definition | Chance value |
|---|---|---|
| `avgHits` | Mean of `|TopPick_t ∩ d_t|` | `randomBaseline = mean_t k²/L_t` (Ada Kotipathi 0.2105, Kapruka 0.2133, others 0.1951 / 0.2000) |
| `z` | `(Σh - Σk²/L_t) / sqrt(Σ k(k/L_t)(1-k/L_t)(L_t-k)/(L_t-1))` | 0 |
| `ci95` | `avgHits - randomBaseline ± 1.96·SE` | contains 0 |
| `v1.avgHits`, `v1.pairedDiff`, `v1.pairedZ` | Per-draw `h2 - h1` on identical draws, `z = mean/(sd/√n)` | 0 |
| `rankPct`, `rankZ` | Mean percentile `(rank+0.5)/L` of the drawn numbers in the θ ranking (θ descending, ties by number tie key), over the test draws whose numbers are all live. Null variance per draw `(L+1)(L-k)/(12L²k)`: the variance `(L²-1)/(12L²)` of one percentile, over `k`, times the without-replacement factor `(L-k)/(L-1)`. Uses every rank, so it has more power than hits. | 0.5 |
| `logScoreNats` | Ball log-score vs uniform over `Λ_t`: `Σ_{n∈Λ} [x_n ln(q_n/q0) + (1-x_n) ln((1-q_n)/(1-q0))]`, with `q_n = clamp(kθ_n)` and `q0 = k/L`, averaged over the same in-domain test draws as `rankPct`. Under i.i.d. draws it equals `-KL <= 0`: the honest cost of leaning. | <= 0 |
| `letterHitRate`, `bonusHitRate` | MAP letter or bonus (the Top pick's: argmax, exact ties to the smallest tie key, 2.13) vs the actual one | `1/max(|U_t|, 26)` (12 for zodiac signs: the letters the game allows, a rule, not data; any guess hits 1 time in 26 under fair draws, while `U_t` holds only the letters seen so far, 17-19 early in the NLB archives), `1/B` |
| `lifts.jackpotNumbersZ` | Do past jackpot numbers come up more often afterwards? `Σ|d_t ∩ U_t|` vs `Σ k|U_t|/L_t` (hypergeometric), over the steps with at least 1 usable combination. `null` until there are at least 30 such steps (`CHECK_MIN_STEPS` = `BT_MIN`) and at least 5 numbers expected by chance over them (`LIFT_MIN_EXPECTED`): see "Checks with too few draws" below | 0 |
| `lifts.sourceZ` | For each source that moved the picks (present, parts not all equal) on at least 30 test steps: the standardised `part_s(n)` of the drawn numbers, summed over those steps, `/ sqrt(Σ k(L-k)/(L-1))`. A source on fewer steps is left out | 0 |
| `copyTilt` | Over steps with at least 1 usable combination: mean past-jackpot numbers in the Top pick vs `mean k|U_t|/L_t`, plus the maximum shared with one combination and the maximum from the union | analytic |
| `orderHeld` | Steps where the Top pick's parts were ordered, and steps where the filter changed the pick | none |
| `jackpotDrawHits` | Top-pick hits on the actual jackpot draws inside the window (descriptive only: it lists the archive's jackpot draws by definition, so it is not part of the leakage canary, 6) | none |
| `outOfDomain` | Test draws containing a number outside `Λ_t` (their rank and log-scores are skipped) | 0 |
| `pooled` | All 7 lotteries: draws, avgHits, randomBaseline, z, v1 avgHits, paired z, rank z | none |
| `holm` | Holm step-down at 5% (two-sided normal p-values, sorted; significant while `p_(i) < 0.05/(m-i)`) over two stated families: `holm` = every z reported for the lottery (hits z, paired v1 z, rank z, the jackpot-number lift z and one source z per source, these two kinds only once they have the 30 test draws above behind them); `holmAll` = the 7 headline hit z's. Each `{tests, minP (smallest raw p), anySignificant}`. The texts (5.4) use the lottery's own family: the verdict the Holm-adjusted p of its hit check, the Holm note that of its most unusual check | none |
| `power` | Minimum detectable effect at 80% power, as a share of the baseline, taken at the cut the verdict uses (5.4): a hit result stays outside the usual range of luck only if it survives Holm over the lottery's `m` checks (`holm.tests`), and it surely does once its two-sided p is below `0.05/m`, the first Holm step. So `mdeShare = (z_{1-0.05/(2m)} + z_{0.8}) SE / baseline` (`holmFirstCut(m) + Z_POWER` in `lib/model-v2/backtest.ts`, inverting the same `normalP` the Holm test uses): 3.34 SE for 4 checks, 3.42 for 5, 3.53 for 7, about +55-57% per NLB lottery and +49-50% per DLB lottery. `pooledMdeShare` is taken the same way over the family the pooled result is judged in, the headline hit checks of all lotteries (`holmAll.tests`, 7): about +21%. Plus a sentence. The first versions used 2 SE (about 52% power) and then the 95% range's `1.96 + 0.84 = 2.8 SE`, which the verdict's Holm judgement notices only 55-62% of the time with 4-7 checks | none |
| `verdict` | Generated text (5.4) | none |

Two v1 annotations: `previousModel.backtest` keeps v1's own `randomBaseline` unchanged (0.2 for Ada Kotipathi and Kapruka), and
`previousModel.honestRandomBaseline` carries 0.2105 and 0.2133. The UI shows the honest value.

**Checks with too few draws.** The jackpot-number check and the source checks start with their evidence: a lottery's first
jackpot combination starts its jackpot-number check and its combinations check at one test draw. Over a few draws their normal
p-values are far too small, because each is a sum of a few skewed counts. With one past jackpot (4 numbers of 80), 2 shared
numbers over 2 draws give z +2.65 and p 0.008, below Holm's 0.05/6 for 6 checks, while 2 or more shared numbers turn up by luck
5.3% of the time (`1 - P0² - 2 P0 P1`, `P_x = C(4,x) C(76,4-x) / C(80,4)`). Simulated over the first 30 days after a lottery's
first jackpot (200,000 fair runs), that check survived Holm on some day in 9.5% of the runs and set off the Holm note in about
22%, so the page would have blamed the data or the method for luck (with the rule below: 0.6% and 5.0%, the single look on
day 30). So a check is formed only with 30 test draws behind it (`CHECK_MIN_STEPS` = `BT_MIN`,
the history the backtest itself waits for), and the jackpot-number check also needs 5 numbers expected by chance
(`LIFT_MIN_EXPECTED`, the usual condition for the normal approximation of a count; 30 draws already give 6 or more with 4
numbers of at most 96 balls). Until then the check is `null` (or missing from `sourceZ`), is not counted in `holm.tests` or in
the site's checks of 5.4, is never named by the Holm note and never makes the prebuild warn; the copy tilt, which only
describes the Top pick, is still reported. From 30 draws on, the true chance of crossing the Holm cut or the 95% range stays
within about 1.5 times the nominal one (exact for the jackpot-number count, whose lattice keeps a small excess; simulated for
the combinations lean), against up to 6.7 times over the first draws. Today every formed check has at least 149 test draws,
so no payload changed (Appendix B item 31).

### 5.3 Offline audit (`npm run audit:model` -> `docs/MODEL-V2-AUDIT.md`; not in the build)

1. **Placebo combinations.** At least 100 replicates: replace own combinations with random earlier draws (seeded), and report the
   percentile of the real hits and of the real copy tilt.
2. **Placebo dates.** At least 60 replicates: random dates inside each date's era. The **era** of a date is the 61-day window
   centred on it (±30 days: about two moon cycles and two months, so moon phase, day of month and weekday are all randomised),
   kept before the archive start. Only the dates of wins **without** winning numbers move (today all of them are older than
   the archive); a win with numbers keeps its date, because moving it would move its combination and could make it known
   before its own draw.
3. **Null simulation.** Fair synthetic draws with the real dates, letters and jackpot items (combinations take the synthetic
   numbers of their draw). Mean hits and the rank percentile must sit at chance within 2 SE, per lottery and pooled. The **copy
   tilt** (past-jackpot numbers in the Top pick minus a random ticket's, per step, with the between-replicate SE) is
   **expected to be positive**: J moves whole decades and the past jackpot numbers sit in exactly those decades. It must
   respect the hard guards at every step: at most `perCombination` numbers shared with any one past jackpot and at most `union`
   from all of them (the step's own rung, 2.14). The audit reports the measured tilt with its SE and the verdict "positive by
   design (jackpot decades), capped by the guards"; it says "not met" if hits or rank fail, or if any guard is broken.
4. **Evidence growth.** Dhana Nidhanaya with 0/1/3/10/30/100 synthetic own combinations and dates: guard rung, excluded share,
   influence shares, runtime.
5. **Per-item pull.** Leave-one-out total-variation change per combination, date and daily draw (information only).
6. **Oracle gap.** Global best ticket (full enumeration with the same rules) vs the Top pick definition.
7. **Sensitivity.** Constants at ±50%, reported, **never** used to retune.

Measured by the audit (`docs/MODEL-V2-AUDIT.md`: 100 combination and 60 date placebo replicates, 10 null replicates per
lottery, data as of 2026-10-27):

| Lottery | Real-hits percentile among placebos (permutation p) | Placebo copy-tilt ratios | Real copy-tilt ratio |
|---|---|---|---|
| Dhana Nidhanaya | 0.08 (0.26) | 0-4.57 | 0.54 (percentile 0.04) |
| Govisetha | 0.13 (0.38) | 0-4.53 | 2.24 (percentile 0.54) |

- After Holm over all 10 placebo comparisons (combinations and dates) the smallest p is 0.99: nothing stands out.
- Null simulation: pooled hits z -0.66 and rank z +0.80, every lottery within 2 SE. The copy tilt is **+0.33 past-jackpot
  numbers per draw (SE 0.10, 3.4 SE)**: positive by design (jackpot decades), capped by the guards. At all 3,270 null steps with
  combinations, no Top pick shared more than 1 number with one past jackpot or more than 2 with all of them.

The walk-forward copy-tilt metric is very noisy, because consecutive steps are autocorrelated. Copy control rests on the hard
guards and the EXACT = 0 property, not on a tilt bound (risk R4). Dhana Nidhanaya's low placebo percentile is not significant
after correction. The audit keeps watching it.

### 5.4 Honest reporting rules

- **Headline.** The headline is the pooled result over all lotteries. Never headline the best single lottery. Every lottery figure
  is shown with its 95% interval.
- **Verdict template.** The verdict never contains "beats", "better", "edge" or "more likely":
  > "Over the last {n} {name} draws, using only what was known before each draw, the Top pick matched {avg} numbers per draw. A
  > random ticket matches {base}, and the previous model matched {v1}. {judgement} Across all 7 lotteries ({N} draws): {avgP} vs
  > {baseP}."

  The judgement follows the 95% range of the difference (the payload's `ci95`, so the text and the range next to it always
  agree) and the lottery's own Holm family of {m} checks (5.2):
  - range contains 0: "That is the same as random; the difference is luck (95% range {lo} to {hi})."
  - range excludes 0, the hit check does not survive Holm: "That is outside the usual range of luck for one check (95% range
    {lo} to {hi}), but {m} checks are made for this lottery, and a result like this turns up by luck now and then; allowing for
    that, it is within luck." (Super Ball today: +0.001 to +0.119, z +1.98, Holm-adjusted p 0.19 over its 4 checks.)
  - the hit check survives Holm: "That stays outside the usual range of luck even after allowing for the {m} checks made for
    this lottery (95% range {lo} to {hi}). Lottery draws are random, so it is most likely a rare fluke or a fault in the data or
    the method, not a way to win." The prebuild then prints a warning (8.1 item 8).

  `explanation.backtest` uses the same judgement, without the range.
- **Holm note**, whenever some check of the lottery lands outside its 95% range (|z| > 1.96, the cut of the range; the first
  version used |z| >= 2 and so missed Super Ball's +1.98). It names the most unusual check ({check}: "The check of the Top
  pick's hits", "The check against the previous model", "The check of how the drawn numbers rank", "The check of how often past
  jackpot numbers come up", "The check of the jackpot-combinations / jackpot-dates / daily-draws lean"):
  > "{check} looks unusual on its own, but after allowing for the {m} checks made for this lottery it is within luck. Across all
  > {M} checks on this site, about {M/20} results like this are expected by luck alone."

  {M} is the number of checks over all lotteries (35 today), known in `predictAllV2`. Only formed checks count: a check with
  fewer than 30 test draws behind it is not one of the {m} or the {M}, and the note never names it (5.2, "Checks with too few
  draws"). The expected count is {M}/20 whatever the correlation between the checks, because each formed check lands outside its
  range about 1 time in 20 under luck (within about 1.5 times that for a count, 5.2). If the check survives Holm: "{check} stays unusual
  even after allowing for the {m} checks made for this lottery. Lottery draws are random, so it is most likely a rare fluke or a
  fault in the data or the method, not a way to win." The first version claimed that "with {tests} checks at least one unusual
  result is expected by luck", which is false for 4-7 checks (at most 18-32% under luck), did not name the check, and promised
  that a surviving result "is being looked at" with nothing behind it.
- **Power sentence** (80% power at the first Holm cut over the lottery's {m} checks, 5.2):
  > "With {n} draws, only an effect of about +{mde}% or more would show up reliably in this test (in 4 cases out of 5), after
  > allowing for the {m} checks made for this lottery."

  {mde} is the payload's `power.mdeShare` (r4), so the sentence and the figure next to it agree. An effect that size survives
  the verdict's Holm judgement 4 times in 5 (a seeded simulation in the unit tests checks this, and that 2.8 SE falls short).
- **Copy tilt sentence:**
  > "The Top pick held on average {a} numbers from past jackpots; a random ticket holds {b}. The model leans toward the tens where
  > jackpot numbers fell, and never repeats two numbers of the same jackpot."

  The wording follows the current rung, so drop the last clause if a looser rung applies.

### 5.5 Reference results (implementation, data as of 2026-10-27)

| Lottery | n | v2 | random (live) | z | v1 | paired z | rank pct (z) | log nats | letter v2 / chance |
|---|---|---|---|---|---|---|---|---|---|
| Dhana Nidhanaya | 178 | 0.1629 | 0.1951 | -1.02 | 0.1742 | -0.31 | 0.497 (-0.28) | -0.009 | 0.028 / 0.038 |
| Mega Power | 178 | 0.1854 | 0.2000 | -0.46 | 0.1404 | +1.21 | 0.500 (+0.02) | -0.009 | 0.034 / 0.038 (bonus 0.056 / 0.038) |
| Govisetha | 178 | 0.1573 | 0.2000 | -1.33 | 0.1742 | -0.42 | 0.508 (+0.72) | -0.014 | 0.051 / 0.038 |
| Ada Kotipathi | 200 | 0.2550 | 0.2105 | +1.44 | 0.1850 | +2.04 | 0.492 (-0.83) | -0.004 | 0.040 / 0.038 |
| Super Ball | 200 | 0.2600 | 0.2000 | +1.98 | 0.1950 | +1.59 | 0.487 (-1.29) | +0.007 | 0.030 / 0.038 |
| Shanida | 200 | 0.2000 | 0.2000 | 0.00 | 0.2000 | 0.00 | 0.516 (+1.60) | -0.027 | 0.015 / 0.038 |
| Kapruka | 200 | 0.1800 | 0.2133 | -1.07 | 0.2050 | -0.54 | 0.507 (+0.73) | -0.033 | 0.025 / 0.038 (bonus 0.025 / 0.025) |
| **All 1,334** | | **0.2016** | **0.2029** | **-0.11** (SE 0.0118) | 0.1829 (z -1.70) | +1.24 | 0.501 (+0.25) | | |

The letter chance is 1/26 = 0.038 everywhere (Appendix B item 29): the NLB rows showed 0.040-0.041, the mean of 1/|U_t| over
letter sets of 17-26 letters seen so far, which made the letter look worse than chance. The DLB letter and bonus hit rates differ from the design-phase prototype (which broke exact MAP ties in category order) only
because exact ties go to the smallest seeded tie key (2.13); every such difference was checked to be an exact θ tie. The NLB
rows also moved with `n_eff` = number of clusters (2.7): prototype Dhana Nidhanaya 0.1517 (z -1.37), Mega Power 0.1910
(z -0.28), pooled 0.2009 (z -0.17); Govisetha's hits did not change.

Further results:
- **Holm:** over the 7 headline hit tests (`holmAll`) the smallest p is 0.047 (Super Ball hits); nothing is significant. Nothing
  survives any lottery's own family (`holm`) either. Two lotteries carry the Holm note of 5.4: Ada Kotipathi (its check against
  the previous model, z +2.04, p 0.042 among 4 checks) and Super Ball (its hits, z +1.98, p 0.047 among 4 checks; its verdict says
  the 95% range +0.001 to +0.119 is outside the usual range for one check but within luck after allowing for the 4).
- **Power:** an effect of about +55-57% (NLB: 5 or 7 checks), +49-50% (DLB: 4 checks) or +21% (pooled, among the 7 headline
  checks) would show up in 4 cases out of 5 after allowing for those checks.
- **Jackpot-number lift:** Dhana Nidhanaya +0.77, Govisetha -0.84. Past jackpot numbers do not come up more often.
- **Copy tilt:** Dhana Nidhanaya 0.21 vs 0.40 random; Govisetha 0.89 vs 0.40. At most 1 shared number with one combination and at
  most 1 from the union over all steps.
- **Out of domain:** 0 test draws.
- **v1 trace:** equals v1 `backtest()` for all 7.

---

## 6. Test plan

| File | What it asserts |
|---|---|
| `test/model.parity.test.ts` | **Unchanged.** v1 equals the frozen Python output (both fixtures). `lib/model.ts` itself: test/model-v2.v1trace.test.ts pins the sha256 of its text (line endings normalised), so even an edit that keeps v1's output fails. |
| `test/model-v2.unit.test.ts` | Each `knownFrom` rule: prize table +1 day; directory `2019-11-08` listed `2020-01` gives `2020-01-31`; "latest" only gives date +1; DLB K+2 by drawNo and null if missing; undated gives null. Regime on a synthetic range change (balls 77-80 retired at index i). `A1inv` and the bias-corrected κ: uniformly spread dates give κ = 0; 7 dates exactly one synodic month apart (so more than 7 days apart, all at the same moon phase) give κ_moon = 2. De-clustering in fixed windows (a cluster holds the dates within 7 days of its first date) and each cluster counts as one independent date (`n_eff` = number of clusters): 7 identical dates give `n_eff = 1` and κ = 0, the same 7 plus one far away give `n_eff = 2` (not 3.5), 9 wins on consecutive Fridays give 5 clusters and weekday κ = 2 (chains of gaps would have made them 1), a 188-day chain of gaps of 6-7 days stays at least 14 clusters, and the bias correction and Rayleigh p use that `n_eff`. Moon angle sanity (a published full-moon date gives phase 0.5 ± 0.04). Shape nulls sum to 1 and the bins match brute force on `C(20,4)`. Hypergeometric tail and ladder rungs for given `(L, combos)`. Cap: `influence_T <= 0.75·influence_J`, damping in [0,1]. Leans in [0.75, 1.25]; `Σ parts = lean - 1` to 1e-12. J number part constant within each decade. Typicality (1-2-3-4 fails, sum band). R4 diversity. Card labels for absent and silent sources: always the five base labels, with the reason in the note (absent, silent, held back; Top-pick notes for every combination of moving sources; "can be used yet" when wins are known but not usable). The view cards use the tie keys only: with the same tie keys and a different stream afterwards, cards 1-4 stay and only the Lucky dip moves; the selection order (Top pick, moving sources J, T, D, balanced cards, Lucky dip). `wholePercents`: whole percents that add up to 100 by the largest remainder, ties J, T, D, a zero share stays 0, all zero gives all 0, plus a seeded property check (sum 100, each within 1 point). Counts that grow with data/ are checked as rules (the pool is the regime draws minus the usable jackpot draws), the pinned counts of 2026-10-27 on the frozen snapshot of the golden fixture. The order note names only the sources present (no jackpot combinations for a dates-only lottery). Power (5.2): `holmFirstCut(m)` is the first Holm step over `m` checks (two-sided p = 0.05/m: 1.96, 2.50, 2.58, 2.69 for 1, 4, 5, 7 checks), a hit check past it survives Holm whatever the other checks show and one just inside it does not, and in a seeded simulation a true effect of `mdeSE(m)` SE survives Holm over `m` checks in about 80% of the runs (2.8 SE: under 65%). |
| `test/model-v2.invariants.test.ts` | Real data, all 7 lotteries, plus synthetic growth on Dhana Nidhanaya (0/1/3/10/30/100 own combinations = random earlier draws, plus their dates). Asserts: order (2.11 b) in every channel; leans bounded; parts exact; the guard rung's excluded share <= 5%; every set passes R1-R5; no duplicate sets; dead balls never picked; Top pick `orderHeld` true on real data; no NaN or Infinity; every payload float equals `r4` of itself; `evidence.counts.jackpotDates.effective` = clusters (independent de-clustering helper); the five labels unique and fixed, a note saying "balanced pick" exactly when its source does not move the picks; a view card whose source moves the picks has a positive part for its own source; a balanced card shares at most 1 number with every card selected before it and repeats no earlier letter or bonus, a moving-source card at most 2; cards 2-4 equal a brute force of their definition (2.15, `specViewCards` in test/helpers/v2-rules.ts: own-source or balanced score, CAND pools, R1-R4 against the cards selected before, the balanced overlap and unused letter / bonus, tie keys) in the selection order, and in display order they would differ (a fixed synthetic daily-draws-only lottery, and today the 4 DLB lotteries and Mega Power), so the check is not vacuous; payload <= 24 KiB on real data (synthetic growth: + 128 bytes per `evidence.used` item). |
| `test/model-v2.leakage.test.ts` | (1) **Future corruption.** For 4 lotteries at 3 cut points `t`, shuffle all draws `>= t`, alter or add jackpot items with `knownFrom >= date(d_t)` (numbers, dates, DLB resets); the step-`t` record (θ, parts, shares, Top pick, rung) is byte-identical. (2) **Truncation equivalence.** `predictV2` on draws `< t` and jackpots usable before `date(d_t)` equals the backtest record at `t`, at cut points `t` where v1's `nextDrawDate` of the draws before `t` equals `date(d_t)` (so production's target date is the test draw's). (3) **Same-day canary.** A jackpot planted on the last test draw's own date, and a DLB reset planted on the draw before it, leave the whole backtest byte-identical, except the descriptive `backtestDetail.jackpotDrawHits`, which lists jackpot draws by definition and is checked separately (it gains exactly the planted draws, with the hits their steps already had). Planted at an earlier `t`, they change no record before step `t+2`. (4) **Evidence-only order.** Shuffling the order of `jackpots.json` items leaves the payload sha256 equal. (5) **Late directory cards.** A winners-directory card first read on page 1 after the last draw is labelled with that month (`directoryMonth`, test/jackpots.test.ts) and changes no walk-forward record; labelled "latest" it would have changed every step. test/jackpots.test.ts also runs the code that writes those labels on fixture pages from the page cache (a stubbed `fetch` fails any network call): `readWinnersDirectory` labels every page-1 card with the month of the run in Colombo (either side of midnight on 31 Oct), in a full rebuild a card also on a month page keeps only that month, and the daily `updateDirectory` keeps the earliest month of a stored card and replaces a stored "latest" (older data) with the month of the run, so reverting either rule fails a test. |
| `test/model-v2.determinism.test.ts` | Two separate `tsx` processes (`test/helpers/v2-hash.ts`) print the same sha256 of `predictAllV2` output; two calls in one process are deep-equal. |
| `test/model-v2.golden.test.ts` | `test/fixtures/model-v2-golden.json` freezes a data snapshot: Dhana Nidhanaya, Govisetha and Mega Power full (208 draws each), the newest 700 draws of Ada Kotipathi and Kapruka (taken as their whole history in the snapshot; their balls out of use, 77-80 and 76-80, are detected inside it), `jackpots.json` and prizes. The full v2 payloads must deep-equal it (like `model-parity.json`). `npm run golden:model` recomputes the payloads on the frozen snapshot, so a fixture diff shows only the model's effect: the snapshot is written on one line, the expected payloads with one field per line, so `git diff` shows which fields moved. On the 2026-10-27 snapshot it also pins this document's measured numbers (1, 2.4, 2.7, 2.11, 2.12, 2.14, 2.15 including the view cards, 3.3 including the balanced-card example, 5.5, 7.3) at their printed precision. |
| `test/model-v2.zero-evidence.test.ts` | DLB (each lottery's own items removed, so the case is built, not assumed): status `none`, influence `{0,0,1}`, notes, the base labels with the absent-source notes. Mega Power on the frozen snapshot of 2026-10-27: `dates-only`, J share 0 (not redistributed), the note counting its 9 dated wins (2.12). 9 weekly Friday wins: 5 clusters, weekday κ = 2, the dates and the daily draws move the picks. Synthetic lottery with uniformly spread dates: T silent, `c_D = 0`, θ = p0, a Top pick that passes R2 (not 1-2-3-4), the silent-dates note. Clustered dates: 7 wins in one week are one date (`n_eff = 1`, T silent), plus one more far away two (`n_eff = 2`). Synthetic lottery with 1 combination: `n_eff = 1`, T silent, J present. A first jackpot usable on the last 2 draws, both sharing one of its numbers: no check of it is formed (`jackpotNumbersZ` null, no combinations z, 4 checks), nothing survives Holm and there is no Holm note, while the normal p of its count would have been 0.008 (below 0.05/6); usable on 29 test draws still no check, on 30 both (6 checks); each limit on its own (5 numbers expected, a source on 30 steps) (5.2). Fewer than 31 draws: `backtest.draws = 0`. |
| `test/model-v2.v1trace.test.ts` | `mean(v1TopPickHits)` equals `backtest().avgHits` for all 7 lotteries and both parity fixtures. |
| `test/model-v2.oracle.test.ts` | On 3 small fixtures (L = 30), the Top-pick search equals a brute-force implementation of the same definition, and so do the production view cards (selection order, R1-R4, tie keys). |
| `test/model-v2.copy.test.ts` | Forbidden phrases in all payload strings fail: `more likely`, `better odds`, `better chance`, `beats`, `lucky day`, `x times`, `guarantee`. The disclaimer equals v1's verbatim. The odds are identical for every set. The card labels never carry a reason, and the synthetic payloads (including a jackpot won on the last draw, not usable yet) reach every card-note template of 2.15. Every explanation text holds for its evidence status: no ": 0%" after an absent source, no "fair balls" or "pseudo-jackpots" on the main panel (summary, source texts, notes, card notes), "three kinds of evidence" only when all three move the picks, a printed split adds up to 100; the summary, combinations and dates templates are all reached. The dates-only note counts the dated wins like the jackpot list. The generated audit document uses no odds language either. The payloads include the frozen snapshot of 2026-10-27 (the template-coverage checks rest on it, not on today's data/). Every verdict says "the same as random" exactly when its `ci95` contains 0, prints that range, and `explanation.backtest` agrees; a Holm note exists exactly when some reported check has |z| > 1.96 and names the most unusual one; the Holm family is exactly the reported checks, and no jackpot-number check is reported with fewer than 30 test draws (a synthetic first jackpot on the last 2 draws makes this non-vacuous); the dates text calls the peaks chance unless some feature has Holm p < 0.05 (both cases reached); every branch of the verdict and Holm templates passes the copy rules, and backtest and explanation texts never contain "better" or "edge". Every power sentence names its lottery's checks, and its figure is `power.mdeShare` = `mdeSE(holm.tests)` SE over the random level (`pooledMdeShare`: `mdeSE(holmAll.tests)` on the pooled SE). README.md and the visible text of the built pages (`out/*.html`) use none of the words of 7.5: `npm test` skips the pages while `out/` is missing, and CI runs this file again after `npm run build` with `REQUIRE_BUILT_PAGES=1`, where a missing `out/` fails. |
| `test/data.test.ts` | Exactly the 5 known in-archive own jackpot draws carry `jackpot` today, and no other lottery's dates are marked. `getJackpotStatus` counts (Dhana Nidhanaya: 3 wins in checked draws, `drawsSinceLastWin = 64`). `latestDraw` on any data: `won` iff the newest draw is marked or its NLB prize row shows winners; `not-won` only with an NLB prize row of 0 winners; never `not-won` for DLB; `drawNo`/`date` of the newest archived draw; today Dhana Nidhanaya 2383, Mega Power 2701 and Govisetha 4595 `not-won`, the 4 DLB `unknown`. v1 equality via `getPredictionV1`. Cache key changes when any data file or constant changes. The exact jackpot status of 2026-10-27 (notes, amounts, `checked`, `latestDraw`, `usedAs` counts) is pinned on the frozen snapshot of the golden fixture through the pure `jackpotStatusOf` / `markJackpotDraws` (`getJackpotStatus` reads data/ into the same functions), so it is checked whatever data/ holds; the rules are checked on the live data. |
| `scripts/bench-model.ts` (CI step after the tests, not a unit test) | Full `predictAllV2` plus v1 under 20 s on the dev laptop (measured 2.2 s; prototype about 6 s). Synthetic 100-combination Dhana Nidhanaya backtest under 10 s (measured 0.43 s). |

---

## 7. UI requirements (for the UI engineer)

### 7.1 Marking jackpot-winning days

- **History table** (`components/HistoryTable.tsx`): rows with `draw.jackpot` get a badge, a trophy icon plus the text **"Jackpot
  won"**, and a left border. Colour is never the only signal.
  - Expandable or tooltip text: "Super Prize won on this draw · 1 winner · Rs. 87,804,496 · source: NLB prize table".
  - For `dlb-jackpot-reset`: "Jackpot won (inferred from the advertised jackpot dropping; DLB does not publish winners)".
- **Latest draw** (`components/Hero.tsx` and the latest-result block):
  - Show the same badge if the latest draw is a jackpot draw (`JackpotStatus.latestDraw.outcome` is `won`).
  - Show "Jackpot not won - it rolls over" exactly when `JackpotStatus.latestDraw.outcome` is `not-won` (the NLB prize row of
    the newest draw shows `superPrizeWinners = 0`, 3.2).
  - If the outcome is `unknown` (NLB table not published, or DLB, whose inference needs 2 more draws), show **nothing**. Never
    claim "not won" without data.
- **Home cards** (`components/LotteryCard.tsx`): one line "Last jackpot: 24 Aug 2026 (#2319) · 64 draws ago" ("· won at the latest
  draw" when it is the newest draw, "· 1 draw ago" singular). The alternatives are "Last known jackpot: 1 Feb 2026 (#2440), before our
  archive (not every draw since could be checked)" and "No jackpot win recorded yet". Add "Jackpot now: Rs. 93.9 M (at draw #2383)"
  for NLB, or "Advertised jackpot for draw #2505: Rs. 397.2 M" for DLB. On the day an NLB jackpot is won on the newest draw, the
  newest priced amount is the one just won, so the line reads "Won at draw #N: Rs. X M (next jackpot not published yet)" instead
  of "Jackpot now".

### 7.2 Jackpot wins section on `/l/[id]` (new `components/JackpotWins.tsx`, data from `getJackpotStatus`)

- **Heading and summary.** Heading "Jackpot wins". Summary as counts only: "Won 3 times in the 207 draws we could check (28 Mar
  2026 to 27 Oct 2026)" (`checked.from` to `checked.to`). Never "chance per draw", "due" or "overdue".
- **Table columns:** Date | Draw | Winning letter + numbers | Winners | Jackpot | Source | Used by the picks.
  - Missing numbers: "numbers not in our archive".
  - Undated items: "date unknown (card listed Apr 2017)".
  - Source labels: "NLB prize table", "NLB winners page (publicity card; may be incomplete)", "DLB (inferred from jackpot drop)".
  - "Used by the picks" values: "combination + date", "date only", "not yet (from 29 Oct 2026)", "no (no date)".
- **Also show** the current jackpot and the days and draws since the last jackpot (from `JackpotStatus`), and any known-typo notes.
- **DLB note:** "DLB does not publish a winners list. We infer a win when the advertised jackpot falls and is still below its
  old amount one draw later, so wins appear two draws late and without a winners count." (The rule of `inferJackpotResets`: draw
  K won when the jackpots of K+1 and K+2 are both below K's. A real reset falls once and then grows again, so the first wording,
  "drops two draws in a row", described a rule that would never find one.)
- **Empty state:** "No jackpot win found in the available sources yet."

### 7.3 Picks panel

- **Five cards** in the order of 2.15. Each card shows:
  - its title, `label` (always one of the five base labels; never parsed);
  - letter, 4 numbers and the bonus;
  - a one-line "why", `note` (it says when the card is a balanced pick);
  - a three-segment bar "Jackpot combinations / Jackpot dates / Daily draws" from `set.parts`, with the values as text (negative
    parts as 0 width with the value in text);
  - "Contains 1 number from a past jackpot, never 2 from the same one" when `pastJackpotNumbers > 0`.
- **Lucky dip card:** "A random ticket that follows the same pick rules. It has exactly the same chance as every other card."
- **"How these picks are made" panel:**
  - **Headline split** (numbers): "Jackpot combinations 54% · Jackpot dates 26% · Daily draws 20%", in whole percents that add up
    to 100 (`wholePercents` of `influence.numbers`, the same numbers as `explanation.summary`; 3.3).
  - **Per-item rule:** "Each jackpot combination counts like 12 draws, each jackpot date like 4, each daily draw like 1."
  - **Damping sentence:** "Daily draws are turned down so they never outweigh the dates."
  - **Status and notes.** An absent source shows **"0% - none known yet"** and its share is not redistributed.
  - **Pattern lean:** "Pattern lean: 2.4 (0 = all numbers equal). This is not an advantage."
- **"Show the maths"** (collapsed by default):
  - letter, bonus, odd and spread splits and damping factors;
  - calendar table (feature, strength, peak, raw p, Holm p), with the sentence "most likely a ticket-sales effect";
  - `numberLean` as diverging bars around 1.00, labelled **"pattern score, not a probability"**;
  - evidence used and pending, the guard rung, and the constants.
  - No nats, z-scores or L1 terms outside this view.
- **Odds line** directly under the cards, the same for every set: "Every ticket has the same chance: 1 in 1,749,060 for the four
  numbers (1 in 45,475,560 with the letter)". Where balls are out of use it names them: "... (76 balls in use; 1 in 33,357,350
  with the letter)" (3.3).
- **The existing disclaimer**, verbatim, directly below, linked with `aria-describedby`.

### 7.4 Backtest panel (`components/charts/Backtest.tsx`)

- Per lottery, show v2, random (honest, live balls) and v1, each with its 95% interval.
- The pooled result is the headline. Show the verdict text, the power sentence and the Holm note.
  - The pooled headline clause is computed (`pooledVerdict` in `components/charts/Backtest.tsx`, also used by the About page):
    "That is the same as random; the difference is luck." exactly while |pooled z| <= 1.96 (the cut of the 95% ranges). Beyond
    that it says the result is outside the usual range of luck for one check; it says it stays outside after allowing for the
    checks only if |pooled z| passes the first Holm cut over the headline family (`holmFirstCut(holmAll.tests)`, the family
    `power.pooledMdeShare` uses), and then words it as a rare fluke or a fault in the data or the method, never a way to win.
    Otherwise: "allowing for that, it is within luck". No promise of a follow-up investigation.
- Copy-tilt sentence; hits on the known jackpot draws ("No jackpot was won inside this test window." only when the checked NLB
  prize rows cover the whole window; never for DLB).
- Annotate v1: "v1 used a baseline of 0.2000; the honest value for 1-76 is 0.2105".
- Never colour a lottery green as "winning". Never sort lotteries by performance.

### 7.5 Copy rules

| | Words and phrases |
|---|---|
| **Use** | "pattern", "lean", "counts like N draws", "same chance", "picks", "for fun", "the difference is luck" |
| **Never use** | "more likely", "better odds" or "better chance", "beats", "lucky day", "due" or "overdue" (in v2 copy), "N× more", "hot" (in v2 copy), "guarantee", "accuracy", "jackpot-likeness", "affinity" |

- Never show a per-draw jackpot chance or a "jackpot-like day" score next to the picks.
- The previous model (v1) appears only in the comparison and the details view, under the heading "Previous model (v1)".

### 7.6 Accessibility

- Badges carry text, not only colour and icon; tables have captions and header scope.
- Bars expose their values as text and as an `aria-label` (e.g. "Jackpot combinations 54 percent, jackpot dates 26 percent, daily
  draws 20 percent").
- Tooltips can be reached with the keyboard (the existing `useTooltip`) and are never the only place information appears.
- Contrast is at least 4.5:1 in both themes.
- Respect `prefers-reduced-motion`.
- The collapsible details use `<details>/<summary>` or `aria-expanded`.
- Numbers on balls are read as numbers ("23"), never as images.

---

## 8. Acceptance criteria, open risks, decisions for the PM

### 8.1 Acceptance criteria

1. `lib/model.ts` has zero diff. `test/model.parity.test.ts` passes unchanged. `getPredictionV1(id)` equals v1 `predict()`.
2. `getPrediction(id).modelVersion === "win-lot-jackpot-v2"` for all 7 lotteries, and every existing `Prediction` field keeps its
   type and meaning (5 sets, `score` 0..1, `numberScores` for lo..hi, `backtest {draws, avgHits, randomBaseline}`).
3. The order is guaranteed at levels (a), (b) and (c) of 2.11 and tested. Influence, damping, mass and per-set parts are in the
   payload. Today's headline splits (implementation, with `n_eff` = number of date clusters; 2.11): Dhana Nidhanaya 0.54 / 0.27
   / 0.20, Govisetha 0.48 / 0.30 / 0.22, Mega Power 0 / 0.57 / 0.43, DLB 0 / 0 / 1. Today's Top picks are those of 2.15
   ("Measured today"), with `orderHeld` true for all 7.
4. Leans lie in [0.75, 1.25] and the parts add up exactly. The J number part is constant within each decade (no exact-number
   favouring).
5. Guards: today's rung is (1,2) for Dhana Nidhanaya and Govisetha. Every card shares at most 1 number with any own combination and
   at most 2 with their union. The excluded share is at most 5% at every evidence level from 0 to 100 synthetic combinations, and the
   search never fails.
6. Only own evidence is used, never across boards. DLB has status `none` with its note. Mega Power is `dates-only` with a 0%
   combinations share.
7. Exactly the 5 in-archive own jackpot draws carry `DrawSummary.jackpot`. `getJackpotStatus` lists all 29 known items across the 7
   lotteries, including the 6 undated ones.
8. Backtest:
   - stride 1 on v1's window;
   - honest baselines (Ada Kotipathi 0.2105, Kapruka 0.2133);
   - paired v1 comparison;
   - pooled z, Holm and the power statement;
   - a verdict without forbidden words;
   - copy tilt reported.

   The pooled result is within chance (|z| < 2). If it ever is not, the generated text must still say it is most likely luck,
   given the number of checks, unless it survives Holm. In that case, escalate to the PM rather than celebrate: the texts then
   say it is most likely a rare fluke or a fault in the data or the method (5.4), and the prebuild (`scripts/export-public.ts`)
   prints a warning for every Holm family with a survivor (a GitHub Actions warning annotation when run there). The texts say
   "the same as random" only where the 95% range contains 0.
9. Leakage tests 1-5 of section 6 pass.
10. Two processes give byte-identical output. The golden fixture deep-equals the real output.
11. `npm run bench:model` (a CI step) takes under 20 s for all 7, and the synthetic 100-combination backtest under 10 s. One `npm run build`
    computes the model exactly once: prebuild computes, workers hit the cache (checked through the log line).
12. Each v2 prediction object is at most 24 KiB (24,576 bytes of minified UTF-8 JSON) on real data (largest today: Mega Power,
    18,907 bytes); a synthetic evidence-growth case may add 128 bytes per item of `evidence.used` (3.4). No forbidden phrases appear
    in any payload string. The disclaimer is verbatim. Card labels are always the five base labels, and every card note is true
    for every evidence status (2.15).
13. The UI meets section 7 (badges, wins section, weights panel with the 0% rule, odds line, disclaimer, backtest honesty,
    accessibility).
14. `docs/ARCHITECTURE.md` is updated, and `npm run audit:model` produces `docs/MODEL-V2-AUDIT.md` with at least 100 combination and
    at least 60 date placebo replicates, and the null-simulation verdict of 5.3 item 3 (today: met; copy tilt +0.33, SE 0.10,
    positive by design and capped by the guards).

### 8.2 Open risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Owner expectation.** Picks do not repeat jackpot numbers, daily draws are damped to 6-14% of their own pull (today 5.7% Govisetha, 9.0% Dhana Nidhanaya, 14.1% Mega Power), and the Top letter is always a past jackpot letter. | Plain-language text (section 1, `explanation`, notes); owner sign-off (D8). |
| R2 | **Fragile calendar signal.** Own-only, 7-9 dates in 6-7 clusters (`n_eff`), nothing significant after Holm. κ can switch on or off as dates accumulate, which shifts the picks. | Fitted every step, capped, reported with raw and Holm p, explained as probably ticket sales. |
| R3 | **Strict chain.** Silent dates hold daily draws at 0. A DLB lottery's first inferred jackpot (1 date, so silent) turns it from "daily 100%" into "combinations 100%". | Documented note; decision D5. |
| R4 | **Copy-tilt metric is noisy** (placebo range 0-4.5x). | Hard guards, the EXACT = 0 property and audit placebo percentiles, not a tilt threshold. |
| R5 | **Regime detection** can lag a range change and is inactive below 270 draws (all NLB today). | `outOfDomain` count; synthetic range-change test. |
| R6 | **Data quality.** The directory is incomplete and biased toward winners who came forward. Mega Power "Super Prize" cards may include the fixed Rs. 10 M tier, which affects dates only. DLB inference can produce a false win. There are two NLB amount typos. | Source labels in the UI; amounts are not used by the model. |
| R7 | **Float determinism** across V8 versions (exp, cos, log). | Pin Node 22, r4, tie keys, 1e-12 tie tolerance, golden fixture. |
| R8 | **Prize sharing.** Leaning toward patterns of past winning tickets cannot raise odds and may raise the chance of sharing a prize. | Disclaimer and odds line. |
| R9 | **Dhana Nidhanaya's real-jackpot hits** sit low among the placebo replicates (percentile 0.08 of 100, permutation p 0.26; the prototype saw 0.00 of 30). Not significant: after Holm over the 10 placebo comparisons the smallest p is 0.99. | The audit tracks it with at least 100 replicates. |
| R10 | **Stale build cache** if the key misses an input. | The key covers every model input; a unit test checks it. |

### 8.3 Decisions for the PM (defaults in bold)

| # | Decision | Options |
|---|---|---|
| D1 | NLB prize-table availability lag | **1 day** (conservative; the newest jackpot is used from the draw after next) or 0 |
| D2 | Calendar features | **moon phase, day of month, weekday** (a priori; weekday switches itself off), or also day-of-year |
| D3 | 7-day de-clustering in the calendar fit (fidelity asked for owner agreement) | **on** (each date still counts as 4 draws in the weights) or off |
| D4 | R3 "not a past result" rule | **on**, with the wording that it is not about odds, or off (the stats judge saw a gambler's-fallacy hint) |
| D5 | Silent dates | **strict chain** (daily draws held at 0; order always visible) or pass-through (daily draws then outweigh dates visibly) |
| D6 | v1 on the site | **comparison and details view only** or a full second card set |
| D7 | `GUARD_ALPHA` | **5%** |
| D8 | Owner sign-off of the section 1 text and the card labels before UI work | **required** |

---

## Appendix A: judge must-fixes and where they are resolved

| Must-fix (judge) | Resolution |
|---|---|
| Honest baselines; v1's 0.2 annotated (stats 1, fidelity 5, engineering 5) | 5.2: `mean k²/L_t`, log-score vs live uniform, `honestRandomBaseline`; pooled z -0.11 (prototype -0.17) |
| Copy control (stats 2, fidelity 3) | EXACT = 0; Dirichlet-shrunk decades (`J_PRIOR`); partition rule; guard ladder (1,2) today; `copyTilt` reported; no "does not copy" wording |
| Guards must scale; bounded loops; defined fallbacks; no duplicates (engineering 2, 3) | Guard ladder (at most 5% excluded); `SIR_ROUNDS`; deterministic fallbacks; R4 |
| One shared availability gate; DLB by draw K+2 (stats 3, engineering 4) | `knownFrom()` in 2.4; leakage tests 1-4 |
| Calendar honesty (stats 4, fidelity 7, 8) | Features chosen a priori, κ fitted per step, de-clustered, contrast, raw and Holm p, ticket-sales wording, no lucky-day signal |
| No odds language (stats 5, fidelity 4) | Copy rules 7.5, phrase test, odds line, "pattern score, not a probability" |
| Backtest design: stride 1, v1 window, paired, pooled, Holm, power, frozen constants (stats 6, engineering 6) | Section 5 |
| Influence claims match measurements (stats 7, fidelity 2) | Levels (a)-(c) in 2.11; realised shares, damping and parts in the payload; Top-pick order filter |
| Disclosures: Top letter, borrowed damping, zero evidence (stats 8, fidelity 10) | 2.13 note; POOL = 0; 2.12 table |
| Own evidence first (fidelity 1) | Own-only items and own-only calendar fit |
| Jackpot-day marking own-only, plus a full wins list (fidelity 6, engineering 11) | 3.1, 3.2, 7.1, 7.2 |
| One weight story per lottery (fidelity 9) | 7.3 headline split, per-item rule, damping sentence; the rest in details |
| Compute once per build (engineering 1) | `.cache/predictions.json` keyed by sha256; prebuild only |
| v1 byte-intact; v1 `nextDrawDate`; same window (engineering 6) | Section 4; imports only; trace helper verified |
| Determinism contract (engineering 7) | 2.16 |
| Tests and golden fixtures (engineering 8) | Section 6 |
| Types and payload compact; one naming scheme (engineering 10) | 3.3 and 3.4; `jackpotCombinations` / `jackpotDates` / `dailyDraws` everywhere |
| Constants frozen in one object, in the method text and the hash, pinned (engineering 12) | 2.2, section 4 |

---

## Appendix B: changes during implementation (2026-10-29)

PM decisions on the builders' open issues, and the places where the implementation and this document now agree (fixed in
place above; one line per item). Constants and `MODEL_VERSION_V2` are unchanged; the golden fixture was regenerated on its
frozen snapshot, so its diff shows only these effects.

1. **`n_eff` = number of date clusters** (2.7 a): each de-clustered cluster counts as one independent date, everywhere `n_eff` is used; the Kish size `W² / Σ w_j²` and its single-cluster special case are gone. Dhana Nidhanaya 6.55 -> 6, Mega Power 7.74 -> 7, Govisetha 6.55 -> 6; the calendar fits, shares, backtests and Mega Power's Super Number (15 -> 12) moved with it (2.7, 2.11, 2.15, 5.5).
2. **Card labels and notes** (2.15): `label` is always one of the five base labels (unique per lottery); why a card is a balanced pick is one plain sentence in `note`, true for every evidence status. The Top pick's note names the sources that move the picks (the old "All three sources together." was false without jackpot numbers). `explanation.sets` says "all the evidence together" and mentions balanced picks when one applies.
3. **Size budget** (3.4, 8.1 item 12): at most 24 KiB per lottery on real data; synthetic evidence growth may add 128 bytes per `evidence.used` item. The first 16 KB estimate left out `letterLean`, `bonusLean`, `evidence` and `method`.
4. **Copy tilt under the null** (5.3 item 3): hits and rank must sit at chance within 2 SE; the copy tilt is expected to be positive (J moves whole decades, where past jackpot numbers sit) and must respect the guards at every step. The audit measured +0.33 (SE 0.10) and reports "positive by design (jackpot decades), capped by the guards"; it says "not met" only if hits or rank fail or a guard breaks.
5. **Shanida's Top-pick letter is Q** (2.13, 2.15): G and Q tie exactly and the seeded letter tie key of 2.16 picks Q.
6. **MAP letter and bonus tie-breaks** (2.13, 5.2): exact ties go to the smallest seeded tie key, never to category order; the backtest's MAP letter and bonus are the Top pick's. This alone explains the DLB letter and bonus hit rates of 5.5 differing from the prototype.
7. **Rank-z null variance** (5.2): `(L+1)(L-k)/(12 L² k)` per draw, the variance of the mean of `k` percentiles drawn without replacement.
8. **Holm** (5.2, 5.5): a step-down at 5% over the stated families: per lottery every reported z (`holm`), and the 7 headline hit z's (`holmAll`; the prototype's "14 hit and rank tests" was a different family).
9. **Out-of-domain test draws** (5.2): a test draw with a number outside the live balls is skipped for `rankPct`, `rankZ` and `logScoreNats` (and counted in `outOfDomain`).
10. **Empty pool** (2.7): T is present but silent, and `calendarEss` is `null`.
11. **Integer-bonus channel** (2.5): it exists at step `t` only if an integer bonus was seen in draws `[0, t)`.
12. **`evidence.counts.dailyDraws.total`** (3.3): the draws in the current regime `[r_t, t)`.
13. **`backtestDetail`** (3.3, 2.12): omitted when `backtest.draws = 0`.
14. **`checked.from`** (3.2, 7.2): the date of the first NLB prize row with a winners count, 28 Mar 2026 today (the 7.2 example sentence reads "28 Mar 2026").
15. **Leakage tests** (6): test 3 excludes the descriptive `backtestDetail.jackpotDrawHits` (checked separately: it gains exactly the planted draws); test 2 uses cut points where `nextDrawDate` of the draws before `t` equals `date(d_t)`.
16. **Date-placebo era** (5.3 item 2): ±30 days around the real date, kept before the archive start, for the dates of wins without numbers only.
17. **Golden snapshot** (6): "the last 700 draws" of Ada Kotipathi and Kapruka are their whole history in the snapshot; their balls out of use are detected inside it.
18. **Data snapshot tests** (6): the tests that pin today's counts run only while the newest archived draw is of 2026-10-27 (`SNAPSHOT` in test/data.test.ts) and are skipped once newer data lands; the rules are checked on any data.
19. **`JackpotStatus.latestDraw`** (3.2, 7.1): `{drawNo, date, outcome: "won" | "not-won" | "unknown"}` of the newest archived draw; the UI shows "Jackpot not won - it rolls over" exactly when `outcome` is `not-won` (an NLB prize row with 0 winners). Today: 3 NLB `not-won`, 4 DLB `unknown`.
20. **`A1inv`** (2.7): `r >= 1` gives ∞ and `R_f` is clamped to 1 (the Best-Fisher formula turns negative above 1), so a perfect concentration gives `KAPPA_MAX`.

**Second round (PM decisions 11-13, 2026-10-29).** `MODEL_VERSION_V2` is unchanged on purpose: it is part of the stream seed
(2.16), so a new version string would change every tie key and with them the Top picks and the backtests, which this round
must keep byte-identical (verified: the 7 Top picks, `backtest` and `backtestDetail` of every lottery are byte-identical before
and after, on real data and on the golden snapshot). `V2_CONSTANTS` lost `TAU`, so the build cache key changed by itself; the
golden fixture was regenerated on its frozen snapshot (its diff: cards 2-5, `explanation.summary` / `combinations` / `dates` /
`sets`, Mega Power's `notes` and the constants).

21. **Deterministic view cards** (2.2, 2.11, 2.13-2.17, 3.3): every card except the Lucky dip is a constrained best ticket.
    A card whose source moves the picks maximises the source-only logScore over the 4-subsets of the `CAND` live numbers with
    the highest source-only lean (fallback 32, 48, all live balls), passing R1-R4 against the cards selected before it, with
    letter and bonus the argmax of the source-only distributions (tie keys); a balanced card does the same with the full
    posterior (the Top pick's logScore without the order filter). Selection order: Top pick, the cards whose source moves the
    picks (J, T, D), the balanced cards (J, T, D), the Lucky dip; display order and labels unchanged. The SIR sampling of
    cards 2-4 and its temperature `TAU` are gone (the old deterministic fallback is now the rule); `SIR` and `SIR_ROUNDS` stay
    for the Lucky dip, which is unchanged (uniform over passing tickets from the stream) and is now the only card that draws
    from the stream after the tie keys. Why: the sampled cards could point away from their own source (Mega Power's Daily
    draws card had T +0.12 > D +0.05, Dhana Nidhanaya's D -0.02), contradicting their notes. Now a card whose source moves the
    picks has a positive part for its own source (tested on real data and the synthetic growth cases). The method text did not
    mention the sampling, so it is unchanged.
22. **Payload texts** (2.12, 2.15, 3.3): an absent source's `explanation.combinations` / `dates` no longer ends in ": 0%"; the
    dates-only note counts the dated wins ("Mega Power's 9 dated jackpot wins ...", like the jackpot list: 11 known, 2 undated);
    `explanation.summary` names only the sources that move the picks and starts "All balls start equal" (no "fair balls" on the
    main panel; the method text in the maths view keeps it); `explanation.combinations` says "2 imaginary average jackpots"
    instead of "pseudo-jackpots"; `explanation.sets` describes the deterministic cards; a source known in the data but not
    usable yet (not public long enough, or undated) says "can be used yet", never "known yet", in the card notes, the
    summary, the notes and the source texts, so no text contradicts the jackpot list next to it.
23. **Whole-percent splits** (1, 3.3, 7.3): `wholePercents(split)` in `lib/model-v2/explain.ts` gives integer percents that add
    up to exactly 100 when any share is above 0 (largest remainder, ties J, T, D, a zero share stays 0, all zero gives all 0);
    every payload text that prints a split uses it, on the payload's `influence.numbers`. Dhana Nidhanaya: 54 / 27 / 20 (101)
    -> 54 / 26 / 20.

**Third round (review findings and PM decision 15, 2026-10-29).** `MODEL_VERSION_V2` is again unchanged on purpose (it seeds
the tie keys). `V2_CONSTANTS` gained `BALANCED_OVERLAP = 1`, so the build cache key changed by itself; the golden fixture was
regenerated on its frozen snapshot. Verified before and after: `sets[0]`, `backtest` and `backtestDetail` of all 7 lotteries
byte-identical for item 24 (and every payload byte-identical for the de-clustering of item 28), on real data and on the golden
snapshot; items 25-30 then change only the texts, `letter.chance` and the power figures, never a pick, a hit or a z.

24. **Balanced cards are clearly different alternatives** (PM decision 15; 2.2, 2.13-2.15): besides R1-R4, a balanced card
    shares at most `BALANCED_OVERLAP = 1` number with every card selected before it (the R4 rule only if no ticket passes that
    after the CAND fallbacks) and takes the best letter and bonus (full posterior, tie keys) that no card selected before it
    uses. Cards whose source moves the picks keep R4 and the argmax letter and bonus of their own source. Changed today (old ->
    new): Mega Power Jackpot pattern N 11 51 61 74, Super Number 12 -> S 11 22 56 74, Super Number 20; Ada Kotipathi R 2 20 43 57
    -> B 2 11 43 57 and R 11 20 57 73 -> M 14 20 43 73; Super Ball G 3 9 30 71 -> I 3 30 38 48 and G 30 37 38 76 -> T 21 30 74 76;
    Shanida Q 3 15 22 73 -> G 3 22 77 79 and Q 3 22 77 80 -> K 3 18 34 67; Kapruka H 15 42 63 69, bonus 29 -> X 40 42 43 63,
    bonus 23 and H 38 42 43 63, bonus 29 -> S 9 21 42 47, bonus 30. No Lucky dip changed.
25. **Backtest verdict, `explanation.backtest` and Holm note** (5.2, 5.4, 8.1 item 8): "the same as random" exactly when the
    95% range (the payload's `ci95`) contains 0; otherwise the judgement after allowing for the lottery's own checks (Holm). The
    note fires at |z| > 1.96 (the cut of the range, not 2), names the most unusual check and counts the site's checks (35 today,
    about 2 expected outside their range by luck). The old note's "at least one unusual result is expected" (false for 4-7
    checks) and "it is being looked at" (no escalation existed) are gone; a survivor is printed as a warning by the prebuild.
    Super Ball's verdict no longer calls +0.001 to +0.119 "the same as random".
26. **Power at 80%** (5.2, 5.4): the minimum detectable effect is 2.8 SE (it was 2 SE, about 52% power): +45% per NLB lottery,
    +41-42% per DLB lottery, +16% pooled, "would show up reliably in this test (in 4 cases out of 5)". Superseded by item 32.
27. **Method text window** (3.3): "over the last 200 draws, or fewer so that each replayed draw has at least 30 earlier draws"
    (the NLB lotteries replay 178).
28. **De-clustering in fixed windows** (2.2, 2.7 a): a cluster holds the dates within 7 days of its first date, so none spans
    more than 7 days (chains of gaps could span months and switch the calendar off for weekly wins). No real payload changed;
    the synthetic growth cases now have 7, 16 and 24 date clusters at 10, 30 and 100 combinations (6, 11 and 1 before). The
    dates text calls the peaks chance unless some feature has a Holm p below 0.05 (none does today).
29. **Letter chance** (5.2, 5.5): 1 in the letters the game allows (26, or 12 zodiac signs; `1/|U_t|` only if more were seen),
    not `1/|U_t|` of the letters seen so far: 0.038 instead of 0.040-0.041 for NLB.
30. **Other texts** (2.12, 2.15, 3.3, 7.2, 7.3): card notes "Follows the tens, odd/even mix, spread and letter of past jackpots."
    and "Follows the draws held on calendar days similar to past jackpot dates."; Lucky dip "A random ticket that follows the
    same pick rules. ..." (it is uniform over the passing tickets only); `explanation.summary` "Share of the pull on the numbers
    today: ..."; `explanation.sets` names the order the Top pick keeps and the balanced cards' difference; the odds line names
    the balls in use where some are out of use; the order note names the 24 numbers it is about; the DLB note states the
    inference rule correctly; a winners-directory card read from page 1 is labelled with the month of the run (2.4).

Tests and tooling of this round: counts that grow with data/ are checked as rules and the pinned values of 2026-10-27 run on the
frozen snapshot of the golden fixture (unit, zero-evidence, copy, data tests; `jackpotStatusOf` in lib/data.ts); the golden
fixture is written one field per line; CI runs `npm run bench:model`; a test pins the sha256 of `lib/model.ts`; the copy test
checks every verdict, Holm note and dates text against its numbers and scans README.md and the built pages; leakage test 5.

**Fourth round (recheck finding, 2026-10-29).** Reporting only: no constant, pick, hit or z of today changed (every payload
byte-identical before and after, on real data and on the golden snapshot), so the golden fixture is unchanged.

31. **Checks with too few draws** (5.2, 5.4, 2.12): the jackpot-number check and each source's lean check are formed only with
    30 test draws behind them (`CHECK_MIN_STEPS` = `BT_MIN`; the jackpot-number check also needs 5 numbers expected by chance,
    `LIFT_MIN_EXPECTED`, in `lib/model-v2/backtest.ts`). Before, they started at one test draw, so a lottery's first jackpot
    (any of the 4 DLB lotteries, or Mega Power's first win in the archive) could make the page say a check "stays unusual
    ... a fault in the data or the method" and the prebuild warn, from 2 lucky draws: the normal p of 2 shared numbers over 2
    draws is 0.008, the true chance 5.3%. Until then the check is `null` or left out of `lifts.sourceZ`, `holm.tests`, the Holm
    note and the site's count; the copy tilt is still described. The walk-forward now also counts the steps of each source
    (`sourceSteps`); today: combinations 149 (Dhana Nidhanaya) and 178 (Govisetha) steps, dates 149-178, daily draws 149-200.

**Fifth round (recheck findings, 2026-10-29).** Reporting, tests and CI only: no constant, pick, card, hit or z changed. The
payloads differ only in `backtestDetail.power` and `backtestDetail.text.power` (checked field by field on real data and on the
golden snapshot), and the golden fixture was regenerated on its frozen snapshot for them.

32. **Power at the verdict's cut** (5.2, 5.4, 5.5): the power sentence promised "4 cases out of 5" at 2.8 SE, the cut of the
    95% range, but the verdict calls a hit result unusual only when it survives Holm over the lottery's 4-7 checks, which a true
    effect of 2.8 SE does only 55-62% of the time. `mdeShare` is now `(holmFirstCut(m) + Z_POWER) SE / baseline` with
    `m = holm.tests` (3.34-3.53 SE: about +55-57% per NLB lottery, +49-50% per DLB lottery), `pooledMdeShare` the same over
    the headline checks `holmAll.tests` (about +21%), and the sentence names the checks: "..., after allowing for the 7 checks
    made for this lottery." Its figure is the payload's r4 value. Every payload grew by 55 bytes (3.4, 8.1 item 12: Mega
    Power 18,907). Supersedes item 26.
33. **Order note** (2.12, 2.15): "no ticket that follows the pick rules keeps the order ..." names only the sources present
    in the number channel, like `explanation.sets` ("jackpot dates, then daily draws" for a dates-only lottery such as Mega
    Power). It appears only when `orderHeld` is false, which no lottery is today.
34. **Directory labels tested** (6, leakage test 5): `readWinnersDirectory` (page-1 cards labelled with the month of the run,
    item 30) and the daily merge of `updateDirectory` (the earliest month counts; a stored "latest" gives way to a month) run in
    test/jackpots.test.ts on fixture pages through the page cache (`pageCacheFile`), never the network.
35. **Copy rules on the built pages in CI** (6): CI ran `npm test` before `npm run build`, so the scan of `out/*.html` was
    always skipped there. `.github/workflows/ci.yml` now runs test/model-v2.copy.test.ts again after the build with
    `REQUIRE_BUILT_PAGES=1`, which makes a missing `out/` a failure instead of a skip.
36. **Section 1**: the site does not "always" say "the same as random" (since item 25 it says so only where the 95% range
    contains 0, not for Super Ball today); the sentence says where it does.
