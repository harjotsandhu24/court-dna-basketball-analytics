"""
Simulation-model data and leakage checks (software tests, not model validation).

Run: cd analysis && python3 -m pytest ../tests/test_sim_model.py -v
Model validation (accuracy, calibration, baselines) is reported separately in docs/model/validation_report.md.
"""
import json
import os
import sys

import numpy as np
import pandas as pd
import pytest

HERE = os.path.dirname(__file__)
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(ROOT, "analysis"))
from sim import config as C  # noqa: E402

SIM = os.path.join(ROOT, "public", "data", "sim")
load = lambda p: json.load(open(p))  # noqa: E731
BR = load(os.path.join(SIM, "brackets.json"))
MODEL = load(os.path.join(SIM, "model.json"))
HONORS = load(os.path.join(ROOT, "public", "data", "honors.json"))


# ------------------------------------------------------------------ splits, freeze and leakage
def test_splits_are_chronological_ordered_and_disjoint():
    assert C.TRAIN[1] < C.VALIDATION[0] and C.VALIDATION[1] < C.TEST[0]
    assert (C.TRAIN, C.VALIDATION, C.TEST) == ((1997, 2012), (2013, 2019), (2020, 2026))
    assert MODEL["validation"]["fitSeasons"] == [C.TRAIN[0], C.VALIDATION[1]]            # final fit stops before the test seasons
    assert MODEL["validation"]["fitSeasons"][1] < MODEL["validation"]["testSeasons"][0]


def test_old_test_seasons_are_development_data_not_untouched_test_data():
    # 2013-2015 were the sim-1.0.0 test: they must now sit in the validation split, never in the test split
    assert all(C.VALIDATION[0] <= y <= C.VALIDATION[1] for y in (2013, 2014, 2015))
    assert not any(C.TEST[0] <= y <= C.TEST[1] for y in (2013, 2014, 2015))
    assert "inspected" in MODEL["validation"]["earlier"]["note"]


def test_choices_were_frozen_on_disk_before_the_test_was_scored():
    frozen = load(os.path.join(ROOT, "docs", "model", "frozen_choices.json"))
    res = load(os.path.join(ROOT, "docs", "model", "validation_results.json"))
    import hashlib
    body = {k: v for k, v in frozen.items() if k != "sha256"}
    assert hashlib.sha256(json.dumps(body, sort_keys=True, default=float).encode()).hexdigest() == frozen["sha256"]
    assert res["frozen"]["sha256"] == frozen["sha256"]
    assert frozen["splits"]["test"] == list(C.TEST)
    assert frozen["decision_rules"]["calibration_slope_band"] == list(C.CALIBRATION_SLOPE_BAND)
    assert frozen["already_seen_before_this_freeze"]
    assert os.path.getmtime(os.path.join(ROOT, "docs", "model", "frozen_choices.json")) <= os.path.getmtime(os.path.join(ROOT, "docs", "model", "validation_results.json"))
    assert frozen["features"] == MODEL["features"]                                       # what was frozen is what shipped


def test_decision_rules_are_the_registered_ones():
    assert (C.WINS_RMSE_RATIO_MAX, C.WINS_RMSE_RATIO_MAX_FIVE, C.RANGE_COVERAGE_BAND) == (0.70, 0.85, (0.70, 0.90))
    assert C.COMPONENT_R2_MIN == 0.30 and C.SERIES_MIN_TEST_N == 100 and C.CALIBRATION_SLOPE_BAND == (0.75, 1.25)
    assert C.FIVE_MUST_BEAT_PRIOR_SEASON is True


