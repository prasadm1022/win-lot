"""Offline analysis: statistics, randomness checks, predictions and a walk-forward backtest.

    scraper/.venv/Scripts/python scraper/analysis.py   ->  data/analysis_report.md

Evaluation protocol (Model/Prompt Plan in the task record):
- Primary metric: average main-number hits per draw of the model's 'Top scores' set, walk-forward over
  the last 200 draws (train on everything strictly before each draw; no leakage).
- Baselines: analytic random expectation k^2/range, plus frequency-only and recency-only top-k pickers.
- Guardrail: per-lottery result, z-score of the model vs random (honest reporting; draws are random).
"""
from __future__ import annotations

import datetime as dt
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from backfill import load_db  # noqa: E402
from lotteries import LOTTERIES  # noqa: E402
import model  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
REPORT = ROOT / "data" / "analysis_report.md"
WINDOW = 200


def chi2_pvalue(chi2: float, df: int) -> float:
    """Upper-tail p-value via the Wilson-Hilferty normal approximation (no scipy dependency)."""
    if df <= 0:
        return float("nan")
    z = ((chi2 / df) ** (1 / 3) - (1 - 2 / (9 * df))) / math.sqrt(2 / (9 * df))
    return 0.5 * math.erfc(z / math.sqrt(2))


def counts_matrix(history: list[list[int]], lo: int, hi: int) -> np.ndarray:
    """Binary matrix draws x numbers."""
    mat = np.zeros((len(history), hi - lo + 1), dtype=np.int8)
    for i, nums in enumerate(history):
        for n in nums:
            if lo <= n <= hi:
                mat[i, n - lo] = 1
    return mat


def walk_forward(history: list[list[int]], lo: int, hi: int, k: int) -> dict:
    mat = counts_matrix(history, lo, hi)
    total = len(history)
    start = max(model.BACKTEST_MIN_TRAIN, total - WINDOW)
    hits = {"model": [], "frequency": [], "recency": []}
    for t in range(start, total):
        actual = set(history[t])
        scores = model.blend(*model.components(history[:t], lo, hi, k))
        hits["model"].append(len(actual & set(model.top_k(scores, lo, k))))
        freq = mat[:t].sum(axis=0)
        hits["frequency"].append(len(actual & set(lo + i for i in np.lexsort((np.arange(len(freq)), -freq))[:k])))
        recent = mat[max(0, t - 30):t].sum(axis=0)
        hits["recency"].append(len(actual & set(lo + i for i in np.lexsort((np.arange(len(recent)), -recent))[:k])))
    size = hi - lo + 1
    p = k / size
    # hits per draw ~ hypergeometric(size, k, k): mean k^2/size, var k*p*(1-p)*(size-k)/(size-1)
    var = k * p * (1 - p) * (size - k) / (size - 1)
    n = total - start
    out = {"draws": n, "random": k * k / size}
    for name, h in hits.items():
        mean = float(np.mean(h)) if h else 0.0
        out[name] = mean
        out[f"{name}_z"] = (mean - out["random"]) / math.sqrt(var / n) if n else float("nan")
        out[f"{name}_dist"] = np.bincount(h, minlength=k + 1).tolist() if h else []
    return out


