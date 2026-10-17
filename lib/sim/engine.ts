/**
 * Simulation entry point shared by the browser worker, the main-thread fallback and the tests.
 * Pure TypeScript: all data arrives through a DataSource.
 *
 * What the model does: it uses completed-season player performance to estimate how a hypothetical team would have done.
 * It is not a preseason forecast. Every custom-lineup result is Experimental, and a lineup that is too different from the
 * teams the model was tested on has its numbers withheld (support check, lib/sim/support.ts).
 */
import { assess, DEFENSE_NOTE, matchupFactors } from "./assess";
import type { Assessment } from "./assess";
import { historicalPath, replayBracket, sampleBracket, simulatePath } from "./bracket";
import type { BracketResult, PathResult, SampleBracket, TieRule } from "./bracket";
import { flipPattern, sampleSeries, seriesExact, simulateSeason, tick } from "./game";
import type { SeasonResult } from "./game";
import { hashString, makeRng } from "./math";
import { canonical, evaluateLineup, playerFromShard, STARTERS } from "./strength";
import type { LineupEval } from "./strength";
import { checkSupport, reasonText, SUPPORT_CAVEAT, UNSUPPORTED_MESSAGE, worst } from "./support";
import type { SupportLevel, SupportResult } from "./support";
import { evaluateTeam } from "./teams";
import type { Footing } from "./teams";
import type { BracketsFile, DataSource, LineupPick, ModelFile, SimPlayer, StatusLabel } from "./types";

export type { Footing };
export { UNSUPPORTED_MESSAGE };

/** `reveal` shows numbers for a lineup the support check withholds them for. It is part of the cache key. */
export interface SeasonReq { mode: "season"; lineup: LineupPick[]; env: number | "auto"; replace?: string | null; seed: number; n?: number; reveal?: boolean }
export type OpponentReq = { kind: "lineup"; lineup: LineupPick[] } | { kind: "team"; season: number; team: string };
export interface SeriesReq {
  mode: "series"; lineup: LineupPick[]; opponent: OpponentReq;
  homeCourt: "you" | "opponent" | "neutral"; footing: Footing; seed: number; reveal?: boolean;
}
export interface BracketReq {
  mode: "bracket"; lineup: LineupPick[]; season: number; replaced: string;
  replay: "full" | "path"; footing: Footing; seed: number; n?: number; reveal?: boolean;
  /** home court when two teams have equal records and the season series doesn't decide (a simulation assumption); default "net" */
  tie?: TieRule;
}
export type SimRequest = SeasonReq | SeriesReq | BracketReq;

export class SimError extends Error {
  constructor(public code: "NEED_FIVE" | "DUPLICATE_PLAYER" | "MISSING_PLAYER" | "UNSUPPORTED" | "DATA", message: string) {
    super(message);
  }
}

export interface Hooks {
  progress?: (fraction: number, label?: string) => void;
  cancelled?: () => boolean;
  /** how to give the browser a chance to breathe; defaults to a macrotask tick */
  yieldNow?: () => Promise<void>;
}

export interface Meta {
  cacheKey: string;
  seed: number;
  modelVersion: string;
  dataVersion: string;
  status: { label: StatusLabel; note: string };
}

/** One lineup's support check, ready to show. */
export interface SupportInfo {
  level: SupportLevel;
  reasons: string[];
  /** a lineup the check withholds numbers for, and nothing in this result shows them */
  withheld: boolean;
  /** numbers are shown although the check says not to (the person asked) */
  shownAnyway: boolean;
  message: string | null;
  caveat: string;
}

const SEED_MAX = 2 ** 32;
export const SEASON_SIMS = 3000;
export const BRACKET_SIMS = 4000;
export const PATH_SIMS = 6000;

// ------------------------------------------------------------------ helpers
export function validateLineup(lineup: LineupPick[], what = "lineup"): void {
  if (lineup.length !== STARTERS) throw new SimError("NEED_FIVE", `Pick five players for the ${what}.`);
  const ids = new Set(lineup.map((p) => p.id));
  if (ids.size !== lineup.length) throw new SimError("DUPLICATE_PLAYER", `The same player can't appear twice in the ${what}.`);
}

