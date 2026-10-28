# win-lot analysis report

Generated 2026-10-28T20:30:02 by `scraper/analysis.py` (model `win-lot-heuristic-v1`).

> Lottery draws are random and every combination is equally likely. These picks are a statistical curiosity for entertainment only; they do not improve your odds. Please play responsibly.

## Summary

| Lottery | Draws | From | To | Model avg hits | Random | z |
|---|---|---|---|---|---|---|
| dhana-nidhanaya | 208 | 2026-03-27 | 2026-10-27 | 0.1742 | 0.1951 | -0.66 |
| mega-power | 208 | 2026-03-27 | 2026-10-27 | 0.1404 | 0.2000 | -1.86 |
| govisetha | 208 | 2026-03-27 | 2026-10-27 | 0.1742 | 0.2000 | -0.81 |
| ada-kotipathi | 1903 | 2021-04-01 | 2026-10-27 | 0.1850 | 0.2000 | -0.50 |
| super-ball | 1903 | 2021-04-01 | 2026-10-27 | 0.1950 | 0.2000 | -0.17 |
| shanida | 1909 | 2021-04-01 | 2026-10-27 | 0.2000 | 0.2000 | +0.00 |
| kapruka | 1790 | 2021-04-02 | 2026-10-27 | 0.2050 | 0.2000 | +0.17 |

|z| < 2 means the model is statistically indistinguishable from random picks, which is the expected result for a fair lottery.

## Dhana Nidhanaya (`dhana-nidhanaya`, NLB)