def analyse(lottery: dict, draws: list[dict]) -> tuple[str, dict]:
    lo, hi, k = lottery["main_min"], lottery["main_max"], lottery["main_count"]
    df = pd.DataFrame(draws)
    df["sum"] = df["numbers"].apply(sum)
    df["odd"] = df["numbers"].apply(lambda xs: sum(1 for x in xs if x % 2))
    history = df["numbers"].tolist()
    mat = counts_matrix(history, lo, hi)
    freq = mat.sum(axis=0)
    expected = len(history) * k / (hi - lo + 1)
    chi2 = float(((freq - expected) ** 2 / expected).sum())
    p_num = chi2_pvalue(chi2, hi - lo)
    letters = df["letter"].dropna().value_counts().sort_index()
    l_exp = letters.sum() / len(letters) if len(letters) else 0
    l_chi2 = float(((letters - l_exp) ** 2 / l_exp).sum()) if len(letters) else float("nan")
    p_let = chi2_pvalue(l_chi2, len(letters) - 1)
    order = np.lexsort((np.arange(len(freq)), -freq))
    hot = [int(lo + i) for i in order[:10]]
    cold = [int(lo + i) for i in order[::-1][:10]]
    out_of_range = int(sum(1 for h in history for n in h if n < lo or n > hi))
    observed_min = min(min(h) for h in history)
    observed_max = max(max(h) for h in history)

    bonus_vals = [d["bonus"] for d in draws if isinstance(d["bonus"], int)]
    bonus_line = ""
    if bonus_vals:
        bonus_line = (f"- Bonus ({lottery['bonus_label']}): {len(bonus_vals)} draws, observed range "
                      f"{min(bonus_vals)}..{max(bonus_vals)}\n")
    digit_bonus = [d["bonus"] for d in draws if isinstance(d["bonus"], dict)]
    if digit_bonus:
        bonus_line = f"- {lottery['bonus_label']}: present on {len(digit_bonus)} draws (4 digits 0-9)\n"

    wf = walk_forward(history, lo, hi, k)
    pred = model.predict(lottery, draws, generated_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"))

    lines = [
        f"## {lottery['name']} (`{lottery['id']}`, {lottery['board']})",
        "",
        f"- Draws: **{len(draws)}** (#{draws[0]['draw_no']} {draws[0]['draw_date']} .. "
        f"#{draws[-1]['draw_no']} {draws[-1]['draw_date']})",
        f"- Format: letter + {k} numbers, observed range {observed_min}..{observed_max} "
        f"(configured {lo}..{hi}; out-of-range values: {out_of_range})",
        bonus_line.rstrip("\n") if bonus_line else "- Bonus: none",
        f"- Number uniformity: chi2 = {chi2:.1f} (df {hi - lo}), p ~ {p_num:.3f} "
        f"{'(no evidence against uniform)' if p_num > 0.01 else '(deviation; check data)'}",
        f"- Letter uniformity: chi2 = {l_chi2:.1f} (df {len(letters) - 1}), p ~ {p_let:.3f}; "
        f"{len(letters)} distinct letters",
        f"- Sum of numbers: mean {df['sum'].mean():.1f}, IQR {df['sum'].quantile(.25):.0f}..{df['sum'].quantile(.75):.0f}",
        f"- Odd count distribution: {df['odd'].value_counts().sort_index().to_dict()}",
        f"- Hot (all-time): {hot}",
        f"- Cold (all-time): {cold}",
        "",
        f"**Walk-forward backtest** (last {wf['draws']} draws, avg main-number hits per draw)",
        "",
        "| Picker | Avg hits | z vs random | Hit distribution 0..k |",
        "|---|---|---|---|",
        f"| Random expectation | {wf['random']:.4f} | - | - |",
        f"| Model 'Top scores' | {wf['model']:.4f} | {wf['model_z']:+.2f} | {wf['model_dist']} |",
        f"| Frequency-only top-k | {wf['frequency']:.4f} | {wf['frequency_z']:+.2f} | {wf['frequency_dist']} |",
        f"| Recency-only (30 draws) | {wf['recency']:.4f} | {wf['recency_z']:+.2f} | {wf['recency_dist']} |",
        "",
        f"**Next draw** #{pred['nextDrawNo']} on {pred['nextDrawDate']}:",
        "",
    ]
    for s in pred["sets"]:
        bonus = f" + bonus {s['bonus']}" if s["bonus"] is not None else ""
        lines.append(f"- {s['label']}: {s['letter'] or ''} {s['numbers']}{bonus} (score {s['score']})")
    lines.append("")
    return "\n".join(lines), {"id": lottery["id"], "draws": len(draws), "first": draws[0]["draw_date"],
                              "last": draws[-1]["draw_date"], **{k2: wf[k2] for k2 in ("random", "model", "model_z")}}


def main() -> None:
    data = load_db()
    sections, summary = [], []
    for lottery in LOTTERIES:
        draws = data.get(lottery["id"], [])
        if not draws:
            continue
        text, row = analyse(lottery, draws)
        sections.append(text)
        summary.append(row)
        print(f"{row['id']}: {row['draws']} draws {row['first']}..{row['last']} model {row['model']:.3f} "
              f"vs random {row['random']:.3f} (z {row['model_z']:+.2f})")

    header = [
        "# win-lot analysis report",
        "",
        f"Generated {dt.datetime.now().isoformat(timespec='seconds')} by `scraper/analysis.py` "
        f"(model `{model.MODEL_VERSION}`).",
        "",
        "> " + model.DISCLAIMER,
        "",
        "## Summary",
        "",
        "| Lottery | Draws | From | To | Model avg hits | Random | z |",
        "|---|---|---|---|---|---|---|",
    ]
    header += [f"| {r['id']} | {r['draws']} | {r['first']} | {r['last']} | {r['model']:.4f} | {r['random']:.4f} | "
               f"{r['model_z']:+.2f} |" for r in summary]
    header += ["", "|z| < 2 means the model is statistically indistinguishable from random picks, which is the "
               "expected result for a fair lottery.", ""]
    REPORT.write_text("\n".join(header + sections), encoding="utf-8")
    print(f"wrote {REPORT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
