import json
import os
import sys

import pandas as pd
import pytest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "analysis"))
import shot_bands as sb  # noqa: E402
import shot_band_validation as val  # noqa: E402
import utils  # noqa: E402


def test_js_round_is_half_up_like_the_browser():
    assert sb.js_round(0.5) == 1 and sb.js_round(1.5) == 2 and sb.js_round(2.5) == 3  # not banker's rounding


def test_distribution_status_tolerance():
    assert sb.distribution_status(1.0025) == "ok" and sb.distribution_status(0.9975) == "ok"
    assert sb.distribution_status(0.968) == "incomplete"
    assert sb.distribution_status(1.013) == "overallocated"
    assert sb.distribution_status(None) == "missing"


def test_band_state_distinguishes_zero_from_missing():
    assert sb.band_state(0.0, float("nan")) == "source_none"
    assert sb.band_state(float("nan"), None) == "unavailable"
    assert sb.band_state(0.0, 0.5) == "inconsistent"
    assert sb.band_state(0.2, 0.0) == "ok"  # zero makes with attempts is a real 0% FG, not a blank


def test_displayed_counts_round_attempts_before_makes():
    att, mk = sb.displayed_counts(0.123, 0.667, 77)
    assert att == 9 and mk == 6  # round(9.471)=9; round(9*0.667=6.003)=6
    assert sb.displayed_counts(None, 0.5, 100) == (None, None)
    assert sb.displayed_counts(0.0, float("nan"), 500) == (0, 0)


def _row(fga, shares, fgs):
    r = {"fga": fga}
    for b, s, f in zip(sb.BANDS, shares, fgs):
        r[f"percent_fga_from_{b}_range"] = s
        r[f"fg_percent_from_{b}_range"] = f
    return r


def test_pooled_fg_is_makes_over_attempts_not_mean_of_percentages():
    nan = float("nan")
    big = _row(1000, [1, 0, 0, 0, 0], [0.5, nan, nan, nan, nan])      # 1000 att @ 50%
    small = _row(10, [1, 0, 0, 0, 0], [1.0, nan, nan, nan, nan])      # 10 att @ 100%
    out = sb.pooled_baseline([big, small])
    assert out["bands"]["x0_3"]["fg_pct"] == pytest.approx((500 + 10) / 1010, abs=1e-4)
    assert out["bands"]["x0_3"]["fg_pct"] != pytest.approx(0.75, abs=1e-3)  # unweighted mean would be 0.75
    assert out["bands"]["x3_10"]["fg_pct"] is None  # no attempts → undefined, not 0
    assert out["bands"]["x0_3"]["share"] == 1.0


def test_blank_fg_is_not_zero_makes_when_attempts_exist():
    nan = float("nan")
    a = _row(100, [0.5, 0.5, 0, 0, 0], [0.4, nan, nan, nan, nan])  # blank FG% despite 50 attempts: unknown
    out = sb.pooled_baseline([a])
    assert out["bands"]["x3_10"]["fg_pct"] is None and out["bands"]["x3_10"]["fg_missing_rows"] == 1
    assert out["bands"]["x3_10"]["share"] == 0.5  # attempts still count toward share


@pytest.fixture(scope="module")
def exported_baselines():
    return json.load(open(utils.public_data_path("shot_baselines.json")))


def test_baseline_metadata_is_honest(exported_baselines):
    b = exported_baselines
    assert b["season_type"] == "regular" and b["attempts_are_estimates"] is True and b["min_minutes"] == 0
    for season, e in b["seasons"].items():
        assert 0 < e["fga_coverage"] <= 1
        assert e["players"] + e["excluded_missing"] + e["excluded_incomplete"] + e["excluded_overallocated"] == e["league_player_seasons"]
        assert sum(x["share"] for x in e["bands"].values()) == pytest.approx(1.0, abs=0.002)
    # includes low-minute players: more rows than a 250-minute display pool could have
    features = pd.read_csv(utils.data_path("with_archetypes.csv"))
    s2009 = features[features.season == 2009]
    assert b["seasons"]["2009"]["league_player_seasons"] > len(s2009)


