# COURT DNA — Methodology

This is the complete analytical record behind COURT DNA: every rule, threshold,
and formula, with real numbers from the current build. The in-app
[Methodology page](/methodology) is the condensed, reader-friendly version of
this document.

## Data source

Player-season statistics from Basketball-Reference.com, covering NBA regular
seasons **2000-01 through 2025-26**. Six primary tables are combined:
`Advanced.csv`, `Per 100 Poss.csv`, `Player Shooting.csv`,
`Player Per Game.csv`, `Player Season Info.csv`, `Player Career Info.csv`.
Six supplementary tables (All-Star Selections, Player Award Shares, End of
Season Teams x2, Draft Pick History, Player Play By Play) are available in
`raw/` but not forced into the core model — awards/context are shown as
secondary information on Player DNA pages and never affect any calculation.

ABA/BAA-era rows are excluded by construction: those leagues ceased to exist
decades before this project's window, so `analysis/utils.py filter_nba_seasons()`
finds zero non-NBA rows in 2001-2026 (verified in `tests/test_pipeline.py`).

## Canonical player-season rule

A player traded mid-season appears in the raw data as an aggregate row (team
code `2TM`, `3TM`, `4TM`, or `5TM`) plus one row per individual team.
**The aggregate row is used as that player's single canonical full-season
profile whenever one exists.** Individual team rows are kept only in
`data/team_stints.csv`, for team-history display — never re-used in any
statistical calculation, which would double-count the season.

Verified with a real example from the dataset: James Harden's 2025-26 season
has a `2TM` row (2,438 minutes) plus `LAC` (1,559) and `CLE` (879) individual
rows. The canonical table uses exactly the 2TM row's 2,438 minutes — this
exact case is a regression test in `tests/test_pipeline.py`.

The math checks out exactly across the whole dataset: 16,130 raw in-range NBA
rows − 3,320 individual-team rows absorbed into 1,605 aggregate rows =
**12,810 canonical player-seasons**, with zero duplicate `(player_id, season)`
pairs (also a pytest assertion, not just a one-time check).

## Qualification thresholds

Centralized in `analysis/config.py` / `lib/config.ts` — nothing is
scattered through the codebase:

| Tier | Threshold | Used for |
|---|---|---|
| Comparison / Galaxy pool | ≥ 500 minutes and ≥ 20 games | Candidate pool for closest matches, Galaxy plot |
| Player detail / career display | ≥ 250 minutes | Gets a detail page; flagged `small_sample` if below the comparison bar |

A season below 250 minutes gets **no detail page at all** (too small a
sample to usefully display, e.g. a 5-game injury cameo). A season between
250-499 minutes (or under 20 games) gets a detail page but is visibly flagged
"small sample" and is **never** used as a candidate in someone else's closest
matches — tiny samples are never silently treated as equivalent to full
seasons.

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

For every season, restricted to that season's qualified pool:

1. **Winsorize** each raw feature at the 1st/99th percentile, to blunt
   tiny-sample and garbage-time outliers that still cleared the games/minutes
   bar.
2. **Standardize** (z-score) within that season only — never against the
   full 26-season history. League environments changed substantially over
   this window (three-point rate roughly tripled), so a player is only ever
   compared to how unusual their number was in their own league environment.
3. Sub-threshold ("small sample") rows are standardized against the
   *qualified pool's* mean/std for display purposes, but never contribute to
   that mean/std themselves.

## Similarity formula

Six feature groups, weights fixed by specification, divided evenly across
each group's features:

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

A score of 91 means 91/100 on this project's statistical similarity index —
**not** a 91% probability two players are alike. Identical standardized
vectors always score exactly 100 (tested). The formula is symmetric (tested).
**Awards, popularity, Hall of Fame status, draft position, names, teams, and
reputation never factor into this calculation** — verified by construction,
since the formula's only inputs are the 12 standardized features above.

Implemented twice — `analysis/similarity.py` (Python reference) and
`lib/similarity.ts` (browser runtime) — with **32 real player-season pairs**
checked for exact numerical agreement between the two in
`tests/similarity.parity.test.ts`.

### Candidate filters

- **Self-match exclusion**: a player-season is never matched to itself.
- **Include other seasons of the same player**: off by default; a toggle in
  the UI turns it on.
- **Season scope**: All seasons / Same season / Same era (±5 seasons,
  configurable via `ERA_WINDOW_SEASONS`).
- **Position filter**: Guard / Wing / Big, derived from Basketball-Reference's
  `pos` field.

## Explain the match

"Where they match" / "where they separate" language (`lib/explain.ts`) comes
from a **fixed template per feature**, selected by which features have the
smallest or largest weighted gap between two standardized vectors. No LLM,
no free text generation at runtime, no invented causal explanation (role
change, coaching, injury, effort) — only what the numeric gap supports.

## Percentile traits

Seven dimensions, each a weighted average of standardized features converted
to a season-relative percentile against the qualified pool:

