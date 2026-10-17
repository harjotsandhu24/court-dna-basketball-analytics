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

## Shooting Profile data (shipped)

**Source.** Basketball-Reference season statistics via the Kaggle dataset, regular season only. `Player Shooting.csv` gives, per player-season, the share of FGA and FG% in five **distance bands** (0–3 ft, 3–10 ft, 10–16 ft, 16 ft–3PT line, 3PT); `Player Totals.csv` supplies season FGA/FGM (the canonical aggregate `2TM/3TM…` row for traded players; team rows are never added to totals).

**What the court shows.** Distance rings, captioned “Simplified distance zones—not exact shot locations.” Nothing is inferred about left/right/corner.

**Primary vs. estimated numbers.** The primary numbers are the source's own share of attempts and band FG%. Estimated makes/attempts are secondary and labelled “Estimate”: attempts = round(share × season FGA), then makes = round(attempts × band FG%) — exactly the interface's calculation. Source shares are rounded to 3 decimals, so counts are approximate; displayed shares are never adjusted to total 100%.

**Zero / unavailable semantics** (all verified in `docs/shot_band_validation.md`):
- *Source-reported zero:* band share 0 **and** FG% blank (4,689 bands). Shown as “No attempts reported” and “—” FG%. In this dataset FG% is blank exactly when the share is 0 (no exceptions), but a one-shot band is invisible at 3-decimal shares for players with ≥ 1,000 FGA (8 bands), so “zero” is the source's statement, not independently proven.
- *Estimated below one:* share > 0 but the estimate rounds to 0 attempts → “fewer than 1 attempt by this estimate” (0 bands occur today; handled and tested).
- *Unavailable:* share missing → “—”; 58 low-minute player-seasons (≤ 24 MP) have no distribution.
- *Inconsistent:* share and FG% disagree about whether attempts exist (0 bands today) → flagged, never treated as zero.
- A band FG% of 0.0 with attempts is a real 0%.

**Incomplete distributions (documented exception D1).** For 331 of 14,511 player-seasons the five shares total outside 1 ± 0.0025 (the most 3-decimal rounding can explain): 236 below, 95 above, range 0.858–1.053, concentrated in 2015–16 → 2017–18 and 2022–23. The lowest display-eligible record is **Jaxson Hayes, 2022–23 (NOP, 610 MP, 156 FGA)**, shares totalling **0.968**: the source's own 2PT-range share is 0.814, but its four 2PT zones sum to 0.782, so ≈3.2% of attempts (≈5 shots) belong to no zone; the 3PT share (0.186 = 29/156) is exact. In every one of the 331 records, 2PT-range share + 3PT share equals 1 (within rounding), so the gap is always inside the 2PT zones. The dataset does not document why; the cause is unresolved at source. Handling: values are shown as reported, the court displays an “Incomplete/Inconsistent shot distribution” note, and the record is excluded from league baselines. Nothing is normalized.

**League baselines** (`public/data/shot_baselines.json`, step 6). Population: all canonical NBA player-seasons in the source for that season, any minutes, one row per player-season (traded players use the aggregate row only), excluding rows with a missing or inconsistent distribution. Regular season. Attempts per band are estimated (share × FGA); FG% is pooled makes ÷ pooled attempts, never a mean of player percentages; a blank FG% is zero makes only when the share is 0. Each season carries metadata (included/excluded counts, FGA coverage) and the interface prints the population and coverage — it never calls this “the league” without that qualifier. Coverage is high for most seasons but **70.4% of attempts in 2022–23, 85.7% in 2016–17 and 92.1% in 2015–16** because many records there are flagged; including the flagged rows would move any band share by at most 0.0076 in any band share in any season (see report). If a baseline ever uses a minutes cutoff, the label becomes “Estimated average among players with 250+ minutes.”

**Validation.** `python3 analysis/shot_band_validation.py` exits non-zero on any unexpected problem (duplicates, missing FGA, impossible percentages, share/FG% disagreement, share-total gaps not covered by D1, exported flags or baselines that disagree with an independent recomputation, displayed-estimate errors beyond 0.0025 × FGA + 5). Documented exceptions stay listed in `docs/shot_band_validation.md` / `.json`, including worst cases and every affected player-season for **both** estimate methods (unrounded and as displayed). Tests: `tests/test_shot_bands.py`.