export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.abs(Math.floor(seed)) % SEED_MAX : 1;
}

export async function loadPlayers(ds: DataSource, model: ModelFile, lineup: LineupPick[]): Promise<SimPlayer[]> {
  const seasons = [...new Set(lineup.map((p) => p.season))];
  const shards = new Map<number, Awaited<ReturnType<DataSource["features"]>>>();
  await Promise.all(seasons.map(async (s) => shards.set(s, await ds.features(s))));
  const out: SimPlayer[] = [];
  for (const pick of lineup) {
    const p = playerFromShard(shards.get(pick.season)!, pick.id, model);
    if (!p) throw new SimError("MISSING_PLAYER", `Some stats the model needs are missing for ${pick.id} in ${seasonLabel(pick.season)}. Choose a different season for that player.`);
    out.push(p);
  }
  return canonical(out);
}

export interface EnvTeam { abbr: string; name: string; rating: number; evaluation: LineupEval }

/** Every usable real team of one season, rated with its real rotation. */
export async function loadEnvironment(ds: DataSource, model: ModelFile, season: number): Promise<{ teams: EnvTeam[]; skipped: string[] }> {
  const [shard, tf] = await Promise.all([ds.features(season), ds.teams(season)]);
  const teams: EnvTeam[] = [];
  const skipped: string[] = [];
  for (const t of tf.teams) {
    const ev = evaluateTeam(t, shard, model, "real");
    if (!ev) { skipped.push(t.abbr); continue; }
    teams.push({ abbr: t.abbr, name: t.name, rating: ev.net, evaluation: ev });
  }
  return { teams, skipped };
}

export function seasonLabel(s: number): string {
  return `${s - 1}-${String(s).slice(-2)}`;
}

/** Stable description of a request (no versions). Used to spot duplicate jobs and to build the cache key. */
export function requestKey(req: SimRequest): string {
  const picks = (l: LineupPick[]) => canonical(l).map((p) => `${p.id}@${p.season}`).join(",");
  const base = `${req.mode}|${picks(req.lineup)}`;
  let rest: string;
  if (req.mode === "season") rest = `env=${req.env}|replace=${req.replace ?? "none"}|n=${req.n ?? SEASON_SIMS}`;
  else if (req.mode === "series") {
    const o = req.opponent;
    const opp = o.kind === "lineup" ? `L:${picks(o.lineup)}` : `T:${o.season}:${o.team}`;
    rest = `opp=${opp}|hc=${req.homeCourt}|foot=${req.footing}`;
  } else rest = `season=${req.season}|replace=${req.replaced}|replay=${req.replay}|foot=${req.footing}|tie=${req.tie ?? "net"}|n=${req.n ?? BRACKET_SIMS}`;
  return `${base}|${rest}|reveal=${req.reveal ? 1 : 0}|seed=${normalizeSeed(req.seed)}`;
}

/** Cache key: players, seasons, settings, seed, data version and model version. */
export function cacheKeyFor(req: SimRequest, model: ModelFile): string {
  return `${model.modelVersion}|${model.dataVersion}|${requestKey(req)}`;
}

/** Default seed: derived from everything except the seed, so the same inputs always give the same answer. */
export function defaultSeed(req: Omit<SimRequest, "seed">): number {
  return normalizeSeed(hashString(requestKey({ ...req, seed: 0 } as SimRequest)));
}

export function shortKey(key: string): string {
  return hashString(key).toString(36);
}

const f1 = (x: number) => x.toFixed(1);

