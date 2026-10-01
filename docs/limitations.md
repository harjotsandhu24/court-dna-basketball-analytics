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
  an average of 58.6% of variance across seasons (range 56.4%-61.1%) —
  the app always uses the full similarity formula for actual rankings,
  never 2D distance.
- **"How Much They Handle the Ball" (Build a Lineup)** is a z-score
  approximation, not the same season-rank computation as the other six
  trait dimensions.
- **Correlation is not causation.** Career Over Time callouts state
  numeric changes only, never a cause (role change, coaching, injury).

## Photo coverage

5 of 1,900 players have a real, license-verified photo; every other
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
