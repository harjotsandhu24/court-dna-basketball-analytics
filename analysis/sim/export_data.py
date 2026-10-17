"""
Export the small JSON files the browser needs for Simulate and Season honors.

    cd analysis && python3 -m sim.export_data

Stages public/data/sim/features/*.json, public/data/sim/teams/*.json, public/data/sim/brackets.json,
public/data/honors.json and the docs/model/honors_* reports, validates honors, champions and seeds
(sim/honors_stage.py), and only then writes them (unchanged files are left alone). If validation finds a problem
nothing is written and the existing data stays as it was. No shot data is read or written.
"""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
import pandas as pd

from . import config as C
from . import fit as F
from . import data_build as D
from . import bracket_build as BB
from . import games_build as GB
from . import honors_stage as HS

ROOT = Path(__file__).resolve().parents[2]
PUB = ROOT / "public" / "data"
DOCS = ROOT / "docs" / "model"
RAW = ROOT / "raw"

FEATURE_KEYS = [("ts", "ts_percent"), ("usg", "usg_percent"), ("ast", "ast_percent"), ("tov", "tov_percent"),
                ("orb", "orb_percent"), ("drb", "drb_percent"), ("stl", "stl_percent"), ("blk", "blk_percent"),
                ("x3ar", "x3p_ar"), ("ftr", "f_tr")]


STAGED: dict[Path, str] = {}


def dump(path: Path, obj, pretty: bool = False):
    """Stage a JSON file. Nothing reaches the app until commit() runs after every check has passed."""
    STAGED[path] = json.dumps(obj, indent=1, ensure_ascii=False) if pretty else json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def stage_text(path: Path, text: str):
    STAGED[path] = text


def commit(staged: dict[Path, str] | None = None) -> dict:
    """Write every staged file. Each file goes to a temporary name first and is moved into place in one step, so a failure
    while staging leaves the existing files untouched. If a move fails part-way, the files already moved are put back as they
    were. Unchanged files are not rewritten."""
    import os
    staged = STAGED if staged is None else staged
    tmp: dict[Path, Path] = {}
    originals: dict[Path, str | None] = {}
    written, same = [], 0
    try:
        for path, text in staged.items():
            if path.exists() and path.read_text(encoding="utf-8") == text:
                same += 1
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            t = path.with_name(path.name + ".staging")
            t.write_text(text, encoding="utf-8")
            tmp[path] = t
            originals[path] = path.read_text(encoding="utf-8") if path.exists() else None
        moved: list[Path] = []
        try:
            for path, t in tmp.items():
                os.replace(t, path)
                moved.append(path)
                written.append(str(path.relative_to(ROOT)))
        except Exception:
            for path in moved:                              # put back what was already replaced
                if originals[path] is None:
                    path.unlink(missing_ok=True)
                else:
                    path.write_text(originals[path], encoding="utf-8")
            raise
    finally:
        for t in tmp.values():
            if t.exists():
                t.unlink()
    return {"written": written, "unchanged": same}


def export_features(d: F.Data) -> dict:
    cov = {}
    for s, g in d.players[d.players.complete].groupby("season"):
        g = g.sort_values("player_id")
        obj = {"season": int(s), "ids": g.player_id.tolist(), "mp": g.mp.astype(int).tolist(), "g": g.g.astype(int).tolist()}
        for key, col in FEATURE_KEYS:
            obj[key] = [round(float(x), 4) for x in g[col]]
        dump(PUB / "sim" / "features" / f"{int(s)}.json", obj)
        cov[int(s)] = len(g)
    return cov


def export_teams(d: F.Data) -> dict:
    summary = {}
    for s in range(C.SEASON_MIN, C.SEASON_MAX + 1):
        teams = []
        for t in d.teams[d.teams.season == s].itertuples():
            recs, coverage = d.team_roster(s, t.abbreviation)
            r = d._by_team.get((s, t.abbreviation))
            tot = float(r.mp.sum()) if r is not None else 0.0
            covered = sum(p["mp"] for p in recs)
            teams.append({
                "abbr": t.abbreviation, "name": t.team, "w": int(t.w), "l": int(t.l),
                "coverage": round(coverage, 4),
                "ok": bool(len(recs) >= C.STARTERS + 1 and coverage >= C.MIN_TEAM_COVERAGE),
                "players": [[p["id"], int(p["mp"])] for p in recs],
                "uncoveredMp": int(round(tot - covered)),
            })
        dump(PUB / "sim" / "teams" / f"{s}.json", {"season": s, "teams": sorted(teams, key=lambda x: x["abbr"])})
        summary[s] = {"teams": len(teams), "ok": sum(x["ok"] for x in teams),
                      "min_coverage": min(x["coverage"] for x in teams)}
    return summary


