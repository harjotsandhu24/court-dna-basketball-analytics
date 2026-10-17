"""
Honors, champions and seeds: staged validation (software tests).

These check that the validator catches bad data and that exports are safe. Whether the facts themselves are right is reported in
docs/model/honors_validation_report.md; model accuracy is in docs/model/validation_report.md.

Run: cd analysis && python3 -m pytest ../tests/test_honors_stage.py -v
"""
import hashlib
import json
import os
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

HERE = os.path.dirname(__file__)
ROOT = Path(os.path.abspath(os.path.join(HERE, "..")))
sys.path.insert(0, str(ROOT / "analysis"))
from sim import honors_stage as HS  # noqa: E402
from sim import export_data as ED  # noqa: E402
from sim import engine_py as E  # noqa: E402

PUB = ROOT / "public" / "data"
BR = json.loads((PUB / "sim" / "brackets.json").read_text())
HONORS = json.loads((PUB / "honors.json").read_text())
BRACKETS = {int(k): v for k, v in BR["brackets"].items()}
CHAMPS = {s: b["champion"] for s, b in BRACKETS.items()}
SRC = HS.SRC_DIR
needs_raw = pytest.mark.skipif(not (ROOT / "raw" / "Player Per Game.csv").exists(), reason="raw source tables are not in this checkout")


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def tables():
    t, errs = HS.read_csv_dir(SRC, list(HS.REQUIRED), HS.REQUIRED)
    assert not errs
    return t


@pytest.fixture(scope="module")
def real():
    if not (ROOT / "raw" / "Player Per Game.csv").exists():
        pytest.skip("raw source tables are not in this checkout")
    legacy, _ = ED.legacy_facts()
    ctx = HS.Ctx(ED.id_universe(), BRACKETS, CHAMPS, None, set(), legacy)
    return ctx, HS.validate(ctx, tables()), legacy


# --------------------------------------------------------------- a tiny synthetic world for the failure cases
def small_ctx():
    rows = [("mvpaa01", "Ann Mvp", 2026), ("mvpbb01", "Bob Mvp", 2026), ("dup01", "Same Name", 2026), ("dup02", "Same Name", 2026), ("plain01", "Plain Joe", 2026)]
    rows += [(f"p{i:02d}", f"Player {chr(65 + i)}", 2026) for i in range(20)]
    uni = pd.DataFrame(rows, columns=["player_id", "player", "season"])
    return HS.Ctx(uni, BRACKETS, CHAMPS, None, {("mvpaa01", 2026)}, [])


def aw(rows):
    return pd.DataFrame(rows, columns=["source", "season", "award", "tier", "player", "player_id"]).astype(str)


def team_rows(src, award, tier, ids):
    return [(src, "2026", award, str(tier), f"Player {chr(65 + int(i[1:]))}", i) for i in ids]


# =================================================================== real data
@needs_raw
def test_real_sources_pass_every_check(real):
    _, res, _ = real
    assert res["errors"] == []
    assert res["quarantine"] == []


@needs_raw
def test_finals_mvp_one_per_completed_finals_verified_and_on_the_champion(real):
    _, res, _ = real
    fm = [f for f in res["facts"] if f["k"] == "finalsmvp"]
    assert sorted(f["season"] for f in fm) == list(range(1997, 2027))
    assert all(f["status"] == "verified" and len(f["sources"]) >= 2 for f in fm)
    ring = {f["season"]: f for f in res["facts"] if f["k"] == "ring"}
    for f in fm:
        assert ring[f["season"]]["pid"] == f["pid"] and ring[f["season"]]["tm"] == CHAMPS[f["season"]]
    assert {f["season"]: f["pid"] for f in fm}[2026] == "brunsja01"


