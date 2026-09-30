/**
 * COURT DNA — analytical configuration (TypeScript mirror).
 *
 * This MUST stay in exact sync with analysis/config.py. Both are the same
 * project's single source of truth for weights/thresholds, expressed twice
 * because the similarity engine runs client-side in the browser (no
 * server round-trip) while the data pipeline runs in Python. See
 * tests/similarity.parity.test.ts for the automated check that the two
 * implementations agree, and docs/methodology.md for the human-readable
 * explanation of every value below.
 */

export const SEASON_MIN = 2001; // 2000-01
export const SEASON_MAX = 2026; // 2025-26

export function seasonLabel(seasonEndYear: number): string {
  const start = seasonEndYear - 1;
  return `${start}-${String(seasonEndYear).slice(-2)}`;
}

export const GALAXY_MIN_MINUTES = 500;
export const GALAXY_MIN_GAMES = 20;
export const CAREER_DISPLAY_MIN_MINUTES = 250;

export interface FeatureGroup {
  name: string;
  weight: number;
  features: readonly string[];
}

export const FEATURE_GROUPS: readonly FeatureGroup[] = [
  { name: "Scoring load", weight: 0.2, features: ["pts_per_100_poss", "usg_percent"] },
  { name: "Efficiency", weight: 0.1, features: ["ts_percent"] },
  {
    name: "Shot profile",
    weight: 0.25,
    features: ["f_tr", "avg_dist_fga", "percent_fga_from_x0_3_range", "percent_fga_from_x3p_range"],
  },
  { name: "Playmaking / turnover style", weight: 0.2, features: ["ast_percent", "tov_percent"] },
  { name: "Rebounding", weight: 0.1, features: ["trb_percent"] },
  { name: "Defensive activity", weight: 0.15, features: ["stl_percent", "blk_percent"] },
];

export const SIMILARITY_FEATURES: readonly string[] = FEATURE_GROUPS.flatMap((g) => g.features);

export const FEATURE_WEIGHTS: Readonly<Record<string, number>> = Object.fromEntries(
  FEATURE_GROUPS.flatMap((g) => g.features.map((f) => [f, g.weight / g.features.length])),
);

export const SIMILARITY_SCALE = 20;
export const ERA_WINDOW_SEASONS = 5;

export const TRAIT_DIMENSIONS = [
  "Scoring",
  "Efficiency",
  "Playmaking",
  "Rebounding",
  "Defensive Activity",
  "Rim Pressure",
  "Perimeter Profile",
] as const;
export type TraitDimension = (typeof TRAIT_DIMENSIONS)[number];

export const FEATURE_LABELS: Readonly<Record<string, string>> = {
  pts_per_100_poss: "Scoring rate (per 100)",
  usg_percent: "Usage rate",
  ts_percent: "True shooting %",
  f_tr: "Free-throw rate",
  avg_dist_fga: "Average shot distance",
  percent_fga_from_x0_3_range: "Rim attempt share",
  percent_fga_from_x3p_range: "Three-point attempt share",
  ast_percent: "Assist rate",
  tov_percent: "Turnover rate",
  trb_percent: "Rebound rate",
  stl_percent: "Steal rate",
  blk_percent: "Block rate",
};
