"""MOCK-ONLY tests for the supplementary downloader / normalizers / probe checker.
Nothing here touches stats.nba.com or PBP Stats; passing these proves behavior against synthetic
fixtures only, not that the live service returns the shapes assumed here."""
import itertools
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "analysis", "supplementary"))
import common  # noqa: E402
import download as dl  # noqa: E402
import normalize  # noqa: E402
import probe_check  # noqa: E402
import shots  # noqa: E402


# ----------------------------------------------------------------------------- fixtures
def rs(name, headers, rows):
    return {"name": name, "headers": headers, "rowSet": rows}


HUSTLE_H = ["PLAYER_ID", "TEAM_ID", "G", "MIN", "CONTESTED_SHOTS", "DEFLECTIONS", "SCREEN_ASSISTS", "LOOSE_BALLS_RECOVERED"]
HUSTLE = {"resultSets": [rs("HustleStatsPlayer", HUSTLE_H, [[1, 10, 70, 2000, 300, 90, 20, 30], [2, 11, 60, 1500, 100, 40, 10, 12]])]}
SYN_H = ["PLAYER_ID", "PLAY_TYPE", "TYPE_GROUPING", "GP", "POSS", "POSS_PCT", "PPP", "PTS", "FGA", "FGM"]
SYN = {"resultSets": [rs("SynergyPlayType", SYN_H, [[1, "Isolation", "Offensive", 70, 300, 0.1, 1.0, 300, 250, 110]])]}
SHOT_H = ["GAME_ID", "GAME_EVENT_ID", "PLAYER_ID", "LOC_X", "LOC_Y", "SHOT_MADE_FLAG", "SHOT_ATTEMPTED_FLAG", "SHOT_TYPE", "SHOT_DISTANCE", "EVENT_TYPE"]


def shot_payload(n_made=5, n_miss=5):
    rows, i = [], 0
    for made in [1] * n_made + [0] * n_miss:
        i += 1
        rows.append(["g", i, 977, (i * 7) % 100 - 50, 20 + i, made, 1, "2PT Field Goal", 5, "Made Shot" if made else "Missed Shot"])
    return {"resultSets": [rs("LeagueAverages", ["GRID_TYPE"], [["x"]]), rs("Shot_Chart_Detail", SHOT_H, rows)]}


def call(fetch, tmp, dataset="hustle", season="2023-24", st="Regular Season", extra=None, sleeps=None, **kw):
    return dl.fetch_one(dataset, season, st, extra, fetch=fetch, raw_dir=str(tmp),
                        sleep=(sleeps.append if sleeps is not None else (lambda s: None)), **kw)


class Counter:
    def __init__(self, result):
        self.n, self.result = 0, result

    def __call__(self, url, params, timeout):
        self.n += 1
        if isinstance(self.result, BaseException):
            raise self.result
        return self.result(self.n) if callable(self.result) else self.result


# ----------------------------------------------------------------------------- result-set selection / schema
def test_selects_result_set_by_name_not_position():
    name, chosen, names = common.select_result_set(shot_payload(), "shotchart")
    assert name == "Shot_Chart_Detail" and names == ["LeagueAverages", "Shot_Chart_Detail"]
    assert len(chosen["rows"]) == 10  # not the first set (LeagueAverages, 1 row)


def test_missing_named_set_or_columns_is_schema_failure():
    with pytest.raises(common.SchemaError, match="expected result set"):
        common.select_result_set({"resultSets": [rs("Other", HUSTLE_H, [])]}, "hustle")
    with pytest.raises(common.SchemaError, match="missing columns"):
        common.select_result_set({"resultSets": [rs("HustleStatsPlayer", ["PLAYER_ID"], [])]}, "hustle")
    with pytest.raises(common.SchemaError, match="row length"):
        common.select_result_set({"resultSets": [rs("HustleStatsPlayer", HUSTLE_H, [[1, 2]])]}, "hustle")


def test_accepts_dict_keyed_and_single_resultset_shapes():
    keyed = {"resultSets": {"HustleStatsPlayer": {"headers": HUSTLE_H, "rowSet": []}}}
    assert common.select_result_set(keyed, "hustle")[0] == "HustleStatsPlayer"
    single = {"resultSet": {"name": "HustleStatsPlayer", "headers": HUSTLE_H, "rowSet": []}}
    assert common.select_result_set(single, "hustle")[0] == "HustleStatsPlayer"


