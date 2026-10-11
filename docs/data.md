# COURT DNA — Data

## Source

**Dataset:** Sumitro Datta, ["NBA Stats (1947-present)"](https://www.kaggle.com/datasets/sumitrodatta/nba-aba-baa-stats),
Kaggle (underlying data from Basketball-Reference.com).

**License:** CC0: Public Domain.

**Archive:** `archive.zip`, 22 CSV files. COURT DNA uses 12 directly (6 more
available in `raw/` but not used in the core pipeline — see
`docs/methodology.md`). SHA-256 of the archive this project was built from:
`5be35c2837020214a98148f42c21f90bfba0ea1c75d2b3ab8ff6b91baaa4917f`. Per-file
checksums of the 12 CSVs used are in `public/data/meta.json` →
`source_checksums`.

The raw CSVs are not committed to this repository — for repository
cleanliness and source separation, not a licensing concern (it's CC0).

## Canonical player-season rule

A player traded mid-season appears as an aggregate row (`2TM`/`3TM`/etc.)
plus one row per team. The aggregate row is the canonical full-season
profile whenever one exists; individual rows are kept only for
team-history display. See `docs/methodology.md` for the full rule and a
real verification example.

## Reproducing the pipeline

```bash
# 1. Get the source archive from Kaggle, then extract it into raw/
python3 scripts/prepare_raw.py /path/to/archive.zip --verify-checksum

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run the pipeline, in order
cd analysis
python3 step1_validate_source.py
python3 step2_build_canonical.py
python3 step3_features_traits.py
python3 step4_archetypes.py
python3 step5_galaxy_pca.py
python3 step6_export_frontend_data.py
```

`scripts/prepare_raw.py` validates the archive contains all 22 expected
CSVs, extracts them into `raw/`, and never modifies the source archive.
`--verify-checksum` checks against the SHA-256 above; a mismatch means a
different (the dataset is periodically refreshed) export, not necessarily
an error. No pipeline step modifies `raw/` — each reads raw/intermediate
CSVs and writes to `data/` or `public/data/`.

## Current counts

| Metric | Value |
|---|---|
| Season range | 1996-97 – 2025-26 (30 seasons) |
| Unique players (profile page, ≥250 min in ≥1 season) | 2,093 |
| Unique players, full canonical dataset | 2,859 |
| Canonical player-seasons | 14,569 |
| Display-eligible player-seasons (≥250 min) | 11,635 |
| Comparison-eligible player-seasons (≥500 min, ≥20 games) | 10,121 |
| Flagged small-sample seasons | 1,514 |

Calculated by the pipeline (`step6`), not hardcoded. Comparison-eligible
seasons for the four earliest seasons: 1996-97 → 312, 1997-98 → 309,
1998-99 → 265 (lockout-shortened, same thresholds), 1999-00 → 312.

## Why the range begins in 1996-97

COURT DNA begins with the 1996-97 season, the starting point for the
historical advanced-stat coverage used by this model: every one of the 12
similarity features is present for every comparison-eligible player-season
from 1996-97 onward in this source. The range is set by `SEASON_MIN` in
`analysis/config.py` / `lib/config.ts`. It is not a claim that advanced
statistics did not exist earlier, and the project does not cover all of NBA
history.

## Output files (`public/data/`)

| Path | Contents |
|---|---|
| `meta.json` | Dataset counts, thresholds, source checksums |
| `players_index.json` | Search index |
| `seasons/{season}.json` | Every display-eligible player-season that year |
| `similarity_pool.json` | Comparison-eligible vectors, all seasons |
| `galaxy/{season}.json` | Player Map coordinates per season |
| `career/{player_id}.json` | One player's seasons, career-ordered |
| `photo_manifest.json` | Photo attribution records |

The app loads only the file a given view needs (`lib/dataLoader.ts`) and
never touches `raw/` or Python at runtime.
