"""
Step 2 — build one canonical statistical profile per (player_id, season).

TRADED-PLAYER RULE (see docs/methodology.md "Traded-player handling"):
  - If an aggregate row exists for a player-season (team code '2TM', '3TM',
    '4TM', or '5TM' -- i.e. starts with a digit and ends with 'TM'), that
    aggregate row is used as the canonical full-season profile.
  - Otherwise, the player's single team row is used.
  - Individual per-team rows are NEVER used for the canonical statistical
    profile when an aggregate row exists -- they would double-count the
    player's season. They ARE kept separately, in team_stints.csv, purely
    for "which teams did this player play for" display purposes.

This script joins Advanced, Per 100 Poss, Player Shooting, Player Per Game,
and Player Season Info on (player_id, season) using each table's own
canonical row, then attaches career-level context (height/weight/birth
date/HOF) from Player Career Info on player_id alone.

Run: python3 analysis/step2_build_canonical.py
"""
import sys

import numpy as np
import pandas as pd

import utils
import config


def canonical_rows(df: pd.DataFrame) -> pd.DataFrame:
    """From a raw per-player-season table (which may contain an aggregate
    'NTM' row plus individual team rows for traded players), return exactly
    one row per (player_id, season): the aggregate row if present, else the
    single team row."""
    df = df.copy()
    df["_is_agg"] = df["team"].apply(utils.is_aggregate_team_row)

    # Prefer the aggregate row when present; otherwise there should be
    # exactly one row already.
    df["_rank"] = np.where(df["_is_agg"], 0, 1)
    df = df.sort_values(["player_id", "season", "_rank"])
    canonical = df.drop_duplicates(subset=["player_id", "season"], keep="first").copy()
    canonical = canonical.drop(columns=["_is_agg", "_rank"])
    return canonical


def team_stints(df: pd.DataFrame) -> pd.DataFrame:
    """Individual (non-aggregate) team rows only, for team-history display."""
    df = df.copy()
    df["_is_agg"] = df["team"].apply(utils.is_aggregate_team_row)
    stints = df[~df["_is_agg"]][["player_id", "season", "team"]].copy()
    return stints.drop_duplicates()


def main():
    advanced = utils.filter_nba_seasons(utils.load_raw("Advanced.csv"))
    per100 = utils.filter_nba_seasons(utils.load_raw("Per 100 Poss.csv"))
    shooting = utils.filter_nba_seasons(utils.load_raw("Player Shooting.csv"))
    per_game = utils.filter_nba_seasons(utils.load_raw("Player Per Game.csv"))
    season_info = utils.filter_nba_seasons(utils.load_raw("Player Season Info.csv"))
    career_info = utils.load_raw("Player Career Info.csv")

    adv_c = canonical_rows(advanced)
    per100_c = canonical_rows(per100)
    shoot_c = canonical_rows(shooting)
    pg_c = canonical_rows(per_game)
    info_c = canonical_rows(season_info)

    # --- Validation: exactly one canonical row per (player_id, season) ---
    for name, d in [("Advanced", adv_c), ("Per100", per100_c), ("Shooting", shoot_c),
                     ("PerGame", pg_c), ("SeasonInfo", info_c)]:
        dup = d.duplicated(subset=["player_id", "season"]).sum()
        if dup:
            print(f"FAIL: {name} has {dup} duplicate (player_id, season) rows after canonicalization", file=sys.stderr)
            sys.exit(1)
    print("Canonicalization check passed: one row per (player_id, season) in every source table.")

    # --- Merge on (player_id, season). Advanced is the base (has player name). ---
    base = adv_c[["player_id", "season", "player", "team", "pos", "age", "g", "gs", "mp",
                  "ts_percent", "f_tr", "orb_percent", "drb_percent", "trb_percent",
                  "ast_percent", "stl_percent", "blk_percent", "tov_percent", "usg_percent"]]

    per100_cols = per100_c[["player_id", "season", "pts_per_100_poss", "fga_per_100_poss",
                             "x3pa_per_100_poss", "ast_per_100_poss", "trb_per_100_poss",
                             "stl_per_100_poss", "blk_per_100_poss", "tov_per_100_poss",
                             "o_rtg", "d_rtg"]]

    shoot_cols = shoot_c[["player_id", "season", "avg_dist_fga",
                           "percent_fga_from_x0_3_range", "percent_fga_from_x3_10_range",
                           "percent_fga_from_x10_16_range", "percent_fga_from_x16_3p_range",
                           "percent_fga_from_x3p_range", "percent_assisted_x2p_fg",
                           "percent_assisted_x3p_fg", "percent_dunks_of_fga", "num_of_dunks",
                           "percent_corner_3s_of_3pa", "corner_3_point_percent",
                           "fg_percent_from_x0_3_range", "fg_percent_from_x3_10_range",
                           "fg_percent_from_x10_16_range", "fg_percent_from_x16_3p_range",
                           "fg_percent_from_x3p_range"]]

    pg_cols = pg_c[["player_id", "season", "pts_per_game", "trb_per_game", "ast_per_game",
                     "stl_per_game", "blk_per_game", "mp_per_game", "fg_percent",
                     "x3p_percent", "ft_percent"]]

    info_cols = info_c[["player_id", "season", "experience"]]

    merged = base.merge(per100_cols, on=["player_id", "season"], how="left") \
                 .merge(shoot_cols, on=["player_id", "season"], how="left") \
                 .merge(pg_cols, on=["player_id", "season"], how="left") \
                 .merge(info_cols, on=["player_id", "season"], how="left")

    dup = merged.duplicated(subset=["player_id", "season"]).sum()
    if dup:
        print(f"FAIL: merged canonical table has {dup} duplicate (player_id, season) rows", file=sys.stderr)
        sys.exit(1)

    # --- Attach career-level context (not season-dependent) ---
    career_cols = career_info[["player_id", "ht_in_in", "wt", "birth_date", "from", "to",
                                "hof", "colleges", "debut"]].drop_duplicates(subset=["player_id"])
    merged = merged.merge(career_cols, on="player_id", how="left")

    merged["season_label"] = merged["season"].apply(config.season_label)

    # --- Team stints (for history display; not used in canonical stats) ---
    stints_frames = []
    for d in [advanced]:
        stints_frames.append(team_stints(d))
    stints = pd.concat(stints_frames).drop_duplicates()

    import os as _os
    _os.makedirs(utils.data_path(""), exist_ok=True)

    merged.to_csv(utils.data_path("canonical_player_seasons.csv"), index=False)
    stints.to_csv(utils.data_path("team_stints.csv"), index=False)

    n_players = merged["player_id"].nunique()
    n_player_seasons = len(merged)
    print(f"Canonical player-seasons: {n_player_seasons}")
    print(f"Unique players: {n_players}")
    print(f"Season range present: {merged['season'].min()}-{merged['season'].max()}")
    print("Wrote data/canonical_player_seasons.csv and data/team_stints.csv")


if __name__ == "__main__":
    main()