def test_parameters_match_documented_names_and_values():
    p = dl.build_params("shotchart", "2008-09", "Regular Season", {"PlayerID": 977})
    assert p["ContextMeasure"] == "FGA" and p["PlayerID"] == 977 and p["TeamID"] == 0 and p["Season"] == "2008-09"
    s = dl.build_params("synergy", "2023-24", "Regular Season", {"PlayType": "Isolation", "TypeGrouping": "offensive"})
    assert s["SeasonYear"] == "2023-24" and s["PlayerOrTeam"] == "P" and s["PerMode"] == "Totals" and "Season" not in s
    assert dl.PLAY_TYPES == ["Cut", "Handoff", "Isolation", "Misc", "OffScreen", "Postup", "PRBallHandler", "PRRollman", "OffRebound", "Spotup", "Transition"]
    assert dl.TYPE_GROUPINGS == ["offensive", "defensive"]
    assert common.SPECS["synergy"]["result_set"] == "SynergyPlayType" and common.SPECS["ptdefend"]["identity"] == ["CLOSE_DEF_PERSON_ID"]


def test_regular_season_and_playoffs_are_separate_requests():
    a = dl.cache_key("e", dl.build_params("hustle", "2023-24", "Regular Season"))
    b = dl.cache_key("e", dl.build_params("hustle", "2023-24", "Playoffs"))
    assert a != b


# ----------------------------------------------------------------------------- caching / recovery
def test_cache_hit_refresh_and_ledger_fields(tmp_path):
    f = Counter(HUSTLE)
    r1 = call(f, tmp_path)
    assert r1["status"] == "ok" and not r1["cache_hit"] and f.n == 1 and r1["rows"] == 2
    for k in ("params", "url", "endpoint", "cache_key", "cache_path", "retrieved_utc", "attempts", "payload_sha256", "selected_result_set", "result_set_names", "downloader_version", "source_note"):
        assert k in r1, k
    assert r1["params"]["Season"] == "2023-24" and r1["params"]["PerMode"] == "Totals"
    r2 = call(f, tmp_path)
    assert r2["status"] == "ok" and r2["cache_hit"] and f.n == 1
    r3 = call(f, tmp_path, refresh=True)
    assert not r3["cache_hit"] and f.n == 2


def _cache_file(tmp_path):
    files = [p for p in (tmp_path / "hustle").iterdir() if p.suffix == ".json"]
    assert len(files) == 1
    return files[0]


