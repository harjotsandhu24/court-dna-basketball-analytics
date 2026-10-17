"""
Validation procedure. Stage 1 touches TRAIN and VALIDATION seasons only and freezes every choice.
Final test (run_final_test) runs once afterwards on TEST seasons.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from scipy.stats import norm

from . import config as C
from . import model as M
from . import fit as F
from . import data_build as D

ALPHAS = [0.1, 0.3, 1, 3, 10, 30, 100]
FEATURE_SETS = {
    "all": M.FEATURE_NAMES,
    "no_height": [f for f in M.FEATURE_NAMES if "ht" not in f],
    "no_creator_max": [f for f in M.FEATURE_NAMES if f != "s_maxast"],
    "no_height_no_creator_max": [f for f in M.FEATURE_NAMES if "ht" not in f and f != "s_maxast"],
    "starters_only": [f for f in M.FEATURE_NAMES if f.startswith("s_")],
}
# 'starters_only' is a diagnostic (what if bench were ignored); it is never offered as the product model.
CANDIDATES = [k for k in FEATURE_SETS if k != "starters_only"]


def seasons(a, b):
    return list(range(a, b + 1))


def stage1_select(d: F.Data) -> dict:
    tr_s, va_s = seasons(*C.TRAIN), seasons(*C.VALIDATION)
    prm, pinfo = F.estimate_params(d, tr_s)
    rows = F.build_rows(d, prm, tr_s + va_s, "real")
    tr, va = rows[rows.season.isin(tr_s)], rows[rows.season.isin(va_s)]
    table = []
    for name, feats in FEATURE_SETS.items():
        for a in ALPHAS:
            fit = F.fit_ridge(tr, feats, a, "net")
            p = F.predict(fit, va)
            table.append({"set": name, "alpha": a, "val_rmse": F.rmse(va.net, p), "val_r2": F.r2(va.net, p, tr.net.mean())})
    tab = pd.DataFrame(table)
    best = tab[tab.set.isin(CANDIDATES)].sort_values("val_rmse").iloc[0]
    return {"params": prm, "param_info": pinfo, "table": tab, "best_set": best.set, "best_alpha": float(best.alpha)}


if __name__ == "__main__":
    d = F.Data()
    r = stage1_select(d)
    print(r["param_info"]); print(r["table"].round(3).to_string()); print(r["best_set"], r["best_alpha"])


# ---------------------------------------------------------------------------
# Game / series model pieces
# ---------------------------------------------------------------------------
def game_table(d: F.Data, games: pd.DataFrame) -> pd.DataFrame:
    """Attach each game's teams' actual regular-season net ratings (used only to FIT the game model)."""
    net = d.teams.set_index(["season", "abbreviation"]).n_rtg
    g = games.copy()
    g["net_home"] = [net.get((s, t), np.nan) for s, t in zip(g.season, g.home)]
    g["net_away"] = [net.get((s, t), np.nan) for s, t in zip(g.season, g.away)]
    return g.dropna(subset=["net_home", "net_away"])


def log_loss(p, y):
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    y = np.asarray(y, float)
    return float(-(y * np.log(p) + (1 - y) * np.log(1 - p)).mean())


def brier(p, y):
    return float(((np.asarray(p, float) - np.asarray(y, float)) ** 2).mean())


def p_game_integrated(delta_pred, beta, h, tau2):
    """P(home wins) when the rating difference is only known up to N(0, tau2) error (tau2 = variance of the difference)."""
    return norm.cdf((beta * delta_pred + h) / np.sqrt(1 + beta ** 2 * tau2))


def calibration(p, y, bins=10):
    p, y = np.asarray(p, float), np.asarray(y, float)
    edges = np.quantile(p, np.linspace(0, 1, bins + 1)); edges[0] -= 1e-9; edges[-1] += 1e-9
    out, ece = [], 0.0
    for i in range(bins):
        m = (p > edges[i]) & (p <= edges[i + 1])
        if m.sum() == 0:
            continue
        out.append({"n": int(m.sum()), "mean_pred": float(p[m].mean()), "obs": float(y[m].mean())})
        ece += m.mean() * abs(p[m].mean() - y[m].mean())
    # logistic recalibration slope/intercept
    from sklearn.linear_model import LogisticRegression
    lg = np.log(np.clip(p, 1e-6, 1 - 1e-6) / (1 - np.clip(p, 1e-6, 1 - 1e-6))).reshape(-1, 1)
    lr = LogisticRegression(C=1e6).fit(lg, y.astype(int))
    return {"bins": out, "ece": float(ece), "slope": float(lr.coef_[0][0]), "intercept": float(lr.intercept_[0])}
