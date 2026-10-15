import glob
import json
import os
import shutil
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "analysis"))
import shot_import as si  # noqa: E402
import utils  # noqa: E402

ROOT = utils.repo_root()
PARQUET = os.path.join(ROOT, "raw", "shots", "shotdetail.parquet")
OLD_CSV = os.path.join(ROOT, "raw", "shots", "NBA_2009_Shots.csv")
needs_parquet = pytest.mark.skipif(not os.path.exists(PARQUET), reason="raw parquet not present (kept out of the deliverable)")
SHOTS = os.path.join(ROOT, "public", "data", "shots")


def _manifest():
    return json.load(open(os.path.join(SHOTS, "manifest.json")))


def _season_rows(season):
    d = json.load(open(os.path.join(ROOT, "public", "data", "seasons", f"{season}.json")))
    return d if isinstance(d, list) else d["players"]


def _file(season, pid):
    return json.load(open(os.path.join(SHOTS, str(season), f"{pid}.json")))


# ----------------------------------------------------------------------------- geometry, seasons, ids
def test_vectors_shared_with_vitest():
    v = json.load(open(os.path.join(ROOT, "tests", "shot_zone_vectors.json")))
    assert len(v["cases"]) >= 20
    xs = np.array([c["x"] for c in v["cases"]])
    ys = np.array([c["y"] for c in v["cases"]])
    th = np.array([c["three"] for c in v["cases"]])
    for c in v["cases"]:
        assert si.to_svg(c["x"], c["y"]) == (c["svg_x"], c["svg_y"])
        assert si.zone_of(c["x"], c["y"], c["three"]) == c["zone"]
        assert bool(si.is_drawn(c["x"], c["y"])) == c["drawn"]
    assert si.pack_shots(xs, ys, np.array(v["packed_made"]), th) == v["packed"]


def test_orientation_origin_and_zone_boundaries_are_exact():
    assert si.to_svg(0, 0) == (250.0, 52.5)                          # hoop origin -> basket centre
    assert si.to_svg(-231, 0)[0] == 19.0 and si.to_svg(231, 0)[0] == 481.0   # negative x = shooter's left = viewer's left
    assert si.zone_of(29, 0, False) == "x0_3" and si.zone_of(30, 0, False) == "x3_10"
    assert si.zone_of(99, 10, False) == "x3_10" and si.zone_of(100, 0, False) == "x10_16"
    assert si.zone_of(159, 15, False) == "x10_16" and si.zone_of(160, 0, False) == "x16_3p"
    assert si.zone_of(0, 0, True) == "x3p" and si.zone_of(0, 884, False) == "x16_3p"   # shot type decides 3PT; heaves stay 3PT


def test_drawn_rule_matches_the_svg_court():
    assert si.is_drawn(250, -52) and si.is_drawn(-250, 347)
    assert not si.is_drawn(251, 0) and not si.is_drawn(0, -53) and not si.is_drawn(0, 348)


def test_season_conversion_start_year_to_ending_year():
    assert si.app_season_of(2008) == 2009 and si.season_label(2009) == "2008-09"
    assert si.app_season_of(1996) == 1997 and si.season_label(1997) == "1996-97"
    assert si.app_season_of(2025) == 2026 and si.season_label(2026) == "2025-26"


def test_game_id_types_survive_missing_leading_zeros():
    assert si.game_id_info(29600005) == ("regular", 96)       # 0029600005
    assert si.game_id_info(22100001) == ("regular", 21)
    assert si.game_id_info(42500001) == ("playoffs", 25)
    assert si.game_id_info(49600001) == ("playoffs", 96)


