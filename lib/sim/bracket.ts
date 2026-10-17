/**
 * Playoff bracket replay on a historical field.
 *
 * The field, first-round matchups, series lengths (best-of-5 or best-of-7) and home-court patterns come from the real
 * postseason (1996-97 to 2025-26). Home court for any series goes to the team with the better regular-season record;
 * that rule held in all 450 real series (27 had equal records). Two teams that really met keep their real host. For a new
 * matchup between teams with equal records: the season series decides when two real teams have an uneven one (it matched
 * the real host in 17 of 18 such cases); otherwise a labelled simulation assumption applies (point differential by default,
 * or the user's choice). Point differential is never described as an official tiebreak. Seeds are for display only: seeds and
 * home court are not the same thing. The 2020 restart was
 * played at one site, so every game there is neutral. A custom lineup takes the place of one team and inherits that team's
 * slot, regular-season record and host status. The play-in tournament is not simulated: the field starts as it was.
 */
import { makeRng, normCdf } from "./math";
import { tick } from "./game";
import type { Bracket, BracketSeries, ModelFile } from "./types";

export interface BracketRatings {
  /** team abbreviation -> {rating, tau}; the replaced team's entry holds the custom lineup */
  [abbr: string]: { rating: number; tau: number };
}

export interface BracketResult {
  teams: string[];
  /** reach[team][r] = chance of playing in round r+1 (r = 0..3) */
  reach: Record<string, number[]>;
  champion: Record<string, number>;
  n: number;
}

/** What to do when two teams' records are equal and the season series doesn't settle it (a simulation assumption, not an official rule). */
export type TieRule = "net" | "mine" | "theirs";
export interface HomeOpts { tie?: TieRule; /** the team the custom lineup replaces */ mine?: string | null }

/**
 * Who hosts game 1 between x and y:
 *  1. teams that really met keep their real host;
 *  2. the better regular-season record;
 *  3. equal records between two real teams: the season series, if it isn't even;
 *  4. otherwise a labelled assumption: `tie` ("net" = better point differential, "mine" = the custom lineup, "theirs" = its opponent).
 * A custom lineup never played the real teams, so step 3 never applies to it.
 */
export function homeCourt(b: Bracket, _s: BracketSeries, x: string, y: string, opts: HomeOpts = {}): string {
  const histHost = b.series.find((q) => (q.hc === x && q.other === y) || (q.hc === y && q.other === x));
  if (histHost) return histHost.hc;
  const tx = b.teams[x], ty = b.teams[y];
  const px = tx.w / (tx.w + tx.l), py = ty.w / (ty.w + ty.l);
  if (px !== py) return px > py ? x : y;
  const mine = opts.mine ?? null;
  if (x !== mine && y !== mine) {
    const [lo, hi] = x < y ? [x, y] : [y, x];
    const h = b.tieH2H?.[`${lo}|${hi}`];
    if (h && h[0] !== h[1]) return h[0] > h[1] ? lo : hi;
  }
  const tie = opts.tie ?? "net";
  if (mine && (x === mine || y === mine)) {
    if (tie === "mine") return mine;
    if (tie === "theirs") return x === mine ? y : x;
  }
  return tx.mov >= ty.mov ? x : y;
}

/** Game-by-game venue letters for a series from the home-court team's side; "N" everywhere at a neutral site. */
export function venuePattern(b: Bracket, s: BracketSeries): string {
  return b.neutral || s.neutral ? "N".repeat(s.pattern.length) : s.pattern;
}

export async function replayBracket(
  model: ModelFile,
  bracket: Bracket,
  ratings: BracketRatings,
  opts: { n: number; seed: number; tie?: TieRule; mine?: string | null; progress?: (f: number) => void; cancelled?: () => boolean; yieldNow?: () => Promise<void> }
): Promise<BracketResult | null> {
  const teams = Object.keys(bracket.teams).sort();
  const rng = makeRng(opts.seed);
  const g = model.game.playoff;
  const reach: Record<string, number[]> = Object.fromEntries(teams.map((t) => [t, [0, 0, 0, 0]]));
  const champion: Record<string, number> = Object.fromEntries(teams.map((t) => [t, 0]));
  const hcCache = new Map<string, string>();
  for (let sim = 0; sim < opts.n; sim++) {
    if (sim % 250 === 0) {
      if (opts.cancelled?.()) return null;
      opts.progress?.(sim / opts.n);
      if (opts.yieldNow) await opts.yieldNow();
    }
    const eff: Record<string, number> = {};
    for (const t of teams) eff[t] = ratings[t].rating + ratings[t].tau * rng.normal();
    const winners: Record<string, string> = {};
    for (const s of bracket.series) {
      const a = s.feeders ? winners[s.feeders[0]] : s.hc;
      const b = s.feeders ? winners[s.feeders[1]] : s.other;
      reach[a][s.round - 1]++;
      reach[b][s.round - 1]++;
      const key = `${s.id}|${a}|${b}`;
      let hc = hcCache.get(key);
      if (hc === undefined) { hc = homeCourt(bracket, s, a, b, { tie: opts.tie, mine: opts.mine }); hcCache.set(key, hc); }
      const ot = hc === a ? b : a;
      const gap = eff[hc] - eff[ot];
      let wh = 0, wo = 0;
      for (const c of venuePattern(bracket, s)) {
        if (wh === s.need || wo === s.need) break;
        const h = c === "H" ? g.home : c === "A" ? -g.home : 0;
        if (rng.next() < normCdf(g.beta * gap + h)) wh++; else wo++;
      }
      winners[s.id] = wh === s.need ? hc : ot;
    }
    champion[winners[bracket.series[bracket.series.length - 1].id]]++;
  }
  opts.progress?.(1);
  for (const t of teams) {
    reach[t] = reach[t].map((v) => v / opts.n);
    champion[t] /= opts.n;
  }
  return { teams, reach, champion, n: opts.n };
}

