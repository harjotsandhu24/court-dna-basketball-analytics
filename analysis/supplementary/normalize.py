"""Normalizers for cached supplementary responses (IMPLEMENTED, MOCK-TESTED; not run on live data).

Reads a validated cache file (download.load_valid_cache), selects the expected result set BY NAME,
and writes a tidy CSV under data/supplementary/ with explicit season id, season type, provenance and
row scope. It NEVER writes to public/ or touches production data.

NOT BUILT: crosswalk from NBA person ids to Basketball-Reference ids (needed before any of this can
join the app's player-seasons), and any use of these tables in similarity scoring.

Traded players: stats.nba.com league tables may list a player once (season total) or once per team.
That shape has not been observed, so this module does not guess: if a player id repeats it keeps the
rows as row_scope='team' and reports the duplicates; totals are only claimed (row_scope='player_total')
when ids are unique. It never sums team rows into a total on its own.
"""
import csv
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from common import SPECS, SchemaError, rows_as_dicts, select_result_set  # noqa: E402
import download  # noqa: E402

REPO = download.REPO
OUT_DIR = os.path.join(REPO, "data", "supplementary")


def normalize_cache(dataset, cache_path, out_dir=OUT_DIR):
    """Return (output_path|None, report). A cache that does not validate produces no output."""
    spec = SPECS[dataset]
    try:
        with open(cache_path) as f:
            rec = json.load(f)
    except (OSError, ValueError) as e:
        return None, {"status": "invalid_cache", "reason": f"unreadable/corrupt JSON ({type(e).__name__})"}
    hit, why = download.load_valid_cache(cache_path, rec.get("endpoint"), rec.get("params"), dataset)
    if hit is None:
        return None, {"status": "invalid_cache", "reason": why}
    name, chosen, _ = select_result_set(hit["payload"], dataset)
    rows = rows_as_dicts(chosen)
    params = hit["params"]
    season = params.get("Season") or params.get("SeasonYear")
    ident = spec["identity"][0]
    keys = [r[ident] for r in rows]
    if dataset == "synergy":
        keys = [(r[ident], r["PLAY_TYPE"], r["TYPE_GROUPING"]) for r in rows]
    dup = len(keys) - len(set(keys))
    dup_ids = sorted({k for k in keys if keys.count(k) > 1}, key=str)[:20]
    scope = "player_total" if dup == 0 else "team"
    report = {"status": "ok" if rows else "empty", "rows": len(rows), "duplicate_keys": dup, "duplicate_examples": dup_ids,
              "row_scope": scope, "season": season, "season_type": params["SeasonType"], "result_set": name}
    if not rows:
        return None, report
    extra = {"season_id": season, "season_type": params["SeasonType"], "row_scope": scope, "retrieved_utc": hit["retrieved_utc"],
             "source": "stats.nba.com via documented nba_api parameters (unverified live)", "request_key": download.cache_key(hit["endpoint"], params)}
    for k in ("PlayType", "TypeGrouping", "DefenseCategory", "PerMode"):
        if k in params:
            extra[f"req_{k}"] = params[k]
    cols = chosen["headers"] + list(extra)
    os.makedirs(out_dir, exist_ok=True)
    suffix = "_".join(str(params[k]) for k in ("PlayType", "DefenseCategory", "PlayerID") if k in params)
    out = os.path.join(out_dir, f"{dataset}_{season}_{params['SeasonType'].replace(' ', '')}{('_' + suffix) if suffix else ''}.csv")
    tmp = out + ".tmp"
    with open(tmp, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow({**r, **extra})
    os.replace(tmp, out)
    report["output"] = os.path.relpath(out, REPO)
    return out, report


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(description="Normalize the latest successful cached responses (hustle, synergy, ptdefend) to data/supplementary/*.csv")
    ap.add_argument("--raw-dir", default=download.DEFAULT_RAW_DIR)
    ap.add_argument("--out-dir", default=OUT_DIR)
    a = ap.parse_args(argv)
    path = os.path.join(a.raw_dir, "ledger.jsonl")
    if not os.path.exists(path):
        print("No ledger found; run download.py first.")
        return 1
    latest = {}
    for line in open(path):
        r = json.loads(line)
        if r["dataset"] != "shotchart" and r["status"] in ("ok", "empty"):
            latest[r["cache_key"]] = r
    bad = 0
    for r in latest.values():
        out, rep = normalize_cache(r["dataset"], os.path.join(a.raw_dir, r["cache_path"]), out_dir=a.out_dir)
        print(r["dataset"], r["season"], rep["status"], rep.get("row_scope", ""), rep.get("output", ""), rep.get("reason", ""))
        bad += rep["status"] == "invalid_cache"
    return 1 if bad or not latest else 0


if __name__ == "__main__":
    sys.exit(main())
