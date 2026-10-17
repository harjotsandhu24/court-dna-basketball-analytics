"""
End-to-end: select (train/validation) -> FREEZE (written to disk) -> final fit -> one-time test -> export model + report data.

    cd analysis && python3 -m sim.run_all

Writes (relative to the repository root):
    docs/model/validation_results.json     all numbers behind docs/model/validation_report.md
    docs/model/model_card_data.json        compact summary used to fill the report
    public/data/sim/model.json             what the browser engine loads
"""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.stats import norm

from . import config as C
from . import model as M
from . import fit as F
from . import data_build as D
from . import validate as V
from . import bracket_build as BB
from . import support as SUP
import hashlib
from . import engine_py as E

ROOT = Path(__file__).resolve().parents[2]
OUT_DOCS = ROOT / "docs" / "model"
OUT_PUB = ROOT / "public" / "data" / "sim"

ALL = list(range(C.SEASON_MIN, C.SEASON_MAX + 1))
TRAIN = V.seasons(*C.TRAIN)
VAL = V.seasons(*C.VALIDATION)
TEST = V.seasons(*C.TEST)
FIT = TRAIN + VAL


def boot_ci(vals, fn, n=1000, seed=3):
    rng = np.random.default_rng(seed)
    vals = np.asarray(vals)
    out = [fn(vals[rng.integers(0, len(vals), len(vals))]) for _ in range(n)]
    return [float(np.quantile(out, 0.025)), float(np.quantile(out, 0.975))]


def loso(d: F.Data, feats, alpha, seasons: list[int]) -> dict:
    """Leave-one-season-out residuals (parameters and coefficients refit without the held-out season)."""
    res = {"real": [], "five": [], "ortg": [], "drtg": [], "ortg_five": []}
    for s in seasons:
        others = [x for x in seasons if x != s]
        prm, _ = F.estimate_params(d, others)
        a = F.build_rows(d, prm, others, "real")
        hr = F.build_rows(d, prm, [s], "real")
        ha = F.build_rows(d, prm, [s], "average")
        for tgt, key in [("net", "real"), ("ortg_rel", "ortg"), ("drtg_rel", "drtg")]:
            f = F.fit_ridge(a, feats, alpha, tgt)
            res[key] += list(hr[tgt] - F.predict(f, hr))
            if tgt == "net":
                res["five"] += list(ha[tgt] - F.predict(f, ha))
            if tgt == "ortg_rel":
                res["ortg_five"] += list(ha[tgt] - F.predict(f, ha))
    return {k: float(np.std(v, ddof=1)) for k, v in res.items()} | {"n": len(res["real"])}



def sha(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=float).encode()).hexdigest()