@needs_raw
def test_2025_26_awards_are_verified_by_two_sources_with_full_teams(real):
    _, res, _ = real
    f26 = [f for f in res["facts"] if f["season"] == 2026]

    def one(k):
        return [f["pid"] for f in f26 if f["k"] == k]
    assert one("mvp") == ["gilgesh01"] and one("dpoy") == ["wembavi01"] and one("roy") == ["flaggco01"]
    assert one("smoy") == ["johnske04"] and one("mip") == ["alexani01"]
    for k, n in (("allnba", 15), ("alldef", 10), ("allrookie", 10)):
        assert len(one(k)) == n, k
    for k in ("mvp", "dpoy", "roy", "smoy", "mip", "allnba", "alldef", "allrookie"):
        assert all(f["status"] == "verified" for f in f26 if f["k"] == k), k
    tiers = {f["pid"]: f["tier"] for f in f26 if f["k"] == "allnba"}
    assert tiers["gilgesh01"] == 1 and tiers["brunsja01"] == 2 and tiers["murraja01"] == 3


@needs_raw
def test_nash_has_mvp_in_2005_and_2006_only_and_a_non_mvp_season_has_none(real):
    _, res, _ = real
    mvp = {f["season"] for f in res["facts"] if f["pid"] == "nashst01" and f["k"] == "mvp"}
    assert mvp == {2005, 2006}
    assert not [f for f in res["facts"] if f["pid"] == "nashst01" and f["season"] == 2007 and f["k"] == "mvp"]


@needs_raw
def test_voting_placements_never_become_winner_badges(real):
    _, res, _ = real
    a = pd.read_csv(ROOT / "raw" / "Player Award Shares.csv")
    for raw_key, key in ED.AWARD_KEYS.items():
        winners = a[(a.award == raw_key) & a.winner & a.season.between(1997, 2025)]
        got = [f for f in res["facts"] if f["k"] == key and f["season"] <= 2025]
        assert len(got) == len(winners), key
        shares = a[(a.award == raw_key) & ~a.winner & a.season.between(1997, 2025)]
        gotset = {(f["pid"], f["season"]) for f in got}
        assert not [r for r in shares.itertuples() if (r.player_id, r.season) in gotset]


@needs_raw
def test_team_awards_keep_their_level_and_every_fact_sits_on_its_own_season(real):
    ctx, res, _ = real
    for k in ("allnba", "alldef", "allrookie"):
        fs = [f for f in res["facts"] if f["k"] == k]
        assert fs and all(f["tier"] in (1, 2, 3) for f in fs)
        assert {f["tier"] for f in fs} == ({1, 2, 3} if k == "allnba" else {1, 2})
    assert all((f["pid"], f["season"]) in ctx.pairs for f in res["facts"])


@needs_raw
def test_shared_winners_are_supported(real):
    _, res, _ = real
    shared = [i for m in HONORS["players"].values() for its in m.values() for i in its if i.get("s")]
    assert shared, "at least one historical shared award should exist"
    hits = [f["season"] for f in res["facts"] if f["k"] == "roy"]
    assert max(Counter(hits).values()) == 2


def test_two_winners_in_one_season_are_valid_and_both_exported():
    ctx = small_ctx()
    rows = [("a", "2026", "mvp", "", "Ann Mvp", "mvpaa01"), ("a", "2026", "mvp", "", "Bob Mvp", "mvpbb01"),
            ("b", "2026", "mvp", "", "Ann Mvp", "mvpaa01"), ("b", "2026", "mvp", "", "Bob Mvp", "mvpbb01")]
    res = HS.validate(ctx, {"awards_2026.csv": aw(rows)})
    assert res["errors"] == []
    assert sorted(f["pid"] for f in res["facts"] if f["k"] == "mvp") == ["mvpaa01", "mvpbb01"]


def test_recipient_without_an_app_profile_is_accepted_and_listed():
    ctx = small_ctx()
    rows = [("a", "2026", "smoy", "", "Bob Mvp", "mvpbb01"), ("b", "2026", "smoy", "", "Bob Mvp", "mvpbb01")]
    res = HS.validate(ctx, {"awards_2026.csv": aw(rows)})
    assert res["errors"] == []
    assert [f["pid"] for f in res["facts"]] == ["mvpbb01"]
    assert ("mvpbb01", 2026, "smoy") in res["profile_less"]          # mvpbb01 has no app profile in this world


@needs_raw
def test_recipients_without_an_app_profile_stay_in_the_honors_data():
    idx = json.loads((PUB / "players_index.json").read_text())
    without = [(pid, s) for pid, m in HONORS["players"].items() for s in m if pid not in idx or int(s) not in idx[pid]["seasons"]]
    assert without, "some honored player-seasons have no app profile; they stay in the honors data"