/** Plain statement of what was tested, with RMSE and MAE kept apart and real rotations kept apart from five-plus-average-bench. */
export function evidenceLines(model: ModelFile): string[] {
  const v = model.validation;
  const t = `${seasonLabel(v.testSeasons[0])} to ${seasonLabel(v.testSeasons[1])}`;
  return [
    `Real teams with their full rotations (${t}, ${v.winsReal.n} team-seasons): win-total RMSE ${f1(v.winsReal.rmse)}, mean absolute error ${f1(v.winsReal.mae)}. Predicting every team at 41 wins: RMSE ${f1(v.winsBaselineLeagueRmse)}; using last season's record: RMSE ${f1(v.priorSeason.rmse)}.`,
    `Five starters plus an average bench (what a custom lineup gets), same teams: RMSE ${f1(v.winsFive.rmse)}, mean absolute error ${f1(v.winsFive.mae)}. ${v.winsFive.rmse < v.priorSeason.fiveRmse ? "It beat" : "It did not beat"} last season's record (RMSE ${f1(v.priorSeason.rmse)}). In the first release the same kind of estimate had RMSE ${v.earlier.fiveRmse.toFixed(2)} against ${v.earlier.priorSeasonRmse.toFixed(2)} for last season's record: it did not beat that baseline either.`,
    "These are tests on teams that really played. A custom lineup is an invented combination, so it carries extra uncertainty that no test measures.",
  ];
}

export function uncertaintyLines(model: ModelFile): { luck: string; model: string; evidence: string; runs: string } {
  const v = model.validation;
  return {
    luck: "Game luck: even if every rating were exactly right, a team's wins (or a series) would still vary from run to run.",
    model: `Model uncertainty: ratings built from player stats miss real net ratings by a typical ${f1(model.tau.five)} points per 100 possessions for a starting five with an average bench (${f1(model.tau.real)} with a real rotation). It is included in the range.`,
    evidence: `On real teams (five starters plus an average bench, ${v.winsFive.n} team-seasons) the 80% range covered ${(v.winsFive.coverage80 * 100).toFixed(0)}% of actual win totals; game luck alone covered only ${(v.winsFive.coverage80_game_luck_only * 100).toFixed(0)}%. No such check exists for invented lineups, so the range may be too narrow for them.`,
    runs: "Simulating more seasons only makes the range smoother. It does not reduce the model's uncertainty.",
  };
}

function statusFor(model: ModelFile, mode: SimRequest["mode"]): Meta["status"] {
  const l = model.labels;
  if (mode === "season") {
    return l.season.five_avg_bench_validated
      ? { label: "estimate", note: "Tested on real teams. Invented combinations of players have not been tested." }
      : { label: "experimental", note: "A starting five with an average bench did not meet the accuracy bar set before testing (it did not beat last season's record). Treat the numbers as rough." };
  }
  const x = mode === "series" ? l.series : l.bracket;
  return { label: "experimental", note: x.reason ?? "Custom lineups have no test evidence." };
}

function supportInfo(model: ModelFile, r: SupportResult, players: SimPlayer[], reveal: boolean): SupportInfo {
  const withheld = r.level === "unsupported" && !reveal;
  return {
    level: r.level,
    reasons: reasonText(model, r, players),
    withheld,
    shownAnyway: r.level === "unsupported" && reveal,
    message: r.level === "unsupported" ? UNSUPPORTED_MESSAGE : null,
    caveat: SUPPORT_CAVEAT,
  };
}

/** Combine the support of several custom lineups: the weakest level decides, and every lineup's reasons are listed. */
function combine(model: ModelFile, parts: { label: string; r: SupportResult; players: SimPlayer[] }[], reveal: boolean): SupportInfo {
  let level: SupportLevel = "supported";
  const reasons: string[] = [];
  for (const p of parts) {
    level = worst(level, p.r.level);
    const lines = reasonText(model, p.r, p.players);
    reasons.push(...(parts.length > 1 ? lines.map((x) => `${p.label}: ${x}`) : lines));
  }
  const withheld = level === "unsupported" && !reveal;
  return { level, reasons, withheld, shownAnyway: level === "unsupported" && reveal, message: level === "unsupported" ? UNSUPPORTED_MESSAGE : null, caveat: SUPPORT_CAVEAT };
}

function starterMinutes(model: ModelFile): { each: number; benchTotal: number } {
  return { each: (model.params.starterShare * 240) / STARTERS, benchTotal: 240 * (1 - model.params.starterShare) };
}

export function eraNote(): string {
  return "League-relative adjustments show where each player stood against his own season's league. They can't show how an older player would have developed, trained or been coached in modern basketball.";
}