def main():
    d = F.Data()
    games = D.load_games()
    ser = D.rebuild_series(games)
    gt = V.game_table(d, games)
    brackets = {s: BB.build_bracket(games, s, d.teams) for s in ALL}
    results: dict = {
        "model_version": C.MODEL_VERSION, "data_version": C.DATA_VERSION,
        "splits": {"train": C.TRAIN, "validation": C.VALIDATION, "test": C.TEST},
        "protocol": protocol_text(),
    }

    # ------------------------------------------------------------------ stage 1: choices made on train + validation only
    s1 = V.stage1_select(d)
    feats = V.FEATURE_SETS[s1["best_set"]]
    alpha = s1["best_alpha"]
    results["stage1"] = {"best_set": s1["best_set"], "best_alpha": alpha, "param_info": s1["param_info"],
                         "table": s1["table"].round(4).to_dict(orient="records")}
    prm1, _ = F.estimate_params(d, TRAIN)
    rows1R = F.build_rows(d, prm1, TRAIN + VAL, "real")
    rows1A = F.build_rows(d, prm1, TRAIN + VAL, "average")
    tr1, va1 = rows1R[rows1R.season.isin(TRAIN)], rows1R[rows1R.season.isin(VAL)]
    va1A = rows1A[rows1A.season.isin(VAL)]
    comp1 = {}
    for tgt in ["net", "ortg_rel", "drtg_rel"]:
        f = F.fit_ridge(tr1, feats, alpha, tgt)
        p = F.predict(f, va1)
        comp1[tgt] = {"val_rmse": F.rmse(va1[tgt], p), "val_r2": F.r2(va1[tgt], p, tr1[tgt].mean()), "val_sd": float(va1[tgt].std(ddof=0))}
    fit1 = {t: F.fit_ridge(tr1, feats, alpha, t) for t in ["net", "ortg_rel", "drtg_rel"]}
    f1 = fit1["net"]
    comp1["net_five_avg_bench"] = {"val_rmse": F.rmse(va1A.net, F.predict(f1, va1A)), "val_r2": F.r2(va1A.net, F.predict(f1, va1A), tr1.net.mean())}
    results["stage1"]["components"] = comp1

    tau1 = loso(d, feats, alpha, TRAIN)
    rs = gt[~gt.playoffs & ~gt.neutral]
    po = gt[gt.playoffs & ~gt.neutral]
    b_rs, h_rs = F.probit_fit((rs[rs.season.isin(TRAIN)].net_home - rs[rs.season.isin(TRAIN)].net_away).values,
                              rs[rs.season.isin(TRAIN)].home_win.values.astype(float))
    p_tr = po[po.season.isin(TRAIN)]
    b_po, h_po = F.probit_fit((p_tr.net_home - p_tr.net_away).values, p_tr.home_win.values.astype(float))
    predv = dict(zip(zip(va1.season, va1.team), F.predict(f1, va1)))

    def game_eval(sub, beta, h, tau, pred):
        sub = sub[[(s, t) in pred and (s, a) in pred for s, t, a in zip(sub.season, sub.home, sub.away)]]
        dl = np.array([pred[(s, t)] - pred[(s, a)] for s, t, a in zip(sub.season, sub.home, sub.away)])
        return V.p_game_integrated(dl, beta, h, 2 * tau ** 2), sub.home_win.values.astype(float)

    vpo = po[po.season.isin(VAL)]
    pa, ya = game_eval(vpo, b_rs, h_rs, tau1["real"], predv)
    pb, _ = game_eval(vpo, b_po, h_po, tau1["real"], predv)
    ll_reg, ll_po = V.log_loss(pa, ya), V.log_loss(pb, ya)
    use_playoff_params = (ll_reg - ll_po) > 0.002
    results["stage1"]["game_model_choice"] = {
        "val_playoff_logloss_regular_params": ll_reg, "val_playoff_logloss_playoff_params": ll_po,
        "rule": "use playoff-specific parameters if validation playoff log loss improves by more than 0.002",
        "use_playoff_params": bool(use_playoff_params)}
    sup1 = SUP.fit_support(tr1, feats, tr1.net)

    # ------------------------------------------------------------------ FREEZE: written to disk before any test season is scored
    frozen = {
        "model_version": C.MODEL_VERSION, "feature_set": s1["best_set"], "features": feats, "ridge_alpha": alpha,
        "use_playoff_game_params": bool(use_playoff_params),
        "support_check": {"limited_quantile": C.SUPPORT_LIMITED_Q, "unsupported_quantile": C.SUPPORT_UNSUPPORTED_Q,
                          "min_minutes": C.SUPPORT_MIN_MP, "min_games": C.SUPPORT_MIN_G, "era_span": C.SUPPORT_ERA_SPAN},
        "decision_rules": {"wins_rmse_ratio_max": C.WINS_RMSE_RATIO_MAX, "wins_rmse_ratio_max_five": C.WINS_RMSE_RATIO_MAX_FIVE,
                           "five_must_beat_prior_season": C.FIVE_MUST_BEAT_PRIOR_SEASON, "range_coverage_band": C.RANGE_COVERAGE_BAND,
                           "component_r2_min": C.COMPONENT_R2_MIN, "series_min_test_n": C.SERIES_MIN_TEST_N,
                           "calibration_slope_band": C.CALIBRATION_SLOPE_BAND},
        "splits": {"train": C.TRAIN, "validation": C.VALIDATION, "test": C.TEST},
        "already_seen_before_this_freeze": C.PRIOR_TEST_SEEN,
    }
    frozen["sha256"] = sha(frozen)
    OUT_DOCS.mkdir(parents=True, exist_ok=True)
    (OUT_DOCS / "frozen_choices.json").write_text(json.dumps(frozen, indent=2, default=float))
    results["frozen"] = frozen

    # ------------------------------------------------------------------ final fit on train + validation
    prm, pinfo = F.estimate_params(d, FIT)
    rowsR = F.build_rows(d, prm, ALL, "real")
    rowsA = F.build_rows(d, prm, ALL, "average")
    fitR = rowsR[rowsR.season.isin(FIT)]
    fits = {t: F.fit_ridge(fitR, feats, alpha, t) for t in ["net", "ortg_rel", "drtg_rel"]}
    tau = loso(d, feats, alpha, FIT)
    results["final"] = {"fit_seasons": [FIT[0], FIT[-1]], "param_info": pinfo, "tau": tau, "alpha": alpha,
                        "feature_set": s1["best_set"], "features": feats,
                        "coef": {k: v["coef"] for k, v in fits.items()}, "intercept": {k: v["intercept"] for k, v in fits.items()}}
    sel = rs[rs.season.isin(FIT)]
    beta_rs, h_rs_f = F.probit_fit((sel.net_home - sel.net_away).values, sel.home_win.values.astype(float))
    pl = po[po.season.isin(FIT)]
    beta_po, h_po_f = F.probit_fit((pl.net_home - pl.net_away).values, pl.home_win.values.astype(float))
    game = {"regular": {"beta": beta_rs, "home": h_rs_f, "n": int(len(sel))}, "playoff": {"beta": beta_po, "home": h_po_f, "n": int(len(pl))}}
    gp = game["playoff"] if use_playoff_params else game["regular"]
    game["playoff_used"] = gp
    results["final"]["game"] = game
    results["final"]["implied"] = {"game_sd_points": 1 / beta_rs, "home_adv_net_points": h_rs_f / beta_rs, "playoff_home_adv_net_points": gp["home"] / gp["beta"]}
    for rows in (rowsR, rowsA):
        rows["pred_net"] = F.predict(fits["net"], rows)
        rows["pred_ortg"] = F.predict(fits["ortg_rel"], rows)
        rows["pred_drtg"] = F.predict(fits["drtg_rel"], rows)
    sup = SUP.fit_support(fitR, feats, fitR.net)
    results["final"]["support"] = {k: v for k, v in sup.items() if k not in ("precision", "mean")}

    # ------------------------------------------------------------------ development evidence (validation seasons, train-only fits)
    greg1 = {"beta": b_rs, "home": h_rs}
    gpo1 = {"beta": b_po, "home": h_po} if use_playoff_params else greg1
    results["validation_stage"] = evaluate(
        d, gt, ser, brackets, va1.assign(pred_net=F.predict(f1, va1)), va1A.assign(pred_net=F.predict(f1, va1A)),
        tau1, greg1, gpo1, TRAIN, VAL, rows1R)
    results["validation_stage"]["note"] = "Development evidence: these seasons were used to make model choices, so they are not test evidence."
    results["validation_stage"]["support"] = support_eval(d, sup1, rows1R[rows1R.season.isin(VAL)], va1A.assign(pred_net=F.predict(f1, va1A)))

    # ------------------------------------------------------------------ the reserved test (scored once, after the freeze above)
    results["test"] = evaluate(d, gt, ser, brackets, rowsR[rowsR.season.isin(TEST)], rowsA[rowsA.season.isin(TEST)], tau,
                               game["regular"], gp, FIT, TEST, rowsR)
    rr = rowsR[rowsR.season.isin(TEST)]
    comp = {}
    for tgt, col in [("net", "pred_net"), ("ortg_rel", "pred_ortg"), ("drtg_rel", "pred_drtg")]:
        comp[tgt] = {"rmse": F.rmse(rr[tgt], rr[col]), "r2": F.r2(rr[tgt], rr[col], fitR[tgt].mean()), "n": int(len(rr)), "sd": float(rr[tgt].std(ddof=0))}
    ra = rowsA[rowsA.season.isin(TEST)]
    comp["net_five_avg_bench"] = {"rmse": F.rmse(ra.net, ra.pred_net), "r2": F.r2(ra.net, ra.pred_net, fitR.net.mean()), "n": int(len(ra))}
    results["test"]["components"] = comp
    results["test"]["coverage_min"] = float(rr.coverage.min())
    results["test"]["support"] = support_eval(d, sup, rr, ra)
    results["support_synthetic"] = synthetic_support(d, sup, prm, fits["net"], feats)

    # ------------------------------------------------------------------ labels (pre-registered rules)
    t = results["test"]
    wins_ok = (t["wins_real"]["rmse"] / t["wins_baseline_league"]["rmse"] <= C.WINS_RMSE_RATIO_MAX
               and C.RANGE_COVERAGE_BAND[0] <= t["wins_real"]["coverage80"] <= C.RANGE_COVERAGE_BAND[1])
    five_beats_prior = t["wins_baseline_prior_season"]["rmse_five_same_teams"] < t["wins_baseline_prior_season"]["rmse"]   # same teams, both
    five_ok = (t["wins_five"]["rmse"] / t["wins_baseline_league"]["rmse"] <= C.WINS_RMSE_RATIO_MAX_FIVE
               and C.RANGE_COVERAGE_BAND[0] <= t["wins_five"]["coverage80"] <= C.RANGE_COVERAGE_BAND[1]
               and (five_beats_prior or not C.FIVE_MUST_BEAT_PRIOR_SEASON))
    S = t["series"]
    lo, hi = C.CALIBRATION_SLOPE_BAND
    slope = S["real"]["calibration"]["slope"] if S["real"]["calibration"] else None
    s_ok = (S["real"]["n"] >= C.SERIES_MIN_TEST_N
            and S["real"]["logloss"] < S["baselines"]["average_team_home_court"]["logloss"]
            and S["real"]["logloss"] < S["baselines"]["better_record"]["logloss"]
            and slope is not None and lo <= slope <= hi)
    ortg_ok = comp1["ortg_rel"]["val_r2"] >= C.COMPONENT_R2_MIN and comp["ortg_rel"]["r2"] >= C.COMPONENT_R2_MIN
    drtg_ok = comp1["drtg_rel"]["val_r2"] >= C.COMPONENT_R2_MIN and comp["drtg_rel"]["r2"] >= C.COMPONENT_R2_MIN
    why = []
    if S["real"]["n"] < C.SERIES_MIN_TEST_N:
        why.append(f"only {S['real']['n']} test series (needs {C.SERIES_MIN_TEST_N})")
    if not S["real"]["logloss"] < S["baselines"]["average_team_home_court"]["logloss"]:
        why.append("series log loss does not beat the average-team baseline")
    if not S["real"]["logloss"] < S["baselines"]["better_record"]["logloss"]:
        why.append("series log loss does not beat the better-record rule")
    if slope is None or not (lo <= slope <= hi):
        why.append(f"series calibration slope is {slope:.2f} (needs {lo}-{hi})" if slope is not None else "series calibration could not be measured")
    custom_reason = "No ground truth exists for invented lineups, so any result for one stays Experimental."
    results["labels"] = {
        "season": {"status": "estimate" if five_ok else "experimental",
                   "historical_teams_validated": bool(wins_ok), "five_avg_bench_validated": bool(five_ok),
                   "five_beats_prior_season": bool(five_beats_prior)},
        "series": {"status": "experimental", "real_team_odds": "validated" if s_ok else "experimental",
                   "reason": (custom_reason + (" Real-team series odds: " + "; ".join(why) + "." if why else ""))},
        "bracket": {"status": "experimental", "real_team_odds": "validated" if s_ok else "experimental",
                    "reason": custom_reason + (" Real-team bracket odds rest on the series model: " + "; ".join(why) + "." if why else "")},
        "show_ortg": bool(ortg_ok), "show_drtg": bool(drtg_ok),
        "rules": frozen["decision_rules"],
    }

    # ------------------------------------------------------------------ export
    (OUT_DOCS / "validation_results.json").write_text(json.dumps(results, indent=2, default=float))
    OUT_PUB.mkdir(parents=True, exist_ok=True)
    export_model(d, prm, pinfo, fits, feats, tau, game, gp, results, rowsR, rowsA, sup)
    print("done")
    return results, d, rowsR, rowsA, fits, prm