# =================================================================== conflicts, duplicates, invalid input
def test_conflicting_award_winners_stop_the_import():
    ctx = small_ctx()
    rows = [("a", "2026", "mvp", "", "Ann Mvp", "mvpaa01"), ("b", "2026", "mvp", "", "Bob Mvp", "mvpbb01")]
    res = HS.validate(ctx, {"awards_2026.csv": aw(rows)})
    assert [e["kind"] for e in res["errors"]] == ["winner_conflict"]
    assert not [f for f in res["facts"] if f["k"] == "mvp"]          # no source is silently preferred
    assert res["status"]["mvp"][2026] == "conflict"


def test_conflicting_finals_mvp_stops_the_import():
    ctx = small_ctx()
    fm = pd.DataFrame([("nba", "2026", "Player A", "p00", "New York Knicks"), ("bbr", "2026", "Player B", "p01", "New York Knicks")],
                      columns=["source", "season", "player", "player_id", "team"])
    res = HS.validate(ctx, {"finals_mvp.csv": fm})
    assert "finals_mvp_conflict" in [e["kind"] for e in res["errors"]]
    assert res["status"]["finalsmvp"][2026] == "conflict"


def test_finals_mvp_must_belong_to_the_champion():
    ctx = small_ctx()
    fm = pd.DataFrame([("nba", "2026", "Player A", "p00", "Boston Celtics"), ("bbr", "2026", "Player A", "p00", "Boston Celtics")],
                      columns=["source", "season", "player", "player_id", "team"])
    res = HS.validate(ctx, {"finals_mvp.csv": fm})
    kinds = [e["kind"] for e in res["errors"]]
    assert "champion_conflict" in kinds or "finals_mvp_team" in kinds        # his team can't differ from the verified champion


def test_two_finals_mvp_rows_for_one_season_are_an_error():
    ctx = small_ctx()
    fm = pd.DataFrame([("nba", "2026", "Player A", "p00", "New York Knicks"), ("nba", "2026", "Player B", "p01", "New York Knicks")],
                      columns=["source", "season", "player", "player_id", "team"])
    res = HS.validate(ctx, {"finals_mvp.csv": fm})
    assert "finals_mvp_count" in [e["kind"] for e in res["errors"]]


def test_conflicting_champions_stop_the_import():
    ctx = small_ctx()
    ch = pd.DataFrame([("nba", "2026", "New York Knicks", "4-1"), ("wiki", "2026", "Boston Celtics", "4-1")], columns=["source", "season", "champion", "finals"])
    res = HS.validate(ctx, {"champions.csv": ch})
    assert "champion_conflict" in [e["kind"] for e in res["errors"]]
    assert res["status"]["champion_team"][2026] == "conflict"


def test_a_champion_only_the_game_results_know_is_derived_not_verified():
    ctx = small_ctx()
    assert HS.validate(ctx, {})["status"]["champion_team"][2026] == "derived"
    ch = pd.DataFrame([("nba", "2026", "New York Knicks", "4-1")], columns=["source", "season", "champion", "finals"])
    assert HS.validate(ctx, {"champions.csv": ch})["status"]["champion_team"][2026] == "verified"


def test_same_player_on_two_teams_of_one_award_is_a_duplicate_identity():
    ctx = small_ctx()
    rows = team_rows("a", "allnba", 1, ["p00", "p01", "p02", "p03", "p04"]) + team_rows("a", "allnba", 2, ["p04", "p05", "p06", "p07", "p08"]) \
        + team_rows("a", "allnba", 3, ["p09", "p10", "p11", "p12", "p13"])
    res = HS.validate(ctx, {"awards_2026.csv": aw(rows)})
    assert "duplicate_identity" in [e["kind"] for e in res["errors"]]


def test_incomplete_team_is_rejected_not_exported_as_partial():
    ctx = small_ctx()
    rows = team_rows("a", "alldef", 1, ["p00", "p01", "p02", "p03"])
    res = HS.validate(ctx, {"awards_2026.csv": aw(rows)})
    assert "incomplete_team" in [e["kind"] for e in res["errors"]]
    assert not [f for f in res["facts"] if f["k"] == "alldef"]


