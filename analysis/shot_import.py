"""Import, validate, reconcile and export real shot locations from the combined shotdetail.parquet.

SOURCE (provenance is also written to public/data/shots/manifest.json):
    https://huggingface.co/datasets/cdechoch/nba-data-archive/blob/main/merged/shotdetail.parquet
    A Parquet mirror of stats.nba.com shot-chart detail collected by Vladislav Shufinskiy (shufinskiy/nba_data).
    The dataset card lists apache-2.0 for the mirror and names upstream sources stats.nba.com, data.nba.com,
    cdn.nba.com and pbpstats.com. That licence does NOT by itself settle upstream redistribution rights.

COORDINATES (verified from the data, not assumed; the earlier CSV used a different system):
    LOC_X, LOC_Y are integer TENTHS OF A FOOT with the HOOP AT THE ORIGIN. LOC_Y grows away from the baseline
    (baseline is y = -52.5), LOC_X is negative on the shooter's LEFT (left-corner threes sit near x = -231).
    SHOT_DISTANCE == floor(hypot(x, y) / 10) for 100% of rows in every season.
    SVG court (viewBox 500 x 400, 10 units per foot): svg_x = 250 + x, svg_y = 52.5 + y.

SEASONS: the file's `_season` is the STARTING year (2008 = 2008-09); COURT DNA uses the ENDING year (2009).
    app_season = _season + 1, confirmed against game dates and the game-id season digits for every season.
    `_season_type`: 'rg' regular season (game ids 002...), 'po' playoffs (004...). Only regular season is integrated.

ZONES (one implementation, integer arithmetic, mirrored in lib/shotLocations.ts):
    3PT      = SHOT_TYPE == '3PT Field Goal' (all heaves; a missing SHOT_TYPE falls back to the source zone name)
    Deep 3PT = a 3PT with x*x + y*y >= 300**2 (30 ft or more from the basket; integer tenths, so exactly 30 ft is deep).
               "x3p" therefore means three-pointers UNDER 30 ft; x3p + x3d is every three-point attempt. A two-point
               label is never deep, whatever its distance.
    0-3 ft   = two-pointers with x*x + y*y < 30**2
    3-10 ft  = < 100**2 ; 10-16 ft = < 160**2 ; 16 ft-3PT = everything else (distances in tenths of a foot)

RUN
    pip install -r requirements.txt          # includes pyarrow
    python3 analysis/shot_import.py --parquet /path/to/shotdetail.parquet
    python3 analysis/step6_export_frontend_data.py
Options: --seasons 2009 2026 (app seasons), --force (ignore the resumable stage), --stage-only.

SAFETY: every season is processed into raw/shots/stage/ (git-ignored) and validated first. Production files under
public/data/shots/ are replaced only by a verified, staged tree via rename; a season that fails validation keeps its
previous production export (recorded as retained in the manifest). Stale files are removed only after the swap.
"""
import argparse
import datetime
import hashlib
import json
import math
import os
import re
import shutil
import sys
import unicodedata

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
import config  # noqa: E402
import utils  # noqa: E402

REPO = utils.repo_root()
SOURCE_URL = "https://huggingface.co/datasets/cdechoch/nba-data-archive/blob/main/merged/shotdetail.parquet"
FORMAT_VERSION = 2
ZONES = ["x0_3", "x3_10", "x10_16", "x16_3p", "x3p", "x3d"]
DEEP_D2 = 300 * 300   # 30 ft in squared tenths of a foot
THREE = "3PT Field Goal"
# bounds (tenths of a foot, hoop at origin): |x| <= 25 ft; baseline at y = -52.5; far baseline at y = 887.5
X_MAX, Y_MIN, Y_MAX = 250, -53, 888
# part of the half court that the SVG draws (svg_y = 52.5 + y in [0, 400])
DRAWN_Y_MIN, DRAWN_Y_MAX = -52, 347
PACK_X_OFFSET, PACK_Y_OFFSET = 250, 100       # packed as two base-36 characters each (values 0..1295)
CROSSWALK_TOLERANCE = 3                       # strict (stats-only) identity tolerance, attempts and makes
NAME_SHORTFALL_FRACTION = 0.05                # name+team identities may be this much short of the trusted total
LEAGUE_COVERAGE_MIN, LEAGUE_COVERAGE_MAX = 0.995, 1.005
TEAM_FGA_TOLERANCE = 0.01
MIN_DIST_AGREEMENT = 0.999
LABEL_MISMATCH_MAX = 0.01                     # 3PT label vs drawn-line geometry; 1996-97 uses the 22-ft line
SHORT_LINE_SEASONS = {1997}                   # three-point line was 22 ft all the way around through 1996-97

# NBA TEAM_ID -> [(first app season, Basketball-Reference code)]. NBA ids are stable per franchise; the codes
# change with relocations. This table is VERIFIED, not derived: team field-goal attempts from the file must equal
# the Basketball-Reference team totals within TEAM_FGA_TOLERANCE for every team-season (validate_teams).
FRANCHISES = {
    1610612737: [(1997, "ATL")], 1610612738: [(1997, "BOS")], 1610612739: [(1997, "CLE")],
    1610612740: [(2003, "NOH"), (2006, "NOK"), (2008, "NOH"), (2014, "NOP")],
    1610612741: [(1997, "CHI")], 1610612742: [(1997, "DAL")], 1610612743: [(1997, "DEN")], 1610612744: [(1997, "GSW")],
    1610612745: [(1997, "HOU")], 1610612746: [(1997, "LAC")], 1610612747: [(1997, "LAL")], 1610612748: [(1997, "MIA")],
    1610612749: [(1997, "MIL")], 1610612750: [(1997, "MIN")], 1610612751: [(1997, "NJN"), (2013, "BRK")],
    1610612752: [(1997, "NYK")], 1610612753: [(1997, "ORL")], 1610612754: [(1997, "IND")], 1610612755: [(1997, "PHI")],
    1610612756: [(1997, "PHO")], 1610612757: [(1997, "POR")], 1610612758: [(1997, "SAC")], 1610612759: [(1997, "SAS")],
    1610612760: [(1997, "SEA"), (2009, "OKC")], 1610612761: [(1997, "TOR")], 1610612762: [(1997, "UTA")],
    1610612763: [(1997, "VAN"), (2002, "MEM")], 1610612764: [(1997, "WSB"), (1998, "WAS")], 1610612765: [(1997, "DET")],
    1610612766: [(1997, "CHH"), (2005, "CHA"), (2015, "CHO")],
}
_TEAM_LUT = {tid: sorted(rows) for tid, rows in FRANCHISES.items()}


def team_code(team_id, season):
    rows = [c for first, c in _TEAM_LUT[int(team_id)] if first <= season]
    if not rows:
        raise ValueError(f"team id {team_id} has no code for season {season}")
    return rows[-1]