@pytest.mark.parametrize("damage", ["truncate", "garbage", "checksum", "identity", "schema"])
def test_corrupt_or_mismatched_cache_is_quarantined_and_refetched(tmp_path, damage):
    f = Counter(HUSTLE)
    call(f, tmp_path)
    p = _cache_file(tmp_path)
    text = p.read_text()
    if damage == "truncate":
        p.write_text(text[: len(text) // 2])
    elif damage == "garbage":
        p.write_text("<html>blocked</html>")
    else:
        d = json.loads(text)
        if damage == "checksum":
            d["payload"]["resultSets"][0]["rowSet"][0][2] = 999
        elif damage == "identity":
            d["params"]["Season"] = "1999-00"
        else:
            d["payload"] = {"resultSets": [rs("Wrong", HUSTLE_H, [])]}
            d["payload_sha256"] = common.payload_sha256(d["payload"])
        p.write_text(json.dumps(d))
    r = call(f, tmp_path)
    assert r["status"] == "ok" and not r["cache_hit"] and f.n == 2
    assert "cache_recovered" in r and r["cache_recovered"]["reason"]
    assert any(".corrupt-" in x.name for x in (tmp_path / "hustle").iterdir())  # quarantined, not deleted


def test_failed_refresh_keeps_the_old_good_cache(tmp_path):
    call(Counter(HUSTLE), tmp_path)
    p = _cache_file(tmp_path)
    before = p.read_bytes()
    r = call(Counter(dl.HTTPStatusError(403)), tmp_path, refresh=True)
    assert r["status"] == "access_denied" and r.get("stale_cache_retained") is True
    assert p.read_bytes() == before


def test_no_tmp_or_cache_left_after_failure(tmp_path):
    call(Counter(dl.HTTPStatusError(403)), tmp_path)
    assert not (tmp_path / "hustle").exists()


# ----------------------------------------------------------------------------- states and retry policy
class FakeProxyError(Exception):
    pass


FakeProxyError.__name__ = "ProxyError"


def test_access_denials_are_permanent_and_not_retried(tmp_path):
    for exc, detail in [(dl.HTTPStatusError(403), "HTTP 403"), (dl.HTTPStatusError(401), "HTTP 401"),
                        (FakeProxyError("Tunnel connection failed: 403 Forbidden"), "CONNECT tunnel")]:
        f, sl = Counter(exc), []
        r = call(f, tmp_path, sleeps=sl, retries=5)
        assert r["status"] == "access_denied" and f.n == 1 and sl == [] and r["attempts"] == 1
        assert detail in r["detail"]
    assert "environment" in r["detail"]  # described as an environment/network-access restriction, not an NBA decision


def test_unsupported_requests_are_not_retried(tmp_path):
    for code in (400, 404, 422):
        f = Counter(dl.HTTPStatusError(code))
        assert call(f, tmp_path)["status"] == "unsupported_coverage" and f.n == 1


def test_transient_errors_retry_with_bounded_backoff_and_retry_after(tmp_path):
    f, sl = Counter(dl.HTTPStatusError(503)), []
    r = call(f, tmp_path, retries=2, backoff=1, sleeps=sl)
    assert r["status"] == "network_failure" and f.n == 3 and r["attempts"] == 3
    assert len(sl) == 2 and 1 <= sl[0] <= 1.2 and 2 <= sl[1] <= 2.4
    f2, sl2 = Counter(dl.HTTPStatusError(429, retry_after="7")), []
    call(f2, tmp_path, retries=1, sleeps=sl2)
    assert sl2 == [7.0]


def test_recovers_after_transient_error(tmp_path):
    f = Counter(lambda n: (_ for _ in ()).throw(TimeoutError("slow")) if n == 1 else HUSTLE)
    r = call(f, tmp_path, sleeps=[])
    assert r["status"] == "ok" and r["attempts"] == 2


def test_schema_failure_is_distinct_and_not_retried_or_cached(tmp_path):
    f = Counter({"resultSets": [rs("HustleStatsPlayer", ["FOO"], [])]})
    r = call(f, tmp_path)
    assert r["status"] == "schema_failure" and f.n == 1 and not (tmp_path / "hustle").exists()
    f2 = Counter(common.SchemaError("response is not JSON"))
    assert call(f2, tmp_path)["status"] == "schema_failure"


def test_valid_empty_response_is_not_a_failure_and_is_cached(tmp_path):
    f = Counter({"resultSets": [rs("HustleStatsPlayer", HUSTLE_H, [])]})
    r = call(f, tmp_path)
    assert r["status"] == "empty" and r["rows"] == 0
    r2 = call(f, tmp_path)
    assert r2["status"] == "empty" and r2["cache_hit"] and f.n == 1


def test_earliest_season_hint_skips_without_a_request(tmp_path):
    f = Counter(HUSTLE)
    r = call(f, tmp_path, season="2010-11", earliest_season="2015-16")
    assert r["status"] == "unsupported_coverage" and f.n == 0


# ----------------------------------------------------------------------------- CLI
def run_cli(args, tmp_path, fetch=None):
    return dl.main(args + ["--raw-dir", str(tmp_path), "--pace", "1"], fetch=fetch or Counter(HUSTLE), sleep=lambda s: None)


@pytest.mark.parametrize("args", [
    ["--dataset", "hustle", "--seasons", "2023"],
    ["--dataset", "hustle", "--seasons", "2023-25"],
    ["--dataset", "hustle", "--seasons", "1800-01"],
    ["--dataset", "shotchart", "--seasons", "2008-09"],
    ["--dataset", "shotchart", "--seasons", "2008-09", "--player-ids", "abc"],
    ["--dataset", "shotchart", "--seasons", "2008-09", "--player-ids", "-5"],
    ["--dataset", "synergy", "--seasons", "2023-24"],
    ["--dataset", "synergy", "--seasons", "2023-24", "--play-type", "Bogus"],
    ["--dataset", "hustle", "--seasons", "2023-24", "--player-ids", "977"],
    ["--dataset", "hustle", "--seasons", "2023-24", "--play-type", "Isolation"],
    ["--dataset", "hustle", "--seasons", "2023-24", "--pace", "0.1"],
    ["--dataset", "hustle", "--seasons", "2023-24", "--season-types", "Pre Season"],
])
def test_cli_rejects_invalid_input(args, tmp_path):
    with pytest.raises(SystemExit) as e:
        dl.main(args + ["--raw-dir", str(tmp_path)], fetch=Counter(HUSTLE), sleep=lambda s: None)
    assert e.value.code == 2


def test_cli_refuses_raw_dir_inside_public():
    with pytest.raises(SystemExit):
        dl.main(["--dataset", "hustle", "--seasons", "2023-24", "--raw-dir", os.path.join(dl.REPO, "public", "data")])


def test_cli_dry_run_makes_no_request_and_plans_explicit_play_types(tmp_path, capsys):
    f = Counter(HUSTLE)
    assert run_cli(["--dataset", "synergy", "--seasons", "2023-24", "--play-type", "Isolation", "--dry-run"], tmp_path, f) == 0
    out = capsys.readouterr().out
    assert f.n == 0 and "Isolation" in out and "offensive" in out and "synergyplaytypes" in out
    run_cli(["--dataset", "synergy", "--seasons", "2023-24", "--play-type", "all", "--dry-run"], tmp_path, f)
    assert capsys.readouterr().out.count("PLAN") == 11


def test_cli_stops_after_first_access_denial(tmp_path):
    f = Counter(dl.HTTPStatusError(403))
    code = run_cli(["--dataset", "hustle", "--seasons", "2022-23", "2023-24", "2024-25"], tmp_path, f)
    assert code == 2 and f.n == 1
    ledger = [json.loads(x) for x in open(tmp_path / "ledger.jsonl")]
    assert len(ledger) == 1 and ledger[0]["status"] == "access_denied" and ledger[0]["params"]["Season"] == "2022-23"


def test_cli_full_probe_flow_with_mocks(tmp_path):
    def fetch(url, params, timeout):
        if "shotchartdetail" in url:
            return shot_payload()
        if "synergyplaytypes" in url:
            return SYN
        return HUSTLE
    assert run_cli(["--dataset", "shotchart", "--seasons", "2008-09", "--player-ids", "977"], tmp_path, fetch) == 0
    assert run_cli(["--dataset", "hustle", "--seasons", "2023-24"], tmp_path, fetch) == 0
    assert run_cli(["--dataset", "synergy", "--seasons", "2023-24", "--play-type", "Isolation"], tmp_path, fetch) == 0
    res = probe_check.check(str(tmp_path), kobe_trusted_fga=10)
    assert all(r["pass"] for r in res), res
    res_bad = probe_check.check(str(tmp_path), kobe_trusted_fga=1712)
    assert not all(r["pass"] for r in res_bad)  # 10 mock shots do not reconcile with 1712 FGA


def test_probe_check_fails_when_nothing_was_downloaded(tmp_path):
    res = probe_check.check(str(tmp_path))
    assert res and not any(r["pass"] for r in res)


# ----------------------------------------------------------------------------- normalizers
def test_normalizer_writes_tidy_csv_with_provenance_only_under_out_dir(tmp_path):
    raw, out = tmp_path / "raw", tmp_path / "out"
    r = call(Counter(HUSTLE), raw)
    n_path, rep = normalize.normalize_cache("hustle", str(raw / r["cache_path"]), out_dir=str(out))
    assert rep["status"] == "ok" and rep["row_scope"] == "player_total" and rep["duplicate_keys"] == 0
    import csv
    rows = list(csv.DictReader(open(n_path)))
    assert len(rows) == 2 and rows[0]["season_id"] == "2023-24" and rows[0]["season_type"] == "Regular Season" and rows[0]["source"]
    assert os.path.dirname(n_path) == str(out)


def test_normalizer_does_not_sum_traded_player_rows(tmp_path):
    traded = {"resultSets": [rs("HustleStatsPlayer", HUSTLE_H, [[1, 10, 30, 900, 100, 40, 5, 10], [1, 11, 40, 1100, 150, 50, 7, 12]])]}
    r = call(Counter(traded), tmp_path / "raw")
    _, rep = normalize.normalize_cache("hustle", str(tmp_path / "raw" / r["cache_path"]), out_dir=str(tmp_path / "out"))
    assert rep["row_scope"] == "team" and rep["duplicate_keys"] == 1 and rep["duplicate_examples"] == [1]


def test_normalizer_refuses_an_invalid_cache_and_empty_writes_nothing(tmp_path):
    r = call(Counter(HUSTLE), tmp_path / "raw")
    p = tmp_path / "raw" / r["cache_path"]
    p.write_text(p.read_text()[:50])
    out, rep = normalize.normalize_cache("hustle", str(p), out_dir=str(tmp_path / "out"))
    assert out is None and rep["status"] == "invalid_cache" and not (tmp_path / "out").exists()
    e = call(Counter({"resultSets": [rs("HustleStatsPlayer", HUSTLE_H, [])]}), tmp_path / "raw2")
    out, rep = normalize.normalize_cache("hustle", str(tmp_path / "raw2" / e["cache_path"]), out_dir=str(tmp_path / "out2"))
    assert out is None and rep["status"] == "empty" and not (tmp_path / "out2").exists()


def test_synergy_duplicates_are_keyed_by_play_type(tmp_path):
    two = {"resultSets": [rs("SynergyPlayType", SYN_H, [[1, "Isolation", "Offensive", 1, 1, .1, 1, 1, 1, 1], [1, "Spotup", "Offensive", 1, 1, .1, 1, 1, 1, 1]])]}
    r = call(Counter(two), tmp_path / "raw", dataset="synergy", extra={"PlayType": "Isolation", "TypeGrouping": "offensive"})
    _, rep = normalize.normalize_cache("synergy", str(tmp_path / "raw" / r["cache_path"]), out_dir=str(tmp_path / "out"))
    assert rep["duplicate_keys"] == 0


# ----------------------------------------------------------------------------- shot geometry / validation (synthetic)
def row(i, x, y, made=1, typ="2PT Field Goal", ev=None):
    return {"GAME_ID": "g", "GAME_EVENT_ID": ev if ev is not None else i, "PLAYER_ID": 1, "LOC_X": x, "LOC_Y": y,
            "SHOT_MADE_FLAG": made, "SHOT_ATTEMPTED_FLAG": 1, "SHOT_TYPE": typ}


def test_zone_boundaries_and_heaves():
    assert shots.zone_for(0, 10) == "restricted_area"
    assert shots.zone_for(0, 50) == "paint_non_ra"
    assert shots.zone_for(150, 50) == "mid_range"
    assert shots.zone_for(235, 40) == "corner_3"
    assert shots.zone_for(0, 240) == "above_break_3"
    assert shots.zone_for(0, 237.4) == "mid_range"
    assert shots.zone_for(0, 700) == "heave"


def test_zones_are_exhaustive_over_a_grid():
    valid = {"restricted_area", "paint_non_ra", "mid_range", "corner_3", "above_break_3", "heave"}
    for x, y in itertools.product(range(-250, 251, 10), range(-50, 480, 10)):
        assert shots.zone_for(x, y) in valid


def test_normalize_drops_duplicates_invalid_and_keeps_misses():
    rows = [row(1, 0, 10, 1), row(1, 0, 10, 1), row(2, 999, 10), row(3, 0, 50, 0), row(4, 0, 50, 2)]
    clean, rep = shots.normalize_shots(rows)
    assert rep["duplicates"] == 1 and rep["invalid_coordinates"] == 1 and rep["invalid_flags"] == 1
    z = shots.aggregate_zones(clean)
    assert z["paint_non_ra"] == {"fga": 1, "fgm": 0}
    assert all(v["fgm"] <= v["fga"] for v in z.values())


def test_reconcile_with_trusted_total():
    z = {"a": {"fga": 98, "fgm": 40}, "b": {"fga": 0, "fgm": 0}}
    assert shots.reconcile(z, 100)["within_tolerance"]
    assert not shots.reconcile(z, 200)["within_tolerance"]
