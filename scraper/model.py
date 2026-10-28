"""win-lot prediction model (reference implementation; worker/src/model.ts is a 1:1 port).

Lottery draws are random. This is a transparent statistical heuristic, not a forecast.

Number score = 0.35 * long-run frequency
             + 0.40 * recent frequency (last 100 draws, exponential decay, half-life 30 draws)
             + 0.25 * overdue-ness (gap since last seen / expected gap, capped at 3x)
Each component is min-max normalised over the number range, and so is the blend.

Portability rules (so Python and TypeScript produce identical output):
- only + - * / and comparisons on floats (the decay factor is a literal, no pow at runtime);
- the same deterministic PRNG (mulberry32) seeded with FNV-1a of "<lotteryId>:<lastDrawNo>";
- fixed iteration orders (numbers ascending, ties broken by the smaller number / letter);
- rounding via floor(x * 10000 + 0.5) / 10000.
"""
from __future__ import annotations

import datetime as dt
import math

MODEL_VERSION = "win-lot-heuristic-v1"
DECAY = 0.9771599684342459          # 0.5 ** (1 / 30): half-life of 30 draws
RECENT_WINDOW = 100
BACKTEST_DRAWS = 200
BACKTEST_MIN_TRAIN = 30
W_LONG, W_RECENT, W_OVERDUE = 0.35, 0.40, 0.25
OVERDUE_CAP = 3.0
SAMPLE_ATTEMPTS = 200
MASK = 0xFFFFFFFF

METHOD = (
    "Blended score per number: 35% long-run frequency, 40% recent frequency (last 100 draws, "
    "exponentially decayed, half-life 30 draws) and 25% overdue-ness (draws since last seen vs. the "
    "expected gap, capped at 3x), each min-max normalised. 'Top scores' takes the highest-scoring "
    "numbers; the other sets are sampled from the hot, overdue and blended distributions and kept only "
    "if their odd count and sum fall inside the historic interquartile range. The letter is chosen by "
    "decayed letter frequency. Walk-forward backtest over the last 200 draws compares the average number "
    "of main-number hits of 'Top scores' with the random expectation."
)
DISCLAIMER = (
    "Lottery draws are random and every combination is equally likely. These picks are a statistical "
    "curiosity for entertainment only; they do not improve your odds. Please play responsibly."
)


# ---------------------------------------------------------------- helpers

def r4(x: float) -> float:
    return math.floor(x * 10000 + 0.5) / 10000


def fnv1a(text: str) -> int:
    h = 0x811C9DC5
    for ch in text.encode("utf-8"):
        h ^= ch
        h = (h * 0x01000193) & MASK
    return h


class Mulberry32:
    def __init__(self, seed: int):
        self.a = seed & MASK

    def next(self) -> float:
        self.a = (self.a + 0x6D2B79F5) & MASK
        t = self.a
        t = ((t ^ (t >> 15)) * (t | 1)) & MASK
        t = (t ^ ((t + (((t ^ (t >> 7)) * (t | 61)) & MASK)) & MASK)) & MASK
        return ((t ^ (t >> 14)) & MASK) / 4294967296


def normalise(values: list[float]) -> list[float]:
    lo, hi = min(values), max(values)
    if hi - lo == 0:
        return [0.5 for _ in values]
    return [(v - lo) / (hi - lo) for v in values]


def quantile(sorted_values: list[float], q: float) -> float:
    pos = (len(sorted_values) - 1) * q
    base = math.floor(pos)
    frac = pos - base
    if base + 1 < len(sorted_values):
        return sorted_values[base] + (sorted_values[base + 1] - sorted_values[base]) * frac
    return sorted_values[base]


# ---------------------------------------------------------------- scoring

