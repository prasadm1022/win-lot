// SPDX-License-Identifier: Apache-2.0
// Calendar fit of a lottery's own jackpot dates (docs/MODEL-V2.md section 2.7 (a) and (b)): angles of the a-priori
// features (moon phase, day of month, weekday), 7-day de-clustering, the bias-corrected von Mises concentration,
// Rayleigh p-values with Holm, the calendar-similarity weight of a draw date, and plain-language peak labels.
// Nothing is selected on p-values: every feature is refitted at every walk-forward step and switches itself off
// (kappa = 0) when the dates show no concentration.

import { V2_CONSTANTS } from "./constants";
import { cmp } from "./evidence";

export type CalendarFeatureName = (typeof V2_CONSTANTS.CAL_FEATURES)[number];

const DAY_MS = 86_400_000;
const TWO_PI = 2 * Math.PI;
const MOON_EPOCH_DAYS = Date.parse(V2_CONSTANTS.MOON_EPOCH) / DAY_MS;
/** Mean month length (days), used only to turn a day-of-month angle back into a day for the peak label. */
const MEAN_MONTH = 365.2425 / 12;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Days since 1970-01-01 at 12:00 UTC of an ISO date (the moon phase is evaluated at noon UTC). */
export function noonDay(iso: string): number {
  return Date.parse(`${iso}T12:00:00Z`) / DAY_MS;
}

/** Mean-synodic moon phase in [0, 1): 0 = new moon, 0.5 = full moon. Error under 1 day; no Poya table needed. */
export function moonPhase(iso: string): number {
  return ((((noonDay(iso) - MOON_EPOCH_DAYS) / V2_CONSTANTS.SYNODIC) % 1) + 1) % 1;
}

function featureAngle(feature: CalendarFeatureName, iso: string): number {
  switch (feature) {
    case "moonPhase":
      return TWO_PI * moonPhase(iso);
    case "dayOfMonth": {
      const y = Number(iso.slice(0, 4));
      const m = Number(iso.slice(5, 7));
      const d = Number(iso.slice(8, 10));
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return (TWO_PI * (d - 0.5)) / daysInMonth;
    }
    case "weekday":
      return (TWO_PI * new Date(`${iso}T00:00:00Z`).getUTCDay()) / 7; // 0 = Sunday
  }
}

/** Angles of a date for every feature, in V2_CONSTANTS.CAL_FEATURES order. */
export function calendarAngles(iso: string): number[] {
  return V2_CONSTANTS.CAL_FEATURES.map((f) => featureAngle(f, iso));
}

/**
 * De-clustering in fixed windows: the earliest date (ascending) not yet in a cluster starts one, and the cluster
 * holds every later date at most DECLUSTER_DAYS after that FIRST date, so no cluster spans more than DECLUSTER_DAYS
 * days (a chain of weekly wins is several calendar positions, not one). Each date weighs 1 / |cluster| in the
 * calendar fit, so every cluster weighs 1 in total (each date still counts as one full date in the evidence weights).
 */
export function declusterWeights(sortedDates: readonly string[]): { weights: number[]; clusters: number } {
  const weights = new Array<number>(sortedDates.length).fill(1);
  let clusters = 0;
  let s = 0;
  for (let i = 1; i <= sortedDates.length; i++) {
    if (i === sortedDates.length || noonDay(sortedDates[i]) - noonDay(sortedDates[s]) > V2_CONSTANTS.DECLUSTER_DAYS) {
      for (let q = s; q < i; q++) weights[q] = 1 / (i - s);
      clusters++;
      s = i;
    }
  }
  return { weights, clusters };
}

/** Inverse of A1(kappa) = I1/I0, Best-Fisher approximation (r in [0, 1]; r >= 1 means unbounded). */
export function a1inv(r: number): number {
  if (r >= 1) return Infinity;
  if (r < 0.53) return 2 * r + r ** 3 + (5 * r ** 5) / 6;
  if (r < 0.85) return -0.4 + 1.39 * r + 0.43 / (1 - r);
  return 1 / (r ** 3 - 4 * r * r + 3 * r);
}

/** Rayleigh test p-value for n (effective) angles with mean resultant length R, clamped to [0, 1]. */
export function rayleighP(n: number, R: number): number {
  const Z = n * R * R;
  const p =
    Math.exp(-Z) *
    (1 + (2 * Z - Z * Z) / (4 * n) - (24 * Z - 132 * Z * Z + 76 * Z ** 3 - 9 * Z ** 4) / (288 * n * n));
  return Math.min(1, Math.max(0, p));
}

/** Holm step-down adjusted p-values (monotone, capped at 1), in the input order. */
export function holmAdjust(ps: readonly number[]): number[] {
  const m = ps.length;
  const order = ps.map((_, i) => i).sort((a, b) => ps[a] - ps[b] || a - b);
  const out = new Array<number>(m).fill(1);
  let running = 0;
  order.forEach((i, rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * ps[i]));
    out[i] = running;
  });
  return out;
}

