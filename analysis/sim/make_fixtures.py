"""
Generate tests/sim_parity_fixture.json: expected values computed by the Python reference model, checked by
tests/simParity.test.ts against the TypeScript engine.   cd analysis && python3 -m sim.make_fixtures
"""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np

from . import config as C
from . import model as M
from . import fit as F
from . import engine_py as E
from . import support as SUP

ROOT = Path(__file__).resolve().parents[2]


def main():
    mj = json.loads((ROOT / "public/data/sim/model.json").read_text())
    d = F.Data()
    p = mj["params"]
    prm = M.Params(starter_share=p["starterShare"], usage_target=p["usageTarget"], beta_ts_usg=p["betaTsUsg"],
                   avg_bench=p["avgBench"], k_clip=tuple(p["kClip"]))
    feats = mj["features"]

    def predict(vec: dict, which: str) -> float:
        return mj["intercept"][which] + sum(mj["coef"][which][f] * vec[f] for f in feats)

    def vec_of(starters, bench):
        v, info = M.lineup_vector(starters, bench, prm, d.sd_usg)
        return dict(zip(M.FEATURE_NAMES, v)), info["k"]

    rng = np.random.default_rng(2026)
    pool = d.players[d.players.complete].reset_index(drop=True)
    out = {"lineups": [], "teams": [], "series": [], "seasons": []}
    for i in range(20):
        idx = rng.choice(len(pool), 5, replace=False)
        picks = [(pool.player_id[j], int(pool.season[j])) for j in idx]
        if len({a for a, _ in picks}) < 5:
            continue
        recs = [d.rec(a, s, float(pool.mp[j])) for (a, s), j in zip(picks, idx)]
        v, k = vec_of(recs, None)
        sup = SUP.level(mj["support"], v, predict(v, "net"),
                        [{"season": s_, "mp": float(pool.mp[j]), "g": int(pool.g[j])} for (a, s_), j in zip(picks, idx)])
        out["lineups"].append({"picks": [{"id": a, "season": s} for a, s in picks], "k": k,
                               "support": {"level": sup["level"], "d2": sup["d2"], "reasons": sup["reasons"]},
                               "vector": {f: v[f] for f in feats}, "net": predict(v, "net"),
                               "ortg_rel": predict(v, "ortg_rel"), "drtg_rel": predict(v, "drtg_rel")})
    seasons = [1997, 2001, 2005, 2009, 2013, 2018, 2022, 2026]
    for s in seasons:
        ts = d.teams[d.teams.season == s].abbreviation.tolist()
        for t in ts[:3]:
            recs, cov = d.team_roster(s, t)
            if len(recs) < 6:
                continue
            for foot in ("real", "equal"):
                v, k = vec_of(recs[:5], recs[5:] if foot == "real" else None)
                net_ = predict(v, "net")
                sup_ = SUP.level(mj["support"], v, net_, [{"season": s, "mp": float(r_["mp"]), "g": 82} for r_ in recs[:5]])
                out["teams"].append({"season": s, "team": t, "footing": foot, "net": net_, "k": k,
                                     "support": {"level": sup_["level"], "d2": sup_["d2"], "reasons": sup_["reasons"]}})
    # series between pairs of fixture lineups (team A has home court: HHAAHAH)
    beta, h = mj["game"]["playoff"]["beta"], mj["game"]["playoff"]["home"]
    tau = mj["tau"]["five"]
    L = out["lineups"]
    for a, b in [(0, 1), (2, 3), (4, 5), (6, 7)]:
        r = E.series_sim(L[a]["net"], L[b]["net"], tau, tau, "HHAAHAH", 4, beta, h, n=400000, seed=5)
        out["series"].append({"a": a, "b": b, "p_a": r["p_hc"], "length": r["length"]})
    # 82-game seasons in the lineups' latest season
    for i in (0, 3, 6):
        env = max(x["season"] for x in L[i]["picks"])
        opp = []
        for t in d.teams[d.teams.season == env].abbreviation:
            recs, cov = d.team_roster(env, t)
            if len(recs) >= 6 and cov >= C.MIN_TEAM_COVERAGE:
                v, _ = vec_of(recs[:5], recs[5:])
                opp.append(predict(v, "net"))
        r = E.season_sim(L[i]["net"], mj["tau"]["five"], opp, mj["tau"]["real"], mj["game"]["regular"]["beta"], mj["game"]["regular"]["home"], n=20000, seed=9)
        out["seasons"].append({"lineup": i, "env": env, "mean": r["mean"], "sd": r["sd"], "teams": len(opp)})
    (ROOT / "tests" / "sim_parity_fixture.json").write_text(json.dumps(out, indent=1))
    print({k: len(v) for k, v in out.items()})


if __name__ == "__main__":
    main()
