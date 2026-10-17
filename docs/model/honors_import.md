# Honors, champions and seeds: sources, status and how to supply what is missing

Run everything from the `analysis` folder. Windows (PowerShell) uses `py`; macOS / Linux use `python3`.

## What is in the app now

| Category | Status | Basis |
| --- | --- | --- |
| Finals MVP, 1996-97 to 2025-26 | **Verified** (30 of 30) | NBA.com Finals MVP list and Basketball-Reference agree; the winner is on that season's champion |
| 2025-26 MVP, DPOY, ROY, 6MOY, MIP, All-NBA, All-Defensive, All-Rookie | **Verified** | NBA.com press release, Basketball-Reference and Wikipedia agree |
| Awards 1996-97 to 2024-25 | Single source | Kaggle "NBA Stats (1947-present)" tables; checks passed, no second source |
| All-Star selections | Single source | Same Kaggle tables (1999 had no game) |
| Champion team, every season | **Verified** | Game results, NBA.com season recaps, Finals MVP lists; 2026 also Basketball-Reference and Wikipedia |
| "Played in the playoffs for the champion" | Derived | Playoff game logs; says nothing about the roster |
| "On the championship roster" | **Partial** | Only the 30 Finals MVP winners. Full roster / ring lists are missing |
| Seeds, all 30 postseasons | **Provisional** | Published seeds from Wikipedia season pages (secondary, single source); progression-checked. Not the NBA's own tables |
| Home-court tiebreak rules | Partly assumed | Real hosts kept; better record; uneven season series; then a labelled assumption (default point differential). Season-specific official rules were not obtained |

Every fact's sources and status are in `docs/model/honors_facts.csv`; the per-season matrix is in `docs/model/honors_validation_report.md`.
The sources were read as text extractions through a page reader. Raw files could not be downloaded, so there are no raw-byte hashes;
`raw/honors_sources/sources.json` records the URLs, retrieval date and the SHA-256 of each staged table.

## Source links

- NBA.com 2025-26 awards: https://pr.nba.com/voting-results-2025-26-nba-regular-season-awards/
- NBA.com Finals MVP history: https://www.nba.com/news/history-finals-mvp-winners
- NBA.com season recaps index: https://www.nba.com/news/history-season-recaps-index
- NBA.com 2026 Knicks article: https://www.nba.com/news/how-2026-new-york-knicks-were-built
- Basketball-Reference Knicks 2026: https://www.basketball-reference.com/teams/NYK/2026.html
- Basketball-Reference Finals MVP: https://www.basketball-reference.com/awards/finals_mvp.html
- Basketball-Reference playoffs by season: https://www.basketball-reference.com/playoffs/NBA_2026.html (change the year)
- Roster / ring lists, one season: https://www.basketball-reference.com/teams/NYK/2026.html (roster table) or NBA.com champions history

Check each site's terms before reusing its data. Whether the NBA.com material may be redistributed inside the app has not been settled.

## What you must supply to close the remaining gaps

1. **Championship roster / ring lists** (30 seasons): `champion_roster.csv`.
2. **The NBA's own seed tables** (to replace the provisional Wikipedia seeds): `seeds_extra.csv`.
3. **Season-specific official tiebreak rules**: none can be imported; send the rule text per era and the code will be changed.
4. **A second source for 1997-2025 awards** (optional): `awards_extra.csv`, `end_of_season_teams_extra.csv`.

## Import files

Blank templates (header only) are in `raw/honors_import_templates/`. Copy the ones you fill in to `raw/honors_import/`.
Regenerate the templates with `py -m sim.honors_import --templates` (an existing file is never overwritten).

| File | Columns | Rules |
| --- | --- | --- |
| `champion_roster.csv` | `season,player_id,player[,team]` | one row per player on the championship roster; must belong to the verified champion |
| `finals_mvp.csv` | `season,player_id,player[,team]` | one row per season; cross-checked, a conflict stops the export |
| `awards_extra.csv` | `season,award,player_id,player` | `mvp`, `dpoy`, `roy`, `smoy`, `mip`; winners only (a tie is two rows); never voting placements |
| `end_of_season_teams_extra.csv` | `season,type,number_tm,player_id,player` | `All-NBA` / `All-Defense` / `All-Rookie`; `1st` `2nd` `3rd` (All-Rookie only 1st/2nd); 15 / 10 / 10 rows |
| `seeds_extra.csv` | `season,conference,seed,team` | `E` or `W`, seed 1-8, Basketball-Reference team abbreviation; must satisfy bracket progression |
| `champions_extra.csv` | `season,champion[,finals]` | independent champion record; a disagreement stops the export |

Season = the year the season ends (2025-26 is `2026`). Player ids are Basketball-Reference ids (for example `nashst01`).
An award recipient does not need an app profile: the fact is kept and attached to a profile only where one exists.

## Commands

```
cd analysis
py -m sim.honors_import --check
py -m sim.export_data
```

`--check` (also `py -m sim.export_data --check`) validates and writes nothing. `export_data` stages everything first, validates, then replaces
files one by one with rollback on failure. Any conflict, duplicate identity, invalid season, broken join or inconsistent bracket progression
makes it exit with status 1 and write **nothing**. Unresolved records are quarantined and listed. Rerunning with unchanged inputs changes no file.
Shot data and model files are never written. Manual corrections to the source tables: none.