def test_labels_follow_the_registered_rules_and_stay_experimental_for_custom_lineups():
    L = MODEL["labels"]
    v = MODEL["validation"]
    assert L["series"]["status"] == "experimental" and L["bracket"]["status"] == "experimental"   # no ground truth for invented lineups
    five_ok = (v["winsFive"]["rmse"] / v["winsBaselineLeagueRmse"] <= C.WINS_RMSE_RATIO_MAX_FIVE
               and C.RANGE_COVERAGE_BAND[0] <= v["winsFive"]["coverage80"] <= C.RANGE_COVERAGE_BAND[1]
               and v["priorSeason"]["fiveRmse"] < v["priorSeason"]["rmse"])
    assert L["season"]["five_avg_bench_validated"] == five_ok
    assert L["season"]["status"] == ("estimate" if five_ok else "experimental")
    slope = v["series"]["slope"]
    real_ok = (v["seriesN"] >= C.SERIES_MIN_TEST_N and v["series"]["logloss"] < v["series"]["baselineAverageLogloss"]
               and v["series"]["logloss"] < v["series"]["baselineRecordLogloss"] and C.CALIBRATION_SLOPE_BAND[0] <= slope <= C.CALIBRATION_SLOPE_BAND[1])
    assert (L["series"]["real_team_odds"] == "validated") == real_ok
    assert L["show_drtg"] is False and v["drtgR2"] < C.COMPONENT_R2_MIN                           # expected defensive rating stays withheld


def test_reported_numbers_are_rmse_and_mae_kept_apart_and_five_kept_apart_from_full_rotations():
    v = MODEL["validation"]
    for k in ("winsReal", "winsFive"):
        assert {"rmse", "mae", "coverage80", "mean_range_width", "n"} <= set(v[k])
        assert v[k]["mae"] < v[k]["rmse"]                       # MAE <= RMSE always; equal numbers would mean one was copied
    assert v["winsFive"]["rmse"] > v["winsReal"]["rmse"]        # five + average bench is a different, harder estimate
    assert v["earlier"]["fiveRmse"] == 9.98 and v["earlier"]["priorSeasonRmse"] == 9.84 and v["earlier"]["fiveRmse"] > v["earlier"]["priorSeasonRmse"]


def test_validation_report_numbers_match_the_shipped_model():
    res = load(os.path.join(ROOT, "docs", "model", "validation_results.json"))
    assert res["test"]["wins_real"]["rmse"] == pytest.approx(MODEL["validation"]["winsReal"]["rmse"])
    assert res["test"]["wins_five"]["mae"] == pytest.approx(MODEL["validation"]["winsFive"]["mae"])
    assert res["test"]["series"]["real"]["n"] == MODEL["validation"]["seriesN"] >= 100
    assert set(res["test"]["wins_five"]) >= {"rmse", "mae", "coverage80", "mean_range_width", "coverage80_game_luck_only", "rmse_ci", "mae_ci"}
    for g in ("regular", "playoffs"):
        for m in ("real", "five"):
            assert set(res["test"]["games"][g][m]) >= {"logloss", "brier", "calibration", "n"}
    assert set(res["test"]["series"]["baselines"]) >= {"average_team_home_court", "better_record", "prior_season_net_rating"}
    assert "validation_stage" in res and "Development evidence" in res["validation_stage"]["note"]


@pytest.fixture(scope="module")
def data():
    raw = os.path.join(ROOT, "raw", "Advanced.csv")
    if not os.path.exists(raw):
        pytest.skip("raw source tables not present")
    from sim.fit import Data
    return Data()


def test_z_scores_for_a_season_do_not_depend_on_other_seasons(data):
    from sim import data_build as D
    before = data.pz[data.pz.season == 2005].ts_percent_z.reset_index(drop=True)
    p = data.players.copy()
    later = p.season >= 2013
    p.loc[later, "ts_percent"] = p.loc[later, "ts_percent"] * 1.5 + 0.2
    pz = D.add_z(p, D.season_pool_stats(p))
    after = pz[pz.season == 2005].ts_percent_z.reset_index(drop=True)
    pd.testing.assert_series_equal(before, after)