export const NOT_A_FORECAST =
  "This uses what players did over a completed season to estimate how a hypothetical team would have done. It is not a preseason forecast and does not know injuries, trades or future development.";

// ------------------------------------------------------------------ season
export interface SeasonOut {
  mode: "season";
  meta: Meta;
  env: number;
  envTeams: number;
  envSkipped: string[];
  replaced: string | null;
  support: SupportInfo;
  /** null when the support check withholds numbers */
  wins: SeasonResult | null;
  net: number | null;
  netRange: [number, number] | null;
  ortg: number | null;
  ortgRange: [number, number] | null;
  drtg: null;
  assessment: Assessment;
  defenseNote: string;
  evidence: string[];
  uncertainty: ReturnType<typeof uncertaintyLines>;
  assumptions: string[];
  eraNote: string;
  players: { id: string; season: number; usageBefore: number; usageAfter: number }[];
  usageScaleLimited: boolean;
}

export function seasonAssumptions(model: ModelFile, env: number, ev: LineupEval, opponents: number, replaced: string | null): string[] {
  const m = starterMinutes(model);
  const lim = model.params.kClip;
  return [
    `Minutes: each starter plays about ${m.each.toFixed(0)} minutes a game. The other ${m.benchTotal.toFixed(0)} of the team's 240 minutes go to an average bench (the typical 6th to 10th players of real teams).`,
    `Possessions: starters' usage is scaled by ${ev.k.toFixed(2)}× so five players share one ball like a real team (allowed range ${lim[0]}× to ${lim[1]}×). Shooting efficiency moves along the measured usage-efficiency slope when a player's workload changes.`,
    "Availability: every player is healthy and plays every game. No injuries, rest days or trades.",
    "Coaching: average. No coach, system or chemistry effect.",
    `League: the ${seasonLabel(env)} league. Opponents are that season's real teams with their real rotations (${opponents} opponents), so pace and scoring come from that league.`,
    replaced
      ? `Schedule: a balanced hypothetical schedule, not the actual ${seasonLabel(env)} schedule. Your lineup takes the place of ${replaced}, so that team is not an opponent. Each of the other ${opponents} teams is played twice (once at home, once away); the remaining games are against random opponents, half at home.`
      : `Schedule: a balanced hypothetical schedule, not the actual ${seasonLabel(env)} schedule. Your lineup is an extra team added to the league (${opponents + 1} teams), so no real team is removed. Each real team is played twice (once at home, once away); the remaining games are against random opponents, half at home.`,
    "Every stat is measured against that player's own season, then placed in the chosen league, so eras are compared by standing, not raw numbers.",
    "Positions are only for arranging the lineup. They never change a result.",
  ];
}