def protocol_text() -> dict:
    return {
        "splits": "Chronological: train 1997-2012 (fit), validation 2013-2019 (every choice), test 2020-2026 (scored once after the freeze).",
        "already_seen": C.PRIOR_TEST_SEEN + ". The sim-1.0.0 test (2013-2015) results were inspected, so those seasons are development data here.",
        "availability": {
            "regular_season_estimates": "Retrospective. Inputs are completed-season stats of the same season (a model of what these players did, not a preseason forecast).",
            "playoff_predictions": "Inputs are regular-season stats, all available before the postseason starts. No playoff games, results or awards enter any input.",
            "normalization": "Each season's z-scores use only that season's regular-season qualified pool, so playoff predictions use nothing after the regular season.",
            "game_model": "Game-model slope and home advantage are fitted on earlier seasons only. Team net rating is used as a regressor only in that fit and in the 'actual net rating' oracle baseline, which is labelled as not a prediction.",
        },
    }


def eval_wins(d, rr, ra, taus, greg, fit_seasons, seasons):
    """Team-season wins for full 82-game seasons. rr/ra carry pred_net for real-rotation and five-plus-average-bench structures."""
    full = [s for s in seasons if (d.teams[d.teams.season == s].w + d.teams[d.teams.season == s].l).eq(82).all()]
    out: dict = {"seasons": full}
    rows = {"real": [], "five": []}
    for s in full:
        sr = rr[rr.season == s]
        sa = ra[ra.season == s].set_index("team")
        ratings_real = dict(zip(sr.team, sr.pred_net))
        for r in sr.itertuples():
            opp = [v for k, v in ratings_real.items() if k != r.team]
            for mode, rt, tt in (("real", r.pred_net, taus["real"]), ("five", sa.loc[r.team, "pred_net"], taus["five"])):
                sim = E.season_sim(rt, tt, opp, taus["real"], greg["beta"], greg["home"], n=3000, seed=11 + len(rows[mode]))
                # game luck alone (no model error): same schedule, ratings known exactly
                lucky = E.season_sim(rt, 0.0, opp, 0.0, greg["beta"], greg["home"], n=1500, seed=17 + len(rows[mode]))
                rows[mode].append({"season": s, "team": r.team, "actual": r.wins82, "pred": sim["mean"], "lo": sim["lo"], "hi": sim["hi"],
                                   "lo_luck": lucky["lo"], "hi_luck": lucky["hi"], "pred_net": rt})
    allt = d.teams.set_index(["season", "abbreviation"]).wins82
    pairs = [(allt.get((s - 1, t)), allt.get((s, t))) for (s, t) in allt.index if s in fit_seasons and (s - 1, t) in allt.index]
    slope, icpt = np.polyfit([p[0] for p in pairs], [p[1] for p in pairs], 1)
    nt = d.teams[d.teams.season.isin(fit_seasons)]
    sl2, ic2 = np.polyfit(nt.n_rtg, nt.wins82, 1)
    teams = d.teams.set_index(["season", "abbreviation"])
    for mode in ("real", "five"):
        w = pd.DataFrame(rows[mode])
        y = w.actual.values
        out[f"wins_{mode}"] = {
            "n": int(len(w)), "rmse": F.rmse(y, w.pred), "mae": float(np.abs(y - w.pred).mean()), "bias": float((w.pred - y).mean()),
            "coverage80": float(((y >= w.lo) & (y <= w.hi)).mean()), "mean_range_width": float((w.hi - w.lo).mean()),
            "coverage80_game_luck_only": float(((y >= w.lo_luck) & (y <= w.hi_luck)).mean()),
            "mean_width_game_luck_only": float((w.hi_luck - w.lo_luck).mean()),
            "rmse_ci": boot_ci(np.arange(len(w)), lambda idx: F.rmse(y[idx], w.pred.values[idx])),
            "mae_ci": boot_ci(np.arange(len(w)), lambda idx: float(np.abs(y[idx] - w.pred.values[idx]).mean())),
        }
    wr, wf = pd.DataFrame(rows["real"]), pd.DataFrame(rows["five"])
    y_all = wr.actual.values
    out["wins_baseline_league"] = {"rmse": F.rmse(y_all, np.full(len(y_all), 41.0)), "mae": float(np.abs(y_all - 41.0).mean()),
                                   "note": "every team predicted at 41 wins"}
    bp = np.array([icpt + slope * allt.get((s - 1, t), np.nan) for s, t in zip(wr.season, wr.team)])
    hp = ~np.isnan(bp)
    out["wins_baseline_prior_season"] = {
        "rmse": F.rmse(y_all[hp], bp[hp]), "mae": float(np.abs(y_all[hp] - bp[hp]).mean()), "n": int(hp.sum()),
        "fit": {"slope": float(slope), "intercept": float(icpt)},
        "rmse_model_same_teams": F.rmse(y_all[hp], wr.pred.values[hp]),
        "rmse_five_same_teams": F.rmse(y_all[hp], wf.pred.values[hp]),
        "mae_five_same_teams": float(np.abs(y_all[hp] - wf.pred.values[hp]).mean()),
        "note": "last season's win total fitted to this season's, on teams that existed last season"}
    nt_t = np.array([teams.loc[(s, t), "n_rtg"] for s, t in zip(wr.season, wr.team)])
    out["wins_baseline_actual_net_rating"] = {"rmse": F.rmse(y_all, ic2 + sl2 * nt_t), "note": "uses the season's actual point differential; not a prediction"}
    out["wins_rows"] = wr.drop(columns=["lo_luck", "hi_luck"]).round(2).to_dict(orient="records")
    return out