def components(history: list[list[int]], lo: int, hi: int, k: int,
               counts: list[int] | None = None, last_seen: list[int] | None = None):
    """Normalised (long, recent, overdue) per number for draws `history` (oldest first).

    `counts` / `last_seen` may be supplied pre-computed (backtest fast path).
    """
    size = hi - lo + 1
    total = len(history)
    if counts is None or last_seen is None:
        counts = [0] * size
        last_seen = [-1] * size
        for idx, nums in enumerate(history):
            for n in nums:
                if lo <= n <= hi:
                    counts[n - lo] += 1
                    last_seen[n - lo] = idx
    long_raw = [c / total if total else 0.0 for c in counts]
    recent_raw = [0.0] * size
    weight = 1.0
    window = min(RECENT_WINDOW, total)
    for age in range(window):
        for n in history[total - 1 - age]:
            if lo <= n <= hi:
                recent_raw[n - lo] += weight
        weight = weight * DECAY
    expected_gap = size / k
    overdue_raw = []
    for i in range(size):
        gap = (total - 1 - last_seen[i]) if last_seen[i] >= 0 else total
        ratio = gap / expected_gap
        overdue_raw.append((ratio if ratio < OVERDUE_CAP else OVERDUE_CAP) / OVERDUE_CAP)
    return normalise(long_raw), normalise(recent_raw), normalise(overdue_raw)


def blend(long_n, recent_n, overdue_n) -> list[float]:
    raw = [W_LONG * long_n[i] + W_RECENT * recent_n[i] + W_OVERDUE * overdue_n[i] for i in range(len(long_n))]
    return normalise(raw)


def top_k(scores: list[float], lo: int, k: int) -> list[int]:
    order = sorted(range(len(scores)), key=lambda i: (-scores[i], i))
    return sorted(lo + i for i in order[:k])


def weighted_sample(rng: Mulberry32, weights: list[float], k: int) -> list[int]:
    """k distinct indices, sampled without replacement proportional to weights."""
    remaining = list(range(len(weights)))
    picked = []
    for _ in range(min(k, len(remaining))):
        total = 0.0
        for i in remaining:
            total += weights[i]
        r = rng.next() * total
        cum = 0.0
        choice = remaining[-1]
        for i in remaining:
            cum += weights[i]
            if r < cum:
                choice = i
                break
        picked.append(choice)
        remaining.remove(choice)
    return picked


# ---------------------------------------------------------------- backtest

def backtest(history: list[list[int]], lo: int, hi: int, k: int) -> dict:
    total = len(history)
    size = hi - lo + 1
    start = max(BACKTEST_MIN_TRAIN, total - BACKTEST_DRAWS)
    baseline = r4(k * k / size)
    if start >= total:
        return {"draws": 0, "avgHits": 0.0, "randomBaseline": baseline}
    counts = [0] * size
    last_seen = [-1] * size
    for idx in range(start):
        for n in history[idx]:
            if lo <= n <= hi:
                counts[n - lo] += 1
                last_seen[n - lo] = idx
    hits = 0
    for t in range(start, total):
        prefix = history[:t]
        scores = blend(*components(prefix, lo, hi, k, counts, last_seen))
        pick = set(top_k(scores, lo, k))
        hits += sum(1 for n in history[t] if n in pick)
        for n in history[t]:
            if lo <= n <= hi:
                counts[n - lo] += 1
                last_seen[n - lo] = t
    return {"draws": total - start, "avgHits": r4(hits / (total - start)), "randomBaseline": baseline}


# ---------------------------------------------------------------- prediction

def next_draw_date(dates: list[str]) -> str:
    recent = dates[-28:]
    weekdays = {dt.date.fromisoformat(d).weekday() for d in recent}
    day = dt.date.fromisoformat(dates[-1])
    for _ in range(14):
        day = day + dt.timedelta(days=1)
        if day.weekday() in weekdays:
            return day.isoformat()
    return (dt.date.fromisoformat(dates[-1]) + dt.timedelta(days=1)).isoformat()


def letter_scores(letters: list[str | None]) -> tuple[list[str], list[float]]:
    universe = sorted({l for l in letters if l})
    if not universe:
        return [], []
    raw = {l: 1.0 for l in universe}       # +1 smoothing
    weight = 1.0
    seq = [l for l in letters if l]
    for age in range(min(RECENT_WINDOW, len(seq))):
        raw[seq[len(seq) - 1 - age]] += weight
        weight = weight * DECAY
    return universe, [raw[l] for l in universe]