def load_games_final() -> pd.DataFrame:
    p = RAW / "sim" / "games_final.csv"
    if not p.exists():
        raise SystemExit("raw/sim/games_final.csv is missing. Run: cd analysis && python3 -m sim.games_build")
    return pd.read_csv(p)


def build_brackets(d: F.Data) -> dict:
    """Rebuild every postseason (in memory). Seeds are reconstructed here; published seeds are applied after validation."""
    G = load_games_final()
    brackets, status, rules, champions = {}, {}, {}, {}
    for s in range(C.SEASON_MIN, C.SEASON_MAX + 1):
        b = BB.build_bracket(G, s, d.teams)
        champions[s] = b["champion"]
        tt = {t["abbr"]: t for t in json.loads(STAGED[PUB / "sim" / "teams" / f"{s}.json"])["teams"]}
        bad = [t for t in b["teams"] if not tt[t]["ok"]]
        for k, v in b["homeRule"].items():
            rules[k] = rules.get(k, 0) + v
        for t in b["teams"].values():
            t["pos"] = t["seed"]                        # reconstructed bracket position, kept even when a published seed exists
        if bad:
            status[s] = {"supported": False, "reason": f"Player data is incomplete for {', '.join(bad)}."}
            continue
        brackets[str(s)] = b
        status[s] = {"supported": True, "reason": None}
    return {"brackets": brackets, "status": status, "rules": rules, "champions": champions}


def apply_seeds(br: dict, seeds: dict[int, dict[str, int]]) -> dict:
    """Published seeds replace the reconstructed ones only for seasons that passed every check; the rest keep the label 'reconstructed'."""
    for s, b in br["brackets"].items():
        b["teams"] = {t: b["teams"][t] for t in sorted(b["teams"])}   # a fixed order keeps reruns byte-identical
        pub = seeds.get(int(s))
        if pub:
            for t, info in b["teams"].items():
                info["seed"] = pub[t]
            b["seedSource"] = "published"
            b["seedRef"] = "Wikipedia playoff and standings tables (see docs/model/honors_validation_report.md)"
        else:
            b["seedSource"] = "reconstructed"
            b.pop("seedRef", None)
    return br


def stage_brackets(br: dict):
    dump(PUB / "sim" / "brackets.json", {
        "dataVersion": C.DATA_VERSION,
        "note": "Series, formats and home-court patterns are rebuilt from game results (1996-97 to 2025-26). 'seed' is the published playoff seed where "
                "seedSource is 'published' (checked against the actual bracket), otherwise a reconstructed bracket position ('pos' is always the "
                "reconstruction). Seeds never decide home court. In every real series the team with the better regular-season record hosted; "
                "for hypothetical matchups with equal records the tiebreak is a labelled simulation assumption, not an official rule. "
                "'history' is reference only and is never a model input.",
        "homeRule": br["rules"],
        "status": {str(k): v for k, v in br["status"].items()},
        "brackets": br["brackets"],
    })


# ---------------------------------------------------------------------------
# Season honors
# ---------------------------------------------------------------------------
AWARD_KEYS = {"nba mvp": "mvp", "nba dpoy": "dpoy", "nba roy": "roy", "nba smoy": "smoy", "nba mip": "mip"}
EOS_KEYS = {"All-NBA": "allnba", "All-Defense": "alldef", "All-Rookie": "allrookie"}
TIER = {"1st": 1, "2nd": 2, "3rd": 3}
LEGACY_SRC = "kaggle_nba_stats"