- Draws: **208** (#2176 2026-03-27 .. #2383 2026-10-27)
- Format: letter + 4 numbers, observed range 1..82 (configured 1..82; out-of-range values: 0)
- Sunday Bonus: present on 22 draws (4 digits 0-9)
- Number uniformity: chi2 = 75.3 (df 81), p ~ 0.657 (no evidence against uniform)
- Letter uniformity: chi2 = 17.8 (df 25), p ~ 0.853; 26 distinct letters
- Sum of numbers: mean 171.3, IQR 143..201
- Odd count distribution: {0: 14, 1: 61, 2: 66, 3: 55, 4: 12}
- Hot (all-time): [37, 52, 77, 19, 30, 63, 66, 76, 7, 13]
- Cold (all-time): [49, 6, 71, 65, 50, 14, 1, 12, 73, 51]

**Walk-forward backtest** (last 178 draws, avg main-number hits per draw)

| Picker | Avg hits | z vs random | Hit distribution 0..k |
|---|---|---|---|
| Random expectation | 0.1951 | - | - |
| Model 'Top scores' | 0.1742 | -0.66 | [147, 31, 0, 0, 0] |
| Frequency-only top-k | 0.1629 | -1.02 | [149, 29, 0, 0, 0] |
| Recency-only (30 draws) | 0.1798 | -0.48 | [148, 28, 2, 0, 0] |

**Next draw** #2384 on 2026-10-28:

- Top scores: P [13, 19, 30, 37] (score 0.9016)
- Hot streak: X [13, 25, 74, 76] (score 0.6866)
- Overdue hunter: B [4, 29, 65, 79] (score 0.3552)
- Balanced blend: G [37, 39, 40, 61] (score 0.6815)
- Wildcard: Z [15, 29, 46, 64] (score 0.4974)

## Mega Power (`mega-power`, NLB)

- Draws: **208** (#2494 2026-03-27 .. #2701 2026-10-27)
- Format: letter + 4 numbers, observed range 1..80 (configured 1..80; out-of-range values: 0)
- Bonus (Super Number): 208 draws, observed range 1..26
- Number uniformity: chi2 = 83.2 (df 79), p ~ 0.352 (no evidence against uniform)
- Letter uniformity: chi2 = 26.0 (df 25), p ~ 0.408; 26 distinct letters
- Sum of numbers: mean 159.9, IQR 132..192
- Odd count distribution: {0: 16, 1: 42, 2: 87, 3: 50, 4: 13}
- Hot (all-time): [22, 50, 65, 20, 25, 48, 26, 28, 70, 4]
- Cold (all-time): [66, 47, 44, 15, 42, 78, 68, 52, 16, 14]

**Walk-forward backtest** (last 178 draws, avg main-number hits per draw)

| Picker | Avg hits | z vs random | Hit distribution 0..k |
|---|---|---|---|
| Random expectation | 0.2000 | - | - |
| Model 'Top scores' | 0.1404 | -1.86 | [154, 23, 1, 0, 0] |
| Frequency-only top-k | 0.1629 | -1.16 | [150, 27, 1, 0, 0] |
| Recency-only (30 draws) | 0.1798 | -0.63 | [147, 30, 1, 0, 0] |

**Next draw** #2702 on 2026-10-28:

- Top scores: U [22, 48, 50, 65] + bonus 4 (score 0.9668)
- Hot streak: V [25, 41, 57, 60] + bonus 13 (score 0.596)
- Overdue hunter: Y [26, 42, 55, 66] + bonus 4 (score 0.4628)
- Balanced blend: K [10, 48, 52, 65] + bonus 23 (score 0.7686)
- Wildcard: L [10, 24, 61, 63] + bonus 3 (score 0.5779)

## Govisetha (`govisetha`, NLB)

- Draws: **208** (#4388 2026-03-27 .. #4595 2026-10-27)
- Format: letter + 4 numbers, observed range 1..80 (configured 1..80; out-of-range values: 0)
- Bonus: none
- Number uniformity: chi2 = 66.8 (df 79), p ~ 0.834 (no evidence against uniform)
- Letter uniformity: chi2 = 30.0 (df 25), p ~ 0.224; 26 distinct letters
- Sum of numbers: mean 163.0, IQR 132..194
- Odd count distribution: {0: 13, 1: 54, 2: 74, 3: 48, 4: 19}
- Hot (all-time): [45, 10, 32, 36, 50, 55, 20, 41, 42, 59]
- Cold (all-time): [56, 53, 4, 51, 78, 68, 40, 28, 70, 19]

**Walk-forward backtest** (last 178 draws, avg main-number hits per draw)

| Picker | Avg hits | z vs random | Hit distribution 0..k |
|---|---|---|---|
| Random expectation | 0.2000 | - | - |
| Model 'Top scores' | 0.1742 | -0.81 | [147, 31, 0, 0, 0] |
| Frequency-only top-k | 0.1910 | -0.28 | [146, 30, 2, 0, 0] |
| Recency-only (30 draws) | 0.1854 | -0.46 | [146, 31, 1, 0, 0] |

**Next draw** #4596 on 2026-10-28:

- Top scores: H [32, 36, 45, 73] (score 0.8423)
- Hot streak: G [3, 21, 35, 74] (score 0.5299)
- Overdue hunter: I [13, 27, 46, 58] (score 0.4501)
- Balanced blend: N [6, 42, 49, 60] (score 0.5517)
- Wildcard: Y [17, 18, 31, 71] (score 0.3483)

## Ada Kotipathi (`ada-kotipathi`, DLB)

- Draws: **1903** (#1240 2021-04-01 .. #3153 2026-10-27)
- Format: letter + 4 numbers, observed range 1..77 (configured 1..80; out-of-range values: 0)
- Bonus: none
- Number uniformity: chi2 = 427.7 (df 79), p ~ 0.000 (deviation; check data)
- Letter uniformity: chi2 = 19.1 (df 25), p ~ 0.791; 26 distinct letters
- Sum of numbers: mean 155.0, IQR 125..186
- Odd count distribution: {0: 106, 1: 464, 2: 739, 3: 479, 4: 115}
- Hot (all-time): [9, 20, 57, 38, 13, 29, 75, 26, 60, 11]
- Cold (all-time): [80, 79, 78, 77, 64, 23, 24, 63, 15, 47]

**Walk-forward backtest** (last 200 draws, avg main-number hits per draw)

| Picker | Avg hits | z vs random | Hit distribution 0..k |
|---|---|---|---|
| Random expectation | 0.2000 | - | - |
| Model 'Top scores' | 0.1850 | -0.50 | [163, 37, 0, 0, 0] |
| Frequency-only top-k | 0.2700 | +2.32 | [148, 50, 2, 0, 0] |
| Recency-only (30 draws) | 0.2450 | +1.49 | [154, 43, 3, 0, 0] |

**Next draw** #3154 on 2026-10-28:

- Top scores: C [14, 50, 57, 70] (score 0.9277)
- Hot streak: R [17, 21, 50, 67] (score 0.7159)
- Overdue hunter: Z [23, 24, 35, 77] (score 0.3869)
- Balanced blend: S [14, 44, 53, 67] (score 0.5893)
- Wildcard: G [5, 24, 34, 69] (score 0.6007)

## Super Ball (`super-ball`, DLB)

- Draws: **1903** (#1414 2021-04-01 .. #3327 2026-10-27)
- Format: letter + 4 numbers, observed range 1..80 (configured 1..80; out-of-range values: 0)
- Bonus: none
- Number uniformity: chi2 = 238.3 (df 79), p ~ 0.000 (deviation; check data)
- Letter uniformity: chi2 = 27.2 (df 25), p ~ 0.348; 26 distinct letters
- Sum of numbers: mean 157.0, IQR 125..188
- Odd count distribution: {0: 108, 1: 468, 2: 720, 3: 487, 4: 120}
- Hot (all-time): [45, 9, 3, 29, 52, 74, 43, 8, 62, 57]
- Cold (all-time): [78, 80, 79, 50, 77, 69, 40, 41, 55, 10]

**Walk-forward backtest** (last 200 draws, avg main-number hits per draw)

| Picker | Avg hits | z vs random | Hit distribution 0..k |
|---|---|---|---|
| Random expectation | 0.2000 | - | - |
| Model 'Top scores' | 0.1950 | -0.17 | [163, 35, 2, 0, 0] |
| Frequency-only top-k | 0.1650 | -1.16 | [169, 29, 2, 0, 0] |
| Recency-only (30 draws) | 0.2050 | +0.17 | [162, 35, 3, 0, 0] |

**Next draw** #3328 on 2026-10-28:

- Top scores: G [3, 18, 42, 48] (score 0.8606)
- Hot streak: P [18, 21, 58, 69] (score 0.546)
- Overdue hunter: D [4, 16, 72, 75] (score 0.5321)
- Balanced blend: M [29, 30, 42, 48] (score 0.7386)
- Wildcard: Z [2, 45, 48, 58] (score 0.6997)

## Shanida (`shanida`, DLB)

- Draws: **1909** (#3570 2021-04-01 .. #5488 2026-10-27)
- Format: letter + 4 numbers, observed range 1..80 (configured 1..80; out-of-range values: 0)
- Bonus: none
- Number uniformity: chi2 = 272.1 (df 79), p ~ 0.000 (deviation; check data)
- Letter uniformity: chi2 = 39.7 (df 25), p ~ 0.031; 26 distinct letters
- Sum of numbers: mean 154.7, IQR 125..185
- Odd count distribution: {0: 104, 1: 497, 2: 744, 3: 463, 4: 101}
- Hot (all-time): [28, 3, 26, 45, 14, 61, 12, 67, 65, 13]
- Cold (all-time): [76, 78, 79, 77, 80, 75, 55, 58, 1, 47]

**Walk-forward backtest** (last 200 draws, avg main-number hits per draw)

| Picker | Avg hits | z vs random | Hit distribution 0..k |
|---|---|---|---|
| Random expectation | 0.2000 | - | - |
| Model 'Top scores' | 0.2000 | +0.00 | [161, 38, 1, 0, 0] |
| Frequency-only top-k | 0.1850 | -0.50 | [165, 33, 2, 0, 0] |
| Recency-only (30 draws) | 0.2500 | +1.65 | [154, 42, 4, 0, 0] |

**Next draw** #5489 on 2026-10-28:

- Top scores: F [13, 14, 26, 67] (score 0.9388)
- Hot streak: H [9, 21, 50, 53] (score 0.6795)
- Overdue hunter: N [37, 39, 40, 49] (score 0.5782)
- Balanced blend: U [6, 26, 49, 70] (score 0.7125)
- Wildcard: I [12, 31, 33, 70] (score 0.6229)

## Kapruka (`kapruka`, DLB)

- Draws: **1790** (#710 2021-04-02 .. #2503 2026-10-27)
- Format: letter + 4 numbers, observed range 1..80 (configured 1..80; out-of-range values: 0)
- Bonus (Bonus Number): 1719 draws, observed range 1..40
- Number uniformity: chi2 = 440.8 (df 79), p ~ 0.000 (deviation; check data)
- Letter uniformity: chi2 = 25.6 (df 25), p ~ 0.432; 26 distinct letters
- Sum of numbers: mean 152.6, IQR 122..182
- Odd count distribution: {0: 122, 1: 399, 2: 709, 3: 456, 4: 104}
- Hot (all-time): [45, 28, 21, 42, 6, 40, 10, 11, 52, 9]
- Cold (all-time): [80, 78, 79, 76, 77, 7, 54, 26, 3, 59]

**Walk-forward backtest** (last 200 draws, avg main-number hits per draw)

| Picker | Avg hits | z vs random | Hit distribution 0..k |
|---|---|---|---|
| Random expectation | 0.2000 | - | - |
| Model 'Top scores' | 0.2050 | +0.17 | [164, 31, 5, 0, 0] |
| Frequency-only top-k | 0.2000 | +0.00 | [165, 30, 5, 0, 0] |
| Recency-only (30 draws) | 0.2450 | +1.49 | [154, 43, 3, 0, 0] |

**Next draw** #2504 on 2026-10-28:

- Top scores: S [12, 16, 21, 65] + bonus 30 (score 0.8922)
- Hot streak: S [23, 25, 41, 42] + bonus 35 (score 0.5936)
- Overdue hunter: R [6, 34, 68, 69] + bonus 10 (score 0.6673)
- Balanced blend: J [11, 32, 43, 52] + bonus 30 (score 0.5562)
- Wildcard: A [9, 29, 41, 70] + bonus 5 (score 0.4433)