async function runSeason(req: SeasonReq, ds: DataSource, model: ModelFile, hooks: Hooks): Promise<SeasonOut | null> {
  validateLineup(req.lineup);
  hooks.progress?.(0.02, "Loading players");
  const players = await loadPlayers(ds, model, req.lineup);
  const env = req.env === "auto" ? Math.max(...players.map((p) => p.season)) : req.env;
  hooks.progress?.(0.1, `Loading the ${seasonLabel(env)} league`);
  const environment = await loadEnvironment(ds, model, env);
  if (hooks.cancelled?.()) return null;
  let teams = environment.teams;
  let replacedName: string | null = null;
  if (req.replace) {
    const t = teams.find((x) => x.abbr === req.replace);
    if (!t) throw new SimError("UNSUPPORTED", `${req.replace} isn't a team with usable data in ${seasonLabel(env)}.`);
    replacedName = t.name;
    teams = teams.filter((x) => x.abbr !== req.replace);
  }
  if (teams.length < 20) throw new SimError("DATA", `Not enough ${seasonLabel(env)} team data to build a league.`);
  const ev = evaluateLineup(players, null, model);
  const sup = checkSupport(model, ev.vector, ev.net, players);
  const support = supportInfo(model, sup, players, !!req.reveal);
  const key = cacheKeyFor(req, model);
  const lg = model.seasons[String(env)];
  const meta: Meta = { cacheKey: key, seed: normalizeSeed(req.seed), modelVersion: model.modelVersion, dataVersion: model.dataVersion, status: statusFor(model, "season") };
  let wins: SeasonResult | null = null;
  if (!support.withheld) {
    wins = await simulateSeason(
      model,
      { rating: ev.net, tau: model.tau.five, oppRatings: teams.map((t) => t.rating), tauOpp: model.tau.real, n: req.n ?? SEASON_SIMS, seed: normalizeSeed(req.seed) },
      { progress: (f) => hooks.progress?.(0.15 + 0.8 * f, "Simulating seasons"), cancelled: hooks.cancelled, yieldNow: hooks.yieldNow ?? tick }
    );
    if (!wins) return null;
  }
  const show = !support.withheld;
  const k = model.params.kClip;
  return {
    mode: "season", meta, env, envTeams: teams.length, envSkipped: environment.skipped, replaced: replacedName, support,
    wins,
    net: show ? ev.net : null,
    netRange: show ? [ev.net - model.tau.five, ev.net + model.tau.five] : null,
    ortg: show && model.labels.show_ortg ? lg.lgOrtg + ev.ortgRel : null,
    ortgRange: show && model.labels.show_ortg ? [lg.lgOrtg + ev.ortgRel - model.tau.ortgFive, lg.lgOrtg + ev.ortgRel + model.tau.ortgFive] : null,
    drtg: null,
    assessment: assess(model, env, ev),
    defenseNote: DEFENSE_NOTE,
    evidence: evidenceLines(model),
    uncertainty: uncertaintyLines(model),
    assumptions: seasonAssumptions(model, env, ev, teams.length, replacedName),
    eraNote: eraNote(),
    players: ev.usage.map((u) => ({ id: u.id, season: u.season, usageBefore: u.before, usageAfter: u.after })),
    usageScaleLimited: ev.k <= k[0] + 1e-9 || ev.k >= k[1] - 1e-9,
  };
}

// ------------------------------------------------------------------ series
export interface SideOut { label: string; net: number | null; tau: number; footingNote: string; evaluation?: never }
export interface SeriesOut {
  mode: "series";
  meta: Meta;
  env: number;
  support: SupportInfo;
  a: SideOut;
  b: SideOut;
  /** every number below is null / empty when the support check withholds numbers */
  pA: number | null;
  pARange: [number, number] | null;
  /** chance if the ratings were exactly right (game luck only) */
  pAExact: number | null;
  /** games -> probability, for "you win in g" and "opponent wins in g" */
  lengthA: number[] | null;
  lengthB: number[] | null;
  expectedGames: number | null;
  homeCourt: SeriesReq["homeCourt"];
  pattern: string;
  factors: { name: string; diff: number; a: string; b: string }[] | null;
  examples: { winsA: number; winsB: number }[];
  assumptions: string[];
  eraNote: string;
  evidence: string[];
  uncertainty: ReturnType<typeof uncertaintyLines>;
  opponentDescription: string;
  /** "equal": both sides use five starters plus the same average bench. "mixed": a real rotation against an average bench. */
  comparison: "equal" | "mixed";
}

