"""
COURT DNA — centralized analytical configuration.

Every threshold, weight, and feature list used anywhere in the pipeline
lives here. Nothing downstream should hardcode a number that belongs in
this file. See docs/methodology.md for the human-readable explanation of
every value below.
"""
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Season range
# ---------------------------------------------------------------------------
SEASON_MIN = 2001  # 2000-01
SEASON_MAX = 2026  # 2025-26
LEAGUE = "NBA"      # excludes ABA/BAA rows entirely


def season_label(season_end_year: int) -> str:
    """2001 -> '2000-01', 2026 -> '2025-26'."""
    start = season_end_year - 1
    return f"{start}-{str(season_end_year)[-2:]}"


# ---------------------------------------------------------------------------
# Qualification thresholds (Section 4 of the spec)
# ---------------------------------------------------------------------------
GALAXY_MIN_MINUTES = 500
GALAXY_MIN_GAMES = 20

CAREER_DISPLAY_MIN_MINUTES = 250
# A season is flagged "small sample" in career/detail views when it clears
# the low display bar but not the full comparison-pool bar.
SMALL_SAMPLE_MINUTES = GALAXY_MIN_MINUTES  # below this = flagged, not hidden

# ---------------------------------------------------------------------------
# Similarity feature groups and weights (Section 5-6 of the spec)
# Each group's weight is divided evenly across its listed features unless a
# per-feature weight is given explicitly.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FeatureGroup:
    name: str
    weight: float  # fraction of total similarity weight (sums to 1.0 across all groups)
    features: tuple  # column names in the standardized-feature table
    higher_is_more_of_trait: dict = field(default_factory=dict)


FEATURE_GROUPS = [
    FeatureGroup(
        name="Scoring load",
        weight=0.20,
        features=("pts_per_100_poss", "usg_percent"),
    ),
    FeatureGroup(
        name="Efficiency",
        weight=0.10,
        features=("ts_percent",),
    ),
    FeatureGroup(
        name="Shot profile",
        weight=0.25,
        features=(
            "f_tr",
            "avg_dist_fga",
            "percent_fga_from_x0_3_range",
            "percent_fga_from_x3p_range",
        ),
    ),
    FeatureGroup(
        name="Playmaking / turnover style",
        weight=0.20,
        features=("ast_percent", "tov_percent"),
    ),
    FeatureGroup(
        name="Rebounding",
        weight=0.10,
        features=("trb_percent",),
    ),
    FeatureGroup(
        name="Defensive activity",
        weight=0.15,
        features=("stl_percent", "blk_percent"),
    ),
]

# Flat list of every feature used in the similarity vector, in a fixed order.
SIMILARITY_FEATURES = [f for g in FEATURE_GROUPS for f in g.features]

# Per-feature weight = group weight / number of features in that group.
FEATURE_WEIGHTS = {
    f: g.weight / len(g.features) for g in FEATURE_GROUPS for f in g.features
}

assert abs(sum(g.weight for g in FEATURE_GROUPS) - 1.0) < 1e-9, "Group weights must sum to 1.0"
assert abs(sum(FEATURE_WEIGHTS.values()) - 1.0) < 1e-9, "Feature weights must sum to 1.0"
# The model uses exactly 12 similarity features (2 Scoring load + 1 Efficiency +
# 4 Shot profile + 2 Playmaking/turnover + 1 Rebounding + 2 Defensive activity).
# This assertion exists specifically so a documentation/model mismatch (e.g. an
# incorrect "11 features" reference somewhere in the docs) is caught here
# rather than silently drifting from what the code actually does.
assert len(SIMILARITY_FEATURES) == 12, (
    f"Expected exactly 12 similarity features, found {len(SIMILARITY_FEATURES)}. "
    "If this changed intentionally, update every '12-feature'/'12-dimension' "
    "reference in README.md and docs/."
)

