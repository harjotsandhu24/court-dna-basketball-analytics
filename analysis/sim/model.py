"""
Team-strength model: player-season features -> team net rating.

The same arithmetic is implemented in TypeScript (lib/sim/strength.ts); a
parity fixture (tests/sim_parity_fixture.json) is generated from this file and
checked by the frontend tests.

Structure
---------
* A lineup is five starters plus a bench. Starters carry fixed standard minutes
  (STARTER_SHARE of team minutes, split equally). The bench is either a team's
  real bench (minute-weighted) or the "average bench" (the mean bench vector of
  training teams).
* Players are described by season-relative z-scores (era-neutral): value minus
  that season's qualified-pool mean, divided by that season's pool sd.
* Usage overlap: five starters cannot all keep the scoring volume they had on
  their own teams. Starter usage is rescaled so total usage on the floor equals
  what real teams have (USAGE_TARGET), and each player's shooting efficiency
  moves along the usage-efficiency slope estimated from the same players'
  season-to-season changes (BETA_TS_USG).
"""
from __future__ import annotations
from dataclasses import dataclass, field
import numpy as np
import pandas as pd

from . import config as C

Z = {f: f + "_z" for f in C.FEATURES}

FEATURE_NAMES = [
    "s_uts", "s_ast", "s_tov", "s_orb", "s_drb", "s_stl", "s_blk", "s_x3", "s_ftr", "s_ht", "s_maxast",
    "b_ts", "b_ast", "b_tov", "b_orb", "b_drb", "b_stl", "b_blk", "b_x3", "b_ftr", "b_ht",
]
# Which assessment dimension each model feature belongs to (fixed, shown to users)
DIMENSIONS = {
    "Scoring efficiency": ["s_uts", "b_ts", "s_ftr", "b_ftr"],
    "Creation": ["s_ast", "s_maxast", "b_ast"],
    "Spacing": ["s_x3", "b_x3"],
    "Possession control": ["s_tov", "s_orb", "b_tov", "b_orb"],
    "Defensive box-score signals": ["s_drb", "s_stl", "s_blk", "s_ht", "b_drb", "b_stl", "b_blk", "b_ht"],
}
# "Role balance" is not a regression term: it is the usage-overlap adjustment
# itself (its effect on the efficiency feature s_uts), reported separately.


@dataclass
class Params:
    """Everything the browser needs besides the regression coefficients."""
    starter_share: float          # share of team minutes played by the five starters
    usage_target: float           # minute-weighted mean usage of real rosters (percent)
    beta_ts_usg: float            # z-units of TS% per z-unit of usage change (<= 0)
    avg_bench: dict = field(default_factory=dict)   # feature -> mean z (b_* features) + 'usg' raw
    k_clip: tuple = (0.5, 1.5)


def _sorted_key(p):
    return (p["id"], p["season"])


def starter_features(starters: list[dict], bench_usage: float, prm: Params, season_sd_usg: dict) -> tuple[dict, float]:
    """Return ({s_* features}, usage scale k). Each starter dict has raw usage 'usg', z values 'z', 'id', 'season'."""
    st = sorted(starters, key=_sorted_key)
    n = len(st)
    fS = prm.starter_share
    mean_u = sum(p["usg"] for p in st) / n
    k = (prm.usage_target - (1 - fS) * bench_usage) / (fS * mean_u)
    k = min(max(k, prm.k_clip[0]), prm.k_clip[1])
    wsum, uts = 0.0, 0.0
    for p in st:
        u2 = k * p["usg"]
        sd = season_sd_usg[p["season"]]
        ts2 = p["z"]["ts_percent"] + prm.beta_ts_usg * (u2 - p["usg"]) / sd
        uts += u2 * ts2
        wsum += u2
    out = {"s_uts": uts / wsum}
    for name, f in [("s_ast", "ast_percent"), ("s_tov", "tov_percent"), ("s_orb", "orb_percent"),
                    ("s_drb", "drb_percent"), ("s_stl", "stl_percent"), ("s_blk", "blk_percent"),
                    ("s_x3", "x3p_ar"), ("s_ftr", "f_tr"), ("s_ht", "ht_in_in")]:
        out[name] = sum(p["z"][f] for p in st) / n
    out["s_maxast"] = max(p["z"]["ast_percent"] for p in st)
    return out, k


