# COURT DNA — Known Limitations

## Analytical

- **Box-score statistics are incomplete.** Screening, spacing gravity,
  communication, and other off-ball value are real parts of basketball
  this project cannot measure.
- **Defensive activity ≠ defensive quality.** Steals and blocks are the
  only defensive signals available; a low-steal, low-block defender can
  still be an excellent one.
- **Style Match is a distance metric, not a probability.** A score of 91
  is 91/100 on this project's formula — not a 91% chance two players are
  alike.
- **The Player Map (PCA) is a visualization only.** Two components explain
  an average of 58.3% of variance across seasons (range 55.0%-61.1%) —
  the app always uses the full similarity formula for actual rankings,
  never 2D distance.
- **"How Much They Handle the Ball" (Build a Lineup)** is a z-score
  approximation, not the same season-rank computation as the other six
  trait dimensions.
- **Coverage starts in 1996-97.** That is the start of the historical
  advanced-stat coverage the 12-feature model relies on; earlier seasons
  are not included and the project is not all-time NBA history.
- **Eras are compared by style, not quality.** Matches use season-relative
  standardized traits; raw values from different eras are not necessarily
  directly comparable, and equal similarity does not mean equal talent.
- **1998-99 is a shortened (lockout) season** with the same qualification
  thresholds as every other season, so its comparison pool (265) is smaller.
- **Shot-distance level shift around 1999-00 / 2000-01.** Raw
  `avg_dist_fga` drops by roughly a foot at the boundary without a matching
  change in three-point share. Season-relative standardization neutralizes
  the level difference; raw cross-season shot distance is not interpreted.
- **Correlation is not causation.** Career Over Time callouts state
  numeric changes only, never a cause (role change, coaching, injury).

## Photo coverage

5 of 2,093 players have a real, license-verified photo; every other
player uses the fallback graphic. See `docs/photo-attribution.md`.

## Browser/device QA

Only Chromium was tested (360–1280px). Firefox and WebKit could not be
installed in this build environment and should be treated as untested,
not assumed equivalent.

## Data

- Award/All-Star data exists in `raw/` but is not joined into the model or
  shown on profile pages — a deliberate scope decision, not a technical
  limitation.
- Career Info fields (height/weight/birth date) come from a single source
  snapshot, not re-verified against a live source.
- The source dataset (Kaggle, CC0) is clearly licensed for reuse; raw CSVs
  are excluded from the repository for cleanliness, not licensing. See
  `docs/data.md`.

## Not verified

Firefox/WebKit rendering; live loading of the 5 real photo URLs;
full-roster photo resolution (requires network access this build
environment doesn't have); screen-reader software testing.

## Shooting Profile and supplementary data (Oct 2026)
- Visible wording: “These comparisons use recorded statistics. They miss off-ball impact and much of defense. A high Similarity Index means the measured profiles are close; it does not establish equal ability or identical playing styles.” An expandable note on the player, Compare and Methodology pages lists sources, coverage and missing features.
- Real shot locations exist for all 30 regular seasons 1996-97 to 2025-26 (`shotdetail.parquet`; see `docs/data.md`). Playoffs are not integrated. Coverage is 99.91–100.001% of the trusted league FGA per season; 2008-09 to 2016-17 are short by 23–186 attempts (mostly threes; cause unknown), so up to 114 players per season are labelled "Recorded shots" with coverage. About a quarter of shots sit exactly at the hoop centre in many seasons (stacked, never jittered); 83–809 shots per season beyond the drawn court are counted but not drawn; 0–0.3% of shots have a 2PT/3PT label that disagrees with the drawn arc. 1996-97 is drawn with the 22-ft line. One identity (Vincent Edwards 2019) is ambiguous and omitted. Upstream (NBA.com) redistribution rights are unresolved. Deep threes (30+ ft from the basket) include end-of-period heaves and are not all intentional deep shooting; seasons without located shots cannot show the split (none in-range today). The UI was tested in Chromium only.
- The 331 reviewed distribution exceptions were reviewed by the assistant and still need human sign-off (`analysis/reviewed_distribution_exceptions.json`).
- 331 player-seasons (236 under, 95 over; most in 2015–18 and 2022–23) have shot-zone shares that do not total 100% in the source. They are flagged on the court and excluded from league averages, never normalized. League averages are estimates over players with a complete distribution (coverage per season is shown; 2022–23 covers 70.4% of attempts).
- Hustle, play-type, defensive-tracking and on/off data were **not** added (and no shot coordinates were downloaded from NBA sources): the build environment's proxy refused every connection to the sources (HTTP CONNECT 403), so nothing was downloaded. Screening, spacing gravity, communication and most defense remain unmeasured; these limitations were not reduced.


## Simulation and honors (Oct 2026)

- Simulate uses completed-season performance. It is **not a preseason forecast**.
- Series and Playoff bracket are **Experimental**: custom lineups have no ground truth, and for real teams the series calibration slope on the 2020–2026 test (0.73) is below the pre-registered 0.75–1.25 band.
- A five plus an average bench does **not** beat last season's record on RMSE (10.50 against 10.12 on 2021–22 to 2025–26; earlier release 9.98 against 9.84). MAE is reported separately in `docs/model/validation_report.md`.
- The support check withholds numbers for lineups unlike any tested team, but it is blunt: distance did not predict error among real teams (Spearman about 0), so "supported" is not "validated", and some real teams are marked "limited".
- Model uncertainty cannot be reduced by simulating more runs. No 80% claim is made for custom lineups.
- Team-season wins and net ratings for 2013–2026 were looked at before the validation choices were frozen; the report says so. The old 2013–2015 test is development data.
- Expected defensive rating is withheld (test R² 0.21). "Defensive box-score signals" are not measured defensive impact.
- Game and bracket data run through 2025–26 (2019–20 played at one neutral site; no play-in). Seeds are the published seeds from Wikipedia season pages (secondary, single source, checked against bracket progression); the NBA's own seed tables were not obtained. Seeds are display-only. Home court follows the real host for series that happened, then the better regular-season record, then (equal records, two real teams) an uneven season series, then a labelled simulation assumption that you can change (default: better point differential; the NBA's season-specific tiebreak rules were not obtained). The choice of that final step used all-season tie evidence, including test seasons, and moved two bracket test log scores slightly (1.8030 to 1.8040 and 2.6766 to 2.6788); it was not tuned against model accuracy. Every champion is confirmed by at least two sources, 2025–26 included. Average coaching and full health are assumed.
- Three championship facts are kept apart: the team won (verified), the player appeared in a playoff game for it ("Played in the playoffs for the champion", derived from game results) and the player was on the championship roster ("On the championship roster", known only for the 30 Finals MVP winners; full roster and ring lists are missing). Awards for 1997–2025 come from one source (Kaggle); Finals MVP and all 2025–26 awards are confirmed by two or more sources, read as text extractions. The steps to supply what is missing are in `docs/model/honors_import.md`. Voting placements are never counted as wins.
- Only Chromium was used for browser testing.