def predict(lottery: dict, draws: list[dict], generated_at: str) -> dict:
    """`draws` oldest first, each {draw_no, draw_date, letter, numbers, bonus}."""
    lo, hi, k = lottery["main_min"], lottery["main_max"], lottery["main_count"]
    history = [d["numbers"] for d in draws]
    long_n, recent_n, overdue_n = components(history, lo, hi, k)
    scores = blend(long_n, recent_n, overdue_n)
    last = draws[-1]
    rng = Mulberry32(fnv1a(f"{lottery['id']}:{last['draw_no']}"))

    odd_counts = sorted(sum(1 for n in h if n % 2 == 1) for h in history)
    sums = sorted(sum(h) for h in history)
    odd_lo, odd_hi = quantile(odd_counts, 0.25), quantile(odd_counts, 0.75)
    sum_lo, sum_hi = quantile(sums, 0.25), quantile(sums, 0.75)

    def acceptable(nums: list[int]) -> bool:
        odd = sum(1 for n in nums if n % 2 == 1)
        total = sum(nums)
        return odd_lo <= odd <= odd_hi and sum_lo <= total <= sum_hi

    strategies = [
        ("Hot streak", [x * x + 0.0025 for x in recent_n]),
        ("Overdue hunter", [x * x + 0.0025 for x in overdue_n]),
        ("Balanced blend", [(x + 0.05) * (x + 0.05) for x in scores]),
        ("Wildcard", [x + 0.5 for x in scores]),
    ]
    number_sets: list[tuple[str, list[int]]] = [("Top scores", top_k(scores, lo, k))]
    for label, weights in strategies:
        chosen = None
        for _ in range(SAMPLE_ATTEMPTS):
            candidate = sorted(lo + i for i in weighted_sample(rng, weights, k))
            chosen = candidate
            if acceptable(candidate) and all(candidate != s for _, s in number_sets):
                break
        number_sets.append((label, chosen))

    universe, l_scores = letter_scores([d["letter"] for d in draws])
    bonus_kind = bonus_type(lottery, draws)
    bonus_scores = None
    if bonus_kind == "int":
        b_lo, b_hi = lottery["bonus_min"], lottery["bonus_max"]
        b_hist = [[d["bonus"]] for d in draws if isinstance(d["bonus"], int)]
        bonus_scores = blend(*components(b_hist, b_lo, b_hi, 1))

    sets = []
    for idx, (label, nums) in enumerate(number_sets):
        letter = None
        if universe and lottery["letter_kind"] != "none":
            if idx == 0:
                best = max(range(len(universe)), key=lambda i: (l_scores[i], -i))
                letter = universe[best]
            else:
                letter = universe[weighted_sample(rng, l_scores, 1)[0]]
        bonus = None
        if bonus_scores is not None:
            if idx == 0:
                bonus = top_k(bonus_scores, lottery["bonus_min"], 1)[0]
            else:
                weights = [(x + 0.05) * (x + 0.05) for x in bonus_scores]
                bonus = lottery["bonus_min"] + weighted_sample(rng, weights, 1)[0]
        set_score = 0.0
        for n in nums:
            set_score += scores[n - lo]
        sets.append({"label": label, "letter": letter, "numbers": nums, "bonus": bonus,
                     "score": r4(set_score / len(nums))})

    return {
        "lotteryId": lottery["id"],
        "generatedAt": generated_at,
        "basedOnDraws": len(draws),
        "nextDrawDate": next_draw_date([d["draw_date"] for d in draws]),
        "nextDrawNo": last["draw_no"] + 1,
        "sets": sets,
        "numberScores": [{"n": lo + i, "score": r4(s)} for i, s in enumerate(scores)],
        "method": METHOD,
        "disclaimer": DISCLAIMER,
        "backtest": backtest(history, lo, hi, k),
        "modelVersion": MODEL_VERSION,
    }


def bonus_type(lottery: dict, draws: list[dict]) -> str | None:
    if not lottery["has_bonus"]:
        return None
    if lottery["bonus_min"] is None or lottery["bonus_max"] is None:
        return None
    if any(isinstance(d["bonus"], int) for d in draws):
        return "int"
    return None