def test_fitting_rows_ignore_test_season_results(data):
    from sim.fit import build_rows, fit_ridge, estimate_params
    from sim import model as M
    train = list(range(C.TRAIN[0], C.TRAIN[1] + 1))
    prm, _ = estimate_params(data, train)
    base = build_rows(data, prm, train, "real")
    fit0 = fit_ridge(base, M.FEATURE_NAMES, 0.1, "net")
    saved = data.teams.copy()
    try:
        late = data.teams.season >= C.TEST[0]
        rng = np.random.default_rng(0)
        data.teams.loc[late, "n_rtg"] = rng.permutation(data.teams.loc[late, "n_rtg"].to_numpy())
        data.teams.loc[late, "wins82"] = 41
        prm2, _ = estimate_params(data, train)
        rows2 = build_rows(data, prm2, train, "real")
        fit1 = fit_ridge(rows2, M.FEATURE_NAMES, 0.1, "net")
    finally:
        data.teams = saved
    assert prm2 == prm
    for k, v in fit0["coef"].items():
        assert fit1["coef"][k] == pytest.approx(v, abs=1e-12)


def test_game_model_ignores_test_season_games(data):
    from sim import data_build as D, validate as V, fit as F
    games = D.load_games()
    gt = V.game_table(data, games)
    fit = gt[gt.season <= C.VALIDATION[1]]
    a = F.probit_fit((fit.net_home - fit.net_away).values, fit.home_win.values.astype(float))
    shuffled = games.copy()
    late = shuffled.season >= C.TEST[0]
    shuffled.loc[late, "home_win"] = np.random.default_rng(1).permutation(shuffled.loc[late, "home_win"].to_numpy())
    gt2 = V.game_table(data, shuffled)
    fit2 = gt2[gt2.season <= C.VALIDATION[1]]
    b = F.probit_fit((fit2.net_home - fit2.net_away).values, fit2.home_win.values.astype(float))
    assert a == pytest.approx(b, abs=1e-12)


def test_no_player_feature_uses_awards_or_playoff_columns():
    banned = ("award", "mvp", "allnba", "playoff", "champ", "allstar")
    assert not [f for f in C.FEATURES if any(b in f for b in banned)]
    assert not [f for f in MODEL["features"] if any(b in f for b in banned)]


# ------------------------------------------------------------------ brackets
SUPPORTED = [int(s) for s, v in BR["status"].items() if v["supported"]]


def test_every_postseason_1997_to_2026_is_supported():
    assert SUPPORTED == list(range(1997, 2027))
    assert all(v["reason"] is None for v in BR["status"].values())


@pytest.mark.parametrize("season", SUPPORTED)
def test_bracket_shape_formats_and_home_court(season):
    b = BR["brackets"][str(season)]
    rounds = {r: [s for s in b["series"] if s["round"] == r] for r in (1, 2, 3, 4)}
    assert [len(rounds[r]) for r in (1, 2, 3, 4)] == [8, 4, 2, 1]
    assert len(b["teams"]) == 16
    assert b["seedSource"] == "published" and all(1 <= t["seed"] <= 8 and "pos" in t for t in b["teams"].values())
    assert b.get("neutral", False) == (season == 2020)
    for s in b["series"]:
        h = s["history"]
        assert s["need"] == (3 if s["round"] == 1 and season <= 2002 else 4)
        assert max(h["wins_hc"], h["wins_other"]) == s["need"]
        assert s["need"] <= h["games"] <= 2 * s["need"] - 1
        assert h["games"] == h["wins_hc"] + h["wins_other"]
        assert h["winner"] in (s["hc"], s["other"])
        assert s["pattern"] == ("HHAAH" if s["need"] == 3 else "HHAAAHH" if (s["round"] == 4 and season <= 2013) else "HHAAHAH")
        hw, hl = b["teams"][s["hc"]]["w"], b["teams"][s["hc"]]["l"]
        ow, ol = b["teams"][s["other"]]["w"], b["teams"][s["other"]]["l"]
        assert hw / (hw + hl) >= ow / (ow + ol)          # the better regular-season record hosts, never the better seed by itself
    for r in (2, 3, 4):  # each later series is fed by exactly the two earlier winners
        ids = {s["id"]: s for s in b["series"]}
        for s in rounds[r]:
            f = s["feeders"]
            assert f and {ids[f[0]]["history"]["winner"], ids[f[1]]["history"]["winner"]} == {s["hc"], s["other"]}
    assert rounds[4][0]["history"]["winner"] == b["champion"]