@pytest.mark.parametrize("bad", ["1990", "2027", "abc", "2005.5"])
def test_invalid_seasons_are_errors(bad):
    ctx = small_ctx()
    rows = [("a", bad, "mvp", "", "Ann Mvp", "mvpaa01")]
    res = HS.validate(ctx, {"awards_2026.csv": aw(rows)})
    assert "invalid_season" in [e["kind"] for e in res["errors"]]


def test_unresolved_players_are_quarantined_with_a_reason_not_exported():
    ctx = small_ctx()
    rows = [("a", "2026", "mvp", "", "Nobody Atall", ""), ("a", "2026", "dpoy", "", "Same Name", ""), ("a", "2026", "roy", "", "Ann Mvp", "plain01"),
            ("a", "2026", "smoy", "", "Plain Joe", "")]
    res = HS.validate(ctx, {"awards_2026.csv": aw(rows)})
    reasons = " | ".join(q["detail"] for q in res["quarantine"])
    assert "no player named Nobody Atall" in reasons                       # unknown name
    assert "matches more than one player" in reasons                       # ambiguous name
    assert "is Plain Joe, not Ann Mvp" in reasons                          # id and name disagree
    assert [f["pid"] for f in res["facts"]] == ["plain01"]                 # only the unambiguous record is exported
    assert res["errors"] == []


def test_a_fact_with_one_source_is_single_source_never_verified():
    ctx = small_ctx()
    res = HS.validate(ctx, {"awards_2026.csv": aw([("only", "2026", "mvp", "", "Ann Mvp", "mvpaa01")])})
    assert res["facts"][0]["status"] == "single-source" and res["status"]["mvp"][2026] == "single-source"


def test_missing_stays_distinct_from_no_award():
    res = HS.validate(small_ctx(), {})
    assert res["status"]["finalsmvp"][2020] == "missing"
    assert res["facts"] == []                                              # nothing is invented to fill a gap


def test_every_fact_has_sources_and_a_status():
    ctx = small_ctx()
    rows = [("a", "2026", "mvp", "", "Ann Mvp", "mvpaa01"), ("b", "2026", "mvp", "", "Ann Mvp", "mvpaa01")]
    f = HS.validate(ctx, {"awards_2026.csv": aw(rows)})["facts"][0]
    assert f["sources"] == ["a", "b"] and f["status"] == "verified"


@needs_raw
def test_every_real_fact_has_a_source_and_a_known_status(real):
    _, res, _ = real
    assert all(f["sources"] and f["status"] in ("verified", "single-source") for f in res["facts"])


# =================================================================== seeds
@needs_raw
def test_published_seeds_pass_for_all_30_postseasons(real):
    _, res, _ = real
    assert sorted(res["seeds"]) == list(range(1997, 2027))
    assert all(r["status"] in ("verified", "single-source") for r in res["seed_report"])


def _seed_rows(season, mutate=None):
    df = tables()["seeds.csv"].copy()
    df = df[df.season.astype(int) == season].reset_index(drop=True)
    if mutate:
        mutate(df)
    return df


@needs_raw
def test_seeds_that_break_bracket_progression_are_rejected(real):
    ctx = real[0]

    def swap(df):  # put the 1 seed where the 4 seed is: first-round pairs no longer sum to 9
        a = df.index[(df.conference == "E") & (df.seed == "1")][0]
        b = df.index[(df.conference == "E") & (df.seed == "4")][0]
        df.loc[a, "seed"], df.loc[b, "seed"] = "4", "1"
    res = HS.validate(ctx, {"seeds.csv": _seed_rows(2005, swap)})
    assert "seed_conflict" in [e["kind"] for e in res["errors"]]
    assert 2005 not in res["seeds"]


@needs_raw
def test_seed_tables_with_a_wrong_conference_or_duplicate_team_are_rejected(real):
    ctx = real[0]

    def wrong_conf(df):
        df.loc[0, "conference"] = "W"

    def duplicate(df):
        df.loc[1, "team"] = df.loc[0, "team"]
    for mut in (wrong_conf, duplicate):
        res = HS.validate(ctx, {"seeds.csv": _seed_rows(2005, mut)})
        assert "seed_conflict" in [e["kind"] for e in res["errors"]], mut.__name__


