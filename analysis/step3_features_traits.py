"""
Step 3 — season-relative feature standardization, percentile traits, and
deterministic archetypes.

Why season-relative: league averages, pace, and role definitions shifted
substantially between 2000-01 and 2025-26 (three-point rate alone roughly
tripled). Comparing raw numbers across eras would silently favor recent
players. Every similarity feature and every trait percentile is therefore
calculated relative to the OTHER QUALIFYING PLAYERS IN THAT SAME SEASON,
never against the full 26-season pool.

Pipeline per season, restricted to the qualified pool (>=500 MP, >=20 G):
  1. Winsorize each raw feature at the 1st/99th percentile (season-relative)
     to blunt tiny-sample and garbage-time outliers.
  2. Standardize (z-score: (x - mean) / std) within that season.
  3. Convert standardized values into 0-100 percentiles within that season
     for the human-readable trait dimensions.
  4. Assign a deterministic archetype from percentile + position rules.

Sub-threshold rows (250-499 MP) are carried through for display but are
EXCLUDED from the season's mean/std/percentile calculation, and are flagged
small_sample=True. They still get standardized values (using the qualified
pool's season mean/std as the reference), so their trait bars and Court
Print are still comparable -- they just didn't influence the baseline.

Run: python3 analysis/step3_features_traits.py
"""
import sys

import numpy as np
import pandas as pd

import utils
import config


def winsorize_series(s: pd.Series, lower_q: float, upper_q: float) -> pd.Series:
    lo, hi = s.quantile(lower_q), s.quantile(upper_q)
    return s.clip(lower=lo, upper=hi)


def main():
    df = pd.read_csv(utils.data_path("canonical_player_seasons.csv"))

    df["qualified"] = (df["mp"] >= config.GALAXY_MIN_MINUTES) & (df["g"] >= config.GALAXY_MIN_GAMES)
    df["small_sample"] = (df["mp"] >= config.CAREER_DISPLAY_MIN_MINUTES) & (~df["qualified"])
    # Rows below the career-display floor are dropped entirely from the
    # analytical dataset (still present in canonical_player_seasons.csv for
    # completeness/audit, but not carried into the app's data layer).
    display_pool = df[df["mp"] >= config.CAREER_DISPLAY_MIN_MINUTES].copy()

    features = config.SIMILARITY_FEATURES

    # Defensive check before we begin: are there any missing values in the
    # qualified pool for a required feature? (Expected: zero, per data
    # exploration -- but this must never silently pass if that changes.)
    qualified_pool = display_pool[display_pool["qualified"]]
    for f in features:
        n_missing = qualified_pool[f].isna().sum()
        if n_missing:
            print(f"WARNING: {n_missing} missing values for required feature '{f}' "
                  f"in the qualified pool -- excluding those rows from similarity.", file=sys.stderr)

    std_cols = {f: [] for f in features}
    pct_cols = {dim: [] for dim in config.TRAIT_DIMENSIONS}
    small_sample_mask_all = []

    seasons = sorted(display_pool["season"].unique())
    for season in seasons:
        season_mask = display_pool["season"] == season
        season_df = display_pool[season_mask]
        qual_mask = season_df["qualified"]
        qual_df = season_df[qual_mask]

        # --- winsorize + standardize each raw feature, reference = qualified pool ---
        season_std = pd.DataFrame(index=season_df.index)
        for f in features:
            valid_qual = qual_df[f].dropna()
            if len(valid_qual) < 5:
                # Not enough qualified rows this season for this feature
                # (should not happen post-2001, but guarded anyway).
                season_std[f] = np.nan
                continue
            lo = valid_qual.quantile(config.WINSOR_LOWER_PCTILE)
            hi = valid_qual.quantile(config.WINSOR_UPPER_PCTILE)
            mean = valid_qual.clip(lo, hi).mean()
            std = valid_qual.clip(lo, hi).std(ddof=0)
            std = std if std > 1e-9 else 1.0  # guard against zero-variance columns

            clipped_all = season_df[f].clip(lo, hi)
            season_std[f] = (clipped_all - mean) / std

        for f in features:
            std_cols[f].extend(list(zip(season_df.index, season_std[f])))

        # --- trait percentiles (season-relative, qualified pool as reference) ---
        for dim, parts in config.TRAIT_DIMENSIONS.items():
            # weighted average of (sign-adjusted) standardized components
            acc = np.zeros(len(season_df))
            total_weight = sum(w for _, _, w in parts)
            for feat, sign, weight in parts:
                acc = acc + sign * weight * season_std[feat].fillna(0).values
            acc = acc / total_weight
            # percentile rank of each row's composite vs. the QUALIFIED pool's composite
            qual_positions = season_df.index.isin(qual_df.index)
            qual_acc = acc[qual_positions]
            ranks = np.array([
                (qual_acc <= v).sum() / max(len(qual_acc), 1) * 100
                for v in acc
            ])
            pct_cols[dim].extend(list(zip(season_df.index, ranks)))

    # --- assemble standardized feature columns back onto display_pool ---
    for f in features:
        s = pd.Series(dict(std_cols[f]))
        display_pool[f"std_{f}"] = display_pool.index.map(s)

    for dim in config.TRAIT_DIMENSIONS:
        s = pd.Series(dict(pct_cols[dim]))
        display_pool[f"pctile_{dim.lower().replace(' ', '_')}"] = display_pool.index.map(s)

    display_pool.to_csv(utils.data_path("features_traits.csv"), index=False)

    n_qualified = int(display_pool["qualified"].sum())
    n_small_sample = int(display_pool["small_sample"].sum())
    print(f"Display pool (>= {config.CAREER_DISPLAY_MIN_MINUTES} MP): {len(display_pool)}")
    print(f"Qualified comparison pool (>= {config.GALAXY_MIN_MINUTES} MP, >= {config.GALAXY_MIN_GAMES} G): {n_qualified}")
    print(f"Flagged small-sample display rows: {n_small_sample}")
    print("Wrote data/features_traits.csv")


if __name__ == "__main__":
    main()