def test_home_court_rule_counts_cover_all_450_series():
    r = BR["homeRule"]
    assert r["series"] == 450 and r["host_worse_record"] == 0
    assert r["host_better_record"] + r["tied_record"] == 450
    assert r["tied_host_better_h2h"] + r["tied_host_worse_h2h"] + r["tied_h2h_even"] == r["tied_record"]


def test_known_champions():
    champs = {s: BR["brackets"][str(s)]["champion"] for s in SUPPORTED}
    for season, team in {1997: "CHI", 1999: "SAS", 2004: "DET", 2005: "SAS", 2011: "DAL", 2014: "SAS", 2016: "CLE", 2019: "TOR",
                         2020: "LAL", 2021: "MIL", 2022: "GSW", 2023: "DEN", 2024: "BOS", 2025: "OKC"}.items():
        assert champs[season] == team, season


def test_historical_best_of_five_first_rounds_are_kept():
    needs = {s: [x["need"] for x in BR["brackets"][str(s)]["series"] if x["round"] == 1] for s in range(1997, 2003)}
    assert all(set(n) == {3} for n in needs.values())  # 1997-2002 first rounds were best-of-5
    assert {x["need"] for x in BR["brackets"]["2003"]["series"] if x["round"] == 1} == {4}  # best-of-7 from 2003


def test_2020_postseason_was_neutral_and_other_finals_patterns_changed_in_2014():
    assert BR["brackets"]["2020"]["neutral"] is True
    assert BR["brackets"]["2013"]["series"][-1]["pattern"] == "HHAAAHH"
    assert BR["brackets"]["2014"]["series"][-1]["pattern"] == "HHAAHAH"


# ------------------------------------------------------------------ game data and sources (through 2025-26)
GAMES = os.path.join(ROOT, "raw", "sim", "games_final.csv")


@pytest.mark.skipif(not os.path.exists(GAMES), reason="derived game table not present")
def test_game_table_covers_every_season_and_reconciles_with_basketball_reference():
    g = pd.read_csv(GAMES)
    assert sorted(g.season.unique()) == list(range(1997, 2027))
    teams = pd.read_csv(os.path.join(ROOT, "raw", "Team Summaries.csv"))
    teams = teams[(teams.lg == "NBA") & (teams.team != "League Average") & teams.season.between(1997, 2026)]
    r = g[~g.playoffs]
    wl = pd.concat([pd.DataFrame({"season": r.season, "team": r.home, "w": (r.home_pts > r.away_pts).astype(int)}),
                    pd.DataFrame({"season": r.season, "team": r.away, "w": (r.home_pts < r.away_pts).astype(int)})]).groupby(["season", "team"]).w.sum()
    merged = teams.set_index(["season", "abbreviation"]).w
    assert len(merged) == 892 and (wl.reindex(merged.index) == merged).all()
    po = g[g.playoffs]
    assert po.groupby("season").size().min() >= 50 and po.home_pts.notna().all()
    assert g[(g.season == 2020) & g.playoffs].neutral.all() and not g[(g.season == 2019)].neutral.any()


def test_source_log_records_url_date_checksum_coverage_and_transformations():
    log = load(os.path.join(ROOT, "docs", "model", "source_log.json"))
    assert len(log["sources"]) == 85 and log["coverage"]["seasons"] == [1997, 2026]
    for s in log["sources"]:
        assert s["url"].startswith("https://") and len(s["sha256"]) == 64 and s["retrieved"] == "2026-10-16" and s["bytes"] > 0
    assert log["reconciliation"]["regular_season_record_vs_basketball_reference"] == {"team_seasons": 892, "mismatches": 0}
    assert len(log["transformations"]) >= 5 and "official_playoff_seeds" in log["not_available"] and "finals_mvp" in log["not_available"]


def test_downloaded_files_still_match_their_logged_checksums_when_present():
    import hashlib
    log = load(os.path.join(ROOT, "docs", "model", "source_log.json"))
    d = os.path.join(ROOT, "raw", "sim", "download")
    if not os.path.isdir(d):
        pytest.skip("download cache not present")
    checked = 0
    for s in log["sources"][:6]:
        p = os.path.join(d, s["file"])
        if os.path.exists(p):
            assert hashlib.sha256(open(p, "rb").read()).hexdigest() == s["sha256"]
            checked += 1
    assert checked


