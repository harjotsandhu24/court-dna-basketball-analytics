/**
 * Game and series probability. A game's chance comes from the gap in team net rating (points per 100
 * possessions) plus home court: P(home wins) = Phi(beta * gap + home). Rating gaps are only known up to a model
 * error (tau), which is shared by every game in a series, so a series is computed by averaging over that error
 * (a fixed grid of quantiles, so results are exactly repeatable) while game luck is handled exactly.
 */
import { makeRng, normCdf, normInv } from "./math";
import type { Rng } from "./math";
import type { ModelFile } from "./types";

export type Venue = "H" | "A" | "N";
export type GameKind = "regular" | "playoff";

export function gameParams(model: ModelFile, kind: GameKind) {
  return kind === "playoff" ? model.game.playoff : model.game.regular;
}

/** Chance the first-named team wins, given the true rating gap (first minus second) and where it plays. */
export function pGame(model: ModelFile, kind: GameKind, gap: number, venue: Venue): number {
  const g = gameParams(model, kind);
  const h = venue === "H" ? g.home : venue === "A" ? -g.home : 0;
  return normCdf(g.beta * gap + h);
}

export function flipPattern(p: string): string {
  return p.replace(/[HA]/g, (c) => (c === "H" ? "a" : "h")).toUpperCase();
}

/** Exact chance team A wins a series (and the games-played distribution) for fixed per-game win chances. */
export function seriesDp(pA: number[], need: number): { pA: number; lenA: number[]; lenB: number[] } {
  // state: [winsA][winsB] probability; games are played in order until someone reaches `need`
  const maxG = need * 2 - 1;
  let cur: number[][] = Array.from({ length: need + 1 }, () => Array(need + 1).fill(0));
  cur[0][0] = 1;
  const lenA = Array(maxG + 1).fill(0);
  const lenB = Array(maxG + 1).fill(0);
  let pWin = 0;
  for (let g = 0; g < maxG; g++) {
    const p = pA[Math.min(g, pA.length - 1)];
    const nxt: number[][] = Array.from({ length: need + 1 }, () => Array(need + 1).fill(0));
    for (let a = 0; a < need; a++) {
      for (let b = 0; b < need; b++) {
        const m = cur[a][b];
        if (m === 0) continue;
        // A wins this game
        if (a + 1 === need) { pWin += m * p; lenA[g + 1] += m * p; } else nxt[a + 1][b] += m * p;
        if (b + 1 === need) { lenB[g + 1] += m * (1 - p); } else nxt[a][b + 1] += m * (1 - p);
      }
    }
    cur = nxt;
  }
  return { pA: pWin, lenA, lenB };
}

export interface SeriesInput {
  ratingA: number;
  ratingB: number;
  tauA: number;
  tauB: number;
  /** venue of each game from team A's point of view, e.g. "HHAAHAH"; "N" for neutral */
  pattern: string;
  need: number;
  kind?: GameKind;
}

export interface SeriesExact {
  pA: number;
  /** model-uncertainty range of the series chance (10th to 90th percentile of the strength error) */
  pALow: number;
  pAHigh: number;
  /** probability the series ends in g games with A (resp. B) winning, index = games */
  lenA: number[];
  lenB: number[];
  /** probability the favourite per ratings wins if the rating gap is exact (no model error) */
  pAExact: number;
}

const GRID = 200;

export function seriesExact(model: ModelFile, s: SeriesInput): SeriesExact {
  const kind = s.kind ?? "playoff";
  const maxG = s.need * 2 - 1;
  const gap = s.ratingA - s.ratingB;
  const sd = Math.sqrt(s.tauA * s.tauA + s.tauB * s.tauB);
  const pat = s.pattern.slice(0, maxG);
  const lenA = Array(maxG + 1).fill(0);
  const lenB = Array(maxG + 1).fill(0);
  const probs: number[] = [];
  let total = 0;
  for (let i = 0; i < GRID; i++) {
    const e = sd * normInv((i + 0.5) / GRID);
    const pg = [...pat].map((c) => pGame(model, kind, gap + e, c as Venue));
    const r = seriesDp(pg, s.need);
    total += r.pA;
    probs.push(r.pA);
    for (let g = 0; g <= maxG; g++) { lenA[g] += r.lenA[g] / GRID; lenB[g] += r.lenB[g] / GRID; }
  }
  probs.sort((a, b) => a - b);
  const exact = seriesDp([...pat].map((c) => pGame(model, kind, gap, c as Venue)), s.need).pA;
  return {
    pA: total / GRID, pALow: probs[Math.floor(GRID * 0.1)], pAHigh: probs[Math.floor(GRID * 0.9)],
    lenA, lenB, pAExact: exact,
  };
}