/** One series of a single simulated bracket. */
export interface SampleSeries {
  id: string; round: number; need: number;
  /** teams in the order the home-court team first, the other second */
  hc: string; other: string;
  winner: string;
  winsHc: number; winsOther: number;
}
export interface SampleBracket { series: SampleSeries[]; champion: string }

/** Salt that gives the sample bracket its own random stream (the probability runs never see it). */
const SAMPLE_SALT = 0x9e3779b9;

/**
 * Plays ONE bracket from the same field, ratings and home-court rules as replayBracket, so the round-by-round view
 * has a concrete example to show. It draws from a separate random stream (the seed mixed with SAMPLE_SALT), which
 * means it can never change the advancement probabilities, and the same seed always gives the same sample.
 */
export function sampleBracket(
  model: ModelFile,
  bracket: Bracket,
  ratings: BracketRatings,
  opts: { seed: number; tie?: TieRule; mine?: string | null },
): SampleBracket {
  const teams = Object.keys(bracket.teams).sort();
  const rng = makeRng((opts.seed ^ SAMPLE_SALT) >>> 0);
  const g = model.game.playoff;
  const eff: Record<string, number> = {};
  for (const t of teams) eff[t] = ratings[t].rating + ratings[t].tau * rng.normal();
  const winners: Record<string, string> = {};
  const out: SampleSeries[] = [];
  for (const s of bracket.series) {
    const a = s.feeders ? winners[s.feeders[0]] : s.hc;
    const b = s.feeders ? winners[s.feeders[1]] : s.other;
    const hc = homeCourt(bracket, s, a, b, { tie: opts.tie, mine: opts.mine });
    const ot = hc === a ? b : a;
    const gap = eff[hc] - eff[ot];
    let wh = 0, wo = 0;
    for (const c of venuePattern(bracket, s)) {
      if (wh === s.need || wo === s.need) break;
      const h = c === "H" ? g.home : c === "A" ? -g.home : 0;
      if (rng.next() < normCdf(g.beta * gap + h)) wh++; else wo++;
    }
    const winner = wh === s.need ? hc : ot;
    winners[s.id] = winner;
    out.push({ id: s.id, round: s.round, need: s.need, hc, other: ot, winner, winsHc: wh, winsOther: wo });
  }
  return { series: out, champion: winners[bracket.series[bracket.series.length - 1].id] };
}

export interface PathStep {
  seriesId: string;
  round: number;
  opponent: string;
  need: number;
  /** pattern from the custom lineup's point of view */
  pattern: string;
  customHasHomeCourt: boolean;
}

/** The replaced team's real series, in order, from the custom lineup's point of view. */
export function historicalPath(bracket: Bracket, replaced: string): PathStep[] {
  const steps: PathStep[] = [];
  for (const s of bracket.series) {
    if (s.hc !== replaced && s.other !== replaced) continue;
    const has = s.hc === replaced;
    const base = venuePattern(bracket, s);
    const pattern = has ? base : base.replace(/[HA]/g, (c) => (c === "H" ? "a" : "h")).toUpperCase();
    steps.push({ seriesId: s.id, round: s.round, opponent: has ? s.other : s.hc, need: s.need, pattern, customHasHomeCourt: has });
  }
  return steps;
}

export interface PathResult {
  steps: { step: PathStep; pReach: number; pWinGivenReach: number }[];
  pWinAll: number;
  n: number;
}

/** Play the replaced team's actual opponents in order. Not a bracket simulation. */
export async function simulatePath(
  model: ModelFile,
  path: PathStep[],
  custom: { rating: number; tau: number },
  opponents: Record<string, { rating: number; tau: number }>,
  opts: { n: number; seed: number; progress?: (f: number) => void; cancelled?: () => boolean; yieldNow?: () => Promise<void> }
): Promise<PathResult | null> {
  const rng = makeRng(opts.seed);
  const g = model.game.playoff;
  const reached = Array(path.length).fill(0);
  const won = Array(path.length).fill(0);
  for (let sim = 0; sim < opts.n; sim++) {
    if (sim % 500 === 0) {
      if (opts.cancelled?.()) return null;
      opts.progress?.(sim / opts.n);
      if (opts.yieldNow) await opts.yieldNow();
    }
    const mine = custom.rating + custom.tau * rng.normal();
    for (let i = 0; i < path.length; i++) {
      reached[i]++;
      const o = opponents[path[i].opponent];
      const gap = mine - (o.rating + o.tau * rng.normal());
      let a = 0, b = 0;
      for (const c of path[i].pattern) {
        if (a === path[i].need || b === path[i].need) break;
        const h = c === "H" ? g.home : c === "A" ? -g.home : 0;
        if (rng.next() < normCdf(g.beta * gap + h)) a++; else b++;
      }
      if (a === path[i].need) won[i]++; else break;
    }
  }
  opts.progress?.(1);
  return {
    steps: path.map((step, i) => ({ step, pReach: reached[i] / opts.n, pWinGivenReach: reached[i] ? won[i] / reached[i] : 0 })),
    pWinAll: won[path.length - 1] / opts.n,
    n: opts.n,
  };
}

export { tick };