## Real shot locations (all 30 regular seasons, 1996-97 to 2025-26)

**Source:** https://huggingface.co/datasets/cdechoch/nba-data-archive/blob/main/merged/shotdetail.parquet — uploaded as `shotdetail.parquet`, 64,300,730 bytes, sha256 `da631036eeaa78d9854f67c900139cfd45735eb5c97534ebfe34c895beb8a376`. Processed 2026-10-15 (UTC date recorded by the importer in `raw/shots/import_state.json`). The file covers source seasons 1996 to 2025 (starting year); COURT DNA uses the ending year (source 2008 = 2008-09), confirmed against game dates in every season. Game ids 002xxxxxxx are regular season, 004xxxxxxx playoffs.

```bash
pip install -r requirements.txt
python3 analysis/shot_import.py --parquet /path/to/shotdetail.parquet     # --seasons 2009 2026 for a subset; --force to reprocess; --stage-only to validate without publishing
python3 analysis/step6_export_frontend_data.py        # adds shot_dna.locations + exact season baselines; similarity pool unchanged
python3 analysis/shot_band_validation.py
```
The raw copy and staging live in `raw/shots/` (git-ignored, excluded from the ZIP). The import is deterministic and safe to rerun: outputs are built in `raw/shots/stage/`, validated, then swapped in; a failure keeps the previous valid files and records the retained source; stale season files are removed only after a successful replacement. It replaces the earlier single-season CSV import (nothing is appended, so no attempt is counted twice).

**Coverage (verified).** All 30 regular seasons pass validation and are integrated (11,635 player-season files + `public/data/shots/manifest.json`; 56 MB on disk, loaded one player-season at a time). 2025-26 is included: 1,230 games, 219,160 shots against 219,159 trusted, coverage 100.000%. Per-season games, shots, trusted totals, differences, exact/partial players and beyond-court counts are in `docs/shot_location_validation.md`. Playoffs (1996-97 to 2025-26) are inventoried there only; no trusted playoff totals exist in this project, so they are not integrated and never mixed into regular-season counts. No source season lies outside the app's range; nothing was rejected or quarantined.

**Reconciliation against Basketball-Reference.** League coverage is 99.91–100.001% in every season. Seasons with shortfalls: 2008-09 to 2016-17 (23–186 attempts short, nearly all three-point attempts; 2015-16 and 2016-17 are the largest at 156 and 186) and 2001-02 (12). The file has no event ids for the missing shots and the reason is unexplained. Players whose recorded attempts or makes are below the trusted season total (0–114 per season; 114 in 2016-17, 97 in 2015-16) are labelled "Recorded shots" with coverage; they are never padded or adjusted. 2003-04 and 2025-26 have one more shot in the file than the trusted total.

**Crosswalk** (`analysis/crosswalk/nba_to_bbr.csv`, tracked): NBA person id → Basketball-Reference id, never by name alone. 14,409 player-seasons verified by name + team + games + FGA/FGM/3PA/3PM evidence, 101 verified by statistics only because the name spelling differs, 1 ambiguous (Vincent Edwards 2019: 4 FGA, indistinguishable from another player; not mapped, so those 4 shots are omitted), none failed or unmatched. No NBA id maps to two Basketball-Reference ids across seasons, or the reverse. Traded players are matched on the combined season total and each team stint (franchise table for SEA→OKC, NOH/NOK/NOP, NJN→BKN, WSB→WAS, CHH/CHA/CHO, VAN→MEM).

**Coordinates.** Integer tenths of a foot, hoop at the origin, x < 0 = shooter’s left, y away from the baseline (baseline y = −52.5), in all seasons (orientation verified from corner shots; shot distance agrees with the stored distance for ≥ 99.9% of rows). SVG position = (250 + x, 52.5 + y). Shots outside |x| ≤ 250 or y outside −52…347 (backcourt heaves, 83–809 per season) are counted in their zone (three-pointers by shot type) but not drawn, never moved or clamped; the count is shown in "About this data". About a quarter of shots in many seasons (35% in 1996-97) sit exactly at the hoop centre (a source artifact; dots stack, no jitter). The three-point arc is drawn at 22 ft all round for 1996-97 and 23.75 ft (22 ft corners) afterwards. 2PT/3PT labels disagree with the drawn arc in 0–0.3% of shots; the source label decides.