/** One random series, for the "example series" list. Returns [winsA, winsB]. */
export function sampleSeries(model: ModelFile, s: SeriesInput, rng: Rng): { winsA: number; winsB: number } {
  const kind = s.kind ?? "playoff";
  const gap = s.ratingA - s.ratingB + s.tauA * rng.normal() - s.tauB * rng.normal();
  let a = 0, b = 0;
  for (const c of s.pattern.slice(0, s.need * 2 - 1)) {
    if (a === s.need || b === s.need) break;
    if (rng.next() < pGame(model, kind, gap, c as Venue)) a++; else b++;
  }
  return { winsA: a, winsB: b };
}

export function homePatternFor(pattern: string, aIsHomeCourt: boolean): string {
  return aIsHomeCourt ? pattern : flipPattern(pattern);
}

// ---------------------------------------------------------------------------------------------
// 82-game season
// ---------------------------------------------------------------------------------------------
export interface SeasonInput {
  rating: number;
  tau: number;
  oppRatings: number[];
  tauOpp: number;
  n: number;
  seed: number;
  games?: number;
}

export interface SeasonResult {
  mean: number;
  sd: number;
  lo: number;
  hi: number;
  /** probability of exactly w wins, w = 0..games */
  dist: number[];
  /** same seasons if the ratings were exactly right: game luck alone (10th and 90th percentile) */
  luck: { lo: number; hi: number; mean: number };
  n: number;
}

export const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export async function simulateSeason(
  model: ModelFile,
  s: SeasonInput,
  hooks: { progress?: (f: number) => void; cancelled?: () => boolean; yieldNow?: () => Promise<void> } = {}
): Promise<SeasonResult | null> {
  const games = s.games ?? 82;
  const rng = makeRng(s.seed);
  const m = s.oppRatings.length;
  const reg = model.game.regular;
  const counts = Array(games + 1).fill(0);
  const luckCounts = Array(games + 1).fill(0);
  let sum = 0, sum2 = 0, luckSum = 0;
  const chunk = 250;
  for (let i = 0; i < s.n; i++) {
    if (i % chunk === 0) {
      if (hooks.cancelled?.()) return null;
      hooks.progress?.(i / s.n);
      if (hooks.yieldNow) await hooks.yieldNow();
    }
    const eps = s.tau * rng.normal();
    const oe = s.oppRatings.map((r) => r + s.tauOpp * rng.normal());
    let wins = 0, luckWins = 0;
    for (let k = 0; k < games; k++) {
      let opp: number, home: boolean;
      if (k < 2 * m) { opp = k % m; home = k < m; }
      else { opp = Math.floor(rng.next() * m); home = (k - 2 * m) % 2 === 0; }
      const h = home ? reg.home : -reg.home;
      const u = rng.next();
      if (u < normCdf(reg.beta * (s.rating + eps - oe[opp]) + h)) wins++;
      // game luck alone: same dice, but the ratings (ours and the opponents') are taken as exactly right
      if (u < normCdf(reg.beta * (s.rating - s.oppRatings[opp]) + h)) luckWins++;
    }
    counts[wins]++;
    luckCounts[luckWins]++;
    luckSum += luckWins;
    sum += wins;
    sum2 += wins * wins;
  }
  hooks.progress?.(1);
  const mean = sum / s.n;
  const sd = Math.sqrt(Math.max(0, sum2 / s.n - mean * mean));
  const dist = counts.map((c) => c / s.n);
  const quant = (d: number[], p: number) => { let c = 0; for (let w = 0; w <= games; w++) { c += d[w]; if (c >= p) return w; } return games; };
  const luckDist = luckCounts.map((c) => c / s.n);
  return { mean, sd, lo: quant(dist, 0.1), hi: quant(dist, 0.9), dist, luck: { lo: quant(luckDist, 0.1), hi: quant(luckDist, 0.9), mean: luckSum / s.n }, n: s.n };
}
