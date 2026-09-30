export interface BasicStats {
  pts: number | null;
  trb: number | null;
  ast: number | null;
  stl: number | null;
  blk: number | null;
  fg_percent: number | null;
  x3p_percent: number | null;
  ft_percent: number | null;
}

export interface ShotDna {
  percent_fga_from_x0_3_range: number | null;
  percent_fga_from_x3_10_range: number | null;
  percent_fga_from_x10_16_range: number | null;
  percent_fga_from_x16_3p_range: number | null;
  percent_fga_from_x3p_range: number | null;
  fg_percent_from_x0_3_range: number | null;
  fg_percent_from_x3_10_range: number | null;
  fg_percent_from_x10_16_range: number | null;
  fg_percent_from_x16_3p_range: number | null;
  fg_percent_from_x3p_range: number | null;
  avg_dist_fga: number | null;
  percent_assisted_x2p_fg: number | null;
  percent_assisted_x3p_fg: number | null;
  percent_dunks_of_fga: number | null;
  percent_corner_3s_of_3pa: number | null;
  corner_3_point_percent: number | null;
}

export interface CareerInfo {
  ht_in_in: number | null;
  wt: number | null;
  birth_date: string | null;
  hof: boolean;
  from_year: number | null;
  to_year: number | null;
}

export interface GalaxyPoint {
  x: number;
  y: number;
}

export interface PlayerSeasonRecord {
  player_id: string;
  player: string;
  season: number;
  season_label: string;
  team: string;
  pos: string;
  pos_group: string;
  age: number | null;
  g: number | null;
  gs: number | null;
  mp: number | null;
  qualified: boolean;
  small_sample: boolean;
  basic: BasicStats;
  vector: Record<string, number | null>;
  traits: Record<string, number | null>;
  archetype: string;
  trait_tags: string[];
  shot_dna: ShotDna;
  galaxy: GalaxyPoint | null;
  career: CareerInfo;
  team_stints: string[];
}

export interface PlayersIndexEntry {
  name: string;
  seasons: number[];
  qualified_seasons: number[];
  latest_team: string;
}

export type PlayersIndex = Record<string, PlayersIndexEntry>;

export interface GalaxyPointFull {
  player_id: string;
  player: string;
  archetype: string;
  pos_group: string;
  x: number;
  y: number;
}

export interface GalaxySeasonData {
  season: number;
  points: GalaxyPointFull[];
  variance_explained: number[];
}

export interface DatasetMeta {
  season_range: [number, number];
  season_range_label: [string, string];
  unique_players: number;
  unique_players_note: string;
  unique_players_all_samples: number;
  canonical_player_seasons_all_samples: number;
  canonical_player_seasons: number;
  qualified_comparison_player_seasons: number;
  display_eligible_player_seasons: number;
  small_sample_player_seasons: number;
  qualification_thresholds: {
    comparison_pool_min_minutes: number;
    comparison_pool_min_games: number;
    career_display_min_minutes: number;
  };
  source_checksums: Record<string, string>;
}