def legacy_facts() -> tuple[list[dict], dict]:
    """Awards, All-NBA/Defense/Rookie teams and All-Star selections from the Kaggle tables. Only winners are read: voting
    placements (the other rows of Player Award Shares) never become badges."""
    a = pd.read_csv(RAW / "Player Award Shares.csv")
    e = pd.read_csv(RAW / "End of Season Teams.csv")
    s = pd.read_csv(RAW / "All-Star Selections.csv")
    lo, hi = C.SEASON_MIN, C.SEASON_MAX
    out: list[dict] = []
    cov: dict[str, dict] = {}
    allaw = a[a.award.isin(AWARD_KEYS)]
    aw = allaw[allaw.winner]
    for key_raw, key in AWARD_KEYS.items():
        w_in = aw[(aw.award == key_raw) & aw.season.between(lo, hi)]
        counts = w_in.groupby("season").size()
        for r in w_in.itertuples():
            out.append({"pid": r.player_id, "season": int(r.season), "k": key, "tier": None, "source": LEGACY_SRC, **({"s": True} if counts[r.season] > 1 else {})})
        seasons_with_data = sorted(allaw[allaw.award == key_raw].season.unique())
        cov[key] = {"from": lo, "to": int(max(seasons_with_data)), "introduced": int(min(seasons_with_data))}
    en = e[e.lg == "NBA"]
    for raw_type, key in EOS_KEYS.items():
        x = en[en.type == raw_type]
        for r in x[x.season.between(lo, hi)].itertuples():
            out.append({"pid": r.player_id, "season": int(r.season), "k": key, "tier": TIER[r.number_tm], "source": LEGACY_SRC})
        cov[key] = {"from": lo, "to": int(x.season.max()), "introduced": int(x.season.min())}
    sn = s[s.lg == "NBA"]
    for r in sn[sn.season.between(lo, hi)].itertuples():
        out.append({"pid": r.player_id, "season": int(r.season), "k": "allstar", "tier": None, "source": LEGACY_SRC, **({"r": True} if bool(r.replaced) else {})})
    present = set(sn.season.unique())
    cov["allstar"] = {"from": lo, "to": int(sn.season.max()), "introduced": int(sn.season.min()),
                      "noGame": [y for y in range(lo, int(sn.season.max()) + 1) if y not in present]}
    return out, cov


def id_universe() -> pd.DataFrame:
    """Every player-season in the source tables, whether or not the app shows a profile for it. Award recipients are
    validated against this, so a legitimate recipient below the app's minutes threshold is still accepted."""
    p = pd.read_csv(RAW / "Player Per Game.csv", usecols=["season", "player_id", "player"])
    return p[p.season.between(C.SEASON_MIN, C.SEASON_MAX)]


def champion_appearances(champions: dict[int, str]) -> tuple[dict[int, set[str]], list]:
    """Players who appeared in a playoff game for the title team (play-by-play). Says nothing about ring recipients."""
    A = pd.read_csv(RAW / "sim" / "po_appearances.csv")
    X = pd.read_csv(ROOT / "analysis" / "crosswalk" / "nba_to_bbr.csv")
    X = X[X.status.isin(["verified", "verified_stats_only_name_differs"])].drop_duplicates(["nba_id", "season"])
    A["team"] = [GB.to_bbr(t, s_) for t, s_ in zip(A.team, A.season)]
    A = A[[champions.get(int(s_)) == t for s_, t in zip(A.season, A.team)]]
    P = A.groupby(["season", "team", "nba_id"]).game_id.nunique().reset_index(name="games")
    P = P.merge(X[["nba_id", "season", "bbr_id"]], on=["nba_id", "season"], how="left")
    players: dict[int, set[str]] = {}
    unmapped = []
    for r in P.itertuples():
        if isinstance(r.bbr_id, str):
            players.setdefault(int(r.season), set()).add(r.bbr_id)
        else:
            unmapped.append((int(r.season), r.team, int(r.nba_id), int(r.games)))
    return players, unmapped