def test_flagged_hayes_record_is_exported_unmodified_and_flagged():
    recs = json.load(open(utils.public_data_path("seasons", "2023.json")))
    recs = recs if isinstance(recs, list) else recs["players"]
    h = [r for r in recs if r["player_id"] == "hayesja02"][0]["shot_dna"]
    assert h["distribution_status"] == "incomplete" and h["shares_total"] == 0.968
    assert h["percent_fga_from_x0_3_range"] == 0.41  # not normalized


def test_validation_passes_on_real_data_and_fails_on_injected_problems(tmp_path):
    src = utils.data_path("canonical_player_seasons.csv")
    assert val.main(canon_path=src, out_dir=str(tmp_path)) == 0
    df = pd.read_csv(src)
    dup = pd.concat([df, df.iloc[[0]]])  # duplicate player-season
    p = tmp_path / "dup.csv"
    dup.to_csv(p, index=False)
    assert val.main(canon_path=str(p), out_dir=str(tmp_path)) == 1
    bad = df.copy()
    i = bad[bad.fga > 300].index[0]
    bad.loc[i, "percent_fga_from_x0_3_range"] = 0.6  # makes the share total unexplainable by the documented cause
    p2 = tmp_path / "bad.csv"
    bad.to_csv(p2, index=False)
    assert val.main(canon_path=str(p2), out_dir=str(tmp_path)) == 1
    rep = json.load(open(tmp_path / "shot_band_validation.json"))
    assert any("NEW unreviewed" in f for f in rep["failures"])


def _run(tmp_path, canon=None, exceptions=None, manifest=None):
    src = utils.data_path("canonical_player_seasons.csv")
    if canon is not None:
        src = str(tmp_path / "c.csv")
        canon.to_csv(src, index=False)
    kw = {}
    if exceptions is not None:
        ep = tmp_path / "ex.json"
        ep.write_text(json.dumps(exceptions))
        kw["exceptions_path"] = str(ep)
    if manifest is not None:
        mp = tmp_path / "man.json"
        mp.write_text(json.dumps(manifest))
        kw["manifest_path"] = str(mp)
    code = val.main(canon_path=src, out_dir=str(tmp_path), **kw)
    return code, json.load(open(tmp_path / "shot_band_validation.json"))


def _reviewed():
    return json.load(open(val.REVIEWED_EXCEPTIONS))


def test_reviewed_exception_file_has_331_entries_with_source_identity():
    r = _reviewed()
    assert len(r["exceptions"]) == 331
    assert len({e["id"] for e in r["exceptions"]}) == 331
    assert len(r["source"]["sha256"]) == 64 and r["issue"]


def test_changed_reviewed_value_fails(tmp_path):
    r = _reviewed()
    r["exceptions"][0]["shares_total"] = round(r["exceptions"][0]["shares_total"] + 0.01, 3)
    code, rep = _run(tmp_path, exceptions=r)
    assert code == 1 and any("CHANGED" in f for f in rep["failures"])


def test_stale_reviewed_entry_fails(tmp_path):
    r = _reviewed()
    r["exceptions"].append(dict(r["exceptions"][0], id="nobody01_1999"))
    code, rep = _run(tmp_path, exceptions=r)
    assert code == 1 and any("no longer deviations" in f for f in rep["failures"])


def test_missing_reviewed_entry_means_new_deviation_fails(tmp_path):
    r = _reviewed()
    r["exceptions"] = r["exceptions"][1:]
    code, rep = _run(tmp_path, exceptions=r)
    assert code == 1 and any("NEW unreviewed" in f for f in rep["failures"])


def test_source_checksum_mismatch_fails(tmp_path):
    man = json.load(open(utils.data_path("source_manifest.json")))
    man["files"]["Player Shooting.csv"]["sha256"] = "0" * 64
    code, rep = _run(tmp_path, manifest=man)
    assert code == 1 and any("checksum" in f for f in rep["failures"])


def test_validation_does_not_modify_reviewed_file_or_auto_approve(tmp_path):
    before = open(val.REVIEWED_EXCEPTIONS, "rb").read()
    df = pd.read_csv(utils.data_path("canonical_player_seasons.csv"))
    i = df[df.fga > 300].index[0]
    df.loc[i, "percent_fga_from_x0_3_range"] = 0.3
    code, _ = _run(tmp_path, canon=df)
    assert code == 1
    assert open(val.REVIEWED_EXCEPTIONS, "rb").read() == before
    assert not hasattr(val, "D1_MAX_DEVIATION")
