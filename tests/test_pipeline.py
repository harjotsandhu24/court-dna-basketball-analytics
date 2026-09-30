"""
COURT DNA data-pipeline QA suite.

Run: cd analysis && python3 -m pytest ../tests/test_pipeline.py -v
(run from analysis/ so relative imports resolve, or set PYTHONPATH)
"""
import json
import math
import os
import subprocess
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "analysis"))
import config  # noqa: E402
import utils  # noqa: E402
import similarity  # noqa: E402


@pytest.fixture(scope="module")
def canonical():
    return pd.read_csv(utils.data_path("canonical_player_seasons.csv"))


@pytest.fixture(scope="module")
def features():
    return pd.read_csv(utils.data_path("with_archetypes.csv"))


@pytest.fixture(scope="module")
def raw_advanced():
    return utils.filter_nba_seasons(utils.load_raw("Advanced.csv"))


# ---------------------------------------------------------------------------
# Canonical merge
# ---------------------------------------------------------------------------

def test_one_canonical_row_per_player_season(canonical):
    dup = canonical.duplicated(subset=["player_id", "season"]).sum()
    assert dup == 0, f"{dup} duplicate (player_id, season) rows found"


def test_traded_player_aggregate_selection_real_example(raw_advanced, canonical):
    """James Harden, 2025-26 season (season=2026): raw data has a 2TM
    aggregate row (2438 MP) plus LAC (1559 MP) and CLE (879 MP) individual
    rows. The canonical table must use the 2TM row's minutes, not either
    individual team's minutes, and not the sum-doubled total."""
    raw_rows = raw_advanced[(raw_advanced.player_id == "hardeja01") & (raw_advanced.season == 2026)]
    assert len(raw_rows) == 3, "expected 3 raw rows (2TM + LAC + CLE) for this real example"
    agg_row = raw_rows[raw_rows.team == "2TM"]
    assert len(agg_row) == 1
    expected_mp = agg_row.iloc[0]["mp"]

    canon_row = canonical[(canonical.player_id == "hardeja01") & (canonical.season == 2026)]
    assert len(canon_row) == 1, "must produce exactly one canonical row"
    assert canon_row.iloc[0]["mp"] == expected_mp
    assert canon_row.iloc[0]["team"] == "2TM"


def test_no_multi_team_double_counting(raw_advanced, canonical):
    """For every traded player-season, canonical MP must equal the
    aggregate row's MP, never the sum of individual team MPs (which would
    silently double the season)."""
    raw_advanced = raw_advanced.copy()
    raw_advanced["is_agg"] = raw_advanced["team"].apply(utils.is_aggregate_team_row)
    agg_keys = raw_advanced[raw_advanced["is_agg"]][["player_id", "season", "mp"]]
    checked = 0
    for _, row in agg_keys.iterrows():
        canon = canonical[(canonical.player_id == row.player_id) & (canonical.season == row.season)]
        assert len(canon) == 1
        assert canon.iloc[0]["mp"] == row.mp, f"{row.player_id} {row.season}: canonical MP doesn't match aggregate row"
        checked += 1
    assert checked > 100, "expected substantially more than 100 traded player-seasons to check"


def test_nba_only_season_range(canonical):
    assert canonical["season"].min() >= config.SEASON_MIN
    assert canonical["season"].max() <= config.SEASON_MAX

    # The ABA/BAA leagues ceased to exist long before 2001 (BAA became the
    # NBA in 1949; the ABA merged into the NBA in 1976), so the 2001-2026
    # window naturally contains zero non-NBA rows to exclude -- confirmed
    # directly from the raw source below. The league filter is still real,
    # necessary, defensive code (utils.filter_nba_seasons checks lg=='NBA'
    # explicitly); this test instead proves the filter functions correctly
    # by exercising it against the full, unrestricted historical range,
    # where non-NBA rows genuinely exist.
    raw = utils.load_raw("Advanced.csv")
    non_nba_in_range = raw[(raw.season >= config.SEASON_MIN) & (raw.season <= config.SEASON_MAX) & (raw.lg != "NBA")]
    assert len(non_nba_in_range) == 0, "unexpected non-NBA rows found in the 2001-2026 window"

    full_history_non_nba = raw[raw.lg != "NBA"]
    assert len(full_history_non_nba) > 0, "sanity check: the full historical raw data must contain non-NBA rows"
    filtered = utils.filter_nba_seasons(raw)
    assert (filtered["lg"] == "NBA").all()
    assert len(filtered) < len(raw), "the NBA filter must actually remove rows when applied to full history"


def test_season_label_conversion():
    assert config.season_label(2001) == "2000-01"
    assert config.season_label(2026) == "2025-26"
    assert config.season_label(2000) == "1999-00"
    assert config.season_label(2010) == "2009-10"


# ---------------------------------------------------------------------------
# Qualification rules
# ---------------------------------------------------------------------------

def test_qualification_thresholds(features):
    qualified = features[features["qualified"]]
    assert (qualified["mp"] >= config.GALAXY_MIN_MINUTES).all()
    assert (qualified["g"] >= config.GALAXY_MIN_GAMES).all()
    not_qualified_but_displayed = features[(~features["qualified"]) & (features["mp"] >= config.CAREER_DISPLAY_MIN_MINUTES)]
    assert (not_qualified_but_displayed["small_sample"]).all(), "every sub-threshold displayed row must be flagged small_sample"