@needs_raw
def test_a_season_without_a_seed_table_stays_missing_so_the_app_keeps_the_reconstruction():
    ctx = HS.Ctx(ED.id_universe(), BRACKETS, CHAMPS, None, set(), [])
    res = HS.validate(ctx, {"seeds.csv": _seed_rows(2005)})
    assert res["status"]["seeds"][2004] == "missing" and 2004 not in res["seeds"]


def test_published_seeds_are_not_home_court():
    # 2007: Utah was the 4 seed and Houston the 5 seed, but Houston (better record) hosted
    b = BRACKETS[2007]
    assert b["seedSource"] == "published" and b["teams"]["UTA"]["seed"] == 4 and b["teams"]["HOU"]["seed"] == 5
    s = next(x for x in b["series"] if x["round"] == 1 and {x["hc"], x["other"]} == {"HOU", "UTA"})
    assert s["hc"] == "HOU"
    assert b["teams"]["UTA"]["pos"] == 5 and b["teams"]["HOU"]["pos"] == 4      # the reconstruction is kept separately


def test_every_season_keeps_both_published_seed_and_reconstructed_position():
    for s, b in BRACKETS.items():
        assert b["seedSource"] == "published", s
        assert all("pos" in t and 1 <= t["seed"] <= 8 for t in b["teams"].values())


def test_apply_seeds_falls_back_to_reconstructed_when_no_verified_seeds_exist():
    br = {"brackets": {"2005": {"teams": {"A": {"seed": 3, "pos": 3}}}, "2004": {"teams": {"A": {"seed": 3, "pos": 3}}}}}
    out = ED.apply_seeds(br, {2005: {"A": 1}})
    assert out["brackets"]["2005"]["seedSource"] == "published" and out["brackets"]["2005"]["teams"]["A"]["seed"] == 1
    assert out["brackets"]["2004"]["seedSource"] == "reconstructed" and out["brackets"]["2004"]["teams"]["A"]["seed"] == 3


# =================================================================== championship facts stay separate
def test_team_won_appeared_and_roster_are_three_different_facts():
    ctx = small_ctx()
    ctx.champ_players = {2026: {"p00", "p01"}}                              # appeared in a playoff game
    ring = pd.DataFrame([("imp", "2026", "Player A", "p00", "")], columns=["source", "season", "player", "player_id", "team"])
    res = HS.validate(ctx, {"champion_roster.csv": ring})
    assert res["status"]["champion_team"][2026] == "derived"                # the team won
    assert res["status"]["champion_appeared"][2026] == "derived"            # some players appeared
    rings = [f for f in res["facts"] if f["k"] == "ring"]
    assert [f["pid"] for f in rings] == ["p00"] and rings[0]["status"] == "single-source"
    assert res["status"]["champion_roster"][2026] == "partial"              # p01 appeared but is not claimed as a roster member


def test_appearing_in_the_playoffs_never_creates_a_roster_fact():
    ctx = small_ctx()
    ctx.champ_players = {2026: {"p00", "p01", "p02"}}
    res = HS.validate(ctx, {})
    assert [f for f in res["facts"] if f["k"] == "ring"] == []
    assert res["status"]["champion_roster"][2026] == "missing"


def test_roster_import_for_an_unestablished_champion_is_quarantined():
    ctx = small_ctx()
    ctx.champions = {}                                                      # no champion known
    ring = pd.DataFrame([("imp", "2026", "Player A", "p00", "")], columns=["source", "season", "player", "player_id", "team"])
    res = HS.validate(ctx, {"champion_roster.csv": ring})
    assert [q["kind"] for q in res["quarantine"]] == ["no_champion"]


# =================================================================== optional imports
def test_import_file_with_missing_columns_is_reported_not_guessed(tmp_path):
    (tmp_path / "finals_mvp.csv").write_text("season,player\n2026,Player A\n")
    out, errs = HS.load_user_import(tmp_path)
    assert out == {} and errs and errs[0]["kind"] == "bad_file" and "player_id" in errs[0]["detail"]


def test_unreadable_import_is_a_reported_error(tmp_path):
    (tmp_path / "awards_extra.csv").write_bytes(b"\xff\xfe\x00")
    out, errs = HS.load_user_import(tmp_path)
    assert errs