def eval_games(d, gt, rr, ra, taus, greg, gpo, fit_seasons, seasons):
    pred = {"real": dict(zip(zip(rr.season, rr.team), rr.pred_net)), "five": dict(zip(zip(ra.season, ra.team), ra.pred_net))}
    actual_net = dict(zip(zip(d.teams.season, d.teams.abbreviation), d.teams.n_rtg))
    prev_net = lambda s, t: actual_net.get((s - 1, t), np.nan)
    g = gt[gt.season.isin(seasons)]
    out = {"excluded_neutral_site_games": int(g.neutral.sum())}
    g = g[~g.neutral]
    for label in ("regular", "playoffs"):
        sub = g[g.playoffs == (label == "playoffs")]
        prm_g = greg if label == "regular" else gpo
        fitg = gt[gt.season.isin(fit_seasons) & (gt.playoffs == (label == "playoffs")) & ~gt.neutral].copy()
        home_rate = float(fitg.home_win.mean())
        fitg["pd"] = [prev_net(s, t) - prev_net(s, a) for s, t, a in zip(fitg.season, fitg.home, fitg.away)]
        fitg = fitg.dropna(subset=["pd"])
        bpv, hpv = F.probit_fit(fitg.pd.values, fitg.home_win.values.astype(float))
        res = {}
        for mode in ("real", "five"):
            pr = pred[mode]
            s2 = sub[[(s, t) in pr and (s, a) in pr for s, t, a in zip(sub.season, sub.home, sub.away)]]
            dl = np.array([pr[(s, t)] - pr[(s, a)] for s, t, a in zip(s2.season, s2.home, s2.away)])
            p = V.p_game_integrated(dl, prm_g["beta"], prm_g["home"], 2 * taus[mode] ** 2)
            y = s2.home_win.values.astype(float)
            idx = np.arange(len(y))
            res[mode] = {"n": int(len(y)), "logloss": V.log_loss(p, y), "brier": V.brier(p, y), "accuracy": float(((p > .5) == (y > .5)).mean()),
                         "logloss_ci": boot_ci(idx, lambda i: V.log_loss(p[i], y[i]), n=300), "brier_ci": boot_ci(idx, lambda i: V.brier(p[i], y[i]), n=300),
                         "calibration": V.calibration(p, y)}
            if mode == "real":
                pdv = np.array([prev_net(s, t) - prev_net(s, a) for s, t, a in zip(s2.season, s2.home, s2.away)])
                okm = ~np.isnan(pdv)
                pprior = norm.cdf(bpv * np.nan_to_num(pdv) + hpv)
                da = np.array([actual_net[(s, t)] - actual_net[(s, a)] for s, t, a in zip(s2.season, s2.home, s2.away)])
                res["baselines"] = {
                    "home_rate": {"logloss": V.log_loss(np.full(len(y), home_rate), y), "brier": V.brier(np.full(len(y), home_rate), y)},
                    "prior_season_net_rating": {"logloss": V.log_loss(pprior[okm], y[okm]), "brier": V.brier(pprior[okm], y[okm]), "n": int(okm.sum()),
                                                "model_logloss_same_games": V.log_loss(p[okm], y[okm])},
                    "actual_season_net_rating_oracle": {"logloss": V.log_loss(norm.cdf(prm_g["beta"] * da + prm_g["home"]), y),
                                                        "brier": V.brier(norm.cdf(prm_g["beta"] * da + prm_g["home"]), y),
                                                        "note": "uses the whole season's results, including these games: not a prediction"}}
        out[label] = res
    return out


