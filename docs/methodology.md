# COURT DNA — Methodology

The technical reference behind COURT DNA's player comparisons, traits, and
visualizations. The in-app [How It Works](/methodology) page is the
plain-language version of this document.

## Data source

Player-season statistics from Basketball-Reference.com (via the Kaggle "NBA
Stats" dataset), covering NBA regular seasons **2000-01 through 2025-26**.
Six primary tables are combined: `Advanced.csv`, `Per 100 Poss.csv`,
`Player Shooting.csv`, `Player Per Game.csv`, `Player Season Info.csv`,
`Player Career Info.csv`. Six supplementary tables are available in `raw/`
but not used in the core model. ABA/BAA-era rows are excluded by
construction.

## Canonical player-season rule

A player traded mid-season appears in the raw data as an aggregate row
(`2TM`, `3TM`, `4TM`, or `5TM`) plus one row per individual team. **The
aggregate row is the canonical full-season profile whenever one exists.**
Individual team rows are kept only in `data/team_stints.csv` for
team-history display, never used in any calculation — verified with James
Harden's 2025-26 season (`2TM`, 2,438 minutes) as a regression test.

16,130 raw in-range NBA rows − 3,320 individual-team rows absorbed into
1,605 aggregate rows = **12,810 canonical player-seasons**, with zero
duplicate `(player_id, season)` pairs.

## Qualification thresholds

Centralized in `analysis/config.py` / `lib/config.ts`.

| Tier | Threshold | Used for |
|---|---|---|
| Comparison pool | ≥ 500 minutes and ≥ 20 games | Candidate pool for similar players, Player Map |
| Profile page | ≥ 250 minutes | Gets a profile page; flagged "small sample" below the comparison bar |

A season under 250 minutes gets no profile page; between 250-499 minutes
(or under 20 games), it gets a page but is flagged and never used as a
comparison candidate.

## Features (12 total)

| Feature | Column |
|---|---|
| Scoring rate | `pts_per_100_poss` |
| Usage rate | `usg_percent` |
| True shooting % | `ts_percent` |
| Free-throw rate | `f_tr` |
| Avg. shot distance | `avg_dist_fga` |
| Rim attempt share | `percent_fga_from_x0_3_range` |
| Three-point attempt share | `percent_fga_from_x3p_range` |
| Assist rate | `ast_percent` |
| Turnover rate | `tov_percent` |
| Rebound rate | `trb_percent` |
| Steal rate | `stl_percent` |
| Block rate | `blk_percent` |

## Normalization

Within each season, restricted to that season's qualified pool: each
feature is winsorized at the 1st/99th percentile, then standardized
(z-scored) against that season only — never the full 26-season history,
since league environments shifted substantially over this window (e.g.
three-point rate roughly tripled). Small-sample rows are standardized
against the qualified pool's mean/std but never contribute to it.

## Similarity formula

| Group | Weight | Features |
|---|---|---|
| Scoring load | 20% | `pts_per_100_poss`, `usg_percent` |
| Efficiency | 10% | `ts_percent` |
| Shot profile | 25% | `f_tr`, `avg_dist_fga`, `percent_fga_from_x0_3_range`, `percent_fga_from_x3p_range` |
| Playmaking / turnover style | 20% | `ast_percent`, `tov_percent` |
| Rebounding | 10% | `trb_percent` |
| Defensive activity | 15% | `stl_percent`, `blk_percent` |

```
weighted_RMS_distance = sqrt( Σ weight_i × (a_i − b_i)² / Σ weight_i )
Similarity Index = max(0, 100 − 20 × weighted_RMS_distance)
```

A score of 91 is 91/100 on this project's similarity index — not a 91%
probability two players are alike. Identical vectors score exactly 100;
the formula is symmetric. Awards, popularity, Hall of Fame status, draft
position, names, teams, and reputation never factor in.

Implemented in both `analysis/similarity.py` and `lib/similarity.ts`,
checked against each other for exact agreement on 32 real player-season
pairs in `tests/similarity.parity.test.ts`.

**Candidate filters**: self-match exclusion; other-seasons toggle (off by
default); season scope (all / same season / same era ±5 seasons); position
filter (Guard/Wing/Big).

**Explain the match**: "where they match / separate" text is template-based
(`lib/explain.ts`), chosen by each feature's weighted gap — no LLM, no
invented causal explanation.

## Percentile traits

Seven dimensions, each a weighted average of standardized features
converted to a season-relative percentile:

| Dimension | Components |
|---|---|
| Scoring | `pts_per_100_poss`, `usg_percent` |
| Efficiency | `ts_percent` |
| Playmaking | `ast_percent` (75%), `tov_percent` inverted (25%) |
| Rebounding | `trb_percent` |
| Defensive Activity | `stl_percent`, `blk_percent` |
| Rim Pressure | `percent_fga_from_x0_3_range`, `f_tr` |
| Perimeter Profile | `percent_fga_from_x3p_range`, `avg_dist_fga` |

## Archetypes

Assigned by an ordered set of deterministic rules against the seven
percentiles plus a position group (Guard/Wing/Big); first match wins,
`"Balanced {pos_group}"` is the fallback. No text generation. Two to three
trait tags per player-season are that season's highest-percentile
dimensions, worded `"<Level> <Dimension>"` from a fixed lookup.

## Court Print

A direct visualization of the seven trait percentiles: seven evenly spaced
spokes around 360°, each spoke's length equal to that dimension's
percentile, connected by a smoothed closed curve. Position-group hue
(Guard/Wing/Big) varies the color. Every element traces to a real number.

## Shooting Profile

Built from Basketball-Reference's shot-range breakdown (0-3 ft, 3-10 ft,
10-16 ft, 16 ft-3PT, 3-point). Not a location-based shot chart — the source
has no x/y shot coordinates, only attempt-share and FG% per range. Segment
width = share of attempts; color intensity = FG%.

## Player Map and PCA

Deterministic 2D PCA (`sklearn.decomposition.PCA`, fixed `random_state=42`)
on the same 12 standardized features, computed per season against that
season's qualified pool. PCA is for visualization only — "most similar
player" highlighting uses the full similarity formula, never 2D distance.
Average variance explained by the 2 plotted components across all 26
seasons: **58.6%** (range 56.4%-61.1%).

## Build a Lineup

Lineup dimensions map onto the trait system (Passing & Creation =
Playmaking, Three-Point Shooting = Perimeter Profile, Attacking the Basket
= Rim Pressure, Rebounding, Defense = Defensive Activity), averaged across
the five selected players. "How Much They Handle the Ball" is derived from
a usage-rate z-score via a normal CDF approximation (`lib/stats.ts`), not
the same computation used elsewhere. Observations come from fixed threshold
rules — never a win/loss prediction.

## Limitations

- Box-score statistics cannot capture every part of basketball —
  screening, spacing gravity, communication, and other off-ball value are
  not measured here.
- Steals and blocks are the only available defensive signals — an
  incomplete measure of defensive activity.
- A high Similarity Index reflects these 12 features only, not a claim
  that two players play alike in every respect.

See `docs/limitations.md` for the complete list.