def test_no_tiny_sample_in_qualified_pool(features):
    """A season with e.g. 40 minutes must never appear in the qualified
    comparison pool, confirming tiny samples aren't silently treated as
    full seasons."""
    qualified = features[features["qualified"]]
    assert (qualified["mp"] >= config.GALAXY_MIN_MINUTES).all()


# ---------------------------------------------------------------------------
# Feature integrity
# ---------------------------------------------------------------------------

def test_no_nan_or_inf_in_qualified_similarity_features(features):
    qualified = features[features["qualified"]]
    for f in config.SIMILARITY_FEATURES:
        std_col = f"std_{f}"
        vals = qualified[std_col]
        assert not vals.isna().any(), f"NaN found in {std_col} for qualified pool"
        assert np.isfinite(vals).all(), f"Inf found in {std_col} for qualified pool"


def test_trait_percentiles_in_valid_range(features):
    for dim in config.TRAIT_DIMENSIONS:
        col = f"pctile_{dim.lower().replace(' ', '_')}"
        vals = features[col].dropna()
        assert (vals >= 0).all() and (vals <= 100).all(), f"{col} has values outside [0, 100]"


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------

def test_deterministic_percentiles_and_archetypes_on_rerun(tmp_path):
    """Re-running steps 3 and 4 must produce byte-identical archetype and
    percentile output."""
    analysis_dir = os.path.join(os.path.dirname(__file__), "..", "analysis")
    before = pd.read_csv(utils.data_path("with_archetypes.csv"))

    subprocess.run([sys.executable, "step3_features_traits.py"], cwd=analysis_dir, check=True, capture_output=True)
    subprocess.run([sys.executable, "step4_archetypes.py"], cwd=analysis_dir, check=True, capture_output=True)

    after = pd.read_csv(utils.data_path("with_archetypes.csv"))
    assert before["archetype"].tolist() == after["archetype"].tolist()
    pct_cols = [c for c in before.columns if c.startswith("pctile_")]
    for c in pct_cols:
        assert np.allclose(before[c].fillna(-1), after[c].fillna(-1)), f"{c} not deterministic across reruns"


def test_deterministic_pca_on_rerun():
    analysis_dir = os.path.join(os.path.dirname(__file__), "..", "analysis")
    with open(utils.data_path("galaxy_coords.json")) as f:
        before = json.load(f)
    subprocess.run([sys.executable, "step5_galaxy_pca.py"], cwd=analysis_dir, check=True, capture_output=True)
    with open(utils.data_path("galaxy_coords.json")) as f:
        after = json.load(f)
    assert before == after, "PCA output changed across reruns -- not deterministic"


# ---------------------------------------------------------------------------
# Similarity formula
# ---------------------------------------------------------------------------

def test_identical_vectors_return_max_similarity():
    v = {f: 0.73 for f in config.SIMILARITY_FEATURES}
    assert similarity.similarity_index(v, v) == 100.0


def test_similarity_symmetry():
    rng = np.random.default_rng(7)
    a = {f: float(rng.normal()) for f in config.SIMILARITY_FEATURES}
    b = {f: float(rng.normal()) for f in config.SIMILARITY_FEATURES}
    assert similarity.similarity_index(a, b) == pytest.approx(similarity.similarity_index(b, a))


def test_similarity_index_bounded_0_100():
    rng = np.random.default_rng(3)
    for _ in range(200):
        a = {f: float(rng.normal(scale=5)) for f in config.SIMILARITY_FEATURES}
        b = {f: float(rng.normal(scale=5)) for f in config.SIMILARITY_FEATURES}
        s = similarity.similarity_index(a, b)
        assert 0.0 <= s <= 100.0


def test_exactly_twelve_similarity_features():
    """Regression test for a real documentation bug: README/docs previously
    said '11 features' in nine different places while the actual model
    (analysis/config.py, lib/config.ts) has always used 12. This also
    exercises the assertion in config.py itself."""
    assert len(config.SIMILARITY_FEATURES) == 12


def test_feature_weights_sum_to_one():
    assert math.isclose(sum(config.FEATURE_WEIGHTS.values()), 1.0, abs_tol=1e-9)


def test_group_weights_match_spec():
    weights = {g.name: g.weight for g in config.FEATURE_GROUPS}
    assert weights["Scoring load"] == pytest.approx(0.20)
    assert weights["Efficiency"] == pytest.approx(0.10)
    assert weights["Shot profile"] == pytest.approx(0.25)
    assert weights["Playmaking / turnover style"] == pytest.approx(0.20)
    assert weights["Rebounding"] == pytest.approx(0.10)
    assert weights["Defensive activity"] == pytest.approx(0.15)


# ---------------------------------------------------------------------------
# Archetype quality spot checks (real, known statistical profiles)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("player_id,season,expected", [
    ("curryst01", 2016, "Primary Creator"),   # 2015-16 Curry: elite scoring + playmaking
    ("goberru01", 2018, "Defensive Anchor"),  # elite defense/rebounding, modest scoring
])
def test_known_archetype_spot_checks(features, player_id, season, expected):
    row = features[(features.player_id == player_id) & (features.season == season)]
    assert len(row) == 1
    assert row.iloc[0]["archetype"] == expected


def test_low_usage_low_turnover_shooter_not_mislabeled_creator(features):
    """Regression test for a real bug found during development: a
    low-usage, low-turnover catch-and-shoot player must not be labeled
    Primary Creator purely for having a low turnover rate."""
    row = features[(features.player_id == "thompkl01") & (features.season == 2016)]
    assert len(row) == 1
    assert row.iloc[0]["archetype"] != "Primary Creator"