| Dimension | Components |
|---|---|
| Scoring | `pts_per_100_poss`, `usg_percent` |
| Efficiency | `ts_percent` |
| Playmaking | `ast_percent` (75%), `tov_percent` inverted (25%) |
| Rebounding | `trb_percent` |
| Defensive Activity | `stl_percent`, `blk_percent` |
| Rim Pressure | `percent_fga_from_x0_3_range`, `f_tr` |
| Perimeter Profile | `percent_fga_from_x3p_range`, `avg_dist_fga` |

**A real bug found and fixed during development**: Playmaking was originally
an equal-weight average of assist rate and (inverted) turnover rate. That
mislabeled low-usage, low-turnover catch-and-shoot players as elite
playmakers purely for rarely turning the ball over — concretely, Klay
Thompson's 2015-16 season came out as "Primary Creator." Assist rate is now
weighted 75% against turnover-avoidance's 25%, correctly producing "Perimeter
Shot Creator" instead. This is a regression test in
`tests/test_pipeline.py::test_low_usage_low_turnover_shooter_not_mislabeled_creator`.

## Archetypes

Assigned by an **ordered set of deterministic rules** against the seven
percentiles plus a coarse position group (Guard/Wing/Big, from
`analysis/step4_archetypes.py::position_group()`). First matching rule wins;
`"Balanced {pos_group}"` is the documented fallback. No text generation.
Verified spot checks (also pytest-enforced): Stephen Curry 2015-16 → Primary
Creator; Rudy Gobert 2017-18 → Defensive Anchor.

Two to three trait tags per player-season are simply that season's
highest-percentile dimensions, worded as `"<Level> <Dimension>"` from a fixed
lookup (Elite/Strong/Solid/Modest by percentile band) — also fully
deterministic.

## Court Print

The signature graphic (`lib/courtPrint.ts`, `components/CourtPrint.tsx`) is a
direct visualization of the seven trait percentiles: seven evenly spaced
spokes around 360° (in a documented, fixed order), each spoke's length equal to
that dimension's percentile (0-100 mapped to a fixed min/max radius),
connected by a Catmull-Rom smoothed closed curve rather than a sharp-edged
radar polygon. Position-family hue (Guard/Wing/Big) subtly varies the color.
Every element traces to a real number; the accessible legend and `aria-label`
name each dimension and its value directly.

## Shot DNA

Built from Basketball-Reference's shot-range breakdown: 0-3 ft, 3-10 ft,
10-16 ft, 16 ft-3PT, and 3-point. **This is explicitly not a location-based
shot chart** — the source data has no x/y shot coordinates, only
attempt-share and FG% per distance range, and the UI labels it "Shot Range
Profile" for exactly this reason. Segment width = share of attempts; segment
color intensity = FG% in that range; both numbers are shown directly in the
UI and in a full `aria-label`, never implied by color alone. Supplementary
metrics (average shot distance, assisted 2PT/3PT rate, corner-3 rate, dunk
rate) are shown as labeled stat chips.

## Player Galaxy and PCA

Deterministic 2D PCA (`sklearn.decomposition.PCA`, fixed `random_state=42`,
`svd_solver='full'`) on the same 12 standardized features, computed
separately per season against that season's qualified pool only. **PCA is
for visualization only** — the Galaxy's "closest neighbor" highlighting uses
the full 12-dimensional similarity formula, never 2D distance, and the UI
says so directly.

Determinism verified by re-running the PCA step and diffing output
byte-for-byte (`tests/test_pipeline.py::test_deterministic_pca_on_rerun`).
Average combined variance explained by the 2 plotted components across all
26 seasons: **58.6%** (range 56.4%-61.1% by season) — reported honestly, not
oversold, and stated in the Galaxy page's own caption.

## Build a Five

Lineup Identity Card dimensions map onto the trait system: Creation =
Playmaking, Perimeter Shooting = Perimeter Profile, Rim Pressure = Rim
Pressure, Rebounding = Rebounding, Defensive Activity = Defensive Activity —
each simply averaged across the five selected player-seasons. **Ball
Dominance** is the one exception: it's not one of the seven precomputed trait
dimensions, so it's derived client-side from the standardized usage-rate
z-score via a standard normal CDF approximation (`lib/stats.ts`), documented
there as an approximation rather than the same season-rank computation used
elsewhere. Observations (e.g. "Multiple high-usage creators") are generated
from fixed threshold rules against the averaged dimensions — never a win/loss
or net-rating prediction, and the UI states this explicitly. Duplicate-player
selection is prevented by design.

## Limitations

- Box-score and rate statistics cannot capture every part of basketball
  performance — screening, spacing gravity, communication, and other
  off-ball value are not measured here.
- Steals and blocks are the only available defensive box-score signals; an
  incomplete measure of defensive activity, not a complete one.
- A high Similarity Index reflects these 12 specific features only — not a
  claim that two players play alike in every respect.
- See `docs/limitations.md` for the complete list, including photo coverage
  and PCA caveats.