def series_pattern_for(r) -> str:
    n = 2 * int(r.need) - 1
    if bool(r.neutral):
        return "N" * n
    return BB.series_pattern(int(r.season), int(r.round), int(r.need))


def series_probs(ser, ratings, tau, beta, h, seed=7, n=20000):
    out = []
    for r in ser.itertuples():
        a, b = (r.season, r.hc), (r.season, r.other)
        if a not in ratings or b not in ratings:
            continue
        s = E.series_sim(ratings[a], ratings[b], tau, tau, series_pattern_for(r), int(r.need), beta, h, n=n, seed=seed + int(r.Index))
        out.append({"season": r.season, "hc": r.hc, "other": r.other, "round": int(r.round), "p": s["p_hc"], "y": float(r.winner == r.hc),
                    "games": int(r.games), "exp_games": sum(g * q for g, q in s["length"].items()), "len": s["length"], "need": int(r.need),
                    "neutral": bool(r.neutral)})
    return pd.DataFrame(out)


def series_metrics(o):
    y, p = o.y.values, o.p.values
    idx = np.arange(len(o))
    return {"n": int(len(o)), "logloss": V.log_loss(p, y), "brier": V.brier(p, y), "accuracy": float(((p > .5) == (y > .5)).mean()),
            "logloss_ci": boot_ci(idx, lambda i: V.log_loss(p[i], y[i])), "brier_ci": boot_ci(idx, lambda i: V.brier(p[i], y[i])),
            "mean_games_actual": float(o.games.mean()), "mean_games_model": float(o.exp_games.mean()),
            "calibration": V.calibration(p, y, bins=5) if len(o) >= 30 else None}


