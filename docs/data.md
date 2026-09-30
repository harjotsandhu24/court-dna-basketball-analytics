# COURT DNA — Data

## Source

**Dataset:** Sumitro Datta, ["NBA Stats (1947-present)"](https://www.kaggle.com/datasets/sumitrodatta/nba-aba-baa-stats),
Kaggle. Underlying data originates from Basketball-Reference.com; this
Kaggle export is the actual `archive.zip` this project was built from.

**License:** the Kaggle dataset is published **CC0: Public Domain**.

**Archive:** `archive.zip`, **22 CSV files**. COURT DNA uses 12 of them
directly (plus 6 more available in `raw/` but not forced into the core
pipeline) — see `docs/methodology.md` "Data source." SHA-256 of the exact
archive this project was built from:
`5be35c2837020214a98148f42c21f90bfba0ea1c75d2b3ab8ff6b91baaa4917f`.
Per-file checksums of the 12 CSVs actually used are recorded in
`public/data/meta.json` → `source_checksums`.

**The raw CSVs are not committed to this repository.** This is for
repository cleanliness and source separation — `archive.zip` is a large
third-party input artifact, not project source code — **not** because its
license is unclear (it's CC0, unambiguously). See "Reproducing the
pipeline" below to regenerate everything from your own copy.

## Reproducing the pipeline

```
Download archive.zip from Kaggle (link above)
  ↓ scripts/prepare_raw.py <path-to-archive.zip>   extract + validate -> raw/*.csv (archive itself never modified)
  ↓ pip install -r requirements.txt
  ↓ analysis/step1_validate_source.py    validate schema + row counts, record SHA-256 checksums
  ↓ analysis/step2_build_canonical.py    canonical (player_id, season) merge, traded-player handling
  ↓ analysis/step3_features_traits.py    winsorize, standardize, percentile traits
  ↓ analysis/step4_archetypes.py         deterministic archetype + trait-tag assignment
  ↓ analysis/step5_galaxy_pca.py         deterministic 2D PCA per season
  ↓ analysis/step6_export_frontend_data.py   compact JSON -> public/data/
```

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

`scripts/prepare_raw.py` is a plain cross-platform Python script (`zipfile` +
`pathlib`, no shell-specific syntax) — it validates the archive contains all
22 expected CSVs, extracts them into `raw/`, and never modifies, moves, or
deletes the source archive itself. `--verify-checksum` checks the archive's
SHA-256 against the value above; a mismatch means you have a different
export of the same Kaggle dataset (it's periodically refreshed), not
necessarily an error.

Every pipeline step itself is also a plain, cross-platform Python script.
Nothing in `raw/` is ever modified by any step — each one reads
raw/intermediate CSVs and writes new files to `data/` or `public/data/`.

## Current real counts (from the committed `public/data/meta.json`)

| Metric | Value |
|---|---|
| Season range | 2000-01 – 2025-26 |
| Unique players (detail page, ≥250 min in ≥1 season) | 1,900 |
| Unique players, full canonical dataset (no minutes floor) | 2,584 |
| Canonical player-seasons (all samples) | 12,810 |
| Display-eligible player-seasons (≥250 min) | 10,236 |
| Qualified comparison/Galaxy player-seasons (≥500 min, ≥20 games) | 8,923 |
| Flagged small-sample display seasons | 1,313 |

These are calculated by the pipeline, not hardcoded — `step6` reads them
directly from the processed dataframes and writes them into `meta.json`.

## Frontend data artifacts (`public/data/`)

| Path | Contents | Approx. size |
|---|---|---|
| `meta.json` | Dataset-level counts, thresholds, source checksums | 2 KB |
| `players_index.json` | Search index: player_id → name, seasons, latest team | 264 KB |
| `seasons/{season}.json` | Every display-eligible player-season that year | ~600 KB each, 26 files |
| `similarity_pool.json` | Qualified-only vectors, all seasons flattened (cross-season candidate pool) | 3.8 MB |
| `galaxy/{season}.json` | PCA coordinates + variance explained, that season's qualified pool | ~40 KB each, 26 files |
| `career/{player_id}.json` | One player's display-eligible seasons, career-ordered | ~10 KB each, 1,900 files |
| `photo_manifest.json` | Verified photo attribution records | small |

Nothing loads the full dataset at once — `lib/dataLoader.ts` fetches and
caches exactly the season/player/pool file a given view needs. The
production app never touches `raw/` or Python at runtime.

## Canonical CSV schema (`data/with_archetypes.csv`)

One row per display-eligible `(player_id, season)`. Selected columns:

| Column | Meaning |
|---|---|
| `player_id` | Stable Basketball-Reference identifier (identity key, not name) |
| `season` | End year of the season (2001 = "2000-01") |
| `team` | Team code, or `2TM`/`3TM`/etc. for traded players |
| `qualified` | Meets the 500-min/20-game comparison pool bar |
| `small_sample` | Meets the 250-min display bar but not the comparison bar |
| `std_<feature>` | Season-standardized value of each of the 12 similarity features |
| `pctile_<dimension>` | 0-100 season-relative percentile for each of the 7 trait dimensions |
| `archetype` | Deterministic archetype label |
| `trait_tags` | Pipe-separated top 2-3 trait tags |

Full column list: `analysis/step6_export_frontend_data.py`.