async function runSeries(req: SeriesReq, ds: DataSource, model: ModelFile, hooks: Hooks): Promise<SeriesOut | null> {
  validateLineup(req.lineup, "lineup");
  if (req.opponent.kind === "lineup") validateLineup(req.opponent.lineup, "opponent lineup");
  hooks.progress?.(0.05, "Loading players");
  const mine = await loadPlayers(ds, model, req.lineup);
  const evA = evaluateLineup(mine, null, model);
  const parts: { label: string; r: SupportResult; players: SimPlayer[] }[] = [{ label: "Your lineup", r: checkSupport(model, evA.vector, evA.net, mine), players: mine }];
  let evB: LineupEval;
  let tauB = model.tau.five;
  let footNote: string;
  let oppDesc: string;
  let comparison: SeriesOut["comparison"] = "equal";
  let seasonsForEnv = mine.map((p) => p.season);
  if (req.opponent.kind === "lineup") {
    const oppPlayers = await loadPlayers(ds, model, req.opponent.lineup);
    evB = evaluateLineup(oppPlayers, null, model);
    parts.push({ label: "Opponent lineup", r: checkSupport(model, evB.vector, evB.net, oppPlayers), players: oppPlayers });
    footNote = "Both teams use their five starters plus the same average bench.";
    oppDesc = "Custom lineup";
    seasonsForEnv = seasonsForEnv.concat(oppPlayers.map((p) => p.season));
  } else {
    const opp = req.opponent;
    const [shard, tf] = await Promise.all([ds.features(opp.season), ds.teams(opp.season)]);
    const team = tf.teams.find((t) => t.abbr === opp.team);
    if (!team || !team.ok) throw new SimError("UNSUPPORTED", "That team doesn't have enough player data to simulate.");
    const e = evaluateTeam(team, shard, model, req.footing);
    if (!e) throw new SimError("UNSUPPORTED", "That team doesn't have enough player data to simulate.");
    evB = e;
    tauB = req.footing === "real" ? model.tau.real : model.tau.five;
    comparison = req.footing === "real" ? "mixed" : "equal";
    footNote = req.footing === "real"
      ? `${team.name} use their actual rotation, including their real bench. Your lineup has the average bench, so this is not an even comparison.`
      : `Both teams use their five starters (${team.name}: top five by minutes) plus the same average bench.`;
    oppDesc = `${team.name} (${seasonLabel(opp.season)})`;
    seasonsForEnv = seasonsForEnv.concat([opp.season]);
  }
  const support = combine(model, parts, !!req.reveal);
  const env = Math.max(...seasonsForEnv);
  const home = req.homeCourt;
  // seven games, 2-2-1-1-1 with the home-court team first
  const base = "HHAAHAH";
  const pattern = home === "neutral" ? "NNNNNNN" : home === "you" ? base : flipPattern(base);
  const meta: Meta = { cacheKey: cacheKeyFor(req, model), seed: normalizeSeed(req.seed), modelVersion: model.modelVersion, dataVersion: model.dataVersion, status: statusFor(model, "series") };
  const sides = {
    a: { label: "Your lineup", net: support.withheld ? null : evA.net, tau: model.tau.five, footingNote: "Five starters plus an average bench." },
    b: { label: oppDesc, net: support.withheld ? null : evB.net, tau: tauB, footingNote: footNote },
  };
  const assumptions = [
    "Seven games, first to four wins.",
    home === "neutral" ? "Neutral court: no home-court advantage in any game." : `Home court: ${home === "you" ? "your lineup" : "the opponent"} hosts games 1, 2, 5 and 7 (2-2-1-1-1).`,
    footNote,
    NOT_A_FORECAST,
    "Availability: every player is healthy and plays every game. Coaching is average.",
    "Positions are only for arranging the lineup. They never change a result.",
  ];
  const common = { mode: "series" as const, meta, env, support, ...sides, homeCourt: home, pattern, assumptions, eraNote: eraNote(), evidence: evidenceLines(model), uncertainty: uncertaintyLines(model), opponentDescription: oppDesc, comparison };
  if (support.withheld) {
    hooks.progress?.(1);
    return { ...common, pA: null, pARange: null, pAExact: null, lengthA: null, lengthB: null, expectedGames: null, factors: null, examples: [] };
  }
  const input = { ratingA: evA.net, ratingB: evB.net, tauA: model.tau.five, tauB, pattern, need: 4, kind: "playoff" as const };
  const exact = seriesExact(model, input);
  if (hooks.cancelled?.()) return null;
  const rng = makeRng(normalizeSeed(req.seed));
  const examples = Array.from({ length: 8 }, () => sampleSeries(model, input, rng));
  const expectedGames = exact.lenA.reduce((s, v, g) => s + v * g, 0) + exact.lenB.reduce((s, v, g) => s + v * g, 0);
  hooks.progress?.(1);
  return {
    ...common,
    pA: exact.pA, pARange: [exact.pALow, exact.pAHigh], pAExact: exact.pAExact,
    lengthA: exact.lenA, lengthB: exact.lenB, expectedGames,
    factors: matchupFactors(model, env, evA, evB),
    examples,
  };
}

