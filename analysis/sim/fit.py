"""Parameter estimation and fitting helpers (no test-season access in this module)."""
from __future__ import annotations
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.stats import norm
from sklearn.linear_model import Ridge

from . import config as C
from . import model as M
from . import data_build as D


class Data:
    """All tables, loaded once."""
    def __init__(self):
        self.players = D.load_player_seasons()
        self.stats = D.season_pool_stats(self.players)
        self.pz = D.add_z(self.players, self.stats)
        self.pzi = self.pz[self.pz.complete].set_index(["player_id", "season"])
        self.ts = D.load_team_summaries()
        self.teams = D.team_seasons(self.ts)
        self.env = D.league_environment(self.ts)
        self.rosters = D.load_rosters()
        self.teams["ortg_rel"] = self.teams.o_rtg - self.teams.season.map(self.env.lg_ortg)
        self.teams["drtg_rel"] = self.teams.d_rtg - self.teams.season.map(self.env.lg_ortg)
        self.sd_usg = {int(s): float(v) for s, v in self.stats["usg_percent__sd"].items()}
        self._cache = {}
        self._by_team = {(int(s), t): g for (s, t), g in self.rosters.groupby(["season", "team"])}
        self._pz_dict = None
        self._pzset = set(self.pzi.index)

    def rec(self, pid, season, mp):
        if self._pz_dict is None:
            cols = ["usg_percent"] + [M.Z[f] for f in C.FEATURES]
            self._pz_dict = {k: v for k, v in zip(self.pzi.index, self.pzi[cols].itertuples(index=False, name=None))}
        v = self._pz_dict[(pid, season)]
        return {"id": pid, "season": int(season), "mp": float(mp), "usg": float(v[0]),
                "z": {f: float(v[1 + i]) for i, f in enumerate(C.FEATURES)}}

    def team_roster(self, season, team):
        """Covered players of one team-season sorted by minutes, plus coverage (memoised)."""
        key = (int(season), team)
        if key not in self._cache:
            self._cache[key] = self._team_roster(season, team)
        return self._cache[key]

    def _team_roster(self, season, team):
        r = self._by_team[(int(season), team)]
        r = r.sort_values(["mp", "player_id"], ascending=[False, True])
        tot = r.mp.sum()
        cov = [(x.player_id, x.mp) for x in r.itertuples() if (x.player_id, season) in self._pzset]
        coverage = sum(m for _, m in cov) / tot if tot else 0.0
        return [self.rec(p, season, m) for p, m in cov], coverage


def estimate_params(d: Data, seasons: list[int]) -> tuple[M.Params, dict]:
    """starter share, usage target, usage-efficiency slope and average bench from the given seasons only."""
    shares, utarget, bench_rows = [], [], []
    for (s, t), _ in d.rosters[d.rosters.season.isin(seasons)].groupby(["season", "team"]):
        recs, cov = d.team_roster(s, t)
        tot_cov_mp = sum(p["mp"] for p in recs)
        if len(recs) < C.STARTERS + 1:
            continue
        # share of the team's *covered* minutes played by the top five by minutes
        shares.append(sum(p["mp"] for p in recs[:C.STARTERS]) / tot_cov_mp)
        utarget.append(sum(p["mp"] * p["usg"] for p in recs) / tot_cov_mp)
        bf, bu = M.bench_features(recs[C.STARTERS:])
        bench_rows.append({**bf, "usg": bu})
    # usage-efficiency slope from the same players' consecutive qualified seasons
    q = d.pz[d.pz.qualified & d.pz.complete & d.pz.season.isin(seasons)].sort_values(["player_id", "season"])
    a = q.merge(q, on="player_id", suffixes=("0", "1"))
    a = a[a.season1 == a.season0 + 1]
    dx = (a.usg_percent_z1 - a.usg_percent_z0).values
    dy = (a.ts_percent_z1 - a.ts_percent_z0).values
    b = float((dx * dy).sum() / (dx * dx).sum())
    se = float(np.sqrt(((dy - b * dx) ** 2).sum() / (len(dx) - 1) / (dx * dx).sum()))
    beta = min(b, 0.0)  # pre-registered: an implausible positive slope is set to 0
    prm = M.Params(starter_share=float(np.mean(shares)), usage_target=float(np.mean(utarget)),
                   beta_ts_usg=beta, avg_bench=pd.DataFrame(bench_rows).mean().to_dict())
    info = {"beta_estimate": b, "beta_se": se, "beta_used": beta, "pairs": int(len(dx)),
            "starter_share": prm.starter_share, "usage_target": prm.usage_target, "teams": len(shares)}
    return prm, info


def build_rows(d: Data, prm: M.Params, seasons: list[int], bench_mode: str) -> pd.DataFrame:
    """Historical team-season feature rows for the given seasons."""
    rows = []
    for (s, t), _ in d.rosters[d.rosters.season.isin(seasons)].groupby(["season", "team"]):
        tt = d.teams[(d.teams.season == s) & (d.teams.abbreviation == t)]
        if len(tt) != 1:
            continue
        recs, cov = d.team_roster(s, t)
        if len(recs) < C.STARTERS + 1:
            continue
        starters, bench = recs[:C.STARTERS], recs[C.STARTERS:]
        vec, info = M.lineup_vector(starters, bench if bench_mode == "real" else None, prm, d.sd_usg)
        x = tt.iloc[0]
        rows.append({"season": int(s), "team": t, "name": x.team, "coverage": cov, "k": info["k"],
                     "net": x.n_rtg, "ortg_rel": x.ortg_rel, "drtg_rel": x.drtg_rel,
                     "w": x.w, "l": x.l, "wins82": x.wins82, **dict(zip(M.FEATURE_NAMES, vec))})
    return pd.DataFrame(rows)


def fit_ridge(rows: pd.DataFrame, feats: list[str], alpha: float, target: str) -> dict:
    mu = rows[feats].mean()
    sd = rows[feats].std(ddof=0)
    m = Ridge(alpha=alpha).fit((rows[feats] - mu) / sd, rows[target])
    coef = m.coef_ / sd.values
    b0 = float(m.intercept_ - (coef * mu.values).sum())
    return {"feats": feats, "coef": dict(zip(feats, map(float, coef))), "intercept": b0, "alpha": alpha}


def predict(fit: dict, rows: pd.DataFrame) -> np.ndarray:
    x = rows[fit["feats"]].values
    c = np.array([fit["coef"][f] for f in fit["feats"]])
    return x @ c + fit["intercept"]


def rmse(a, b):
    return float(np.sqrt(np.mean((np.asarray(a) - np.asarray(b)) ** 2)))


def r2(y, p, ref_mean):
    y, p = np.asarray(y), np.asarray(p)
    return float(1 - ((y - p) ** 2).sum() / ((y - ref_mean) ** 2).sum())


def probit_fit(delta: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    """P(win)=Phi(beta*delta + h). Returns (beta, h)."""
    def nll(th):
        z = th[0] * delta + th[1]
        return -(y * norm.logcdf(z) + (1 - y) * norm.logcdf(-z)).sum()
    r = minimize(nll, [0.05, 0.1], method="Nelder-Mead", options={"xatol": 1e-8, "fatol": 1e-8, "maxiter": 2000})
    return float(r.x[0]), float(r.x[1])
