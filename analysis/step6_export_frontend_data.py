"""
Step 6 — export compact, pre-split JSON artifacts for the Next.js frontend.

Nothing downstream of this step touches raw or intermediate CSVs -- the
production app reads only from public/data/. This keeps the deployed site
independent of Python/the raw dataset (Section 16-17 of the spec).

Outputs:
  public/data/meta.json               dataset-level counts, generated_at, source checksum
  public/data/players_index.json      search index: player_id -> name, seasons, photo key
  public/data/seasons/{season}.json   every display-eligible (>=250 MP) player-season that year
  public/data/similarity_pool.json    flat QUALIFIED-only vectors across all seasons (cross-season candidate pool)
  public/data/galaxy/{season}.json    PCA coords for that season's qualified pool
  public/data/career/{player_id}.json all of one player's display-eligible seasons, career-ordered

Run: python3 analysis/step6_export_frontend_data.py
"""
import json
import os

import numpy as np
import pandas as pd

import utils
import config

SHOT_DNA_FIELDS = [
    "percent_fga_from_x0_3_range", "percent_fga_from_x3_10_range",
    "percent_fga_from_x10_16_range", "percent_fga_from_x16_3p_range",
    "percent_fga_from_x3p_range",
    "fg_percent_from_x0_3_range", "fg_percent_from_x3_10_range",
    "fg_percent_from_x10_16_range", "fg_percent_from_x16_3p_range",
    "fg_percent_from_x3p_range",
    "avg_dist_fga", "percent_assisted_x2p_fg", "percent_assisted_x3p_fg",
    "percent_dunks_of_fga", "percent_corner_3s_of_3pa", "corner_3_point_percent",
]

TRAIT_KEYS = [f"pctile_{d.lower().replace(' ', '_')}" for d in config.TRAIT_DIMENSIONS]


