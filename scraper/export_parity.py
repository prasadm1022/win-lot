"""Write Python model outputs for the TS parity test.

    python scraper/export_parity.py                 # small fixture -> worker/test/fixtures/model-parity.json
    python scraper/export_parity.py --full --out X  # full history (used by `npm run check:model`)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from backfill import load_db  # noqa: E402
from lotteries import LOTTERIES  # noqa: E402
import model  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "worker" / "test" / "fixtures" / "model-parity.json"
GENERATED_AT = "2026-10-28T00:00:00Z"
FIXTURE_DRAWS = 260


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--out", default=str(FIXTURE))
    args = ap.parse_args()
    draws = load_db()
    cases = []
    for lottery in LOTTERIES:
        rows = draws.get(lottery["id"], [])
        if not args.full:
            rows = rows[-FIXTURE_DRAWS:]
        if not rows:
            continue
        cases.append({"lottery": lottery, "draws": rows,
                      "expected": model.predict(lottery, rows, generated_at=GENERATED_AT)})
    Path(args.out).write_text(json.dumps({"generatedAt": GENERATED_AT, "cases": cases}, separators=(",", ":")),
                              encoding="utf-8")
    print(f"wrote {len(cases)} cases to {args.out}")


if __name__ == "__main__":
    main()