**Zones** (one implementation in `lib/shotLocations.ts` and `analysis/shot_import.py`, tested against shared vectors in `tests/shot_zone_vectors.json`): a shot is a three-pointer if the source shot type says so; two-pointers are split by distance from the hoop: <3, <10, <16, ≥16 ft. Three-pointers are then split at exactly 30 ft: **Three-pointers (`x3p`)** are recorded threes under 30 ft from the basket and **Deep threes (`x3d`)** are recorded threes at 30 ft or more, tested on the integer coordinates (tenths of a foot) as `x² + y² ≥ 90,000`, so a shot exactly 30.0 ft out is deep and nothing is rounded. The two are mutually exclusive and sum to the original three-point total for every player-season, season baseline and league total. A recorded two-pointer is never deep, however far out (38 labelled twos in the file are 30+ ft out; they stay in 16 ft–3PT). Deep threes include end-of-period heaves (about 2.3% of three-point attempts overall, 1.7–3.0% by season) and shots beyond the drawn court, counted in their zone and never moved; they are not all intentional deep shooting. The same classifier produces import summaries, baselines, counts, dots and tooltips. Seasons without located shots keep the combined three-point zone: the deep split is never estimated from distance bands.

**How the deep-three summaries were produced (Phase 7).** The packed per-shot files already hold every coordinate and the three-point flag, so they were not changed (byte-identical to the Phase 5 shot-data ZIP, verified with `diff -r`). `analysis/shot_import.py` was extended (`ZONES` gained `x3d`) and rerun with `--force` from the original Parquet (`raw/shots/shotdetail.parquet`, sha256 above) followed by `step6_export_frontend_data.py`. If the Parquet is unavailable, the same summaries can be derived from the shipped shot files: for each file, deep = flag has the three bit and `x² + y² ≥ 90,000`. `tests/test_shot_locations.py::test_shipped_deep_threes_reconcile_with_the_per_shot_files_for_every_player_season` does exactly that for all 11,635 player-seasons and asserts it equals the regenerated summaries. Verified: 11,635/11,635 player-seasons have x3p + x3d equal to the file's three-point attempts and makes and zone totals equal to attempts and makes; versus the Phase 6 data the only differences in `public/data` are `shot_dna.locations.zones.x3p` (now under 30 ft) and the new `x3d`, in the season and career files, plus `shot_baselines.json`. `similarity_pool.json` and every other file are byte-identical (sha256 `b1d16cfa…2c26e`).

**Exact vs estimated vs recorded.** Exact: shot records cover the trusted season total. "Recorded shots" with coverage: fewer attempts than the trusted total. Estimated: only when a season has no location data (distance-zone fallback from Basketball-Reference, labelled estimated, with "Simplified distance zones—not exact shot locations."). The season average on the court uses the same zones over every integrated shot of that season (regular season, verified identities); the population and coverage are in "About this data".

**Data-use conditions.** The mirror’s card states Apache-2.0 and that the data were collected from stats.nba.com via shufinskiy/nba_data, arguing that statistics are not copyrightable. A repository licence does not by itself settle NBA.com terms of use or redistribution rights for `public/data/shots/`: this is **unresolved**. Confirm before publishing; to ship without shot locations, remove that folder and the `locations` fields (rerun step 6 without `data/shot_location_summary.json`).

**Not integrated:** hustle, screening, defensive tracking and possession/on-off data.

## Reviewed distribution exceptions

