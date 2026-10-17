"""
Configuration for the simulation model.

Everything that is a judgement call lives here, and the decision rules that
turn validation numbers into labels ("Validated" / "Experimental") are written
down BEFORE the final test seasons are scored. Nothing here is tuned on the
test seasons.
"""
from __future__ import annotations

MODEL_VERSION = "sim-1.1.0"
DATA_VERSION = "sim-data-2026-10-16-v3"

SEASON_MIN = 1997
SEASON_MAX = 2026

# ---------------------------------------------------------------------------
# Season splits (season = the year the season ends: 2005 = 2004-05). Chronological.
# ---------------------------------------------------------------------------
# sim-1.0.0 used TRAIN 1997-2008, VALIDATION 2009-2012 and TEST 2013-2026 (games and series only to 2015). Those test
# results were inspected, so for sim-1.1.0 the 2013-2019 seasons are DEVELOPMENT data (validation), not untouched test data.
TRAIN = (1997, 2012)        # fit coefficients and parameters
VALIDATION = (2013, 2019)   # every choice is made here: features, ridge strength, game model form, support-check cut-offs
TEST = (2020, 2026)         # reserved for games, series and brackets: scored once, after the choices are frozen
# What was already seen: in the first Phase 10 pass, team-season win and net-rating results for 2020-2026 were inspected.
# Game, series and bracket outcomes for 2020-2026 had not been evaluated by any model.
PRIOR_TEST_SEEN = "team-season wins and net rating, 2013-2026; game and series outcomes, 2013-2015"

# Seasons with fewer than 82 games (wins are scaled to an 82-game pace).
FULL_GAMES = 82

# ---------------------------------------------------------------------------
# Roster / lineup structure shared by training and the browser engine
# ---------------------------------------------------------------------------
STARTERS = 5
BENCH_SLOTS = 5            # bench players 6-10 define the "average bench"
MIN_PLAYER_MINUTES = 250   # a player-season needs 250+ minutes to be in the app data
QUALIFIED_MINUTES = 500
QUALIFIED_GAMES = 20
MIN_TEAM_COVERAGE = 0.90   # share of a team's minutes that must belong to players with data

# Player features (raw columns) used by the model
FEATURES = [
    "ts_percent", "usg_percent", "ast_percent", "tov_percent", "orb_percent",
    "drb_percent", "stl_percent", "blk_percent", "x3p_ar", "f_tr", "ht_in_in",
]

# ---------------------------------------------------------------------------
# Pre-registered decision rules (written before the 2020-2026 games and series were scored)
# ---------------------------------------------------------------------------
# A win estimate is labelled "Validated for historical teams" only if, on the test seasons, its RMSE (wins) is at most
# this fraction of the league-average baseline RMSE, and the 80% range covers 70-90% of teams.
WINS_RMSE_RATIO_MAX = 0.70
RANGE_COVERAGE_BAND = (0.70, 0.90)
# Starting-five-plus-average-bench estimates (what a custom lineup gets) use a looser bar because the real bench is unknown.
WINS_RMSE_RATIO_MAX_FIVE = 0.85
# ...and must also beat last season's record as a predictor of wins (a lineup model that cannot beat "same as last year" is
# not an estimate worth presenting as reliable). Added after the sim-1.0.0 test showed 9.98 vs 9.84.
FIVE_MUST_BEAT_PRIOR_SEASON = True
# Expected offensive / defensive rating are shown only if the validation AND test R^2 of that component is at least this.
COMPONENT_R2_MIN = 0.30
# Series / bracket odds drop the "Experimental" label only if: at least this many held-out series, log loss better than
# both baselines (average-team strength with home court, and better-record rule), and a calibration slope inside the band.
# The calibration condition was added after the sim-1.0.0 series slope of 0.22; the 2013-2015 results are development evidence.
SERIES_MIN_TEST_N = 100
CALIBRATION_SLOPE_BAND = (0.75, 1.25)
# Custom (invented) lineups can never be labelled validated: there is no ground truth for combinations that never played.
PREDICTION_RANGE = 0.80    # central probability mass reported as the "range"

# Support check (starting-five feature vector against the training teams' starting fives)
# Distance = Mahalanobis distance with a shrinkage covariance. Cut-offs are quantiles of the TRAINING teams only.
SUPPORT_LIMITED_Q = 0.95       # beyond this: "limited"
SUPPORT_UNSUPPORTED_Q = 0.995  # beyond this: "unsupported" (numbers withheld)
# Also unsupported: a projected net rating outside the range of net ratings of the real teams the model was fitted on.
SUPPORT_MIN_MP, SUPPORT_MIN_G = 500, 20   # small sample: fewer minutes or games than this
SUPPORT_ERA_SPAN = 6                       # players from seasons this many years apart or more: mixed-era

SOURCES = {
    "kaggle_bbref": {
        "name": "NBA Stats (1947-present), Sumitro Datta (Basketball-Reference data)",
        "url": "https://www.kaggle.com/datasets/sumitrodatta/nba-aba-baa-stats",
        "license": "CC0: Public Domain",
        "note": "Already used by the COURT DNA pipeline; see docs/data.md and public/data/meta.json for checksums.",
    },
    "fivethirtyeight_elo": {
        "name": "FiveThirtyEight historical NBA Elo game results (nbaallelo.csv)",
        "url": "https://raw.githubusercontent.com/fivethirtyeight/data/master/nba-elo/nbaallelo.csv",
        "readme": "https://raw.githubusercontent.com/fivethirtyeight/data/master/nba-elo/README.md",
        "license": "CC BY 4.0 (fivethirtyeight/data repository)",
        "note": "Game results are from Basketball-Reference.com. Covers games through the 2015 playoffs.",
    },
}