def test_valid_import_cross_checks_with_the_shipped_sources(tmp_path):
    ctx = small_ctx()
    (tmp_path / "awards_extra.csv").write_text("season,award,player_id,player\n2026,mvp,mvpaa01,Ann Mvp\n")
    extra, errs = HS.load_user_import(tmp_path)
    assert not errs
    base = {"awards_2026.csv": aw([("shipped", "2026", "mvp", "", "Ann Mvp", "mvpaa01")])}
    assert HS.validate(ctx, base, extra)["facts"][0]["status"] == "verified"
    (tmp_path / "awards_extra.csv").write_text("season,award,player_id,player\n2026,mvp,mvpbb01,Bob Mvp\n")
    extra, _ = HS.load_user_import(tmp_path)
    assert "winner_conflict" in [e["kind"] for e in HS.validate(ctx, base, extra)["errors"]]


def test_incomplete_import_leaves_other_seasons_unaffected():
    ctx = small_ctx()
    rows = team_rows("a", "allnba", 1, ["p00", "p01", "p02", "p03", "p04"])      # only one of three teams
    res = HS.validate(ctx, {"awards_2026.csv": aw(rows)})
    assert res["errors"] == []                                              # a missing team is missing, not wrong
    assert {f["tier"] for f in res["facts"]} == {1}


# =================================================================== repeatability and safe exports
@needs_raw
def test_validation_is_repeatable(real):
    ctx, res, _ = real
    again = HS.validate(ctx, tables())

    def dump(r):
        return json.dumps({k: r[k] for k in ("facts", "errors", "quarantine", "status", "seeds")}, sort_keys=True, default=str)
    assert dump(res) == dump(again)


def _commit(staged, root):
    old = ED.ROOT
    ED.ROOT = root
    try:
        return ED.commit(dict(staged))
    finally:
        ED.ROOT = old


def test_commit_writes_once_and_a_rerun_changes_nothing(tmp_path):
    staged = {tmp_path / "a.json": '{"a":1}', tmp_path / "sub" / "b.json": '{"b":2}'}
    first = _commit(staged, tmp_path)
    assert len(first["written"]) == 2
    second = _commit(staged, tmp_path)
    assert second["written"] == [] and second["unchanged"] == 2
    assert not list(tmp_path.rglob("*.staging"))


def test_a_failed_commit_leaves_existing_files_as_they_were(tmp_path, monkeypatch):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    a.write_text("OLD-A")
    b.write_text("OLD-B")
    real_replace = os.replace
    calls = {"n": 0}

    def flaky(src, dst):
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("disk full")
        return real_replace(src, dst)
    monkeypatch.setattr(os, "replace", flaky)
    with pytest.raises(OSError):
        _commit({a: "NEW-A", b: "NEW-B"}, tmp_path)
    assert a.read_text() == "OLD-A" and b.read_text() == "OLD-B"
    assert not list(tmp_path.glob("*.staging"))


@needs_raw
def test_a_conflicting_import_writes_nothing_and_the_app_files_stay_identical(tmp_path):
    watched = [PUB / "honors.json", PUB / "sim" / "brackets.json", ROOT / "docs" / "model" / "honors_validation.json"]
    before = {p: sha(p) for p in watched}
    (tmp_path / "finals_mvp.csv").write_text("season,player_id,player\n2026,gilgesh01,Shai Gilgeous-Alexander\n")   # contradicts the two shipped sources
    rc = ED.main(directory=tmp_path)
    assert rc == 1
    assert {p: sha(p) for p in watched} == before
    assert not list(PUB.rglob("*.staging"))


@needs_raw
def test_an_honors_only_change_leaves_simulation_data_untouched():
    """Re-running the export stages the sim features and teams unchanged, never stages model.json or shot data, and keeps every
    bracket number (records, point differentials, series, formats) the same."""
    rc = ED.main(dry_run=True)
    assert rc == 0
    for path, text in ED.STAGED.items():
        assert "shots" not in path.parts and path.name != "model.json"
        if "features" in path.parts or "teams" in path.parts:
            assert path.read_text(encoding="utf-8") == text, path
    staged_b = json.loads(ED.STAGED[PUB / "sim" / "brackets.json"])
    for s, b in staged_b["brackets"].items():
        old = BR["brackets"][s]
        assert [x["id"] for x in b["series"]] == [x["id"] for x in old["series"]]
        for t, info in b["teams"].items():
            assert (info["w"], info["l"], info["mov"]) == (old["teams"][t]["w"], old["teams"][t]["l"], old["teams"][t]["mov"])