# ------------------------------------------------------------------ support check (Python reference)
def test_support_cutoffs_come_from_training_teams_only_and_are_the_registered_quantiles(data):
    from sim import fit as F, support as SUP, config as C2
    sup = MODEL["support"]
    assert sup["n"] == int(((data.teams.season <= C2.VALIDATION[1]) & data.teams.season.between(1997, 2019)).sum()) - sup_missing(data)
    assert sup["limitedQ"] == C2.SUPPORT_LIMITED_Q and sup["unsupportedQ"] == C2.SUPPORT_UNSUPPORTED_Q
    assert 0 < sup["limited"] < sup["unsupported"] <= sup["d2"]["1.0"]
    # the stored cut-offs are the quantiles of the stored distances
    assert sup["d2"]["0.95"] == pytest.approx(sup["limited"], rel=0.05)


def sup_missing(data):
    """Team-seasons without a usable rotation (fewer than six covered players) are not in the support population."""
    from sim import config as C2
    fit = data.teams[data.teams.season.between(1997, 2019)]
    n = 0
    for r in fit.itertuples():
        recs, _ = data.team_roster(r.season, r.abbreviation)
        if len(recs) < C2.STARTERS + 1:
            n += 1
    return n


def test_support_level_rules():
    from sim import support as SUP
    sup = MODEL["support"]
    dims = sup["dims"]
    vec_mean = {k: m for k, m in zip(dims, sup["mean"])}
    ok_players = [{"season": 2005, "mp": 2000, "g": 70}] * 5
    assert SUP.level(sup, vec_mean, 0.0, ok_players)["level"] == "supported"
    far = {**vec_mean, dims[0]: vec_mean[dims[0]] + 6}
    assert SUP.level(sup, far, 0.0, ok_players)["level"] == "unsupported"
    assert SUP.level(sup, vec_mean, sup["net"]["max"] + 0.1, ok_players)["level"] == "unsupported"
    assert SUP.level(sup, vec_mean, sup["net"]["min"] - 0.1, ok_players)["level"] == "unsupported"
    assert SUP.level(sup, vec_mean, 0.0, ok_players[:4] + [{"season": 2005, "mp": 100, "g": 70}])["level"] == "limited"
    assert SUP.level(sup, vec_mean, 0.0, ok_players[:4] + [{"season": 1997, "mp": 2000, "g": 70}])["reasons"] == ["mixed_era"]


def test_support_check_does_not_use_awards_or_outcomes():
    sup = MODEL["support"]
    assert all(d.startswith("s_") for d in sup["dims"])
    assert not [d for d in sup["dims"] if any(b in d for b in ("net", "win", "mvp", "award", "playoff"))]


def test_support_check_is_reported_with_its_limits():
    res = load(os.path.join(ROOT, "docs", "model", "validation_results.json"))
    t = res["test"]["support"]
    assert t["n"] == 210 and set(t["levels"]) >= {"supported", "limited"}
    # honest limitation: distance from other teams does not predict this model's error within real teams
    assert abs(t["spearman_distance_vs_abs_error"]) < 0.2
    syn = res["support_synthetic"]
    assert syn["feature_leaders"].get("unsupported", 0) >= 25      # lineups of feature leaders are caught
    assert syn["random_any_seasons"].get("supported", 0) == 0      # nothing built from random seasons is called supported


# ------------------------------------------------------------------ honors data
def player_honors(pid, season):
    return [h["k"] for h in HONORS["players"].get(pid, {}).get(str(season), [])]


def test_nash_mvp_only_in_2005_and_2006():
    years = sorted(int(y) for y, hs in HONORS["players"]["nashst01"].items() if any(h["k"] == "mvp" for h in hs))
    assert years == [2005, 2006]
    assert "mvp" not in player_honors("nashst01", 2007)