def test_franchise_codes_follow_relocations():
    assert si.team_code(1610612760, 2008) == "SEA" and si.team_code(1610612760, 2009) == "OKC"
    assert si.team_code(1610612740, 2006) == "NOK" and si.team_code(1610612740, 2014) == "NOP"
    assert si.team_code(1610612751, 2012) == "NJN" and si.team_code(1610612751, 2013) == "BRK"
    assert si.team_code(1610612764, 1997) == "WSB" and si.team_code(1610612764, 1998) == "WAS"
    assert si.team_code(1610612766, 2002) == "CHH" and si.team_code(1610612766, 2010) == "CHA" and si.team_code(1610612766, 2020) == "CHO"
    assert si.team_code(1610612763, 2001) == "VAN" and si.team_code(1610612763, 2002) == "MEM"


def test_text_repair_and_name_normalisation_never_decide_identity_alone():
    assert si.repair_text("Luka Don\xc4\x8di\xc4\x87") == "Luka Dončić"
    assert si.repair_text("Nikola Jokic") == "Nikola Jokic" and si.repair_text("Dončić") == "Dončić"
    assert si.norm_name("Luka Dončić") == si.norm_name("Luka Doncic") == "lukadoncic"
    assert si.norm_name("Ronald Holland II") == "ronaldholland"


def test_packing_round_trips_and_refuses_to_clamp():
    x = np.array([-250, 0, 250, 13]); y = np.array([-52, 0, 884, 347]); made = np.array([1, 0, 1, 0]); three = np.array([0, 1, 1, 0])
    ux, uy, um, ut = si.unpack_shots(si.pack_shots(x, y, made, three))
    assert (ux == x).all() and (uy == y).all() and um.tolist() == [True, False, True, False] and ut.tolist() == [False, True, True, False]
    with pytest.raises(ValueError):
        si.pack_shots(np.array([2000]), np.array([0]), np.array([0]), np.array([0]))


