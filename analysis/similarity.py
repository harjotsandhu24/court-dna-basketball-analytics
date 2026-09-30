"""
COURT DNA similarity formula — reference implementation.

This is the canonical definition of the formula. lib/similarity.ts in the
frontend reimplements this exact logic in TypeScript (so the browser can
compute similarity at query time without a server) and tests/test_similarity_parity.py
checks that the two never drift apart.

Formula (see docs/methodology.md "Similarity formula" for the full writeup):
  1. Each of the 12 features has a fixed weight (config.FEATURE_WEIGHTS),
     derived from the 6 group weights in config.FEATURE_GROUPS.
  2. weighted_RMS_distance = sqrt( sum_i( weight_i * (a_i - b_i)^2 ) / sum_i(weight_i) )
     where a_i, b_i are the two players' SEASON-STANDARDIZED values for
     feature i (already z-scored per step3).
  3. Similarity Index = max(0, 100 - SIMILARITY_SCALE * weighted_RMS_distance)

This is a distance metric, not a probability model. A score of 100 means
identical standardized vectors; it does not mean "100% chance these
players are the same."
"""
import math

import config

FEATURES = config.SIMILARITY_FEATURES
WEIGHTS = config.FEATURE_WEIGHTS
TOTAL_WEIGHT = sum(WEIGHTS.values())


def weighted_rms_distance(vec_a: dict, vec_b: dict) -> float:
    """vec_a, vec_b: dict of feature_name -> standardized value."""
    acc = 0.0
    for f in FEATURES:
        a = vec_a.get(f)
        b = vec_b.get(f)
        if a is None or b is None:
            continue
        diff = a - b
        acc += WEIGHTS[f] * (diff * diff)
    return math.sqrt(acc / TOTAL_WEIGHT)


def similarity_index(vec_a: dict, vec_b: dict) -> float:
    dist = weighted_rms_distance(vec_a, vec_b)
    return max(0.0, 100.0 - config.SIMILARITY_SCALE * dist)


def feature_diffs(vec_a: dict, vec_b: dict) -> list:
    """Per-feature signed differences (a - b), for the 'explain the match'
    layer. Returns a list of (feature, weight, diff, abs_weighted_diff)
    sorted by abs_weighted_diff descending -- largest first = biggest point
    of separation; smallest = closest match."""
    out = []
    for f in FEATURES:
        a, b = vec_a.get(f), vec_b.get(f)
        if a is None or b is None:
            continue
        diff = a - b
        out.append({
            "feature": f,
            "weight": WEIGHTS[f],
            "diff": diff,
            "abs_weighted_diff": WEIGHTS[f] * abs(diff),
        })
    out.sort(key=lambda x: -x["abs_weighted_diff"])
    return out