// ------------------------------------------------------------------ bracket
export interface BracketOut {
  mode: "bracket";
  meta: Meta;
  season: number;
  replaced: string;
  replay: "full" | "path";
  footingNote: string;
  support: SupportInfo;
  /** null when the support check withholds numbers */
  full: (BracketResult & { you: { reach: number[]; champion: number } }) | null;
  /** one simulated bracket for the round-by-round view (its own random stream; not part of the probabilities) */
  sample: SampleBracket | null;
  path: (PathResult & { opponents: Record<string, string> }) | null;
  teamNames: Record<string, string>;
  seeds: Record<string, number>;
  /** "published" seeds passed every check; "reconstructed" ones are shown as bracket positions */
  seedSource: "published" | "reconstructed";
  tieNote: string;
  neutral: boolean;
  history: { replacedExit: { round: number; by: string } | null; champion: string };
  assumptions: string[];
  evidence: string[];
  uncertainty: ReturnType<typeof uncertaintyLines>;
  eraNote: string;
}

/** Plain statement of how equal records are settled, with the historical evidence for the season-series step. */
function tieNote(tie: TieRule, hr: BracketsFile["homeRule"]): string {
  const better = hr.tied_host_better_h2h ?? 0, worse = hr.tied_host_worse_h2h ?? 0;
  const evidence = better + worse > 0 ? ` (it matched the real host in ${better} of the ${better + worse} historical ties it could decide)` : "";
  const assumption = tie === "mine" ? "your lineup hosts" : tie === "theirs" ? "its opponent hosts" : "the better point differential hosts";
  return `Equal records: between two real teams the season series decides if it wasn't even${evidence}. In every other tie ${assumption}. ` +
    "That last step is a simulation assumption, not an official tiebreak, because the NBA's tiebreak rules by season weren't available.";
}