def test_shot_data_is_never_a_staged_path():
    ED.STAGED.clear()
    ED.dump(PUB / "honors.json", {})
    assert all("shots" not in p.parts for p in ED.STAGED)
    ED.STAGED.clear()


# =================================================================== historical home court
def _teams(bracket):
    teams = sorted(bracket["teams"])
    pct = np.array([bracket["teams"][t]["w"] / (bracket["teams"][t]["w"] + bracket["teams"][t]["l"]) for t in teams])
    mov = np.array([bracket["teams"][t]["mov"] for t in teams])
    return teams, pct, mov


def test_real_hosts_are_preserved_for_series_that_happened():
    for s, b in BRACKETS.items():
        teams, pct, mov = _teams(b)
        h = E.home_matrix(b, teams, pct, mov)
        for x in b["series"]:
            i, j = teams.index(x["hc"]), teams.index(x["other"])
            assert h[i, j] and not h[j, i], (s, x["id"])


def test_better_record_hosts_new_matchups():
    b = BRACKETS[2005]
    teams, pct, mov = _teams(b)
    h = E.home_matrix(b, teams, pct, mov)
    assert h[teams.index("PHO"), teams.index("DET")]          # 62-20 vs 54-28, never met in the playoffs
    assert not h[teams.index("DET"), teams.index("PHO")]


def _tied_pair(b, uneven):
    for k, v in b["tieH2H"].items():
        if (v[0] != v[1]) == uneven:
            x, y = k.split("|")
            if not any({x, y} == {q["hc"], q["other"]} for q in b["series"]):
                return x, y, v
    return None


def test_tied_records_use_an_uneven_season_series_between_real_teams():
    for b in BRACKETS.values():
        p = _tied_pair(b, True)
        if p:
            x, y, v = p
            teams, pc, mov = _teams(b)
            h = E.home_matrix(b, teams, pc, mov)
            winner = x if v[0] > v[1] else y
            loser = y if winner == x else x
            assert h[teams.index(winner), teams.index(loser)] and not h[teams.index(loser), teams.index(winner)]
            return
    pytest.fail("no tied pair with an uneven season series found")


def test_even_series_or_a_custom_lineup_falls_back_to_the_labelled_assumption():
    found = False
    for b in BRACKETS.values():
        p = _tied_pair(b, False)
        if not p:
            continue
        x, y, _ = p
        teams, pc, mov = _teams(b)
        i, j = teams.index(x), teams.index(y)
        assert E.home_matrix(b, teams, pc, mov, "net")[i, j] == (mov[i] >= mov[j])
        mine = E.home_matrix(b, teams, pc, mov, "mine", x)
        theirs = E.home_matrix(b, teams, pc, mov, "theirs", x)
        assert mine[i, j] and not mine[j, i]                                # the custom lineup (standing in for x) hosts
        assert theirs[j, i] and not theirs[i, j]                            # its opponent hosts
        found = True
        break
    assert found
    for b in BRACKETS.values():                                             # an uneven real series never applies to a custom lineup
        p = _tied_pair(b, True)
        if p:
            x, y, _ = p
            teams, pc, mov = _teams(b)
            i, j = teams.index(x), teams.index(y)
            assert E.home_matrix(b, teams, pc, mov, "mine", x)[i, j] and E.home_matrix(b, teams, pc, mov, "theirs", x)[j, i]
            return


def test_historical_tie_evidence_is_recorded_and_the_assumption_is_not_called_official():
    hr = BR["homeRule"]
    assert hr["series"] == 450 and hr["host_worse_record"] == 0 and hr["tied_record"] == 27
    assert hr["tied_host_better_h2h"] + hr["tied_host_worse_h2h"] + hr["tied_h2h_even"] == 27
    assert hr["tied_host_better_mov"] + hr["tied_host_worse_mov"] == 27
    assert "simulation assumption, not an official rule" in BR["note"]