# ----------------------------------------------------------------------------- geometry (shared definitions)
def zone_index(x, y, three):
    """Vectorised zone index into ZONES from integer tenths-of-a-foot coordinates (no floating point)."""
    x = np.asarray(x, dtype=np.int64)
    y = np.asarray(y, dtype=np.int64)
    d2 = x * x + y * y
    z = np.where(d2 < 900, 0, np.where(d2 < 10000, 1, np.where(d2 < 25600, 2, 3)))
    return np.where(np.asarray(three, dtype=bool), np.where(d2 >= DEEP_D2, 5, 4), z)


def zone_of(x, y, three):
    return ZONES[int(zone_index([x], [y], [three])[0])]


def to_svg(x, y):
    """Source (hoop-origin tenths of a foot) -> SVG court units. Left corner (x ~ -231) lands at the viewer's left."""
    return 250.0 + x, 52.5 + y


def is_drawn(x, y):
    x = np.asarray(x)
    y = np.asarray(y)
    return (np.abs(x) <= X_MAX) & (y >= DRAWN_Y_MIN) & (y <= DRAWN_Y_MAX)


def app_season_of(source_season):
    return int(source_season) + 1


def season_label(app_season):
    return f"{app_season - 1}-{str(app_season)[2:]}"


def game_id_info(game_id):
    """GAME_ID is stored without its leading zeros (0022100001 -> 22100001). Returns (type, season-start-yy)."""
    g = str(int(game_id)).zfill(10)
    return {"001": "preseason", "002": "regular", "003": "all-star", "004": "playoffs"}.get(g[:3], "unknown"), int(g[3:5])


# ----------------------------------------------------------------------------- names
def repair_text(s):
    """The file contains UTF-8 text decoded as Latin-1 ('DantÃ©'). Repair it; leave clean text untouched."""
    if isinstance(s, str) and re.search("[\u00c2-\u00f4][\u0080-\u00bf]", s):
        try:
            return s.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            return s
    return s