def test_each_single_winner_award_has_one_winner_per_covered_season_and_none_outside():
    cov = HONORS["coverage"]
    for key in ("mvp", "dpoy", "roy", "smoy", "mip"):
        c = cov[key]
        winners = {}
        for pid, seasons in HONORS["players"].items():
            for y, hs in seasons.items():
                if any(h["k"] == key for h in hs):
                    winners.setdefault(int(y), []).append(pid)
        assert winners, key
        assert all(c["from"] <= y <= c["to"] and y >= c["introduced"] for y in winners), key
        assert all(len(v) >= 1 for v in winners.values())
        # ties are allowed (shared winners) but must be rare
        assert sum(1 for v in winners.values() if len(v) > 1) <= 3, key


def test_no_voting_only_fields_are_stored():
    kinds = {h["k"] for s in HONORS["players"].values() for hs in s.values() for h in hs}
    assert kinds <= {"mvp", "dpoy", "roy", "smoy", "mip", "allnba", "alldef", "allrookie", "allstar", "champion", "finalsmvp", "ring"}
    assert not any(k for k in kinds if "vot" in k or "share" in k or "rank" in k)
    assert sum(1 for s in HONORS["players"].values() for hs in s.values() for h in hs if h["k"] == "finalsmvp") == 30   # one per Finals


def test_team_levels_are_valid():
    for seasons in HONORS["players"].values():
        for hs in seasons.values():
            for h in hs:
                if h["k"] in ("allnba", "alldef", "allrookie"):
                    assert h["t"] in (1, 2, 3)
                    assert not (h["k"] == "allrookie" and h["t"] == 3)


def test_coverage_is_declared_for_every_award_and_unverified_ones_are_null():
    cov = HONORS["coverage"]
    for key in ("mvp", "dpoy", "roy", "smoy", "mip", "allnba", "alldef", "allrookie", "allstar"):
        assert key in cov and cov[key]["from"] <= cov[key]["to"]
    assert cov["finalsmvp"]["from"] == 1997 and cov["finalsmvp"]["to"] == 2026
    assert cov["champion"]["to"] == 2026 and "playoff game" in cov["champion"]["basis"]
    assert "not a full roster list" in cov["ring"]["basis"] and set(cov["ring"]["status"]) == {"P"}   # partial, never 'verified'
    assert cov["allstar"]["to"] == 2026 and cov["mvp"]["to"] == 2026
    cov_file = load(os.path.join(ROOT, "docs", "model", "honors_coverage.json"))
    assert cov_file


def test_awards_are_not_in_any_model_or_feature_file():
    for name in ("model.json",):
        text = open(os.path.join(SIM, name)).read().lower()
        assert "honors" not in text and '"mvp"' not in text
    f = load(os.path.join(SIM, "features", "2005.json"))
    assert set(f) >= {"ids", "mp", "ts"} and not any("mvp" in k or "award" in k for k in f)


def test_champion_membership_is_playoff_appearances_for_the_title_team_only():
    champs = {s: BR["brackets"][str(s)]["champion"] for s in range(1997, 2027)}
    per_season = {}
    for pid, seasons in HONORS["players"].items():
        for y, hs in seasons.items():
            for h in hs:
                if h["k"] == "champion":
                    assert h["tm"] == champs[int(y)]
                    per_season.setdefault(int(y), set()).add(pid)
    assert sorted(per_season) == list(range(1997, 2027))
    assert all(8 <= len(v) <= 17 for v in per_season.values())
    # Nash never won: his seasons on good teams do not make him a champion
    assert not any(h["k"] == "champion" for hs in HONORS["players"]["nashst01"].values() for h in hs)


def test_traded_player_gets_one_set_of_honors_per_season():
    seasons = HONORS["players"]["mutomdi01"]["2001"]
    kinds = [(h["k"], h.get("t")) for h in seasons]
    assert len(kinds) == len(set(kinds))
    assert ("dpoy", None) in kinds and ("allnba", 2) in kinds and ("alldef", 1) in kinds


