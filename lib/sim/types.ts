/** Shared types for the simulation engine. All data comes from public/data/sim/*.json. */

export const SIM_FEATURES = [
  "ts_percent", "usg_percent", "ast_percent", "tov_percent", "orb_percent",
  "drb_percent", "stl_percent", "blk_percent", "x3p_ar", "f_tr",
] as const;
export type SimFeature = (typeof SIM_FEATURES)[number];
export type ZMap = Record<SimFeature, number>;

/** Short keys used in the per-season feature files. */
export const SHARD_KEY: Record<SimFeature, keyof FeatureShard> = {
  ts_percent: "ts", usg_percent: "usg", ast_percent: "ast", tov_percent: "tov", orb_percent: "orb",
  drb_percent: "drb", stl_percent: "stl", blk_percent: "blk", x3p_ar: "x3ar", f_tr: "ftr",
};

export interface FeatureShard {
  season: number;
  ids: string[];
  mp: number[];
  g: number[];
  ts: number[]; usg: number[]; ast: number[]; tov: number[]; orb: number[];
  drb: number[]; stl: number[]; blk: number[]; x3ar: number[]; ftr: number[];
}

export interface SeasonStats {
  mean: Record<string, number>;
  sd: Record<string, number>;
  lgOrtg: number;
  lgPace: number;
  lgTs: number;
}

export interface SupportFile {
  dims: string[];
  mean: number[];
  precision: number[][];
  limited: number;
  unsupported: number;
  n: number;
  net: { min: number; max: number };
  minMp: number;
  minG: number;
  eraSpan: number;
  limitedQ: number;
  unsupportedQ: number;
}

export type StatusLabel = "estimate" | "experimental" | "validated";

export interface ModelFile {
  modelVersion: string;
  dataVersion: string;
  features: string[];
  coef: { net: Record<string, number>; ortg_rel: Record<string, number>; drtg_rel: Record<string, number> };
  intercept: { net: number; ortg_rel: number; drtg_rel: number };
  reference: Record<string, number>;
  dimensions: Record<string, string[]>;
  params: {
    starterShare: number; usageTarget: number; betaTsUsg: number; betaTsUsgSe: number;
    kClip: [number, number]; avgBench: Record<string, number>;
  };
  tau: { real: number; five: number; ortgFive: number };
  /** range of real team net ratings in the fitting seasons */
  netRange?: { min: number; max: number; p05: number; p95: number };
  /** what the model's training teams looked like (starting-five feature vectors), used by the support check */
  support: SupportFile;
  game: {
    regular: { beta: number; home: number; n: number };
    playoff: { beta: number; home: number; n: number };
  };
  seasons: Record<string, SeasonStats>;
  labels: {
    season: { status: StatusLabel; historical_teams_validated: boolean; five_avg_bench_validated: boolean; five_beats_prior_season: boolean };
    series: { status: StatusLabel; real_team_odds: StatusLabel; reason: string | null };
    bracket: { status: StatusLabel; real_team_odds: StatusLabel; reason: string | null };
    show_ortg: boolean;
    show_drtg: boolean;
  };
  validation: {
    fitSeasons: [number, number]; validationSeasons: [number, number]; testSeasons: [number, number];
    winsReal: { n: number; rmse: number; mae: number; coverage80: number; mean_range_width: number };
    winsFive: {
      n: number; rmse: number; mae: number; coverage80: number; mean_range_width: number;
      coverage80_game_luck_only: number; mean_width_game_luck_only: number;
    };
    winsBaselineLeagueRmse: number;
    winsBaselineLeagueMae: number;
    priorSeason: { n: number; rmse: number; mae: number; fiveRmse: number; fiveMae: number };
    netR2Real: number; netR2Five: number; ortgR2: number; drtgR2: number;
    seriesN: number;
    series: { logloss: number; brier: number; slope: number | null; baselineAverageLogloss: number; baselineRecordLogloss: number };
    earlier: { version: string; testSeasons: [number, number]; fiveRmse: number; priorSeasonRmse: number; note: string };
  };
}

export interface SimPlayer {
  id: string;
  season: number;
  mp: number;
  g: number;
  usg: number;
  z: ZMap;
  /** raw values (for display) */
  raw: Record<SimFeature, number>;
}

export interface TeamEntry {
  abbr: string; name: string; w: number; l: number; coverage: number; ok: boolean;
  players: [string, number][]; uncoveredMp: number;
}
export interface TeamsFile { season: number; teams: TeamEntry[] }

export interface BracketSeries {
  id: string; round: number; need: number; pattern: string; hc: string; other: string;
  feeders: [string, string] | null;
  /** every game of this series was played at one site (the 2020 restart) */
  neutral?: boolean;
  history: { winner: string; games: number; wins_hc: number; wins_other: number };
}
export interface BracketTeam {
  conf: number;
  /** published playoff seed when the bracket's seedSource is "published", otherwise the reconstructed bracket position */
  seed: number;
  /** reconstructed bracket position (always present in new data) */
  pos?: number;
  w: number; l: number; mov: number; name: string;
}
export interface Bracket {
  season: number; champion: string; teams: Record<string, BracketTeam>; series: BracketSeries[];
  /** the whole postseason was played at one site */
  neutral?: boolean;
  /**
   * "published": seeds from a published table that passed every check against the real bracket (a secondary source, not the NBA's own table).
   * "reconstructed": rebuilt from the bracket shape; shown as "Reconstructed bracket position". Seeds never decide home court.
   */
  seedSource?: "published" | "reconstructed";
  seedRef?: string;
  ambiguousSeeds?: boolean;
  /** season series (wins, losses for the first-named team) between playoff teams with identical regular-season records; key "A|B" with A < B */
  tieH2H?: Record<string, [number, number]>;
}
export interface BracketsFile {
  dataVersion: string;
  note: string;
  /** how often the team with the better regular-season record hosted, over every series 1997-2026 */
  homeRule: { series: number; host_better_record: number; host_worse_record: number; tied_record: number; tied_host_better_h2h?: number; tied_host_worse_h2h?: number; tied_h2h_even?: number; tied_host_better_mov?: number; tied_host_worse_mov?: number };
  status: Record<string, { supported: boolean; reason: string | null }>;
  brackets: Record<string, Bracket>;
}

/** A lineup entry: which player-season. Order never matters. */
export interface LineupPick { id: string; season: number }

export interface DataSource {
  model(): Promise<ModelFile>;
  features(season: number): Promise<FeatureShard>;
  teams(season: number): Promise<TeamsFile>;
  brackets(): Promise<BracketsFile>;
}
