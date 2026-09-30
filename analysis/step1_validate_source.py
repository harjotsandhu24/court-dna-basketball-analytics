"""
Step 1 — validate the raw source files.

Checks that the six primary CSVs exist, are readable, have the expected key
columns, and records a checksum/row-count manifest so downstream steps (and
anyone re-running this pipeline) can confirm they're working from the same
source data. Never modifies the raw files.

Run: python3 analysis/step1_validate_source.py
"""
import json
import os
import sys

import utils
import config

PRIMARY_FILES = [
    "Advanced.csv",
    "Per 100 Poss.csv",
    "Player Shooting.csv",
    "Player Per Game.csv",
    "Player Season Info.csv",
    "Player Career Info.csv",
]
SUPPLEMENTARY_FILES = [
    "Player Play By Play.csv",
    "All-Star Selections.csv",
    "Player Award Shares.csv",
    "End of Season Teams.csv",
    "End of Season Teams (Voting).csv",
    "Draft Pick History.csv",
]

REQUIRED_COLUMNS = {
    "Advanced.csv": {"season", "lg", "player", "player_id", "team", "pos", "g", "mp",
                      "ts_percent", "f_tr", "trb_percent", "ast_percent", "stl_percent",
                      "blk_percent", "tov_percent", "usg_percent"},
    "Per 100 Poss.csv": {"season", "lg", "player_id", "team", "mp", "pts_per_100_poss"},
    "Player Shooting.csv": {"season", "lg", "player_id", "team", "mp", "avg_dist_fga",
                             "percent_fga_from_x0_3_range", "percent_fga_from_x3p_range"},
    "Player Per Game.csv": {"season", "lg", "player_id", "team", "pts_per_game",
                             "trb_per_game", "ast_per_game"},
    "Player Season Info.csv": {"season", "lg", "player_id", "team", "pos", "experience"},
    "Player Career Info.csv": {"player_id", "ht_in_in", "wt", "birth_date", "from", "to", "hof"},
}


def main():
    manifest = {"files": {}, "season_range": [config.SEASON_MIN, config.SEASON_MAX], "league": config.LEAGUE}
    ok = True

    for fname in PRIMARY_FILES + SUPPLEMENTARY_FILES:
        path = utils.raw_path(fname)
        entry = {"present": os.path.exists(path)}
        if not entry["present"]:
            print(f"MISSING: {fname}", file=sys.stderr)
            if fname in PRIMARY_FILES:
                ok = False
            manifest["files"][fname] = entry
            continue

        df = utils.load_raw(fname)
        entry["rows"] = len(df)
        entry["columns"] = len(df.columns)
        entry["sha256"] = utils.sha256_of_file(path)

        required = REQUIRED_COLUMNS.get(fname)
        if required:
            missing_cols = required - set(df.columns)
            entry["missing_required_columns"] = sorted(missing_cols)
            if missing_cols:
                print(f"SCHEMA ISSUE in {fname}: missing {missing_cols}", file=sys.stderr)
                ok = False

        manifest["files"][fname] = entry
        print(f"OK  {fname:35s} rows={entry['rows']:>7} cols={entry['columns']:>3}")

    os.makedirs(utils.data_path(""), exist_ok=True)
    with open(utils.data_path("source_manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)

    if not ok:
        print("\nVALIDATION FAILED", file=sys.stderr)
        sys.exit(1)
    print("\nValidation passed. Manifest written to data/source_manifest.json")


if __name__ == "__main__":
    main()