def test_shared_award_is_marked_and_replacement_all_star_is_marked():
    roy = [(p, h) for p, ss in HONORS["players"].items() for h in ss.get("2000", []) if h["k"] == "roy"]
    assert len(roy) == 2 and all(h.get("s") for _, h in roy)
    assert any(h.get("r") for ss in HONORS["players"].values() for hs in ss.values() for h in hs if h["k"] == "allstar")


def test_2026_awards_are_present_and_verified_by_two_sources():
    cov = HONORS["coverage"]
    for k in ("mvp", "dpoy", "roy", "smoy", "mip", "allnba", "alldef", "allrookie", "finalsmvp"):
        assert cov[k]["to"] == 2026 and cov[k]["status"][-1] == "V", k
    kinds = {h["k"] for ss in HONORS["players"].values() for h in ss.get("2026", [])}
    assert {"mvp", "dpoy", "roy", "smoy", "mip", "allnba", "alldef", "allrookie", "finalsmvp"} <= kinds


# ------------------------------------------------------------------ honors import (the path for data no reachable source had)
def _known(pairs):
    return set(pairs)


def test_honors_import_accepts_valid_files_and_marks_only_complete_seasons_as_covered(tmp_path):
    from sim import honors_import as HI
    (tmp_path / "finals_mvp.csv").write_text("season,player_id,player\n2025,aaa01,A\n2026,bbb01,B\n")
    out = HI.load_extra(_known([("aaa01", 2025), ("bbb01", 2026)]), {2025: {"aaa01"}, 2026: {"bbb01"}}, tmp_path)
    assert out["finalsmvp"] == [("aaa01", 2025), ("bbb01", 2026)]
    assert out["coverage"]["finalsmvp"]["to"] == 2026 and out["messages"] == []


def test_honors_import_rejects_bad_input_instead_of_guessing(tmp_path):
    from sim import honors_import as HI
    known = _known([("aaa01", 2025), ("bbb01", 2026)])
    (tmp_path / "finals_mvp.csv").write_text("season,player\n2025,A\n")
    with pytest.raises(HI.ImportError_, match="missing column"):
        HI.load_extra(known, None, tmp_path)
    (tmp_path / "finals_mvp.csv").write_text("season,player_id\n2024,aaa01\n2026,bbb01\n")
    with pytest.raises(HI.ImportError_, match="contiguous"):
        HI.load_extra(known, None, tmp_path)
    (tmp_path / "finals_mvp.csv").write_text("season,player_id\n2025,aaa01\n2025,bbb01\n")
    with pytest.raises(HI.ImportError_, match="more than one"):
        HI.load_extra(known, None, tmp_path)
    (tmp_path / "finals_mvp.csv").write_text("season,player_id\n2025,nobody99\n")
    with pytest.raises(HI.ImportError_, match="no 2025 season"):
        HI.load_extra(known, None, tmp_path)
    (tmp_path / "finals_mvp.csv").unlink()
    (tmp_path / "awards_extra.csv").write_text("season,award,player_id\n2026,mvpp,aaa01\n")
    with pytest.raises(HI.ImportError_, match="unknown award"):
        HI.load_extra(known, None, tmp_path)
    (tmp_path / "awards_extra.csv").unlink()
    (tmp_path / "end_of_season_teams_extra.csv").write_text("season,type,number_tm,player_id\n2026,All-NBA,1st,aaa01\n")
    with pytest.raises(HI.ImportError_, match="incomplete season"):
        HI.load_extra(known, None, tmp_path)


def test_honors_import_warns_when_finals_mvp_is_not_on_the_champion(tmp_path):
    from sim import honors_import as HI
    (tmp_path / "finals_mvp.csv").write_text("season,player_id\n2025,aaa01\n")
    out = HI.load_extra(_known([("aaa01", 2025)]), {2025: {"zzz01"}}, tmp_path)
    assert out["messages"] and "did not appear for the champion" in out["messages"][0]


def test_honors_import_with_no_files_changes_nothing(tmp_path):
    from sim import honors_import as HI
    out = HI.load_extra(_known([]), None, tmp_path)
    assert out == {"finalsmvp": [], "awards": [], "eos": [], "coverage": {}, "messages": []}