export interface FeatureFit {
  feature: CalendarFeatureName;
  /** Weighted mean resultant length R_f. */
  resultant: number;
  /** Mean direction mu_f (radians). */
  mean: number;
  /** von Mises concentration from the bias-corrected R, capped at KAPPA_MAX; 0 = switched off. */
  kappa: number;
  rayleighP: number;
  holmP: number;
}

export interface CalendarFit {
  features: FeatureFit[]; // V2_CONSTANTS.CAL_FEATURES order
  /** Effective number of independent dates: each de-clustered cluster counts as one, n_eff = W = sum w = clusters. */
  nEff: number;
  clusters: number;
  dates: number;
}

/** Fit every calendar feature on the given jackpot dates (own, usable dates only). */
export function fitCalendar(dates: readonly string[]): CalendarFit {
  const sorted = [...dates].sort(cmp);
  const { weights, clusters } = declusterWeights(sorted);
  let W = 0;
  for (const w of weights) W += w;
  // Effective number of independent dates (spec 2.7 a): dates of one cluster share one calendar position, so each
  // cluster counts as ONE date, n_eff = W = sum w_j = the number of clusters (the exact integer, not the float sum).
  // n_eff is used for the bias-corrected resultant length, the Rayleigh p-value and the silence rule n_eff <= 1:
  // a single cluster (n_eff = 1) can fit nothing (kappa = 0, Rayleigh p = 1).
  const nEff = clusters;
  const angles = sorted.map(calendarAngles);
  const fits = V2_CONSTANTS.CAL_FEATURES.map((feature, f) => {
    let C = 0;
    let S = 0;
    angles.forEach((a, i) => {
      C += weights[i] * Math.cos(a[f]);
      S += weights[i] * Math.sin(a[f]);
    });
    const resultant = W > 0 ? Math.min(1, Math.hypot(C, S) / W) : 0;
    const rc2 = nEff > 1 ? (nEff * resultant * resultant - 1) / (nEff - 1) : 0;
    return {
      feature,
      resultant,
      mean: Math.atan2(S, C),
      kappa: rc2 > 0 ? Math.min(V2_CONSTANTS.KAPPA_MAX, a1inv(Math.sqrt(rc2))) : 0,
      rayleighP: nEff > 1 ? rayleighP(nEff, resultant) : 1,
      holmP: 1,
    };
  });
  const holm = holmAdjust(fits.map((x) => x.rayleighP));
  fits.forEach((x, f) => (x.holmP = holm[f]));
  return { features: fits, nEff, clusters, dates: sorted.length };
}

/** True when the fit can move anything: at least one feature has kappa > 0. */
export function calendarActive(fit: CalendarFit): boolean {
  return fit.features.some((f) => f.kappa > 0);
}

/**
 * Calendar similarity of a draw date to the jackpot dates, rho = exp( sum_f kappa_f (cos(angle_f - mu_f) - 1) ) in
 * (0, 1]. `angles` are calendarAngles() of the draw date. Switched-off features (kappa = 0) contribute nothing.
 */
export function calendarWeight(angles: ArrayLike<number>, fit: CalendarFit): number {
  let s = 0;
  fit.features.forEach((f, q) => {
    if (f.kappa > 0) s += f.kappa * (Math.cos(angles[q] - f.mean) - 1);
  });
  return Math.exp(s);
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function daysText(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

/** Plain-language peak of a fitted feature, e.g. "about 2 days before the full moon"; "none" when switched off. */
export function peakLabel(fit: FeatureFit): string {
  if (!(fit.kappa > 0)) return "none";
  const frac = ((fit.mean / TWO_PI) % 1 + 1) % 1;
  switch (fit.feature) {
    case "moonPhase": {
      if (Math.abs(frac - 0.5) <= 0.25) {
        const d = (frac - 0.5) * V2_CONSTANTS.SYNODIC;
        const n = Math.round(Math.abs(d));
        return n === 0 ? "at the full moon" : `about ${daysText(n)} ${d < 0 ? "before" : "after"} the full moon`;
      }
      const d = (frac < 0.5 ? frac : frac - 1) * V2_CONSTANTS.SYNODIC;
      const n = Math.round(Math.abs(d));
      return n === 0 ? "at the new moon" : `about ${daysText(n)} ${d < 0 ? "before" : "after"} the new moon`;
    }
    case "dayOfMonth": {
      const day = frac * MEAN_MONTH + 0.5;
      if (day >= 29.5 || day < 1.5) return "around the turn of the month";
      return `around the ${ordinal(Math.round(day))}`;
    }
    case "weekday":
      return `around ${WEEKDAYS[Math.round(frac * 7) % 7]}`;
  }
}