# ----------------------------------------------------------------------------- validation on synthetic season slices
def _slice(n=3000, seed=1, season=2008):
    rng = np.random.default_rng(seed)
    x = rng.integers(-248, 249, n)
    y = rng.integers(-50, 340, n)
    d = np.hypot(x, y)
    three = (d >= 237.5) | (np.abs(x) > 220)
    area = np.where(x < -60, "Left Side(L)", np.where(x > 60, "Right Side(R)", "Center(C)"))
    zb = np.where(three, np.where((np.abs(x) > 220) & (x < 0), "Left Corner 3", np.where((np.abs(x) > 220) & (x > 0), "Right Corner 3", "Above the Break 3")), "Mid-Range")
    made = rng.integers(0, 2, n)
    df = pd.DataFrame({"GRID_TYPE": "Shot Chart Detail", "GAME_ID": 20800001 + (np.arange(n) // 40), "GAME_EVENT_ID": np.arange(n) + 1, "PLAYER_ID": 100 + (np.arange(n) % 25),
                       "PLAYER_NAME": "P", "TEAM_ID": 1610612737, "TEAM_NAME": "Atlanta Hawks", "PERIOD": 1, "MINUTES_REMAINING": 5, "SECONDS_REMAINING": 5,
                       "EVENT_TYPE": np.where(made == 1, "Made Shot", "Missed Shot"), "ACTION_TYPE": "Jump Shot", "SHOT_TYPE": np.where(three, si.THREE, "2PT Field Goal"),
                       "SHOT_ZONE_BASIC": zb, "SHOT_ZONE_AREA": area, "SHOT_ZONE_RANGE": "x", "SHOT_DISTANCE": np.floor(d / 10).astype(int), "LOC_X": x, "LOC_Y": y,
                       "SHOT_ATTEMPTED_FLAG": 1, "SHOT_MADE_FLAG": made, "GAME_DATE": 20081101, "HTM": "ATL", "VTM": "BOS", "_season": season, "_season_type": "rg"})
    for c in ("PLAYER_NAME", "TEAM_NAME", "SHOT_TYPE", "EVENT_TYPE", "SHOT_ZONE_BASIC", "SHOT_ZONE_AREA", "_season_type"):
        df[c] = df[c].astype("category")
    return df


def test_clean_synthetic_season_passes_every_check():
    rep, fails = si.validate_season(_slice(), 2008, True)
    assert fails == [] and rep["duplicate_event_keys"] == 0 and rep["out_of_bounds"] == 0 and rep["season_convention_ok"]


def test_validation_fails_on_each_class_of_invalid_data():
    base = _slice()
    def fails(df, season=2008):
        return si.validate_season(df, season, True)[1]
    dup = pd.concat([base, base.iloc[[5]]], ignore_index=True)
    assert any("duplicate" in m for m in fails(dup))
    flipped = base.copy(); flipped["LOC_X"] = -flipped["LOC_X"]
    assert any("orientation" in m for m in fails(flipped))
    oob = base.copy(); oob.loc[0, "LOC_X"] = 400
    assert any("outside" in m for m in fails(oob))
    badmade = base.copy(); badmade.loc[1, "SHOT_MADE_FLAG"] = 1 - badmade.loc[1, "SHOT_MADE_FLAG"]
    assert any("inconsistent" in m for m in fails(badmade))
    wrong_units = base.copy(); wrong_units["LOC_X"] = (wrong_units["LOC_X"] // 10); wrong_units["LOC_Y"] = (wrong_units["LOC_Y"] // 10)
    assert any("distance" in m or "orientation" in m for m in fails(wrong_units))
    assert any("start-year" in m for m in fails(base, season=2010))          # wrong season label vs game dates
    assert any("game ids" in m for m in fails(base.assign(GAME_ID=base.GAME_ID + 20000000)))
    nulls = base.copy(); nulls["LOC_Y"] = nulls["LOC_Y"].astype(float); nulls.loc[2, "LOC_Y"] = np.nan
    assert any("null" in m for m in fails(nulls))


def test_legitimate_repeated_attempts_are_not_deduplicated():
    sub = _slice(60, seed=3)
    sub = sub[sub.PLAYER_ID == 100].copy()
    twin = sub.iloc[[0]].copy(); twin["GAME_EVENT_ID"] = 99999       # same place, same second, different event id: a real second attempt
    both = pd.concat([sub, twin], ignore_index=True)
    assert not both.duplicated(["GAME_ID", "GAME_EVENT_ID", "PLAYER_ID"]).any() and both.duplicated(["GAME_ID", "LOC_X", "LOC_Y", "PERIOD", "MINUTES_REMAINING", "SECONDS_REMAINING"]).any()
    enc, _ = si.encode_player(both, "x01", 100, 2009, len(both), int(both.SHOT_MADE_FLAG.sum()))
    assert enc["attempts"] == len(both) and len(enc["s"]) == 5 * len(both)


# ----------------------------------------------------------------------------- encoding
def test_encode_statuses_exact_partial_differs_and_made_missed_decoding():
    sub = _slice(12, seed=7); sub = sub[sub.PLAYER_ID == 100].copy()
    n, mk = len(sub), int(sub.SHOT_MADE_FLAG.sum())
    e, _ = si.encode_player(sub, "x01", 100, 2009, n, mk)
    assert e["status"] == "exact" and e["coverage"] == 1.0 and e["attempts"] == n and e["makes"] == mk
    assert si.encode_player(sub, "x01", 100, 2009, n + 3, mk + 1)[0]["status"] == "partial"
    p = si.encode_player(sub, "x01", 100, 2009, n + 3, mk + 1)[0]
    assert p["coverage"] == round(n / (n + 3), 4) and p["trusted_fga"] == n + 3
    assert si.encode_player(sub, "x01", 100, 2009, n - 1, mk)[0]["status"] == "differs"      # more recorded than the season total
    assert si.encode_player(sub, "x01", 100, 2009, n, mk + 1)[0]["status"] == "partial" or si.encode_player(sub, "x01", 100, 2009, n, mk + 1)[0]["status"] == "differs"
    xs, ys, made, three = si.unpack_shots(e["s"])
    order = sub.sort_values(["GAME_ID", "GAME_EVENT_ID"])
    assert xs.tolist() == order.LOC_X.tolist() and ys.tolist() == order.LOC_Y.tolist() and made.astype(int).tolist() == order.SHOT_MADE_FLAG.tolist()
    assert three.tolist() == (order.SHOT_TYPE == si.THREE).tolist()


def test_heave_is_counted_in_the_three_zone_marked_undrawn_and_never_moved():
    sub = _slice(30, seed=9); sub = sub[sub.PLAYER_ID == 100].copy()
    sub.loc[sub.index[0], ["LOC_X", "LOC_Y", "SHOT_TYPE"]] = [15, 700, si.THREE]
    sub["SHOT_TYPE"] = sub["SHOT_TYPE"].astype(str)
    enc, zones = si.encode_player(sub, "x01", 100, 2009, len(sub), int(sub.SHOT_MADE_FLAG.sum()))
    xs, ys, _, _ = si.unpack_shots(enc["s"])
    assert enc["undrawn"] >= 1 and (15, 700) in set(zip(xs.tolist(), ys.tolist()))
    assert zones["x3d"][0] >= 1 and sum(z[0] for z in zones.values()) == len(sub)   # a 7-ft... 70-ft heave is a deep three


def test_missing_shot_type_falls_back_to_the_source_zone_name_and_is_counted():
    sub = _slice(30, seed=11); sub = sub[sub.PLAYER_ID == 100].copy()
    for c in ("SHOT_TYPE", "SHOT_ZONE_BASIC"):
        sub[c] = sub[c].astype(object)
    sub.loc[sub.index[0], ["SHOT_TYPE", "SHOT_ZONE_BASIC"]] = [np.nan, "Restricted Area"]
    assert not si.shot_three_flags(sub)[0]
    sub.loc[sub.index[0], ["SHOT_TYPE", "SHOT_ZONE_BASIC"]] = [np.nan, "Above the Break 3"]
    assert si.shot_three_flags(sub)[0]
    full = _slice(20000)
    full["SHOT_TYPE"] = full["SHOT_TYPE"].astype(object); full.loc[0, "SHOT_TYPE"] = np.nan; full["SHOT_TYPE"] = full["SHOT_TYPE"].astype("category")
    rep, fails = si.validate_season(full, 2008, True)
    assert rep["missing_shot_type_rows"] == 1 and not any("SHOT_TYPE" in m for m in fails)      # one row is disclosed, not fatal


# ----------------------------------------------------------------------------- publish: staged, deterministic, preserving, stale-safe
@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    monkeypatch.setattr(si, "REPO", str(tmp_path))
    monkeypatch.setattr(si, "SHOTS_DIR", str(tmp_path / "public" / "data" / "shots"))
    monkeypatch.setattr(si, "SUMMARY_PATH", str(tmp_path / "data" / "summary.json"))
    monkeypatch.setattr(si, "CROSSWALK_PATH", str(tmp_path / "crosswalk.csv"))
    monkeypatch.setattr(si, "TEAM_CODES_PATH", str(tmp_path / "team_codes.csv"))
    return tmp_path


def _fake(app, players, status="integrated"):
    files = si.stage_dir(app, "files")
    shutil.rmtree(si.stage_dir(app), ignore_errors=True); os.makedirs(files)
    sub = _slice(400, seed=app)
    summ = {}
    for i, pid in enumerate(players):
        ps = sub[sub.PLAYER_ID == 100 + i]
        enc, zones = si.encode_player(ps, pid, 100 + i, app, len(ps), int(ps.SHOT_MADE_FLAG.sum()))
        si.write_json(os.path.join(files, f"{pid}.json"), enc)
        summ[pid] = si.summary_record(enc, zones)
    return {"app_season": app, "label": si.season_label(app), "status": status, "failures": [] if status == "integrated" else ["forced failure"], "summary_players": summ,
            "baseline": {"zones": {}}, "input_sha256": "abc", "crosswalk_rows": [{"nba_id": 1, "season": app, "bbr_id": "a", "status": "verified"}],
            "league": {"file_fga": 10, "trusted_fga": 10, "coverage": 1.0}, "players": {"exported_files": len(players), "verified_players": len(players), "exact": len(players), "partial": 0},
            "validation": {"games": 1, "date_range": ["a", "b"], "beyond_drawn_court": {"shots": 0}, "three_label_vs_drawn_line": {"line_ft": 23.75}},
            "crosswalk": {"unresolved": []}}


SRC = {"uploaded_filename": "shotdetail.parquet", "sha256": "abc"}


def _snapshot(root):
    return {os.path.relpath(p, root): open(p, "rb").read() for p in glob.glob(os.path.join(root, "**", "*"), recursive=True) if os.path.isfile(p)}


def test_publish_is_deterministic_and_safe_to_rerun(sandbox):
    res = {2008: _fake(2008, ["aa01", "bb01"]), 2009: _fake(2009, ["aa01"])}
    si.publish(res, SRC, [], None)
    first = _snapshot(si.SHOTS_DIR)
    si.publish(res, SRC, [], None)
    assert _snapshot(si.SHOTS_DIR) == first
    assert not os.path.exists(si.SHOTS_DIR + ".new") and not os.path.exists(si.SHOTS_DIR + ".old")


def test_failed_replacement_retains_previous_valid_season_and_records_it(sandbox):
    si.publish({2008: _fake(2008, ["aa01", "bb01"]), 2009: _fake(2009, ["aa01"])}, SRC, [], None)
    before = _snapshot(os.path.join(si.SHOTS_DIR, "2009"))
    man, retained = si.publish({2008: _fake(2008, ["aa01", "bb01"]), 2009: _fake(2009, ["aa01"], status="quarantined")}, SRC, [], None)
    assert retained == [2009] and man["seasons"]["2009"]["retained"] is True
    assert man["seasons"]["2009"]["replacement_failed"] == ["forced failure"] and "shotdetail.parquet" in man["seasons"]["2009"]["retained_source"]
    assert _snapshot(os.path.join(si.SHOTS_DIR, "2009")) == before                                    # previous files untouched
    assert "2009" in json.load(open(si.SUMMARY_PATH))["seasons"]                                      # and so is its summary


def test_stale_files_are_removed_only_after_a_successful_replacement(sandbox):
    si.publish({2008: _fake(2008, ["aa01", "bb01"])}, SRC, [], None)
    assert os.path.exists(os.path.join(si.SHOTS_DIR, "2008", "bb01.json"))
    bad = _fake(2008, ["aa01"])
    open(os.path.join(si.stage_dir(2008, "files"), "aa01.json"), "w").write("{broken")
    with pytest.raises(Exception):
        si.publish({2008: bad}, SRC, [], None)
    assert os.path.exists(os.path.join(si.SHOTS_DIR, "2008", "bb01.json"))                             # production untouched by the failed run
    si.publish({2008: _fake(2008, ["aa01"])}, SRC, [], None)
    assert not os.path.exists(os.path.join(si.SHOTS_DIR, "2008", "bb01.json"))                         # stale file gone after success


def test_a_season_that_fails_with_no_previous_export_is_not_published(sandbox):
    man, retained = si.publish({2008: _fake(2008, ["aa01"], status="quarantined")}, SRC, [], None)
    assert retained == [] and man["seasons"]["2008"]["status"] == "quarantined" and not os.path.isdir(os.path.join(si.SHOTS_DIR, "2008"))


def test_seasons_outside_the_run_are_kept(sandbox):
    si.publish({2008: _fake(2008, ["aa01"]), 2009: _fake(2009, ["aa01"])}, SRC, [], None)
    before = _snapshot(os.path.join(si.SHOTS_DIR, "2008"))
    si.publish({2009: _fake(2009, ["aa01"])}, SRC, [], None)
    assert _snapshot(os.path.join(si.SHOTS_DIR, "2008")) == before and "2008" in _manifest_at(si.SHOTS_DIR)["seasons"]


def _manifest_at(root):
    return json.load(open(os.path.join(root, "manifest.json")))


# ----------------------------------------------------------------------------- shipped data: manifest, crosswalk, reconciliation
def test_every_in_range_season_is_integrated_and_reconciles():
    m = _manifest()
    assert sorted(int(s) for s, e in m["seasons"].items() if e["status"] == "integrated") == list(range(1997, 2027))
    for s, e in m["seasons"].items():
        assert abs(e["coverage"] - e["shots"] / e["trusted_fga"]) < 1e-4 and 0.995 < e["coverage"] < 1.005
        assert len(os.listdir(os.path.join(SHOTS, s))) == e["files"]
    assert m["source"]["sha256"] and m["source"]["uploaded_filename"] == "shotdetail.parquet" and m["source"]["processed_on"]
    assert m["source"]["url"].endswith("/merged/shotdetail.parquet")


def test_every_shipped_file_matches_its_summary_and_trusted_totals():
    n = 0
    for s in range(1997, 2027):
        rows = {r["player_id"]: r for r in _season_rows(s)}
        for p in glob.glob(os.path.join(SHOTS, str(s), "*.json")):
            f = json.load(open(p)); pid = f["player_id"]
            loc = rows[pid]["shot_dna"]["locations"]
            xs, ys, made, three = si.unpack_shots(f["s"])
            assert f["v"] == 2 and f["season"] == s and f["season_type"] == "regular" and len(xs) == f["attempts"] == loc["attempts"] and int(made.sum()) == f["makes"] == loc["makes"]
            zi = si.zone_index(xs, ys, three)
            assert {z: [int((zi == i).sum()), int(made[zi == i].sum())] for i, z in enumerate(si.ZONES)} == loc["zones"]
            assert loc["trusted_fga"] == rows[pid]["shot_dna"]["fga"]
            assert (loc["status"] == "exact") == (f["attempts"] == f["trusted_fga"] and f["makes"] == f["trusted_fgm"])
            n += 1
    assert n == sum(e["files"] for e in _manifest()["seasons"].values())


def test_crosswalk_is_verified_one_to_one_per_season_and_never_name_only():
    cw = pd.read_csv(os.path.join(ROOT, "analysis", "crosswalk", "nba_to_bbr.csv"), dtype=str, keep_default_na=False)
    assert set(cw.status) <= {"verified", "verified_stats_only_name_differs", "ambiguous"}
    ok = cw[cw.bbr_id != ""]
    assert not ok.duplicated(["season", "nba_id"]).any() and not ok.duplicated(["season", "bbr_id"]).any()
    assert not cw.method.str.contains("name_only").any() and (ok.fga_bbr != "").all()
    per_person = ok.groupby("nba_id").bbr_id.nunique()
    assert (per_person == 1).all() and (ok.groupby("bbr_id").nba_id.nunique() == 1).all()          # stable identity across 30 seasons
    amb = cw[cw.status == "ambiguous"]
    assert amb.nba_name.tolist() == ["Vincent Edwards"] and amb.season.tolist() == ["2019"]        # reported, never guessed
    assert (cw.status == "verified_stats_only_name_differs").sum() > 0 and cw.season.nunique() == 30


def test_traded_players_use_the_aggregate_row_once_and_team_stints_by_franchise_code():
    for s, pid, teams, fga in ((2009, "iversal01", "DEN|DET", 834),):
        rows = [r for r in _season_rows(s) if r["player_id"] == pid]
        assert len(rows) == 1
        loc = rows[0]["shot_dna"]["locations"]
        assert loc["attempts"] == loc["trusted_fga"] == rows[0]["shot_dna"]["fga"] == fga
        cw = pd.read_csv(os.path.join(ROOT, "analysis", "crosswalk", "nba_to_bbr.csv"), dtype=str, keep_default_na=False)
        assert cw[(cw.bbr_id == pid) & (cw.season == str(s))].teams_file.iloc[0] == teams
    cw = pd.read_csv(os.path.join(ROOT, "analysis", "crosswalk", "nba_to_bbr.csv"), dtype=str, keep_default_na=False)
    franchise = cw[(cw.season == "2007") & (cw.teams_file.str.contains("NOK"))]            # New Orleans/Oklahoma City Hornets code
    assert len(franchise) > 0
    nets = cw[(cw.season == "2013") & cw.teams_file.str.contains("BRK")]
    assert len(nets) > 0


def test_all_playoff_shots_are_inventoried_but_not_exported():
    m = _manifest()
    assert len(m["playoffs"]) == 30 and all(p["season_type"] == "playoffs" for p in m["playoffs"])
    assert all(f["season_type"] == "regular" for f in map(lambda p: json.load(open(p)), glob.glob(os.path.join(SHOTS, "2026", "*.json"))[:20]))


def test_summary_and_baselines_cover_every_integrated_season():
    summ = json.load(open(utils.data_path("shot_location_summary.json")))["seasons"] if os.path.exists(utils.data_path("shot_location_summary.json")) else None
    base = json.load(open(os.path.join(ROOT, "public", "data", "shot_baselines.json")))["seasons"]
    for s in range(1997, 2027):
        b = base[str(s)]["shots"]
        assert b["exact_counts"] and b["season_type"] == "regular" and abs(sum(z["share"] for z in b["zones"].values()) - 1) < 0.001
        assert b["attempts"] == _manifest()["seasons"][str(s)]["shots"]
        if summ:
            assert summ[str(s)]["baseline"] == b


# ----------------------------------------------------------------------------- regression against raw inputs (skipped when the raw files are not present)
@needs_parquet
def test_parquet_inventory_is_what_the_documentation_claims():
    df = si.load_parquet(PARQUET)
    inv = [i for i in si.inventory(df) if i["season_type"] == "regular"]
    assert [i["app_season"] for i in inv] == list(range(1997, 2027))
    assert inv[-1]["games"] == 1230 and inv[-1]["date_max"] == "2026-04-12" and inv[0]["date_min"] == "1996-11-01"
    assert not df.duplicated(["GAME_ID", "GAME_EVENT_ID", "PLAYER_ID"]).any()


@needs_parquet
@pytest.mark.skipif(not os.path.exists(OLD_CSV), reason="earlier CSV not present")
def test_kobe_2008_09_parquet_equals_the_earlier_csv_after_the_verified_transform():
    df = si.load_parquet(PARQUET)
    k = df[(df.PLAYER_ID == 977) & (df._season == 2008) & (df._season_type == "rg")].sort_values(["GAME_ID", "GAME_EVENT_ID"])
    old = pd.read_csv(OLD_CSV, dtype={"GAME_ID": str}); old = old[old.PLAYER_ID == 977]
    ox = np.sort(np.round(-old.LOC_X.values * 10).astype(int)); oy = np.sort(np.round(old.LOC_Y.values * 10 - 52.5).astype(int))
    assert len(k) == len(old) == 1712 and (np.sort(k.LOC_X.values) == ox).all() and (np.sort(k.LOC_Y.values) == oy).all()
    f = _file(2009, "bryanko01")
    assert f["attempts"] == f["trusted_fga"] == 1712 and f["makes"] == f["trusted_fgm"] == 800


# ----------------------------------------------------------------------------- deep threes (30+ ft)
def test_deep_three_boundary_is_exact_integer_arithmetic():
    z = si.zone_of
    assert z(0, 299, True) == "x3p" and z(0, 300, True) == "x3d" and z(0, 301, True) == "x3d"
    assert z(180, 240, True) == "x3d" and z(-180, 240, True) == "x3d" and z(179, 240, True) == "x3p" and z(181, 240, True) == "x3d"
    assert z(0, 884, True) == "x3d"                                   # end-of-period heave
    assert z(0, 300, False) == "x16_3p" and z(0, 310, False) == "x16_3p" and z(0, 884, False) == "x16_3p"   # a two is never deep
    assert si.ZONES[-2:] == ["x3p", "x3d"]


def test_deep_threes_partition_the_three_point_total_in_encoding_and_baselines():
    sub = _slice(60, seed=21)
    sub = sub.copy(); sub["SHOT_TYPE"] = sub["SHOT_TYPE"].astype(object)
    sub.loc[sub.index[:10], ["LOC_X", "LOC_Y", "SHOT_TYPE"]] = [[0, 300 + i, si.THREE] for i in range(10)]
    sub.loc[sub.index[10:20], ["LOC_X", "LOC_Y", "SHOT_TYPE"]] = [[0, 290 + i - 10, si.THREE] for i in range(10)]
    three = si.shot_three_flags(sub)
    xy2 = sub.LOC_X.to_numpy(np.int64) ** 2 + sub.LOC_Y.to_numpy(np.int64) ** 2
    base = si.season_baseline(sub, len(sub))
    z = base["zones"]
    assert z["x3p"]["attempts"] + z["x3d"]["attempts"] == int(three.sum())
    assert z["x3d"]["attempts"] == int((three & (xy2 >= 90000)).sum()) >= 10
    assert sum(v["attempts"] for v in z.values()) == len(sub) and sum(v["makes"] for v in z.values()) == int(sub.SHOT_MADE_FLAG.sum())
    for pid, ps in sub.groupby("PLAYER_ID"):
        enc, zones = si.encode_player(ps, "x01", int(pid), 2009, len(ps), int(ps.SHOT_MADE_FLAG.sum()))
        t = si.shot_three_flags(ps)
        assert zones["x3p"][0] + zones["x3d"][0] == int(t.sum())
        assert zones["x3p"][1] + zones["x3d"][1] == int(ps.SHOT_MADE_FLAG.to_numpy(np.int64)[t].sum())


def test_shipped_deep_threes_reconcile_with_the_per_shot_files_for_every_player_season():
    """Independent derivation: recompute every summary's three-point split from the shipped packed shot files."""
    summ = json.load(open(si.SUMMARY_PATH))
    assert summ["zones"] == si.ZONES and summ["deep_three_ft"] == 30
    n = deep = 0
    for season, entry in summ["seasons"].items():
        for pid, rec in entry["players"].items():
            f = _file(season, pid)
            x, y, made, three = si.unpack_shots(f["s"])
            xy2 = x.astype(np.int64) ** 2 + y.astype(np.int64) ** 2
            want_deep = three & (xy2 >= 90000)
            z = rec["zones"]
            assert z["x3d"] == [int(want_deep.sum()), int(made[want_deep].sum())], (season, pid)
            assert z["x3p"] == [int((three & ~want_deep).sum()), int(made[three & ~want_deep].sum())], (season, pid)
            assert z["x3p"][0] + z["x3d"][0] == int(three.sum())
            assert sum(v[0] for v in z.values()) == rec["attempts"] == f["attempts"] and sum(v[1] for v in z.values()) == rec["makes"]
            n += 1; deep += z["x3d"][0]
    assert n == 11635 and deep > 30000


def test_season_baselines_include_deep_threes_and_sum():
    summ = json.load(open(si.SUMMARY_PATH))
    for season, entry in summ["seasons"].items():
        b = entry["baseline"]; z = b["zones"]
        assert set(z) == set(si.ZONES) and z["x3d"]["attempts"] > 0
        assert sum(v["attempts"] for v in z.values()) == b["attempts"] and sum(v["makes"] for v in z.values()) == b["makes"]
