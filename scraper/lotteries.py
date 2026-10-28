# SPDX-License-Identifier: Apache-2.0
"""Lottery metadata (mirrors the `lotteries` D1 table and worker/src/lotteries.ts).

Formats were verified against the live NLB / DLB markup on 2026-10-28:
- All seven lotteries draw one English letter (A-Z) plus four main numbers.
- Mega Power additionally draws a red "Super Number" (NLB title="Super Number") -> integer bonus.
- Kapruka shows a fifth number after the four main numbers -> integer bonus.
- Dhana Nidhanaya sometimes shows a "Sunday Bonus" of four digits -> {"label":..., "digits":[...]}.
"""

LOTTERIES = [
    # id, name, board, source_url, source_key, letter_kind, main_count, main_min, main_max,
    # has_bonus, bonus_label, bonus_min, bonus_max
    dict(id="dhana-nidhanaya", name="Dhana Nidhanaya", board="NLB",
         source_url="https://www.nlb.lk/results/dhana-nidhanaya", source_key="dhana-nidhanaya",
         letter_kind="letter", main_count=4, main_min=1, main_max=82,
         has_bonus=1, bonus_label="Sunday Bonus", bonus_min=0, bonus_max=9),
    dict(id="mega-power", name="Mega Power", board="NLB",
         source_url="https://www.nlb.lk/results/mega-power", source_key="mega-power",
         letter_kind="letter", main_count=4, main_min=1, main_max=80,
         has_bonus=1, bonus_label="Super Number", bonus_min=1, bonus_max=26),
    dict(id="govisetha", name="Govisetha", board="NLB",
         source_url="https://www.nlb.lk/results/govisetha", source_key="govisetha",
         letter_kind="letter", main_count=4, main_min=1, main_max=80,
         has_bonus=0, bonus_label=None, bonus_min=None, bonus_max=None),
    dict(id="ada-kotipathi", name="Ada Kotipathi", board="DLB",
         source_url="https://www.dlb.lk/result/11/", source_key="11",
         letter_kind="letter", main_count=4, main_min=1, main_max=80,
         has_bonus=0, bonus_label=None, bonus_min=None, bonus_max=None),
    dict(id="super-ball", name="Super Ball", board="DLB",
         source_url="https://www.dlb.lk/result/3/", source_key="3",
         letter_kind="letter", main_count=4, main_min=1, main_max=80,
         has_bonus=0, bonus_label=None, bonus_min=None, bonus_max=None),
    dict(id="shanida", name="Shanida", board="DLB",
         source_url="https://www.dlb.lk/result/1/", source_key="1",
         letter_kind="letter", main_count=4, main_min=1, main_max=80,
         has_bonus=0, bonus_label=None, bonus_min=None, bonus_max=None),
    dict(id="kapruka", name="Kapruka", board="DLB",
         source_url="https://www.dlb.lk/result/12/", source_key="12",
         letter_kind="letter", main_count=4, main_min=1, main_max=80,
         has_bonus=1, bonus_label="Bonus Number", bonus_min=1, bonus_max=40),
]

BY_ID = {l["id"]: l for l in LOTTERIES}

# Observed ranges (2026-10-28 backfill): Dhana Nidhanaya main numbers reach 82; Mega Power Super
# Number 1..26; Kapruka bonus 1..40. DLB pages occasionally show lowercase letters (normalised to upper).
