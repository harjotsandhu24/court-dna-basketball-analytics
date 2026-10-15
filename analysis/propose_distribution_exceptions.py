"""PROPOSE (never approve) the list of player-seasons whose five zone shares do not total 1 within rounding.

Writes data/proposed_distribution_exceptions.json. It deliberately does NOT write
analysis/reviewed_distribution_exceptions.json: a person must inspect the proposal and copy it
over by hand. shot_band_validation.py only ever reads the reviewed file, so an exception can never
be approved by the same run that finds it.

Run: python3 analysis/propose_distribution_exceptions.py
"""
import json
import os
import sys

import pandas as pd

import shot_bands as sb
import utils


def build(canon, source_sha256):
    have = canon.dropna(subset=sb.SHARE_COLS).copy()
    have["total"] = have[sb.SHARE_COLS].sum(axis=1).round(4)
    off = have[have["total"].apply(sb.distribution_status) != "ok"].sort_values(["season", "player_id"])
    items = []
    for _, r in off.iterrows():
        items.append({"id": f"{r['player_id']}_{int(r['season'])}", "player": r["player"], "team": r["team"], "fga": int(r["fga"]),
                      "shares_total": float(r["total"]), "status": sb.distribution_status(float(r["total"])),
                      "x2p_range": float(r["percent_fga_from_x2p_range"]), "x3p_range": float(r["percent_fga_from_x3p_range"]),
                      "sum_four_2pt_zones": round(float(sum(r[f"percent_fga_from_{b}_range"] for b in sb.BANDS[:4])), 4)})
    return {"schema": 1, "source": {"file": "Player Shooting.csv", "sha256": source_sha256}, "tolerance": sb.SHARE_ROUNDING_TOLERANCE, "exceptions": items}


def main():
    canon = pd.read_csv(utils.data_path("canonical_player_seasons.csv"))
    manifest = json.load(open(utils.data_path("source_manifest.json")))
    out = build(canon, manifest["files"]["Player Shooting.csv"]["sha256"])
    path = utils.data_path("proposed_distribution_exceptions.json")
    json.dump(out, open(path, "w"), indent=1)
    print(f"proposed {len(out['exceptions'])} exceptions -> {path} (NOT approved; review, then copy to analysis/reviewed_distribution_exceptions.json)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