def eval_series(d, gt, ser, rr, ra, taus, gpo, fit_seasons, seasons):
    st = ser[ser.season.isin(seasons)].reset_index(drop=True)
    rec = {(s, t): w / (w + l) for s, t, w, l in zip(d.teams.season, d.teams.abbreviation, d.teams.w, d.teams.l)}
    o = series_probs(st, dict(zip(zip(rr.season, rr.team), rr.pred_net)), taus["real"], gpo["beta"], gpo["home"])
    o5 = series_probs(st, dict(zip(zip(ra.season, ra.team), ra.pred_net)), taus["five"], gpo["beta"], gpo["home"])
    out = {"real": series_metrics(o), "five": series_metrics(o5)}
    # baselines
    y = o.y.values
    eq = np.array([E.series_sim(0.0, 0.0, 0.0, 0.0, series_pattern_for(r), int(r.need), gpo["beta"], gpo["home"], n=4000, seed=3)["p_hc"] for r in st.itertuples()])
    fit_ser = ser[ser.season.isin(fit_seasons)]
    better_hits = [(rec[(r.season, r.hc)] > rec[(r.season, r.other)]) == (r.winner == r.hc) for r in fit_ser.itertuples() if rec[(r.season, r.hc)] != rec[(r.season, r.other)]]
    p_better = float(np.mean(better_hits))
    pb = np.array([0.5 if rec[(r.season, r.hc)] == rec[(r.season, r.other)] else (p_better if rec[(r.season, r.hc)] > rec[(r.season, r.other)] else 1 - p_better) for r in o.itertuples()])
    # prior-season: probit slope fitted on earlier playoff games using last season's net rating; no model error added (the noise is inside the fit)
    actual_net = dict(zip(zip(d.teams.season, d.teams.abbreviation), d.teams.n_rtg))
    prev = lambda s, t: actual_net.get((s - 1, t), 0.0)      # a team with no last season is treated as average
    fg = gt[gt.season.isin(fit_seasons) & gt.playoffs & ~gt.neutral]
    bpv, hpv = F.probit_fit(np.array([prev(s, t) - prev(s, a) for s, t, a in zip(fg.season, fg.home, fg.away)]), fg.home_win.values.astype(float))
    pr = np.array([E.series_sim(prev(r.season, r.hc), prev(r.season, r.other), 0.0, 0.0, series_pattern_for(r), int(r.need), bpv, hpv, n=4000, seed=3)["p_hc"]
                   for r in st.itertuples()])
    out["baselines"] = {
        "average_team_home_court": {"logloss": V.log_loss(eq, y), "brier": V.brier(eq, y), "note": "every team equal; only home court differs"},
        "better_record": {"logloss": V.log_loss(pb, y), "brier": V.brier(pb, y), "accuracy": float(((pb > .5) == (y > .5))[pb != .5].mean()),
                          "p_better_record_wins_in_fit_seasons": p_better,
                          "note": "the team with the better regular-season record wins with the probability seen in earlier seasons; ties 50/50"},
        "prior_season_net_rating": {"logloss": V.log_loss(pr, y), "brier": V.brier(pr, y), "note": "last season's net rating, game slope fitted on earlier playoff games"},
        "home_court_team_always_accuracy": float(y.mean()),
    }
    out["length_observed"] = {int(k): int(v) for k, v in pd.Series([int(g) for g in o.games]).value_counts().sort_index().items()}
    out["by_round"] = {int(k): {"n": int(len(v)), "acc": float(((v.p > .5) == (v.y > .5)).mean())} for k, v in o.groupby("round")}
    out["rows"] = o.drop(columns=["len"]).round(4).to_dict(orient="records")
    return out