def bench_features(bench: list[dict]) -> tuple[dict, float]:
    """Minute-weighted bench means (z) and bench mean raw usage."""
    b = sorted(bench, key=_sorted_key)
    tot = sum(p["mp"] for p in b)
    out = {}
    for name, f in [("b_ts", "ts_percent"), ("b_ast", "ast_percent"), ("b_tov", "tov_percent"),
                    ("b_orb", "orb_percent"), ("b_drb", "drb_percent"), ("b_stl", "stl_percent"),
                    ("b_blk", "blk_percent"), ("b_x3", "x3p_ar"), ("b_ftr", "f_tr"), ("b_ht", "ht_in_in")]:
        out[name] = sum(p["mp"] * p["z"][f] for p in b) / tot
    usg = sum(p["mp"] * p["usg"] for p in b) / tot
    return out, usg


def lineup_vector(starters, bench, prm: Params, season_sd_usg) -> tuple[np.ndarray, dict]:
    """bench=None -> average bench. Returns (feature vector in FEATURE_NAMES order, info)."""
    if bench is None:
        bf = {k: v for k, v in prm.avg_bench.items() if k.startswith("b_")}
        bu = prm.avg_bench["usg"]
    else:
        bf, bu = bench_features(bench)
    sf, k = starter_features(starters, bu, prm, season_sd_usg)
    feats = {**sf, **bf}
    return np.array([feats[n] for n in FEATURE_NAMES]), {"k": k}


# ---------------------------------------------------------------------------
# Historical teams -> training rows
# ---------------------------------------------------------------------------
def build_team_rows(players_z: pd.DataFrame, rosters: pd.DataFrame, teams: pd.DataFrame,
                    prm: Params, stats: pd.DataFrame, bench_mode: str = "real") -> pd.DataFrame:
    """One row per historical team-season with its feature vector. bench_mode: 'real' or 'average'."""
    sd_usg = {int(s): float(v) for s, v in stats["usg_percent__sd"].items()}
    pz = players_z[players_z.complete].set_index(["player_id", "season"])
    out = []
    for (season, team), r in rosters.groupby(["season", "team"]):
        t = teams[(teams.season == season) & (teams.abbreviation == team)]
        if len(t) != 1:
            continue
        r = r.sort_values(["mp", "player_id"], ascending=[False, True])
        tot_mp = r.mp.sum()
        covered = [(row.player_id, row.mp) for row in r.itertuples() if (row.player_id, season) in pz.index]
        cov = sum(m for _, m in covered) / tot_mp
        if len(covered) < C.STARTERS + 1:
            continue

        def mk(pid, mp):
            row = pz.loc[(pid, season)]
            return {"id": pid, "season": int(season), "mp": float(mp), "usg": float(row["usg_percent"]),
                    "z": {f: float(row[Z[f]]) for f in C.FEATURES}}
        recs = [mk(p, m) for p, m in covered]
        starters, bench = recs[:C.STARTERS], recs[C.STARTERS:]
        vec, info = lineup_vector(starters, bench if bench_mode == "real" else None, prm, sd_usg)
        tt = t.iloc[0]
        out.append({
            "season": int(season), "team": team, "name": tt.team, "coverage": cov,
            "net": tt.n_rtg, "ortg": tt.o_rtg, "drtg": tt.d_rtg, "w": tt.w, "l": tt.l, "wins82": tt.wins82,
            "k": info["k"], **dict(zip(FEATURE_NAMES, vec)),
        })
    return pd.DataFrame(out)