def run_validation(d: F.Data, br: dict, directory: Path | None = None) -> tuple[HS.Ctx, dict, dict]:
    tables, errs = HS.read_csv_dir(HS.SRC_DIR, list(HS.REQUIRED), HS.REQUIRED)
    extra, errs2 = HS.load_user_import(directory or HS.IMPORT_DIR)
    legacy, legacy_cov = legacy_facts()
    champ_players, unmapped = champion_appearances(br["champions"])
    brackets = {int(k): v for k, v in br["brackets"].items()}
    ctx = HS.Ctx(id_universe(), brackets, br["champions"], champ_players, set(zip(d.players.player_id, d.players.season.astype(int))), legacy)
    res = HS.validate(ctx, tables, extra)
    res["errors"] = [*errs, *errs2, *res["errors"]]
    res["unmapped_champion_players"] = unmapped
    res["legacy_cov"] = legacy_cov
    for y in legacy_cov["allstar"].get("noGame", []):
        res["status"]["allstar"][y] = "no game"
    res["champ_players"] = champ_players
    return ctx, res, {"tables": tables, "extra": extra}


def build_honors_json(ctx: HS.Ctx, res: dict) -> dict:
    lo, hi = C.SEASON_MIN, C.SEASON_MAX
    honors: dict[str, dict[str, list]] = {}
    shared: dict[tuple, int] = {}
    for f in res["facts"]:
        if f["k"] in HS.AWARDS:
            shared[(f["season"], f["k"])] = shared.get((f["season"], f["k"]), 0) + 1
    seen = set()
    for f in res["facts"]:
        item = {"k": f["k"]}
        if f.get("tier"):
            item["t"] = f["tier"]
        if f.get("tm"):
            item["tm"] = f["tm"]
        if f.get("s") or (f["k"] in HS.AWARDS and shared[(f["season"], f["k"])] > 1):
            item["s"] = True
        if f.get("r"):
            item["r"] = True
        key = (f["pid"], f["season"], f["k"], f.get("tier"))
        if key in seen:
            continue
        seen.add(key)
        honors.setdefault(f["pid"], {}).setdefault(str(f["season"]), []).append(item)
    for pid, se, in ((p, s) for p, m in res["champ_players"].items() for s in [p]):
        pass
    # champion: appeared in a playoff game for the title team (derived from the game results)
    for season, pids in res["champ_players"].items():
        ab = res["champ_abbr"].get(season) or ctx.champions.get(season)
        for pid in sorted(pids):
            if (pid, season) in ctx.pairs:
                honors.setdefault(pid, {}).setdefault(str(season), []).append({"k": "champion", "tm": ab})
    for pid in honors:
        for season in honors[pid]:
            honors[pid][season].sort(key=lambda it: (it["k"], it.get("t", 0)))
    st = res["status"]
    cov: dict[str, dict] = {}
    for key, c in res["legacy_cov"].items():
        cov[key] = dict(c)
    for key in HS.AWARDS + tuple(HS.TEAM_AWARDS):
        got = [s for s, v in st[key].items() if v in ("verified", HS.SINGLE)]
        if got:
            cov.setdefault(key, {"from": lo, "to": max(got), "introduced": min(got)})["to"] = max(got)
    fm = [s for s, v in st["finalsmvp"].items() if v in ("verified", HS.SINGLE)]
    cov["finalsmvp"] = {"from": min(fm), "to": max(fm), "introduced": 1969} if len(fm) else None
    if cov["finalsmvp"] and sorted(fm) != list(range(min(fm), max(fm) + 1)):
        cov["finalsmvp"]["gaps"] = [s for s in range(min(fm), max(fm) + 1) if s not in fm]
    ct = [s for s, v in st["champion_team"].items() if v in ("verified", "derived")]
    cov["champion"] = {"from": lo, "to": max(ct), "introduced": 1947,
                       "basis": "played in a playoff game for the team that won the title (game results); the team's title is cross-checked against independent sources"} if ct else None
    cr = sorted({f["season"] for f in res["facts"] if f["k"] == "ring"})
    cov["ring"] = {"from": lo, "to": hi, "introduced": 1947, "seasons": cr, "basis": "listed as a member of the championship team (Finals MVP lists or an import); not a full roster list"} if cr else None

    def codes(cat):
        return "".join(HS.STATUS_CODE.get(st[cat].get(s, "missing"), "?") for s in range(lo, hi + 1))
    for key in list(HS.AWARDS) + list(HS.TEAM_AWARDS) + ["allstar", "finalsmvp", "champion_team", "champion_roster"]:
        out_key = {"champion_team": "champion", "champion_roster": "ring"}.get(key, key)
        if cov.get(out_key):
            cov[out_key]["status"] = codes(key)
    return {"dataVersion": C.DATA_VERSION,
            "note": "Season = the year the season ends (2005 = 2004-05). Winners only: voting placements are not stored. coverage.<award>.status has one letter per season "
                    "from 1996-97 (V verified by two or more sources, S one source, D derived, P partial, - missing).",
            "coverage": cov, "players": honors}