def eval_bracket(d, brackets, rr, ra, taus, gpo, seasons):
    out = {}
    for mode, rows in (("real_rotations", rr), ("five_plus_average_bench", ra)):
        ratings = {(r.season, r.team): r.pred_net for r in rows.itertuples()}
        tt = taus["real"] if mode == "real_rotations" else taus["five"]
        res = []
        for s in seasons:
            b = brackets[s]
            r = E.bracket_sim(b, {t: ratings[(s, t)] for t in b["teams"]}, {t: tt for t in b["teams"]}, gpo["beta"], gpo["home"], n=4000, seed=100 + s)
            champ = b["champion"]
            pc = r["champion"][champ]
            best_rec = max(b["teams"], key=lambda t: (b["teams"][t]["w"] / (b["teams"][t]["w"] + b["teams"][t]["l"]), b["teams"][t]["mov"]))
            res.append({"season": s, "champion": champ, "p_champion": pc, "rank": sorted(r["champion"].values(), reverse=True).index(pc) + 1,
                        "log_score": float(-np.log(max(pc, 1e-6))), "favorite": max(r["champion"], key=r["champion"].get),
                        "p_favorite": max(r["champion"].values()), "best_record_team": best_rec, "best_record_won": best_rec == champ})
        out[mode] = {"seasons": res, "mean_log_score": float(np.mean([x["log_score"] for x in res])), "n_seasons": len(res),
                     "favorite_hit_rate": float(np.mean([x["favorite"] == x["champion"] for x in res])),
                     "best_record_hit_rate": float(np.mean([x["best_record_won"] for x in res]))}
    out["uniform_log_score"] = float(np.log(16))
    return out


def evaluate(d, gt, ser, brackets, rr, ra, taus, greg, gpo, fit_seasons, seasons, fit_rows):
    out = eval_wins(d, rr, ra, taus, greg, fit_seasons, seasons)
    out["games"] = eval_games(d, gt, rr, ra, taus, greg, gpo, fit_seasons, seasons)
    out["series"] = eval_series(d, gt, ser, rr, ra, taus, gpo, fit_seasons, seasons)
    out["bracket"] = eval_bracket(d, brackets, rr, ra, taus, gpo, seasons)
    return out


def support_eval(d, sup, rows_real, rows_five):
    """How often are held-out real teams flagged, and does the model's error grow with the distance?"""
    five = rows_five.copy()
    lv, d2 = [], []
    for r in five.itertuples():
        res = SUP.level(sup, r._asdict(), r.pred_net, [{"season": r.season, "mp": 1e9, "g": 82}] * 5)
        lv.append(res["level"]); d2.append(res["d2"])
    five["level"], five["d2"] = lv, d2
    five["err"] = five.net - five.pred_net
    out = {"n": int(len(five)), "levels": {}}
    for k, g in five.groupby("level"):
        out["levels"][k] = {"n": int(len(g)), "share": float(len(g) / len(five)), "net_rmse": F.rmse(g.net, g.pred_net), "mean_abs_net_error": float(g.err.abs().mean())}
    cut = five.d2.quantile([1 / 3, 2 / 3]).values
    terc = np.digitize(five.d2.values, cut)
    out["by_distance_tercile"] = {["near", "middle", "far"][i]: {"n": int((terc == i).sum()), "net_rmse": F.rmse(five.net[terc == i], five.pred_net[terc == i])} for i in range(3)}
    out["spearman_distance_vs_abs_error"] = float(pd.Series(five.d2.values).corr(pd.Series(five.err.abs().values), method="spearman"))
    out["d2_cutoffs"] = {"limited": sup["limited"], "unsupported": sup["unsupported"]}
    return out


def synthetic_support(d, sup, prm, fit_net, feats):
    """Descriptive only (there is no ground truth for invented lineups): how the check classifies random lineups and the
    five most 'extreme' players of each season by a simple feature sum."""
    rng = np.random.default_rng(2026)
    pool = d.players[d.players.complete & d.players.qualified].reset_index(drop=True)
    def classify(picks):
        recs = [d.rec(p, s, float(m)) for p, s, m in picks]
        v, info = M.lineup_vector(recs, None, prm, d.sd_usg)
        vec = dict(zip(M.FEATURE_NAMES, v))
        net = fit_net["intercept"] + sum(fit_net["coef"][f] * vec[f] for f in feats)
        pl = [{"season": s, "mp": m, "g": int(g)} for (p, s, m), g in zip(picks, [pool[(pool.player_id == p) & (pool.season == s)].g.iloc[0] for p, s, m in picks])]
        return SUP.level(sup, vec, net, pl) | {"net": float(net)}
    counts = {"random_same_season": {}, "random_any_seasons": {}, "feature_leaders": {}}
    def add(k, lv):
        counts[k][lv] = counts[k].get(lv, 0) + 1
    for _ in range(300):
        s = int(rng.choice(sorted(pool.season.unique())))
        g = pool[pool.season == s]
        idx = rng.choice(len(g), 5, replace=False)
        add("random_same_season", classify([(g.player_id.iloc[i], s, g.mp.iloc[i]) for i in idx])["level"])
        idx = rng.choice(len(pool), 5, replace=False)
        if len({pool.player_id.iloc[i] for i in idx}) == 5:
            add("random_any_seasons", classify([(pool.player_id.iloc[i], int(pool.season.iloc[i]), pool.mp.iloc[i]) for i in idx])["level"])
    z = ["ts_percent_z", "ast_percent_z", "orb_percent_z", "drb_percent_z", "stl_percent_z", "blk_percent_z", "x3p_ar_z"]
    pz = d.pz[d.pz.qualified & d.pz.complete]
    for s in sorted(pz.season.unique()):
        g = pz[pz.season == s].copy()
        g["score"] = g[z].sum(axis=1)
        top = g.sort_values("score", ascending=False).head(5)
        add("feature_leaders", classify([(r.player_id, s, r.mp) for r in top.itertuples()])["level"])
    return counts