# tov_percent: a HIGHER value is a WORSE trait for the player (more
# turnovers), but similarity is symmetric regardless of "better/worse" —
# two high-turnover players are still similar to each other. No sign flip
# is needed for the distance calculation itself. This dict is used only by
# the archetype/trait layer, where direction matters for labeling.
TRAIT_DIRECTION = {
    "tov_percent": "lower_is_more_efficient",
}

# ---------------------------------------------------------------------------
# Winsorization boundaries (Section 5) — applied within each season, before
# standardization, to blunt the influence of extreme outliers (garbage-time
# lines, tiny-sample anomalies that still cleared the games/minutes bar).
# ---------------------------------------------------------------------------
WINSOR_LOWER_PCTILE = 0.01
WINSOR_UPPER_PCTILE = 0.99

# ---------------------------------------------------------------------------
# Similarity Index transform (Section 6)
# Similarity Index = max(0, 100 - SIMILARITY_SCALE * weighted_RMS_distance)
# ---------------------------------------------------------------------------
SIMILARITY_SCALE = 20

# ---------------------------------------------------------------------------
# Candidate filters (Section 6)
# ---------------------------------------------------------------------------
ERA_WINDOW_SEASONS = 5  # "same era" = +/- this many seasons

# ---------------------------------------------------------------------------
# Percentile trait dimensions (Section 8) — each maps to one or more raw
# features, averaged (after standardization) then converted to a
# season-relative percentile. Sign indicates whether the raw feature should
# be flipped before averaging (some are "lower is more of this trait").
# ---------------------------------------------------------------------------
#   dimension -> list of (feature, sign, weight). sign flips features where
#   "lower is more of this trait" (e.g. fewer turnovers). weight lets one
#   component dominate the composite when it's the truer signal of the
#   trait -- e.g. Playmaking is primarily about creating (assist rate), with
#   turnover avoidance as a secondary modifier, not an equal partner: an
#   equal-weight version mislabeled low-usage, low-turnover catch-and-shoot
#   players (who rarely create for others) as elite playmakers purely for
#   not turning the ball over. Note this is a DISPLAY/ARCHETYPE dimension
#   only -- the similarity engine's feature weights (config.FEATURE_GROUPS)
#   are unaffected and remain as specified.
TRAIT_DIMENSIONS = {
    "Scoring": [("pts_per_100_poss", 1, 1.0), ("usg_percent", 1, 1.0)],
    "Efficiency": [("ts_percent", 1, 1.0)],
    "Playmaking": [("ast_percent", 1, 0.75), ("tov_percent", -1, 0.25)],
    "Rebounding": [("trb_percent", 1, 1.0)],
    "Defensive Activity": [("stl_percent", 1, 1.0), ("blk_percent", 1, 1.0)],
    "Rim Pressure": [("percent_fga_from_x0_3_range", 1, 1.0), ("f_tr", 1, 1.0)],
    "Perimeter Profile": [("percent_fga_from_x3p_range", 1, 1.0), ("avg_dist_fga", 1, 1.0)],
}

# ---------------------------------------------------------------------------
# Archetype rules (Section 8) — evaluated in order; first match wins.
# Each rule is (label, function(traits: dict[str,float in 0..100]) -> bool).
# Traits are the percentile dimensions above, plus position group.
# Kept intentionally simple/deterministic/transparent, not exhaustive.
# ---------------------------------------------------------------------------
ARCHETYPE_HIGH = 75
ARCHETYPE_MID = 55
ARCHETYPE_LOW = 40

FALLBACK_ARCHETYPE = "Balanced {pos_group}"

# ---------------------------------------------------------------------------
# PCA / Galaxy (Section 11-E)
# ---------------------------------------------------------------------------
PCA_RANDOM_STATE = 42
PCA_N_COMPONENTS = 2

# ---------------------------------------------------------------------------
# I/O paths (resolved relative to repo root by the scripts that use this file)
# ---------------------------------------------------------------------------
RAW_DIR = "raw"
DATA_DIR = "data"
PUBLIC_DATA_DIR = "public/data"