def stage_reports(ctx: HS.Ctx, res: dict, honors_obj: dict, inputs: dict):
    meta = json.loads((HS.SRC_DIR / "sources.json").read_text())
    paths = sorted(HS.SRC_DIR.glob("*.csv")) + [RAW / n for n in ("Player Award Shares.csv", "End of Season Teams.csv", "All-Star Selections.csv", "Player Per Game.csv")]
    if HS.IMPORT_DIR.exists():
        paths += sorted(HS.IMPORT_DIR.glob("*.csv"))
    hashes = HS.manifest(paths)
    flat = pd.DataFrame([{"player_id": f["pid"], "season": f["season"], "category": f["k"], "team_level": f.get("tier") or "", "team": f.get("tm") or "",
                          "status": f["status"], "sources": ";".join(f["sources"]),
                          "app_profile": (f["pid"], f["season"]) in ctx.app_pairs} for f in res["facts"]]).sort_values(["season", "category", "team_level", "player_id"])
    stage_text(DOCS / "honors_facts.csv", flat.to_csv(index=False))
    stage_text(DOCS / "honors_validation_report.md", HS.report_markdown(res, meta["sources"], hashes))
    counts = flat.groupby("category").size().to_dict()
    per_cat_status = flat.groupby(["category", "status"]).size().unstack(fill_value=0).to_dict("index")
    dump(DOCS / "honors_validation.json", {
        "dataVersion": C.DATA_VERSION, "sources": meta["sources"], "not_available": meta["not_available"], "source_hashes": hashes,
        "ok": not res["errors"], "errors": res["errors"], "quarantine": res["quarantine"], "notes": res["notes"],
        "status": {k: {str(s): v for s, v in m.items()} for k, m in res["status"].items()},
        "champions": res["champions"], "seeds": res["seed_report"],
        "fact_counts": counts, "fact_status_counts": per_cat_status,
        "recipients_without_app_profile": [list(x) for x in res["profile_less"]],
        "champion_players_without_player_data": res["unmapped_champion_players"],
        "champion_roster_sizes": {str(k): len(v) for k, v in sorted(res["champ_players"].items())},
    }, pretty=True)
    # the older coverage file, kept for continuity
    checks = {"categories": honors_obj["coverage"], "counts": counts, "recipients_without_app_profile": len(res["profile_less"]),
              "champion_players_without_app_data": res["unmapped_champion_players"]}
    dump(DOCS / "honors_coverage.json", checks, pretty=True)


def main(directory: Path | None = None, dry_run: bool = False) -> int:
    d = F.Data()
    STAGED.clear()
    feats = export_features(d)
    teams = export_teams(d)
    br = build_brackets(d)
    ctx, res, inputs = run_validation(d, br, directory)
    if res["errors"]:
        print("VALIDATION FAILED. Nothing was written; the existing app data is unchanged.")
        for e in res["errors"]:
            print(f" - [{e['kind']}] {e['category']} {e['season']}: {e['detail']}")
        return 1
    br = apply_seeds(br, res["seeds"])
    stage_brackets(br)
    honors_obj = build_honors_json(ctx, res)
    dump(PUB / "honors.json", honors_obj)
    stage_reports(ctx, res, honors_obj, inputs)
    print("features seasons", len(feats), "teams", len(teams), "supported brackets", sum(v["supported"] for v in br["status"].values()))
    print("home rule", br["rules"])
    print("quarantined", len(res["quarantine"]), "| facts", len(res["facts"]))
    if dry_run:
        print("Check only: valid. Nothing was written.")
        return 0
    out = commit()
    print("written", len(out["written"]), "unchanged", out["unchanged"])
    for w in out["written"]:
        print("  ", w)
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main(dry_run="--check" in sys.argv))