async function runBracket(req: BracketReq, ds: DataSource, model: ModelFile, hooks: Hooks): Promise<BracketOut | null> {
  validateLineup(req.lineup);
  const bf = await ds.brackets();
  const st = bf.status[String(req.season)];
  if (!st?.supported) throw new SimError("UNSUPPORTED", st?.reason ?? "This postseason isn't supported.");
  const bracket = bf.brackets[String(req.season)];
  if (!bracket.teams[req.replaced]) throw new SimError("UNSUPPORTED", "That team wasn't in this postseason.");
  hooks.progress?.(0.04, "Loading players");
  const mine = await loadPlayers(ds, model, req.lineup);
  const evMe = evaluateLineup(mine, null, model);
  const support = combine(model, [{ label: "Your lineup", r: checkSupport(model, evMe.vector, evMe.net, mine), players: mine }], !!req.reveal);
  const [shard, tf] = await Promise.all([ds.features(req.season), ds.teams(req.season)]);
  const ratings: Record<string, { rating: number; tau: number }> = {};
  for (const abbr of Object.keys(bracket.teams)) {
    const t = tf.teams.find((x) => x.abbr === abbr);
    const ev = t ? evaluateTeam(t, shard, model, req.footing) : null;
    if (!ev) throw new SimError("UNSUPPORTED", `Player data is incomplete for ${abbr}, so this field can't be simulated.`);
    ratings[abbr] = { rating: ev.net, tau: req.footing === "real" ? model.tau.real : model.tau.five };
  }
  ratings[req.replaced] = { rating: evMe.net, tau: model.tau.five };
  const teamNames = Object.fromEntries(Object.entries(bracket.teams).map(([a, t]) => [a, t.name]));
  teamNames[req.replaced] = "Your lineup";
  const footingNote = req.footing === "real"
    ? "Real teams use their actual rotations, including real benches. Your lineup has the average bench, so this is not an even comparison."
    : "Every team (yours included) uses its five starters plus the same average bench. Real teams' starters are their top five by minutes.";
  const exit = bracket.series.filter((s) => s.hc === req.replaced || s.other === req.replaced).pop();
  const history = {
    replacedExit: exit && exit.history.winner !== req.replaced ? { round: exit.round, by: exit.history.winner === exit.hc ? exit.hc : exit.other } : null,
    champion: bracket.champion,
  };
  let full: BracketOut["full"] = null;
  let sample: BracketOut["sample"] = null;
  let path: BracketOut["path"] = null;
  const hk = { cancelled: hooks.cancelled, yieldNow: hooks.yieldNow ?? tick };
  if (!support.withheld) {
    if (req.replay === "full") {
      const r = await replayBracket(model, bracket, ratings, { n: req.n ?? BRACKET_SIMS, seed: normalizeSeed(req.seed), tie: req.tie ?? "net", mine: req.replaced, progress: (f) => hooks.progress?.(0.2 + 0.78 * f, "Replaying the bracket"), ...hk });
      if (!r) return null;
      full = { ...r, you: { reach: r.reach[req.replaced], champion: r.champion[req.replaced] } };
      sample = sampleBracket(model, bracket, ratings, { seed: normalizeSeed(req.seed), tie: req.tie ?? "net", mine: req.replaced });
    } else {
      const steps = historicalPath(bracket, req.replaced);
      const opps = Object.fromEntries(steps.map((s) => [s.opponent, ratings[s.opponent]]));
      const r = await simulatePath(model, steps, ratings[req.replaced], opps, { n: PATH_SIMS, seed: normalizeSeed(req.seed), progress: (f) => hooks.progress?.(0.2 + 0.78 * f, "Playing the historical path"), ...hk });
      if (!r) return null;
      path = { ...r, opponents: Object.fromEntries(steps.map((s) => [s.opponent, bracket.teams[s.opponent].name])) };
    }
  }
  const neutral = !!bracket.neutral;
  const finals = bracket.season <= 2013 ? "2-3-2" : "2-2-1-1-1";
  return {
    mode: "bracket",
    meta: { cacheKey: cacheKeyFor(req, model), seed: normalizeSeed(req.seed), modelVersion: model.modelVersion, dataVersion: model.dataVersion, status: statusFor(model, "bracket") },
    season: req.season, replaced: req.replaced, replay: req.replay, footingNote, support, full, sample, path, teamNames,
    seeds: Object.fromEntries(Object.entries(bracket.teams).map(([a, t]) => [a, t.seed])),
    seedSource: bracket.seedSource === "published" ? "published" : "reconstructed", tieNote: tieNote(req.tie ?? "net", bf.homeRule), neutral, history,
    assumptions: [
      `The ${seasonLabel(req.season)} playoff field starts as it really did: the same ${Object.keys(bracket.teams).length} teams, first-round matchups and series lengths. The play-in tournament is not simulated.`,
      neutral
        ? "This postseason was played at one site (the 2020 restart), so every game is on a neutral court: no home advantage."
        : `Home court: the team with the better regular-season record hosts game 1. That held in every real series from 1997 to 2026, and teams that really met keep their real host. ${tieNote(req.tie ?? "net", bf.homeRule)} The Finals use the ${finals} pattern that season used. Seeds are for display only and never decide home court.`,
      `Your lineup takes the place of ${bracket.teams[req.replaced].name} and inherits its slot, regular-season record and home-court status.`,
      req.replay === "path"
        ? "Follow the historical path: your lineup plays the actual opponents of the team it replaces, in order. This is a hypothetical sequence of real opponents, not a bracket simulation, so it is not a title chance."
        : "Replay the full bracket: every series is simulated together, so title odds come from one coherent bracket.",
      "Actual playoff results are never used to rate any team.",
      footingNote,
      NOT_A_FORECAST,
    ],
    evidence: evidenceLines(model),
    uncertainty: uncertaintyLines(model),
    eraNote: eraNote(),
  };
}

export type SimResult = SeasonOut | SeriesOut | BracketOut;

export async function runSimulation(req: SimRequest, ds: DataSource, hooks: Hooks = {}): Promise<SimResult | null> {
  const model = await ds.model();
  if (req.mode === "season") return runSeason(req, ds, model, hooks);
  if (req.mode === "series") return runSeries(req, ds, model, hooks);
  return runBracket(req, ds, model, hooks);
}
