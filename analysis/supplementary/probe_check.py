"""Check the result of the first small probe against explicit success criteria.

Run after the three probe downloads (see docs/data.md). Reads raw_supplementary/ledger.jsonl and cache
files only; writes nothing except an optional --report JSON. Exit 0 = every criterion passed.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import download  # noqa: E402
from common import rows_as_dicts, select_result_set  # noqa: E402
import shots  # noqa: E402


def latest(ledger, **match):
    out = None
    for r in ledger:
        if all(r.get(k) == v or r.get("params", {}).get(k) == v for k, v in match.items()):
            out = r
    return out


def check(raw_dir, kobe_trusted_fga=1712, tolerance=0.02):
    path = os.path.join(raw_dir, "ledger.jsonl")
    ledger = [json.loads(line) for line in open(path)] if os.path.exists(path) else []
    results = []

    def crit(name, ok, detail=""):
        results.append({"criterion": name, "pass": bool(ok), "detail": detail})

    def cache_for(rec):
        return os.path.join(raw_dir, rec["cache_path"])

    k = latest(ledger, dataset="shotchart", PlayerID=977, season="2008-09", season_type="Regular Season")
    crit("shotchart ledger entry is ok", k and k["status"] in ("ok",), k and f"{k['status']} {k.get('detail', '')}")
    if k and k["status"] == "ok":
        with open(cache_for(k)) as f:
            payload = json.load(f)["payload"]
        _, chosen, _ = select_result_set(payload, "shotchart")
        rows = rows_as_dicts(chosen)
        clean, rep = shots.normalize_shots(rows)
        crit("shotchart includes misses (made < attempted)", any(r["SHOT_MADE_FLAG"] == 0 for r in clean), f"kept {len(clean)} rows")
        crit("no duplicate shots / invalid coordinates / invalid flags", rep["duplicates"] == 0 and rep["invalid_coordinates"] == 0 and rep["invalid_flags"] == 0, json.dumps(rep))
        z = shots.aggregate_zones(clean)
        rec = shots.reconcile(z, kobe_trusted_fga, tolerance)
        crit(f"attempts reconcile with trusted FGA {kobe_trusted_fga} within {tolerance:.0%}", rec["within_tolerance"], json.dumps(rec))
    h = [r for r in ledger if r["dataset"] == "hustle" and r["season_type"] == "Regular Season"]
    crit("hustle ledger entry is ok", h and h[-1]["status"] == "ok", h and f"{h[-1]['status']} {h[-1].get('detail', '')}")
    s = [r for r in ledger if r["dataset"] == "synergy" and r["params"].get("PlayType") == "Isolation"]
    crit("synergy Isolation ledger entry is ok", s and s[-1]["status"] == "ok", s and f"{s[-1]['status']} {s[-1].get('detail', '')}")
    if s and s[-1]["status"] == "ok":
        with open(cache_for(s[-1])) as f:
            payload = json.load(f)["payload"]
        _, chosen, _ = select_result_set(payload, "synergy")
        rows = rows_as_dicts(chosen)
        crit("synergy rows are all Isolation / offensive", rows and all(r["PLAY_TYPE"] == "Isolation" and str(r["TYPE_GROUPING"]).lower() == "offensive" for r in rows), f"{len(rows)} rows")
    return results


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dir", default=download.DEFAULT_RAW_DIR)
    ap.add_argument("--report")
    a = ap.parse_args(argv)
    res = check(a.raw_dir)
    for r in res:
        print("PASS" if r["pass"] else "FAIL", r["criterion"], "-", r["detail"][:300])
    if a.report:
        json.dump(res, open(a.report, "w"), indent=1)
    return 0 if res and all(r["pass"] for r in res) else 1


if __name__ == "__main__":
    sys.exit(main())