def test_neutral_site_2020_is_preserved_and_finals_patterns_change_in_2014():
    assert BRACKETS[2020]["neutral"] is True and all(s.get("neutral") for s in BRACKETS[2020]["series"])

    def fin(s):
        return [x for x in BRACKETS[s]["series"] if x["round"] == 4][0]["pattern"]
    assert fin(2013) == "HHAAAHH" and fin(2014) == "HHAAHAH"
    assert not any(BRACKETS[s].get("neutral") for s in BRACKETS if s != 2020)


def test_seeds_and_home_court_are_independent_in_the_data():
    lower_seed_hosted = [(s, x["hc"]) for s, b in BRACKETS.items() for x in b["series"] if x["round"] == 1
                         and b["teams"][x["hc"]]["seed"] > b["teams"][x["other"]]["seed"]]
    assert lower_seed_hosted


# =================================================================== templates and the extra import files
def test_every_template_loads_as_valid_and_empty_and_rerunning_never_overwrites(tmp_path):
    from sim import honors_import as HI
    assert sorted(HI.write_templates(tmp_path)) == sorted(HI.TEMPLATES)
    (tmp_path / "finals_mvp.csv").write_text("season,player_id,player,team\n2026,x,Y,NYK\n")
    assert HI.write_templates(tmp_path) == []
    assert "2026,x,Y,NYK" in (tmp_path / "finals_mvp.csv").read_text()
    for f in tmp_path.glob("*.csv"):
        if f.name != "finals_mvp.csv":
            assert len(pd.read_csv(f)) == 0
    out, errs = HS.load_user_import(tmp_path)
    assert not errs


def test_champion_roster_import_creates_roster_facts_only_for_listed_players():
    ctx = small_ctx()
    ctx.champ_players = {2026: {"p00", "p01", "p02"}}
    ring = pd.DataFrame([("user_import_champion_roster", "2026", f"Player {chr(65 + i)}", f"p{i:02d}", "") for i in (0, 1)],
                        columns=["source", "season", "player", "player_id", "team"])
    res = HS.validate(ctx, {"champion_roster.csv": ring})
    assert sorted(f["pid"] for f in res["facts"] if f["k"] == "ring") == ["p00", "p01"]       # p02 appeared but isn't claimed
    assert res["status"]["champion_roster"][2026] == "partial"


def test_seeds_and_champions_imports_are_cross_checked_not_trusted(tmp_path):
    (tmp_path / "seeds_extra.csv").write_text("season,conference,seed,team\n2005,E,1,MIA\n")
    (tmp_path / "champions_extra.csv").write_text("season,champion\n2005,SAS\n")
    out, errs = HS.load_user_import(tmp_path)
    assert not errs and set(out) == {"seeds.csv", "champions.csv"}
    assert out["champions.csv"].source.iloc[0] == "user_import_champions"
    ctx = small_ctx()
    ctx.champions = {2005: "SAS"}
    res = HS.validate(ctx, {}, out)
    assert not [e for e in res["errors"] if e["kind"] == "champion_conflict"]
    out["champions.csv"].loc[0, "champion"] = "DET"
    assert "champion_conflict" in [e["kind"] for e in HS.validate(ctx, {}, out)["errors"]]


@needs_raw
def test_rerunning_the_export_in_a_fresh_process_with_another_hash_seed_changes_no_file():
    """Set iteration order must not leak into the files: a dry run in a new interpreter stages exactly what is on disk."""
    import subprocess
    code = ("import sys;from sim import export_data as ED;rc=ED.main(dry_run=True);"
            "bad=[str(p) for p,t in ED.STAGED.items() if p.exists() and p.read_text(encoding='utf-8')!=t];"
            "print('DIFF',bad);sys.exit(rc)")
    for seed in ("1", "99"):
        r = subprocess.run([sys.executable, "-c", code], cwd=ROOT / "analysis", env={**os.environ, "PYTHONHASHSEED": seed}, capture_output=True, text=True)
        assert r.returncode == 0, r.stderr[-400:]
        assert "DIFF []" in r.stdout, r.stdout[-400:]
