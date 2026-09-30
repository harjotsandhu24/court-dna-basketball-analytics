# COURT DNA — Known Limitations

Consolidated from throughout the project so nothing is buried in a single
paragraph. None of these are hidden from the in-app Methodology or Credits
pages either.

## Analytical

- **Box-score statistics are incomplete.** Screening, spacing gravity,
  communication, and other off-ball value are real parts of basketball that
  this project cannot measure, because the source data doesn't capture them.
- **Defensive activity ≠ defensive quality.** Steals and blocks are the only
  defensive signals available. A low-steal, low-block defender can still be
  an excellent defender; this project has no way to see that.
- **The Similarity Index is a distance metric, not a probability.** A score
  of 91 is 91/100 on this project's specific weighted formula — never
  "91% likely to be the same type of player" in any statistical-inference
  sense.
- **PCA (Player Galaxy) is an approximation.** Two components explain an
  average of 58.6% of total variance across seasons (range 56.4%-61.1%) —
  meaningful, but not the same as the full 12-dimension similarity
  calculation, which the app always uses for actual rankings.
- **Ball Dominance (Build a Five)** is derived from a z-score-to-percentile
  approximation (standard normal CDF), not the same season-rank computation
  used for the seven core trait dimensions — documented in `lib/stats.ts`
  and `docs/methodology.md`.
- **Correlation is not causation.** Career Evolution callouts state numeric
  changes only ("X increased N percentile points") and never claim a cause
  (role change, coaching, injury, effort) unless the data itself
  demonstrates it — which box-score rate stats alone cannot.

## Photo coverage

- **5 of 1,900 players (0.26%)** have a real, license-verified photo in this
  build. Every other player uses the fallback graphic. See
  `docs/photo-attribution.md` for the full, honest explanation of why —
  this sandbox cannot reach Wikimedia, so coverage could not be expanded
  here without fabricating results.
- The 5 real photo URLs could not be visually confirmed to load in this
  sandbox either (same network restriction), though the URL construction
  method is standard.

## Browser/device QA

- **Only Chromium was tested.** Firefox and WebKit could not be installed
  in this sandbox (network egress restriction). CSS used is standard and
  broadly supported, but that is not the same as verified cross-engine
  testing — treat Firefox/WebKit as untested, not "probably fine."
- Tablet/laptop breakpoints (1024px, 768px) and mobile (390px) were tested
  on Chromium only, for the same reason.

## Data

- **Awards/All-Star/accolade data exists in `raw/`** (Player Award Shares,
  All-Star Selections, End of Season Teams) but is not joined into the core
  pipeline or shown on Player DNA pages in this build — a deliberate scope
  decision to keep awards fully separate from anything that could be
  mistaken for influencing the model, not a technical limitation.
- **Career Info fields (height/weight/birth date) come from a single
  snapshot** in the source archive and are not re-verified against a live
  source.
- The underlying dataset (Sumitro Datta's "NBA Stats (1947-present)" on
  Kaggle, CC0: Public Domain) is clearly licensed for reuse, but the raw
  CSVs are still excluded from both the standalone and portfolio-facing
  repositories for repository cleanliness and source separation — a large
  third-party input archive isn't project source code. See `docs/data.md`
  for the exact dataset link and checksums.

## What was NOT verified

Stated plainly, not left implicit:
- Firefox and WebKit rendering/interaction (blocked by sandbox network
  restrictions).
- Live loading of the 5 real Wikimedia photo URLs (same restriction).
- Full-roster photo resolution via `scripts/resolve_photos.py` (would
  require real network access this sandbox doesn't have).
- Screen-reader software testing (VoiceOver/NVDA/JAWS) — semantic HTML,
  `aria-label`s, and focus order were checked programmatically, but not
  listened to with actual assistive technology.