def norm_name(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", s)
    return re.sub(r"[^a-z0-9]", "", s)


# ----------------------------------------------------------------------------- load + inventory
SOURCE_COLUMNS = ["GRID_TYPE", "GAME_ID", "GAME_EVENT_ID", "PLAYER_ID", "PLAYER_NAME", "TEAM_ID", "TEAM_NAME", "PERIOD",
                  "MINUTES_REMAINING", "SECONDS_REMAINING", "EVENT_TYPE", "ACTION_TYPE", "SHOT_TYPE", "SHOT_ZONE_BASIC",
                  "SHOT_ZONE_AREA", "SHOT_ZONE_RANGE", "SHOT_DISTANCE", "LOC_X", "LOC_Y", "SHOT_ATTEMPTED_FLAG",
                  "SHOT_MADE_FLAG", "GAME_DATE", "HTM", "VTM", "_season", "_season_type"]


def load_parquet(path):
    import pyarrow.parquet as pq
    df = pq.read_table(path).to_pandas()
    missing = [c for c in SOURCE_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"parquet is missing columns {missing}")
    for c in ("PLAYER_NAME", "TEAM_NAME", "SHOT_TYPE", "EVENT_TYPE", "SHOT_ZONE_BASIC", "SHOT_ZONE_AREA", "_season_type"):
        df[c] = df[c].astype("category")
    return df


def inventory(df):
    """One row per source season and season type, straight from the file (no assumptions)."""
    rows = []
    for (s, t), g in df.groupby(["_season", "_season_type"], observed=True):
        dates = pd.to_datetime(g["GAME_DATE"].astype(str), format="%Y%m%d")
        nulls = {k: int(v) for k, v in g.isna().sum().items() if v}
        rows.append({"source_season": int(s), "app_season": app_season_of(s), "label": season_label(app_season_of(s)),
                     "season_type": "regular" if t == "rg" else "playoffs", "shots": int(len(g)), "games": int(g["GAME_ID"].nunique()),
                     "players": int(g["PLAYER_ID"].nunique()), "date_min": str(dates.min().date()), "date_max": str(dates.max().date()),
                     "null_cells": nulls})
    return rows


# ----------------------------------------------------------------------------- per-season validation
def validate_season(sub, source_season, in_app_range):
    """Hard checks on one regular-season slice. Returns (report, failures)."""
    f, r = [], {"rows": int(len(sub))}
    app = app_season_of(source_season)
    nulls = {k: int(v) for k, v in sub[SOURCE_COLUMNS].isna().sum().items() if v}
    r["null_cells"] = nulls
    for k, v in nulls.items():
        if k != "SHOT_TYPE" or v / len(sub) > 1e-4:
            f.append(f"null values in {k}: {v}")
    r["missing_shot_type_rows"] = int(sub["SHOT_TYPE"].isna().sum())
    r["games"] = int(sub["GAME_ID"].nunique())
    r["players"] = int(sub["PLAYER_ID"].nunique())
    dates = pd.to_datetime(sub["GAME_DATE"].astype(str), format="%Y%m%d")
    r["date_range"] = [str(dates.min().date()), str(dates.max().date())]
    lo, hi = pd.Timestamp(source_season, 10, 1), pd.Timestamp(source_season + 1, 8, 31)
    r["season_convention_ok"] = bool(dates.min() >= lo and dates.max() <= hi)
    if not r["season_convention_ok"]:
        f.append(f"game dates {r['date_range']} are not inside {season_label(app)} (start-year convention check)")
    gi = sub["GAME_ID"].drop_duplicates().map(game_id_info)
    types = {t for t, _ in gi}
    yy = {y for _, y in gi}
    r["game_id_types"] = sorted(types)
    r["game_id_season_digits"] = sorted(yy)
    if types != {"regular"} or yy != {source_season % 100}:
        f.append(f"game ids disagree with season/type (types {types}, season digits {yy})")
    r["duplicate_event_keys"] = int(sub.duplicated(["GAME_ID", "GAME_EVENT_ID", "PLAYER_ID"]).sum())
    r["duplicate_game_event_pairs"] = int(sub.duplicated(["GAME_ID", "GAME_EVENT_ID"]).sum())
    if r["duplicate_event_keys"] or r["duplicate_game_event_pairs"]:
        f.append("duplicate event keys (GAME_ID, GAME_EVENT_ID[, PLAYER_ID])")
    made = sub["SHOT_MADE_FLAG"].to_numpy()
    r["outcome_values"] = sorted(int(v) for v in np.unique(made))
    r["event_vs_outcome_mismatch"] = int(((sub["EVENT_TYPE"] == "Made Shot").to_numpy() != (made == 1)).sum())
    if set(r["outcome_values"]) - {0, 1} or r["event_vs_outcome_mismatch"] or (sub["SHOT_ATTEMPTED_FLAG"] != 1).any():
        f.append("made/missed or attempted flags are inconsistent")
    x = sub["LOC_X"].to_numpy(dtype=np.int64)
    y = sub["LOC_Y"].to_numpy(dtype=np.int64)
    r["bounds"] = {"x": [int(x.min()), int(x.max())], "y": [int(y.min()), int(y.max())]}
    r["out_of_bounds"] = int(((np.abs(x) > X_MAX) | (y < Y_MIN) | (y > Y_MAX)).sum())
    if r["out_of_bounds"]:
        f.append("coordinates outside the 50 x 94 ft court")
    dist = np.floor(np.hypot(x, y) / 10)
    r["distance_floor_agreement"] = round(float((dist == sub["SHOT_DISTANCE"].to_numpy()).mean()), 5)
    if r["distance_floor_agreement"] < MIN_DIST_AGREEMENT:
        f.append("hoop-origin distance disagrees with SHOT_DISTANCE (units/origin assumption wrong?)")
    area = sub["SHOT_ZONE_AREA"].astype(str)
    left, right = x[area.isin(["Left Side(L)", "Left Side Center(LC)"]).to_numpy()], x[area.isin(["Right Side(R)", "Right Side Center(RC)"]).to_numpy()]
    lc = x[(sub["SHOT_ZONE_BASIC"] == "Left Corner 3").to_numpy()]
    rc = x[(sub["SHOT_ZONE_BASIC"] == "Right Corner 3").to_numpy()]
    r["orientation"] = {"left_corner_mean_x": round(float(lc.mean()), 1), "right_corner_mean_x": round(float(rc.mean()), 1),
                        "left_side_negative_share": round(float((left < 0).mean()), 4), "right_side_positive_share": round(float((right > 0).mean()), 4),
                        "convention": "x < 0 = shooter's left; svg_x = 250 + x"}
    if not (lc.mean() < -200 and rc.mean() > 200 and (left < 0).mean() > 0.999 and (right > 0).mean() > 0.999):
        f.append("orientation check failed (left/right corners or zone areas disagree with the sign of x)")
    three_label = (sub["SHOT_TYPE"] == THREE).to_numpy()
    d2 = x * x + y * y
    line = 220 if app in SHORT_LINE_SEASONS else 237.5
    corner = 220
    geo3 = (d2 >= line * line) | ((np.abs(x) > corner) if app not in SHORT_LINE_SEASONS else False)
    typed = sub["SHOT_TYPE"].notna().to_numpy()
    mism = int(((three_label != geo3) & typed).sum())
    r["three_label_vs_drawn_line"] = {"line_ft": line / 10, "mismatches": mism, "rate": round(mism / len(sub), 5),
                                      "labelled_3_but_inside_line": int((three_label & ~geo3 & typed).sum()), "labelled_2_but_outside_line": int((~three_label & geo3 & typed).sum()),
                                      "policy": "SHOT_TYPE decides 2PT/3PT (reconciles with trusted 3PA); coordinates decide the two-point rings"}
    if mism / len(sub) > LABEL_MISMATCH_MAX:
        f.append("3PT labels disagree with the drawn three-point line for more than 1% of shots")
    drawn = is_drawn(x, y)
    r["beyond_drawn_court"] = {"shots": int((~drawn).sum()), "three_pointers": int((~drawn & three_label).sum()), "made": int((~drawn & (made == 1)).sum()),
                               "policy": "counted in the zone totals (3PT by shot type), never drawn, never moved; the count is shown to the user"}
    r["recorded_at_hoop_centre"] = {"shots": int(((x == 0) & (y == 0)).sum()), "share": round(float(((x == 0) & (y == 0)).mean()), 4),
                                    "note": "exact hoop-centre coordinates (the source snaps many rim attempts there; share varies by season); kept as supplied, never jittered"}
    r["in_app_range"] = bool(in_app_range)
    return r, f


def validate_teams(sub, trusted_all, season):
    """Verify the franchise table: team FGA in the file vs Basketball-Reference team totals (same code)."""
    st = trusted_all[(trusted_all.season == season) & (~trusted_all.agg_row)]
    bt = st.groupby("team").fga.sum()
    codes = [team_code(t, season) for t in sub["TEAM_ID"].to_numpy()]
    pt = pd.Series(1, index=pd.Index(codes, name="team")).groupby(level=0).sum()
    rows, fails = [], []
    for code in sorted(set(bt.index) | set(pt.index)):
        a, b = int(pt.get(code, 0)), int(bt.get(code, 0))
        rows.append({"season": season, "team": code, "file_fga": a, "trusted_fga": b, "diff": b - a})
        if a == 0 or b == 0 or abs(b - a) > max(5, TEAM_FGA_TOLERANCE * b) or a - b > 5:
            fails.append(f"team {code}: file {a} vs trusted {b}")
    return rows, fails


# ----------------------------------------------------------------------------- trusted totals + crosswalk
def trusted_all():
    """Canonical one-row-per-player-season Basketball-Reference totals (aggregate 2TM/3TM row for traded players) and stints."""
    tot = utils.filter_nba_seasons(utils.load_raw("Player Totals.csv")).copy()
    tot["agg_row"] = tot.team.apply(utils.is_aggregate_team_row)
    return tot


def trusted_season(tot, season):
    t = tot[tot.season == season]
    can = t.sort_values(["player_id", "agg_row"], ascending=[True, False]).drop_duplicates("player_id").copy()
    stints = t[(~t.agg_row) & (t.fga > 0)].groupby("player_id").team.apply(lambda s: tuple(sorted(set(s))))
    can["teams"] = [stints.get(p, (tm,)) for p, tm in zip(can.player_id, can.team)]   # a zero-FGA stint leaves no shots in the file
    can["n"] = can.player.map(norm_name)
    return can.reset_index(drop=True)


def build_crosswalk(sub, trusted, season, known_ids):
    """One row per NBA player id. Names only GENERATE candidates; an identity is accepted only when team set, attempts,
    makes and games agree with the Basketball-Reference totals and the pairing is one-to-one in the season.
    `known_ids` maps NBA id -> set of BBR ids already verified in other seasons (cross-season tie-break)."""
    sub = sub.assign(team=[team_code(t, season) for t in sub["TEAM_ID"].to_numpy()])
    g = sub.groupby("PLAYER_ID").agg(nba_name=("PLAYER_NAME", "first"), fga=("SHOT_MADE_FLAG", "size"), fgm=("SHOT_MADE_FLAG", "sum"),
                                      games=("GAME_ID", "nunique"), teams=("team", lambda s: tuple(sorted(set(s))))).reset_index()
    g["nba_name"] = g.nba_name.astype(str).map(repair_text)
    g["n"] = g.nba_name.map(norm_name)
    by_name = {}
    for i, n in enumerate(trusted.n):
        by_name.setdefault(n, []).append(i)
    tr = list(trusted.itertuples(index=False))

    def strict(r, b):
        return b.teams == r.teams and abs(b.fga - r.fga) <= CROSSWALK_TOLERANCE and abs(b.fg - r.fgm) <= CROSSWALK_TOLERANCE and r.games <= b.g

    def tolerant(r, b):   # name candidate: same team set, never over by more than the strict tolerance, short by <= 5%
        tol = max(CROSSWALK_TOLERANCE, math.ceil(NAME_SHORTFALL_FRACTION * b.fga))
        return b.teams == r.teams and -CROSSWALK_TOLERANCE <= b.fga - r.fga <= tol and -CROSSWALK_TOLERANCE <= b.fg - r.fgm <= tol and r.games <= b.g + 1

    rows = []
    for r in g.itertuples(index=False):
        cands = [tr[i] for i in by_name.get(r.n, [])]
        method, ok = "name+stats", [b for b in cands if strict(r, b)]
        if not ok:
            ok = [b for b in cands if tolerant(r, b)]
            method = "name+stats_tolerant" if ok else method
        if not ok:
            ok = [b for b in tr if strict(r, b)]
            method = "stats_only"
        if len(ok) > 1:
            exact = [b for b in ok if b.fga == r.fga and b.fg == r.fgm]
            known = known_ids.get(int(r.PLAYER_ID), set())
            pick = exact if len(exact) == 1 else [b for b in ok if b.player_id in known]
            if len(pick) == 1:
                method += "+exact_tiebreak" if len(exact) == 1 else "+cross_season_tiebreak"
                ok = pick
        base = {"nba_id": int(r.PLAYER_ID), "nba_name": r.nba_name, "season": season, "fga_file": int(r.fga), "fgm_file": int(r.fgm),
                "games_file": int(r.games), "teams_file": "|".join(r.teams), "n_name_candidates": len(cands)}
        if len(ok) == 1:
            b = ok[0]
            rows.append({**base, "bbr_id": b.player_id, "bbr_name": b.player, "method": method,
                         "status": "verified" if method.startswith("name") else "verified_stats_only_name_differs",
                         "fga_bbr": int(b.fga), "fgm_bbr": int(b.fg), "games_bbr": int(b.g), "teams_bbr": "|".join(b.teams), "exact": bool(b.fga == r.fga and b.fg == r.fgm)})
        else:
            rows.append({**base, "bbr_id": "", "bbr_name": "", "method": method, "status": "ambiguous" if len(ok) > 1 else ("evidence_failed" if cands else "unmatched"),
                         "fga_bbr": "", "fgm_bbr": "", "games_bbr": "", "teams_bbr": "", "exact": False})
    cw = pd.DataFrame(rows)
    dup = (cw.bbr_id != "") & cw.duplicated("bbr_id", keep=False)
    cw.loc[dup, ["status", "bbr_id", "bbr_name"]] = ["ambiguous", "", ""]            # one-to-one within the season
    return cw


def cross_season_conflicts(cw_all):
    """An NBA id must map to ONE Basketball-Reference id in every season, and vice versa."""
    v = cw_all[cw_all.status.isin(["verified", "verified_stats_only_name_differs"])]
    a = v.groupby("nba_id").bbr_id.nunique()
    b = v.groupby("bbr_id").nba_id.nunique()
    return sorted(a[a > 1].index.tolist()), sorted(b[b > 1].index.tolist())


# ----------------------------------------------------------------------------- per-player encoding
_B36 = "0123456789abcdefghijklmnopqrstuvwxyz"
_LUT = np.array([_B36[i // 36] + _B36[i % 36] for i in range(1296)])
_FLAGS = np.array(list("0123"))


def pack_shots(x, y, made, three):
    """5 characters per shot: x+250 (base36 x2), y+100 (base36 x2), flag (made + 2*three)."""
    xv, yv = np.asarray(x, dtype=np.int64) + PACK_X_OFFSET, np.asarray(y, dtype=np.int64) + PACK_Y_OFFSET
    if xv.min() < 0 or xv.max() > 1295 or yv.min() < 0 or yv.max() > 1295:
        raise ValueError("coordinate outside the packable range; refusing to clamp")
    flag = _FLAGS[np.asarray(made, dtype=np.int64) + 2 * np.asarray(three, dtype=np.int64)]
    return "".join(np.char.add(np.char.add(_LUT[xv], _LUT[yv]), flag).tolist())


def unpack_shots(s):
    """Inverse of pack_shots -> (x, y, made, three) arrays (used by tests and validation)."""
    n = len(s) // 5
    xs, ys, fl = np.empty(n, np.int64), np.empty(n, np.int64), np.empty(n, np.int64)
    for i in range(n):
        o = i * 5
        xs[i] = int(s[o:o + 2], 36) - PACK_X_OFFSET
        ys[i] = int(s[o + 2:o + 4], 36) - PACK_Y_OFFSET
        fl[i] = int(s[o + 4])
    return xs, ys, (fl & 1).astype(bool), (fl >> 1).astype(bool)


def shot_three_flags(sub):
    """3PT by SHOT_TYPE; a missing SHOT_TYPE falls back to the source's own zone name (disclosed in the report)."""
    st = sub["SHOT_TYPE"].astype(object)
    zb = sub["SHOT_ZONE_BASIC"].astype(str)
    fallback = zb.str.contains("3")
    return np.where(st.isna(), fallback, st == THREE).astype(bool)


def encode_player(sub, bbr_id, nba_id, season, trusted_fga, trusted_fgm):
    sub = sub.sort_values(["GAME_ID", "GAME_EVENT_ID"], kind="stable")
    x, y = sub["LOC_X"].to_numpy(np.int64), sub["LOC_Y"].to_numpy(np.int64)
    made, three = sub["SHOT_MADE_FLAG"].to_numpy(np.int64), shot_three_flags(sub)
    att, mk = int(len(sub)), int(made.sum())
    zi = zone_index(x, y, three)
    zones = {z: [int((zi == i).sum()), int(made[zi == i].sum())] for i, z in enumerate(ZONES)}
    exact = att == trusted_fga and mk == trusted_fgm
    enc = {"v": FORMAT_VERSION, "player_id": bbr_id, "nba_id": int(nba_id), "season": int(season), "season_type": "regular",
           "attempts": att, "makes": mk, "trusted_fga": int(trusted_fga), "trusted_fgm": int(trusted_fgm),
           "status": "exact" if exact else ("partial" if att < trusted_fga else "differs"), "coverage": round(att / trusted_fga, 4) if trusted_fga else None,
           "undrawn": int((~is_drawn(x, y)).sum()), "at_hoop_centre": int(((x == 0) & (y == 0)).sum()), "s": pack_shots(x, y, made, three)}
    return enc, zones


def summary_record(enc, zones):
    return {k: enc[k] for k in ("status", "attempts", "makes", "trusted_fga", "trusted_fgm", "coverage", "undrawn", "at_hoop_centre")} | {"zones": zones}


def season_baseline(sub, trusted_league_fga):
    three = shot_three_flags(sub)
    x, y, made = sub["LOC_X"].to_numpy(np.int64), sub["LOC_Y"].to_numpy(np.int64), sub["SHOT_MADE_FLAG"].to_numpy(np.int64)
    zi = zone_index(x, y, three)
    att = int(len(sub))
    zones = {}
    for i, z in enumerate(ZONES):
        a, m = int((zi == i).sum()), int(made[zi == i].sum())
        zones[z] = {"attempts": a, "makes": m, "share": round(a / att, 4), "fg_pct": round(m / a, 4) if a else None}
    return {"season_type": "regular", "population": "every recorded regular-season shot in the source file (all players)", "exact_counts": True,
            "attempts": att, "makes": int(made.sum()), "trusted_league_fga": int(trusted_league_fga), "coverage": round(att / trusted_league_fga, 4),
            "players": int(sub["PLAYER_ID"].nunique()), "zones": zones}


# ----------------------------------------------------------------------------- file helpers
def write_json(path, obj, indent=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(obj, fh, indent=indent, sort_keys=True, separators=None if indent else (",", ":"), default=str)
    os.replace(tmp, path)


def file_sha(path):
    return utils.sha256_of_file(path)


def code_fingerprint():
    return hashlib.sha256(open(__file__, "rb").read()).hexdigest()[:16]


def stage_dir(*parts):
    return os.path.join(REPO, "raw", "shots", "stage", *[str(p) for p in parts])


# ----------------------------------------------------------------------------- process one season
def process_season(sub, source_season, tot, known_ids, display_ids, source_sha, in_app_range):
    """Validate, crosswalk, reconcile and encode one regular-season slice into the stage directory. Never touches production."""
    app = app_season_of(source_season)
    res = {"app_season": app, "label": season_label(app), "source_season": int(source_season), "status": None, "failures": [], "notes": []}
    report, fails = validate_season(sub, source_season, in_app_range)
    res["validation"] = report
    fails = list(fails)
    trusted = trusted_season(tot, app)
    team_rows, team_fails = validate_teams(sub, tot, app)
    res["team_totals"] = team_rows
    fails += team_fails
    cw = build_crosswalk(sub, trusted, app, known_ids)
    verified = cw[cw.status.isin(["verified", "verified_stats_only_name_differs"])]
    unresolved = cw[~cw.status.isin(["verified", "verified_stats_only_name_differs"])]
    res["crosswalk"] = {"nba_ids": int(len(cw)), "verified": int((cw.status == "verified").sum()),
                        "verified_stats_only_name_differs": int((cw.status == "verified_stats_only_name_differs").sum()),
                        "ambiguous": int((cw.status == "ambiguous").sum()), "unmatched": int((cw.status == "unmatched").sum()),
                        "evidence_failed": int((cw.status == "evidence_failed").sum()), "exact_totals": int(cw.exact.sum()),
                        "methods": cw.method.value_counts().to_dict(),
                        "unresolved": unresolved[["nba_id", "nba_name", "status", "fga_file", "fgm_file", "teams_file"]].to_dict("records")}
    unresolved_attempts = int(unresolved.fga_file.sum()) if len(unresolved) else 0
    res["crosswalk"]["unresolved_attempts"] = unresolved_attempts
    if unresolved_attempts > 0.005 * len(sub):
        fails.append(f"identities unresolved for {unresolved_attempts} attempts (>0.5%)")
    league_fga, league_fgm = int(trusted.fga.sum()), int(trusted.fg.sum())
    t3 = trusted[["x3pa", "x3p"]].sum()
    three = shot_three_flags(sub)
    made = sub["SHOT_MADE_FLAG"].to_numpy(np.int64)
    cov = len(sub) / league_fga
    res["league"] = {"file_fga": int(len(sub)), "trusted_fga": league_fga, "file_fgm": int(made.sum()), "trusted_fgm": league_fgm,
                     "file_3pa": int(three.sum()), "trusted_3pa": int(t3.x3pa), "file_3pm": int(made[three].sum()), "trusted_3pm": int(t3.x3p), "coverage": round(cov, 5)}
    xy2 = sub["LOC_X"].to_numpy(np.int64) ** 2 + sub["LOC_Y"].to_numpy(np.int64) ** 2
    deep = three & (xy2 >= DEEP_D2)
    res["league"]["deep_3pa"], res["league"]["deep_3pm"] = int(deep.sum()), int(made[deep].sum())
    res["league"]["deep_exactly_30ft"] = int((three & (xy2 == DEEP_D2)).sum())
    res["league"]["two_pointers_30ft_plus"] = int((~three & (xy2 >= DEEP_D2)).sum())   # labelled twos at 30+ ft: never deep threes
    if not (LEAGUE_COVERAGE_MIN <= cov <= LEAGUE_COVERAGE_MAX):
        fails.append(f"league coverage {cov:.4f} outside [{LEAGUE_COVERAGE_MIN}, {LEAGUE_COVERAGE_MAX}]")
    # players: encode every verified identity that has a record on the site
    trusted_idx = trusted.set_index("player_id")
    by_id = {r.nba_id: r for r in verified.itertuples()}
    out_dir = stage_dir(app, "files")
    shutil.rmtree(stage_dir(app), ignore_errors=True)
    os.makedirs(out_dir, exist_ok=True)
    players, rec_rows, size = {}, [], 0
    for nba_id, ps in sub.groupby("PLAYER_ID", sort=True):
        v = by_id.get(int(nba_id))
        if v is None:
            continue
        t = trusted_idx.loc[v.bbr_id]
        enc, zones = encode_player(ps, v.bbr_id, nba_id, app, int(t.fga), int(t.fg))
        three_p = [zones["x3p"][0] + zones["x3d"][0], zones["x3p"][1] + zones["x3d"][1]]   # ordinary + deep = every three-pointer
        rec_rows.append({"bbr_id": v.bbr_id, "attempts": enc["attempts"], "trusted_fga": enc["trusted_fga"], "makes": enc["makes"], "trusted_fgm": enc["trusted_fgm"],
                         "status": enc["status"], "three_att": three_p[0], "three_made": three_p[1], "trusted_3pa": int(t.x3pa), "trusted_3pm": int(t.x3p)})
        if v.bbr_id in display_ids:
            players[v.bbr_id] = summary_record(enc, zones)
            p = os.path.join(out_dir, f"{v.bbr_id}.json")
            write_json(p, enc)
            size += os.path.getsize(p)
    rec = pd.DataFrame(rec_rows)
    att_diff, fgm_diff = rec.trusted_fga - rec.attempts, rec.trusted_fgm - rec.makes
    res["players"] = {
        "verified_players": int(len(rec)), "exported_files": len(players), "exported_bytes": size, "exact": int((rec.status == "exact").sum()),
        "partial": int((rec.status != "exact").sum()), "short_of_trusted_attempts": int((att_diff > 0).sum()), "over_trusted_attempts": int((att_diff < 0).sum()),
        "attempts_diff_trusted_minus_file": {str(k): int(v) for k, v in att_diff.value_counts().sort_index().items()},
        "makes_diff_trusted_minus_file": {str(k): int(v) for k, v in fgm_diff.value_counts().sort_index().items()},
        "three_point_exact": int(((rec.three_att == rec.trusted_3pa) & (rec.three_made == rec.trusted_3pm)).sum()),
        "max_missing_attempts": int(att_diff.max()), "max_extra_attempts": int((-att_diff).max()),
        "site_players_without_shots": sorted(display_ids - set(rec.bbr_id)),
        "worst": [{"bbr_id": r.bbr_id, "file": int(r.attempts), "trusted": int(r.trusted_fga), "file_makes": int(r.makes), "trusted_makes": int(r.trusted_fgm)}
                  for r in rec.assign(d=att_diff.abs()).sort_values("d", ascending=False).head(8).itertuples()]}
    res["site_players_total"] = len(display_ids)
    res["baseline"] = season_baseline(sub, league_fga)
    res["summary_players"] = players
    res["crosswalk_rows"] = cw.sort_values("nba_id").to_dict("records")
    res["failures"] = fails
    res["status"] = "quarantined" if fails else "integrated"
    res["input_sha256"], res["code"] = source_sha, code_fingerprint()
    write_json(stage_dir(app, "result.json"), res)
    return res


def load_stage(app, source_sha):
    p = stage_dir(app, "result.json")
    if not os.path.exists(p):
        return None
    r = json.load(open(p))
    ok = r.get("input_sha256") == source_sha and r.get("code") == code_fingerprint() and (
        r["status"] != "integrated" or len(os.listdir(stage_dir(app, "files"))) == r["players"]["exported_files"])
    return r if ok else None


# ----------------------------------------------------------------------------- publish (staged, validated, swapped)
SHOTS_DIR = utils.public_data_path("shots")
SUMMARY_PATH = utils.data_path("shot_location_summary.json")
CROSSWALK_PATH = os.path.join(REPO, "analysis", "crosswalk", "nba_to_bbr.csv")
TEAM_CODES_PATH = os.path.join(REPO, "analysis", "crosswalk", "team_codes.csv")


def previous_production():
    """(manifest, summary) of the current production export, tolerating the earlier single-season formats."""
    man, summ = None, None
    mp = os.path.join(SHOTS_DIR, "manifest.json")
    if os.path.exists(mp):
        man = json.load(open(mp))
    elif os.path.exists(os.path.join(SHOTS_DIR, "sources.json")):
        old = json.load(open(os.path.join(SHOTS_DIR, "sources.json")))
        man = {"seasons": {str(old["season"]): {"status": "integrated", "source": f"{old['source_file']} sha256 {old['source_sha256']}", "format": 1}}}
    if os.path.exists(SUMMARY_PATH):
        s = json.load(open(SUMMARY_PATH))
        summ = s if "seasons" in s else {"seasons": {str(s["season"]): {"players": s["players"], "baseline": s["baseline"]}}}
    return man, summ


def valid_tree(root, seasons):
    """Light integrity check of a shots tree: every file parses, packed length matches attempts, counts are consistent."""
    for app in seasons:
        d = os.path.join(root, str(app))
        if not os.path.isdir(d):
            return f"missing season directory {app}"
        for fn in os.listdir(d):
            j = json.load(open(os.path.join(d, fn)))
            if j.get("v") != FORMAT_VERSION or len(j["s"]) != 5 * j["attempts"] or j["season"] != app or j["player_id"] + ".json" != fn:
                return f"invalid file {app}/{fn}"
    return None


def publish(results, source_info, inv, args):
    prev_man, prev_sum = previous_production()
    new_root = SHOTS_DIR + ".new"
    shutil.rmtree(new_root, ignore_errors=True)
    os.makedirs(new_root)
    seasons_manifest, summary_seasons, retained = {}, {}, []
    for app in sorted(results):
        r = results[app]
        if r["status"] == "integrated":
            shutil.copytree(stage_dir(app, "files"), os.path.join(new_root, str(app)))
            summary_seasons[str(app)] = {"players": r["summary_players"], "baseline": r["baseline"], "source_sha256": r["input_sha256"]}
            seasons_manifest[str(app)] = manifest_entry(r, source_info)
        else:
            old_entry = (prev_man or {}).get("seasons", {}).get(str(app))
            old_dir = os.path.join(SHOTS_DIR, str(app))
            if old_entry and old_entry.get("status") == "integrated" and old_entry.get("format", FORMAT_VERSION) == FORMAT_VERSION and os.path.isdir(old_dir) and prev_sum and str(app) in prev_sum["seasons"]:
                shutil.copytree(old_dir, os.path.join(new_root, str(app)))
                summary_seasons[str(app)] = prev_sum["seasons"][str(app)]
                e = dict(old_entry)
                e.update({"retained": True, "retained_source": old_entry.get("retained_source") or old_entry.get("source"),
                          "replacement_failed": r["failures"], "replacement_status": r["status"]})
                seasons_manifest[str(app)] = e
                retained.append(app)
            else:
                seasons_manifest[str(app)] = {"status": r["status"], "failures": r["failures"], "label": r["label"], "files": 0}
    for app, e in (prev_man or {}).get("seasons", {}).items():     # seasons not part of this run (e.g. --seasons subset) are kept as they were
        if int(app) not in results and e.get("status") == "integrated" and os.path.isdir(os.path.join(SHOTS_DIR, str(app))):
            shutil.copytree(os.path.join(SHOTS_DIR, str(app)), os.path.join(new_root, str(app)))
            seasons_manifest[str(app)] = e
            if prev_sum and str(app) in prev_sum["seasons"]:
                summary_seasons[str(app)] = prev_sum["seasons"][str(app)]
    problem = valid_tree(new_root, [int(a) for a, e in seasons_manifest.items() if e.get("status") == "integrated"])
    if problem:
        shutil.rmtree(new_root, ignore_errors=True)
        raise RuntimeError(f"staged export failed validation ({problem}); production files left untouched")
    manifest = {"v": FORMAT_VERSION, "kind": "regular-season shot locations", "source": source_info, "seasons": seasons_manifest,
                "playoffs": [i for i in inv if i["season_type"] == "playoffs"], "season_convention": "COURT DNA season = ending year (2009 = 2008-09); the source `_season` is the starting year",
                "format": {"file": "public/data/shots/<season>/<basketball-reference-id>.json",
                           "s": "5 characters per shot: x+250 (base36, 2 chars), y+100 (base36, 2 chars), flag (made + 2*three)",
                           "coordinates": "integer tenths of a foot, hoop at the origin; x < 0 = shooter's left; svg_x = 250 + x, svg_y = 52.5 + y",
                           "order": "GAME_ID, GAME_EVENT_ID"}}
    write_json(os.path.join(new_root, "manifest.json"), manifest, indent=1)
    # swap: rename old out of the way, move new in, then (and only then) delete the old tree and stale single-season files
    old_root = SHOTS_DIR + ".old"
    shutil.rmtree(old_root, ignore_errors=True)
    if os.path.isdir(SHOTS_DIR):
        os.rename(SHOTS_DIR, old_root)
    os.rename(new_root, SHOTS_DIR)
    shutil.rmtree(old_root, ignore_errors=True)
    write_json(SUMMARY_PATH, {"v": FORMAT_VERSION, "zones": ZONES, "deep_three_ft": 30, "seasons": summary_seasons})
    cw_rows = []
    for app in sorted(results):
        cw_rows += results[app]["crosswalk_rows"]
    new_cw = pd.DataFrame(cw_rows)
    if os.path.exists(CROSSWALK_PATH):      # keep seasons that are not part of this run
        old_cw_df = pd.read_csv(CROSSWALK_PATH, dtype={"bbr_id": str, "bbr_name": str})
        new_cw = pd.concat([old_cw_df[~old_cw_df.season.isin(new_cw.season.unique())], new_cw], ignore_index=True)
    new_cw.sort_values(["season", "nba_id"]).to_csv(CROSSWALK_PATH, index=False)
    old_cw = os.path.join(REPO, "analysis", "crosswalk", "nba_to_bbr_2009.csv")
    if os.path.exists(old_cw):
        os.remove(old_cw)
    tcodes = [{"team_id": tid, "season": s, "bbr_code": team_code(tid, s)} for tid in sorted(FRANCHISES) for s in range(config.SEASON_MIN, config.SEASON_MAX + 1)
              if any(first <= s for first, _ in FRANCHISES[tid]) and not (tid == 1610612740 and s < 2003) and not (tid == 1610612766 and 2003 <= s <= 2004)]
    pd.DataFrame(tcodes).to_csv(TEAM_CODES_PATH, index=False)
    return manifest, retained


def manifest_entry(r, source_info):
    L, P, V = r["league"], r["players"], r["validation"]
    exact_players = P["exact"]
    return {"status": "integrated", "label": r["label"], "source": f"{source_info['uploaded_filename']} sha256 {source_info['sha256']}", "files": P["exported_files"],
            "games": V["games"], "date_range": V["date_range"], "shots": L["file_fga"], "trusted_fga": L["trusted_fga"], "coverage": L["coverage"],
            "verified_players": P["verified_players"], "exact_players": exact_players, "partial_players": P["partial"],
            "beyond_drawn_court": V["beyond_drawn_court"]["shots"], "line_ft": V["three_label_vs_drawn_line"]["line_ft"],
            "complete": bool(L["file_fga"] == L["trusted_fga"] and P["partial"] == 0),
            "unresolved_identities": len(r["crosswalk"]["unresolved"])}


# ----------------------------------------------------------------------------- reports
def write_reports(results, inv, source_info, manifest, retained, cw_conflicts):
    rep = {"source": source_info, "inventory": inv, "seasons": {}, "retained_from_previous_import": retained, "cross_season_identity_conflicts": cw_conflicts}
    for app in sorted(results):
        r = results[app]
        rep["seasons"][str(app)] = {k: r[k] for k in ("label", "status", "failures", "validation", "league", "players", "crosswalk", "baseline", "team_totals")}
        rep["seasons"][str(app)]["crosswalk"] = {k: v for k, v in r["crosswalk"].items()}
    with open(os.path.join(REPO, "docs", "shot_location_validation.json"), "w") as fh:
        json.dump(rep, fh, indent=1, default=str, sort_keys=True)
    L = ["# Shot-location import: coverage and validation", "",
         f"Generated by `python3 analysis/shot_import.py --parquet <shotdetail.parquet>` (source sha256 `{source_info['sha256']}`, processed {source_info['processed_on']}).", "",
         "Season = ending year (2009 = 2008-09); the source `_season` is the starting year. Regular season only is integrated; playoffs are inventoried below.", "",
         "## Regular season, by season", "",
         "| Season | Status | Games | Shots (file) | Trusted FGA | Coverage | ΔFGA / ΔFGM / Δ3PA | Players verified | Exact | Partial | Unresolved ids | Beyond drawn court | 3PT line | Deep 3PA / 3PM (30+ ft) |",
         "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for app in sorted(results):
        r = results[app]
        l, p, v = r["league"], r["players"], r["validation"]
        L.append(f"| {r['label']} | {r['status']}{' (retained previous)' if app in retained else ''} | {v['games']} | {l['file_fga']:,} | {l['trusted_fga']:,} | {l['coverage'] * 100:.3f}% | "
                 f"{l['trusted_fga'] - l['file_fga']} / {l['trusted_fgm'] - l['file_fgm']} / {l['trusted_3pa'] - l['file_3pa']} | {p['verified_players']} | {p['exact']} | {p['partial']} | "
                 f"{len(r['crosswalk']['unresolved'])} | {v['beyond_drawn_court']['shots']} | {v['three_label_vs_drawn_line']['line_ft']} ft | {l['deep_3pa']:,} / {l['deep_3pm']:,} |")
    L += ["", "Deep 3PA / 3PM = recorded three-point attempts / makes at least 30 ft from the basket (squared distance >= 90,000 tenths-of-a-foot²; shot type decides what is a three). Ordinary + deep three-pointers equal the file's three-point total for every season and player-season. Δ = trusted Basketball-Reference total minus the file. Partial = the player's recorded attempts or makes differ from the trusted season total; those players are labelled \"Recorded shots\" with coverage.", "",
          "## Rejected / quarantined", ""]
    q = [(a, results[a]) for a in sorted(results) if results[a]["status"] != "integrated"]
    L += [f"- {r['label']}: " + "; ".join(r["failures"]) for _, r in q] or ["None."]
    L += ["", "## Playoffs (inventory only; not integrated, no trusted playoff totals in this project)", "", "| Season | Shots | Games | Players | Dates |", "|---|---|---|---|---|"]
    for i in [i for i in inv if i["season_type"] == "playoffs"]:
        L.append(f"| {i['label']} | {i['shots']:,} | {i['games']} | {i['players']} | {i['date_min']} – {i['date_max']} |")
    L += ["", "## Identity conflicts across seasons", "", f"NBA ids mapped to more than one Basketball-Reference id: {cw_conflicts['nba_ids']}; Basketball-Reference ids mapped to more than one NBA id: {cw_conflicts['bbr_ids']}."]
    with open(os.path.join(REPO, "docs", "shot_location_validation.md"), "w") as fh:
        fh.write("\n".join(L) + "\n")


# ----------------------------------------------------------------------------- main
def processing_date(sha):
    """Actual first processing date for this exact input; reruns keep it so outputs stay deterministic."""
    p = os.path.join(REPO, "raw", "shots", "import_state.json")
    st = json.load(open(p)) if os.path.exists(p) else {}
    if sha not in st:
        st[sha] = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
        write_json(p, st, indent=1)
    return st[sha]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--parquet", required=True, help="path to shotdetail.parquet (a copy is kept under raw/shots/, git-ignored)")
    ap.add_argument("--seasons", type=int, nargs="*", help="app seasons (ending year) to (re)process; default all in range")
    ap.add_argument("--force", action="store_true", help="ignore the resumable stage")
    ap.add_argument("--stage-only", action="store_true", help="validate and stage, do not touch production files")
    a = ap.parse_args(argv)
    os.makedirs(os.path.join(REPO, "raw", "shots"), exist_ok=True)
    raw_copy = os.path.join(REPO, "raw", "shots", "shotdetail.parquet")
    if os.path.abspath(a.parquet) != os.path.abspath(raw_copy):
        if not os.path.exists(raw_copy) or file_sha(raw_copy) != file_sha(a.parquet):
            shutil.copyfile(a.parquet, raw_copy)
    sha = file_sha(raw_copy)
    source_info = {"url": SOURCE_URL, "uploaded_filename": os.path.basename(a.parquet), "bytes": os.path.getsize(raw_copy), "sha256": sha,
                   "processed_on": processing_date(sha), "publisher": "cdechoch/nba-data-archive on Hugging Face (Parquet mirror of shufinskiy/nba_data)",
                   "upstream": "stats.nba.com shot-chart detail (via shufinskiy/nba_data); data.nba.com, cdn.nba.com and pbpstats.com are named for other tables",
                   "licence_stated_by_publisher": "apache-2.0 for the mirror; the card says the underlying data was collected under Apache-2.0 and argues statistics are not copyrightable",
                   "usage_note": "The repository licence does not by itself settle upstream (NBA.com) terms of use or redistribution rights. Unresolved; see docs/data.md."}
    df = load_parquet(raw_copy)
    inv = inventory(df)
    tot = trusted_all()
    in_range = lambda s: config.SEASON_MIN <= app_season_of(s) <= config.SEASON_MAX  # noqa: E731
    out_of_range = [i for i in inv if not (config.SEASON_MIN <= i["app_season"] <= config.SEASON_MAX)]
    display = pd.read_csv(utils.data_path("with_archetypes.csv"))[["season", "player_id"]]
    wanted = [s for s in sorted(df["_season"].unique()) if in_range(s) and (not a.seasons or app_season_of(s) in a.seasons)]
    results, known_ids = {}, {}
    rg = df[df["_season_type"] == "rg"]
    for s in wanted:
        app = app_season_of(s)
        r = None if a.force else load_stage(app, sha)
        if r is None:
            r = process_season(rg[rg["_season"] == s], s, tot, known_ids, set(display[display.season == app].player_id), sha, True)
            print(f"{season_label(app)}: {r['status']} shots={r['league']['file_fga']} coverage={r['league']['coverage']} files={r['players']['exported_files']} {r['failures'] or ''}", flush=True)
        else:
            print(f"{season_label(app)}: resumed from stage ({r['status']})", flush=True)
        results[app] = r
        for row in r["crosswalk_rows"]:
            if row["bbr_id"]:
                known_ids.setdefault(int(row["nba_id"]), set()).add(row["bbr_id"])
    for app in sorted(results):                         # ambiguous identities: retry with the ids verified in ALL seasons
        r = results[app]
        if r["crosswalk"]["ambiguous"] and r.get("tiebreak_pass") is None:
            s = app - 1
            r = process_season(rg[rg["_season"] == s], s, tot, known_ids, set(display[display.season == app].player_id), sha, True)
            r["tiebreak_pass"] = True
            write_json(stage_dir(app, "result.json"), r)
            results[app] = r
            print(f"{season_label(app)}: re-resolved ambiguous identities with cross-season ids -> {r['status']}, ambiguous={r['crosswalk']['ambiguous']}", flush=True)
    for s in sorted(df["_season"].unique()):           # seasons outside this run: reuse a valid stage, else keep production as-is
        app = app_season_of(s)
        if in_range(s) and app not in results:
            r = load_stage(app, sha)
            if r is not None:
                results[app] = r
    cw_all = pd.DataFrame([row for app in sorted(results) for row in results[app]["crosswalk_rows"]])
    nba_conf, bbr_conf = cross_season_conflicts(cw_all)
    conflicts = {"nba_ids": nba_conf, "bbr_ids": bbr_conf}
    if nba_conf or bbr_conf:
        bad = set(nba_conf) | set(cw_all[cw_all.bbr_id.isin(bbr_conf)].nba_id)
        for app, r in results.items():
            hit = [x for x in r["crosswalk_rows"] if x["nba_id"] in bad and x["bbr_id"]]
            if hit:
                r["failures"].append(f"{len(hit)} identities map inconsistently across seasons: {[x['nba_id'] for x in hit][:5]}")
                r["status"] = "quarantined"
    if a.stage_only:
        write_reports(results, inv, source_info, {"seasons": {}}, [], conflicts)
        return 0
    manifest, retained = publish(results, source_info, inv, a)
    manifest["out_of_app_range_inventory"] = out_of_range
    write_json(os.path.join(SHOTS_DIR, "manifest.json"), manifest, indent=1)
    old = os.path.join(SHOTS_DIR, "sources.json")
    if os.path.exists(old):
        os.remove(old)
    write_reports(results, inv, source_info, manifest, retained, conflicts)
    bad = [app for app, r in results.items() if r["status"] != "integrated"]
    print(f"integrated {sum(1 for r in results.values() if r['status'] == 'integrated')} of {len(results)} seasons; quarantined: {bad}; retained from previous: {retained}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