Five zone shares should total 100% ± 0.25 points (3-decimal rounding). `analysis/reviewed_distribution_exceptions.json` records the 331 player-seasons that do not (236 incomplete, 95 over-allocated): id, source values, the checksum of `Player Shooting.csv` they were reviewed against, and the unresolved source issue (the four 2PT zones do not sum to the source's own 2PT-range share; the cause is not documented). `shot_band_validation.py` **fails** on any new, changed or stale exception or a changed source checksum, never writes this file, and never approves what it finds in the same input. To accept a change: run `python3 analysis/propose_distribution_exceptions.py`, review `data/proposed_distribution_exceptions.json`, then copy the reviewed entries by hand. The current file was reviewed by the assistant in this session and still needs human sign-off.

## Supplementary sources (not in the app)

None of the supplementary data below has been downloaded, validated or used. **Nothing in this section has improved the model or any score.**

| Item | Status |
|---|---|
| Live access to stats.nba.com (nba_api endpoints ShotChartDetail, LeagueHustleStatsPlayer, SynergyPlayTypes, LeagueDashPtDefend) and api.pbpstats.com | **Failed from the build environment.** Every request (including the downloader's own, recorded in a ledger) ended in `ProxyError … Tunnel connection failed: 403 Forbidden` — the sandbox's outbound proxy refused the CONNECT tunnel. That is an environment/network-access restriction; it says nothing about how NBA.com or PBP Stats would answer a request from elsewhere. PBP Stats was reached only by that one failed request and its documentation/examples were not read; no possession or on/off tooling was built. |
| Parameter names/values | Checked against the nba_api repository (docs `parameters.md`, endpoint source, master as fetched 2026-10-14) — not against live responses. |
| Season coverage | **Unverified.** No start season for hustle, play-type or tracking data is asserted; the probe below determines what each endpoint returns. `--earliest-season` lets you record a coverage hint. |
| Downloader (`analysis/supplementary/download.py`) | Implemented; **mock-tested only** (`tests/test_supplementary.py`); never completed a live request. |
| Normalizers | Implemented and mock-tested: `shots.py` (dedupe, coordinate/flag validation, zones with heaves, reconciliation against trusted FGA), `normalize.py` (hustle / synergy / defense tables → `data/supplementary/*.csv` with explicit season id, season type, row scope and provenance). |
| Not built | NBA-id ↔ Basketball-Reference-id crosswalk; join into player-seasons; UI for any of these data; possession/on-off; any similarity use; a CLI for shot-chart normalization (functions only); handling of traded-player rows beyond refusing to sum them (the live row shape is unknown). |

### Downloader behavior (as implemented)
- **Requests:** one request per (dataset, season, season type[, player id | play type | defense category]). Regular season and playoffs are separate requests with separate cache keys. ShotChartDetail uses `ContextMeasure=FGA` (misses included) and `TeamID=0` per player-season. Synergy requires an explicit `--play-type` (Cut, Handoff, Isolation, Misc, OffScreen, Postup, PRBallHandler, PRRollman, OffRebound, Spotup, Transition, or `all`) and `--type-grouping` (default `offensive`).
- **Result sets** are selected by name (`Shot_Chart_Detail`, `HustleStatsPlayer`, `SynergyPlayType`, `LeagueDashPTDefend`) and must contain the required columns (from nba_api's `expected_data`; `PLAYER_ID` for Synergy player rows is assumed, not documented).
- **Cache reuse** requires: readable JSON, same schema version, identical endpoint and parameters, successful status, matching payload SHA-256, valid named result set, and row-count/status agreement. Anything else is quarantined (`*.corrupt-<time>`), logged as `cache_recovered`, and refetched. A failed `--refresh` leaves the old cache untouched.
- **Statuses** (ledger `status`): `ok`, `empty` (valid response, zero rows), `network_failure` (timeouts, 429, 5xx; retried with exponential backoff and `Retry-After`, bounded), `access_denied` (401/403/proxy tunnel refusal; **never retried**, run stops), `schema_failure` (never retried or cached), `unsupported_coverage` (HTTP 400/404/405/410/422, or season before `--earliest-season`; not retried). `cache_hit` is recorded separately.
- **Ledger** (`raw_supplementary/ledger.jsonl`): full request parameters, URL, endpoint, cache key/path, UTC retrieval time, attempts, status/detail, result-set names, selected set, row count, payload hash, downloader version.
- **Input validation:** seasons `YYYY-YY` with consecutive years; positive integer player ids; pace 1–60 s (default 2); timeout 5–120 s; retries 0–5; required options per dataset; `--raw-dir` may not be inside `public/` or `app/`.
- **Safety:** raw responses go to `raw_supplementary/` and normalized CSVs to `data/supplementary/` (both git-ignored). Nothing reads them in the build or the app, and no command here writes to `public/data`, so a failed probe cannot overwrite production data. Redistribution: a package licence is not a data licence — do not commit or serve raw NBA responses; review the NBA's terms before using the data in a public product.

### First local probe — Windows PowerShell
Run from the repository root on a machine that can reach stats.nba.com. Verified IDs (nba_api static player list): **Kobe Bryant = 977** (Luka Dončić = 1629029).

```powershell
cd C:\path\to\court-dna-basketball-analytics
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1          # if scripts are blocked: Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
python -m pip install -r requirements.txt

# 0) plan only, no network
python analysis\supplementary\download.py --dataset shotchart --seasons 2008-09 --player-ids 977 --dry-run

# 1) Kobe Bryant 2008-09 regular season, ALL field-goal attempts (made and missed)
python analysis\supplementary\download.py --dataset shotchart --seasons 2008-09 --player-ids 977

# 2) one recent hustle season
python analysis\supplementary\download.py --dataset hustle --seasons 2023-24

# 3) one explicitly selected offensive play type
python analysis\supplementary\download.py --dataset synergy --seasons 2023-24 --play-type Isolation

# 4) check the three results against explicit success criteria
python analysis\supplementary\probe_check.py --report raw_supplementary\probe_report.json

# 5) optional: normalize hustle + synergy to CSV
python analysis\supplementary\normalize.py
```
2023-24 is only a *recent* season chosen for the probe; whether the endpoint supports it (and earlier seasons) is exactly what the probe tests.

**Expected outputs:** `raw_supplementary\shotchart\<key>.json`, `raw_supplementary\hustle\<key>.json`, `raw_supplementary\synergy\<key>.json`, `raw_supplementary\ledger.jsonl`, `raw_supplementary\probe_report.json`; after step 5, `data\supplementary\hustle_2023-24_RegularSeason.csv` and `data\supplementary\synergy_2023-24_RegularSeason_Isolation.csv`.

**Success criteria** (`probe_check.py` exits 0): all three ledger entries `ok`; the Kobe response contains missed shots; no duplicate shots, invalid coordinates or invalid flags; Kobe's attempts reconcile with the Basketball-Reference FGA the app uses (1,712) within 2%; the synergy rows are all `Isolation` / offensive.

**If a request fails:** read `detail` in the ledger line printed by the command.
| status | meaning / action |
|---|---|
| `access_denied` | 401/403 or a proxy refusal. Not retried. Check VPN/proxy/firewall; try from a normal network. Report the `detail` text. |
| `network_failure` | Timeout/429/5xx after bounded retries. Wait and rerun (the cache makes this resumable); raise `--pace`. |
| `schema_failure` | The response did not match the assumed shape. **Do not edit data to fit**; send the ledger line (and the cache is not written) so the schema in `common.py` can be corrected. |
| `unsupported_coverage` | The endpoint rejected that season/parameter. Record it as unsupported, not as zero. |
| `empty` | Valid response with no rows — a real "no data", distinct from failure. |
A failed probe writes nothing outside `raw_supplementary\` and never changes `public\data` or any app data.


## Simulation data (Oct 2026, through 2025–26)

`public/data/sim/` (model.json, features/, teams/, brackets.json) and `public/data/honors.json` are generated by `analysis/sim/` (`games_build.py`, `bracket_build.py`, `run_all.py`, `export_data.py`). Game results for 1996–97 to 2025–26 (35,546 regular-season and 2,440 playoff games, 171 neutral-site games) are rebuilt from documented sources (85 files) and reconciled against team-season win totals (892 team-seasons, 0 mismatches). Every source's URL, retrieval date, checksum, coverage and the transformations applied are in `docs/model/source_log.json`; honors coverage is in `docs/model/honors_coverage.json`. Derived tables are in `raw/sim/*.csv`; raw downloads are not committed (`raw/sim/download/` is ignored).

Honors, champions and seeds are staged, validated and exported by `analysis/sim/honors_stage.py` and `export_data.py` from the source tables in `raw/honors_sources/` (Finals MVP, 2025–26 awards, champions, published seeds; URLs, retrieval date and table checksums in `sources.json`). The sources were read as text extractions through a page reader, not as downloaded files, so no raw-byte hashes exist; the staged CSV tables are the snapshot. The per-season, per-category status and every fact's sources are in `docs/model/honors_validation_report.md`, `honors_validation.json` and `honors_facts.csv`. Statuses: verified (two or more independent sources agree), single-source, derived (from game results), partial, missing, conflict, quarantined. Still missing: championship roster and ring lists (only Finals MVP winners have a roster fact), the NBA's own seed tables, and season-specific official tiebreak rules. `docs/model/honors_import.md` gives the links, templates and commands to supply them. See `docs/model/validation_report.md` for validation and `docs/model/frozen_choices.json` for the choices frozen before testing.