def clean_num(v):
    if v is None:
        return None
    if isinstance(v, (int, np.integer)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        if math_isnan_or_inf(v):
            return None
        return round(float(v), 4)
    return v


def math_isnan_or_inf(v):
    return v != v or v in (float("inf"), float("-inf"))


def row_to_record(row, galaxy_lookup):
    key = f"{row['player_id']}_{int(row['season'])}"
    gc = galaxy_lookup.get(key)
    return {
        "player_id": row["player_id"],
        "player": row["player"],
        "season": int(row["season"]),
        "season_label": row["season_label"],
        "team": row["team"],
        "pos": row["pos"],
        "pos_group": row["pos_group"],
        "age": clean_num(row["age"]),
        "g": clean_num(row["g"]),
        "gs": clean_num(row["gs"]),
        "mp": clean_num(row["mp"]),
        "qualified": bool(row["qualified"]),
        "small_sample": bool(row["small_sample"]),
        "basic": {
            "pts": clean_num(row["pts_per_game"]),
            "trb": clean_num(row["trb_per_game"]),
            "ast": clean_num(row["ast_per_game"]),
            "stl": clean_num(row["stl_per_game"]),
            "blk": clean_num(row["blk_per_game"]),
            "fg_percent": clean_num(row["fg_percent"]),
            "x3p_percent": clean_num(row["x3p_percent"]),
            "ft_percent": clean_num(row["ft_percent"]),
        },
        "vector": {f: clean_num(row[f"std_{f}"]) for f in config.SIMILARITY_FEATURES},
        "traits": {
            d: clean_num(row[f"pctile_{d.lower().replace(' ', '_')}"])
            for d in config.TRAIT_DIMENSIONS
        },
        "archetype": row["archetype"],
        "trait_tags": row["trait_tags"].split("|"),
        "shot_dna": {f: clean_num(row.get(f)) for f in SHOT_DNA_FIELDS},
        "galaxy": gc,
        "career": {
            "ht_in_in": clean_num(row.get("ht_in_in")),
            "wt": clean_num(row.get("wt")),
            "birth_date": row.get("birth_date") if isinstance(row.get("birth_date"), str) else None,
            "hof": bool(row.get("hof")) if pd.notna(row.get("hof")) else False,
            "from_year": clean_num(row.get("from")),
            "to_year": clean_num(row.get("to")),
        },
    }


def main():
    df = pd.read_csv(utils.data_path("with_archetypes.csv"))
    stints = pd.read_csv(utils.data_path("team_stints.csv"))

    with open(utils.data_path("galaxy_coords.json")) as f:
        galaxy_raw = json.load(f)
    galaxy_lookup = galaxy_raw["coords"]

    os.makedirs(utils.public_data_path(), exist_ok=True)
    os.makedirs(utils.public_data_path("seasons"), exist_ok=True)
    os.makedirs(utils.public_data_path("galaxy"), exist_ok=True)
    os.makedirs(utils.public_data_path("career"), exist_ok=True)

    # --- per-season files ---
    total_bytes = 0
    for season in sorted(df["season"].unique()):
        season_df = df[df["season"] == season]
        records = [row_to_record(r, galaxy_lookup) for _, r in season_df.iterrows()]
        # attach team-history stints for traded players in this season
        season_stints = stints[stints["season"] == season]
        stint_map = season_stints.groupby("player_id")["team"].apply(list).to_dict()
        for rec in records:
            rec["team_stints"] = stint_map.get(rec["player_id"], [rec["team"]])

        path = utils.public_data_path("seasons", f"{season}.json")
        with open(path, "w") as f:
            json.dump(records, f, separators=(",", ":"))
        total_bytes += os.path.getsize(path)

    # --- similarity pool: qualified-only, all seasons, compact vectors ---
    qual_df = df[df["qualified"]]
    pool = []
    for _, r in qual_df.iterrows():
        key = f"{r['player_id']}_{int(r['season'])}"
        pool.append({
            "player_id": r["player_id"],
            "player": r["player"],
            "season": int(r["season"]),
            "season_label": r["season_label"],
            "pos_group": r["pos_group"],
            "archetype": r["archetype"],
            "vector": {f: clean_num(r[f"std_{f}"]) for f in config.SIMILARITY_FEATURES},
        })
    with open(utils.public_data_path("similarity_pool.json"), "w") as f:
        json.dump(pool, f, separators=(",", ":"))

    # --- galaxy per season (coords + qualified count + variance) ---
    for season in sorted(df["season"].unique()):
        season_pool = [p for p in pool if p["season"] == season]
        pts = []
        for p in season_pool:
            key = f"{p['player_id']}_{p['season']}"
            gc = galaxy_lookup.get(key)
            if gc:
                pts.append({
                    "player_id": p["player_id"], "player": p["player"],
                    "archetype": p["archetype"], "pos_group": p["pos_group"],
                    "x": gc["x"], "y": gc["y"],
                })
        variance = galaxy_raw["variance_explained"].get(str(season), [])
        with open(utils.public_data_path("galaxy", f"{season}.json"), "w") as f:
            json.dump({"season": int(season), "points": pts, "variance_explained": variance}, f, separators=(",", ":"))

    # --- career files (one per player, display-eligible seasons only) ---
    for player_id, pdf in df.groupby("player_id"):
        pdf = pdf.sort_values("season")
        records = [row_to_record(r, galaxy_lookup) for _, r in pdf.iterrows()]
        with open(utils.public_data_path("career", f"{player_id}.json"), "w") as f:
            json.dump(records, f, separators=(",", ":"))

    # --- players index (search) ---
    idx = {}
    for player_id, pdf in df.groupby("player_id"):
        name = pdf["player"].iloc[-1]
        seasons = sorted(int(s) for s in pdf["season"].unique())
        qualified_seasons = sorted(int(s) for s in pdf[pdf["qualified"]]["season"].unique())
        idx[player_id] = {
            "name": name,
            "seasons": seasons,
            "qualified_seasons": qualified_seasons,
            "latest_team": pdf.sort_values("season").iloc[-1]["team"],
        }
    with open(utils.public_data_path("players_index.json"), "w") as f:
        json.dump(idx, f, separators=(",", ":"))

    # --- meta ---
    with open(utils.data_path("source_manifest.json")) as f:
        source_manifest = json.load(f)

    canonical_all = pd.read_csv(utils.data_path("canonical_player_seasons.csv"))
    meta = {
        "generated_note": "Generated by analysis/step6_export_frontend_data.py from a frozen archive.zip snapshot",
        "season_range": [config.SEASON_MIN, config.SEASON_MAX],
        "season_range_label": [config.season_label(config.SEASON_MIN), config.season_label(config.SEASON_MAX)],
        "unique_players": int(df["player_id"].nunique()),
        "unique_players_note": (
            "Players with a detail page (>=250 minutes in at least one season). "
            f"{canonical_all['player_id'].nunique()} unique players exist in the full canonical "
            "dataset before that floor is applied (includes brief call-ups/two-way cameos with no "
            "season reaching 250 minutes, which are not given a detail page)."
        ),
        "unique_players_all_samples": int(canonical_all["player_id"].nunique()),
        "canonical_player_seasons_all_samples": int(len(canonical_all)),
        "canonical_player_seasons": int(len(df)),
        "qualified_comparison_player_seasons": int(df["qualified"].sum()),
        "display_eligible_player_seasons": int(len(df)),
        "small_sample_player_seasons": int(df["small_sample"].sum()),
        "qualification_thresholds": {
            "comparison_pool_min_minutes": config.GALAXY_MIN_MINUTES,
            "comparison_pool_min_games": config.GALAXY_MIN_GAMES,
            "career_display_min_minutes": config.CAREER_DISPLAY_MIN_MINUTES,
        },
        "source_checksums": {k: v.get("sha256") for k, v in source_manifest["files"].items() if v.get("present")},
    }
    with open(utils.public_data_path("meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print(f"Unique players: {meta['unique_players']}")
    print(f"Canonical player-seasons: {meta['canonical_player_seasons']}")
    print(f"Qualified comparison player-seasons: {meta['qualified_comparison_player_seasons']}")
    print(f"Season files total size: {total_bytes/1024:.0f} KB")
    print(f"Similarity pool size: {os.path.getsize(utils.public_data_path('similarity_pool.json'))/1024:.0f} KB")
    print("Wrote all public/data/ artifacts")


if __name__ == "__main__":
    main()