def export_model(d, prm, pinfo, fits, feats, tau, game, gp, results, rowsR, rowsA, sup):
    stats = d.stats
    T = results["test"]
    seasons = {}
    for s in ALL:
        seasons[str(s)] = {
            "mean": {f: float(stats.loc[s, f + "__mean"]) for f in C.FEATURES},
            "sd": {f: float(stats.loc[s, f + "__sd"]) for f in C.FEATURES},
            "lgOrtg": float(d.env.loc[s, "lg_ortg"]), "lgPace": float(d.env.loc[s, "lg_pace"]),
            "lgTs": float(d.env.loc[s, "lg_ts"]),
        }
    ref = rowsR[rowsR.season.isin(FIT)][feats].mean()
    model = {
        "modelVersion": C.MODEL_VERSION, "dataVersion": C.DATA_VERSION,
        "features": feats,
        "coef": {k: fits[k]["coef"] for k in ("net", "ortg_rel", "drtg_rel")},
        "intercept": {k: fits[k]["intercept"] for k in ("net", "ortg_rel", "drtg_rel")},
        "reference": {k: float(v) for k, v in ref.items()},
        "dimensions": {k: [f for f in v if f in feats] for k, v in M.DIMENSIONS.items()},
        "params": {"starterShare": prm.starter_share, "usageTarget": prm.usage_target, "betaTsUsg": prm.beta_ts_usg,
                   "betaTsUsgSe": pinfo["beta_se"], "kClip": list(prm.k_clip),
                   "avgBench": {k: float(v) for k, v in prm.avg_bench.items()}},
        "tau": {"real": tau["real"], "five": tau["five"], "ortgFive": tau["ortg_five"]},
        # range of real team net ratings in the fitting seasons: used to warn when a lineup is projected outside it
        "netRange": {"min": float(rowsR[rowsR.season.isin(FIT)].net.min()), "max": float(rowsR[rowsR.season.isin(FIT)].net.max()),
                     "p05": float(rowsR[rowsR.season.isin(FIT)].net.quantile(0.05)), "p95": float(rowsR[rowsR.season.isin(FIT)].net.quantile(0.95))},
        "game": {"regular": game["regular"], "playoff": gp},
        "seasons": seasons,
        "labels": results["labels"],
        "support": sup,
        "validation": {
            "fitSeasons": [FIT[0], FIT[-1]], "validationSeasons": [C.VALIDATION[0], C.VALIDATION[1]], "testSeasons": [C.TEST[0], C.TEST[1]],
            "winsReal": {k: T["wins_real"][k] for k in ("n", "rmse", "mae", "coverage80", "mean_range_width")},
            "winsFive": {k: T["wins_five"][k] for k in ("n", "rmse", "mae", "coverage80", "mean_range_width", "coverage80_game_luck_only", "mean_width_game_luck_only")},
            "winsBaselineLeagueRmse": T["wins_baseline_league"]["rmse"],
            "winsBaselineLeagueMae": T["wins_baseline_league"]["mae"],
            "priorSeason": {"n": T["wins_baseline_prior_season"]["n"], "rmse": T["wins_baseline_prior_season"]["rmse"],
                            "mae": T["wins_baseline_prior_season"]["mae"], "fiveRmse": T["wins_baseline_prior_season"]["rmse_five_same_teams"],
                            "fiveMae": T["wins_baseline_prior_season"]["mae_five_same_teams"]},
            "netR2Real": T["components"]["net"]["r2"], "netR2Five": T["components"]["net_five_avg_bench"]["r2"],
            "ortgR2": T["components"]["ortg_rel"]["r2"], "drtgR2": T["components"]["drtg_rel"]["r2"],
            "seriesN": T["series"]["real"]["n"],
            "series": {"logloss": T["series"]["real"]["logloss"], "brier": T["series"]["real"]["brier"],
                       "slope": T["series"]["real"]["calibration"]["slope"] if T["series"]["real"]["calibration"] else None,
                       "baselineAverageLogloss": T["series"]["baselines"]["average_team_home_court"]["logloss"],
                       "baselineRecordLogloss": T["series"]["baselines"]["better_record"]["logloss"]},
            "earlier": {"version": "sim-1.0.0", "testSeasons": [2013, 2026], "fiveRmse": 9.98, "priorSeasonRmse": 9.84,
                        "note": "In the first release the five-player estimate (RMSE 9.98 wins) did not beat last season's record (9.84). Those results were inspected and are development evidence."},
        },
    }
    (OUT_PUB / "model.json").write_text(json.dumps(model, separators=(",", ":")))


if __name__ == "__main__":
    main()
