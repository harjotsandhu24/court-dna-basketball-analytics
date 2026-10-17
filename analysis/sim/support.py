"""
Support check: how much does a lineup look like the teams the model was fitted on?

The model adds up player evidence, so it can project a lineup far beyond anything that ever played. The check compares the
lineup's starting-five feature vector with the starting fives of the training teams, using a Mahalanobis distance (a
distance that accounts for how the features move together, so "five elite creators" counts as unusual even if each
feature alone is ordinary) with a shrinkage covariance (Ledoit-Wolf) because ~600 teams cannot pin down a 10-dimensional
covariance exactly.

Cut-offs are quantiles of the TRAINING teams' own distances (config.SUPPORT_LIMITED_Q / SUPPORT_UNSUPPORTED_Q), fixed in
advance. Being inside the cut-offs means "resembles teams the model was tested on". It does not mean a custom lineup is
validated: there is no ground truth for lineups that never played together.

Same arithmetic is implemented in lib/sim/support.ts (parity fixture).
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from sklearn.covariance import LedoitWolf

from . import config as C


def starter_dims(feats: list[str]) -> list[str]:
    return [f for f in feats if f.startswith("s_")]


def fit_support(rows: pd.DataFrame, feats: list[str], nets: pd.Series) -> dict:
    """rows: historical team-season feature rows (real rotations). nets: their actual net ratings."""
    dims = starter_dims(feats)
    X = rows[dims].values
    lw = LedoitWolf().fit(X)
    d2 = mahal2(X, lw.location_, lw.precision_)
    return {
        "dims": dims, "mean": [float(v) for v in lw.location_],
        "precision": [[float(v) for v in r] for r in lw.precision_],
        "shrinkage": float(lw.shrinkage_), "n": int(len(rows)),
        "limited": float(np.quantile(d2, C.SUPPORT_LIMITED_Q)),
        "unsupported": float(np.quantile(d2, C.SUPPORT_UNSUPPORTED_Q)),
        "d2": {q: float(np.quantile(d2, q)) for q in (0.5, 0.9, 0.95, 0.99, 0.995, 1.0)},
        "net": {"min": float(nets.min()), "max": float(nets.max())},
        "minMp": C.SUPPORT_MIN_MP, "minG": C.SUPPORT_MIN_G, "eraSpan": C.SUPPORT_ERA_SPAN,
        "limitedQ": C.SUPPORT_LIMITED_Q, "unsupportedQ": C.SUPPORT_UNSUPPORTED_Q,
    }


def mahal2(X: np.ndarray, mean, precision) -> np.ndarray:
    D = np.atleast_2d(X) - np.asarray(mean)
    return np.einsum("ij,jk,ik->i", D, np.asarray(precision), D)


def level(sup: dict, vec: dict, projected_net: float, players: list[dict]) -> dict:
    """players: [{'season','mp','g'}]. Returns {'level','d2','reasons'} (reason codes, not prose)."""
    x = np.array([[vec[k] for k in sup["dims"]]])
    d2 = float(mahal2(x, sup["mean"], sup["precision"])[0])
    reasons = []
    if d2 > sup["unsupported"]:
        reasons.append("combination_far")
    elif d2 > sup["limited"]:
        reasons.append("combination_unusual")
    if projected_net > sup["net"]["max"] or projected_net < sup["net"]["min"]:
        reasons.append("net_outside")
    if any(p["mp"] < sup["minMp"] or p["g"] < sup["minG"] for p in players):
        reasons.append("small_sample")
    seasons = [p["season"] for p in players]
    if max(seasons) - min(seasons) >= sup["eraSpan"]:
        reasons.append("mixed_era")
    lv = "unsupported" if ("combination_far" in reasons or "net_outside" in reasons) else ("limited" if reasons else "supported")
    return {"level": lv, "d2": d2, "reasons": reasons}
