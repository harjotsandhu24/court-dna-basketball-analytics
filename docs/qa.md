# COURT DNA — QA

Results below are from an actual run against the current build. Re-run any
of them with the commands shown.

## Python tests — 27/27 passing

**Prerequisite**: these tests read `raw/*.csv` and `data/*.csv`, both
excluded from Git (see `docs/data.md`). Generate them first:

```bash
python3 scripts/prepare_raw.py /path/to/archive.zip --verify-checksum
pip install -r requirements.txt
cd analysis
python3 step1_validate_source.py && python3 step2_build_canonical.py && \
python3 step3_features_traits.py && python3 step4_archetypes.py && \
python3 step5_galaxy_pca.py && python3 step6_export_frontend_data.py
```

Then: `python3 -m pytest ../tests/test_pipeline.py -v`

| Test group | Verifies |
|---|---|
| Canonicalization | One row per (player_id, season); traded-player aggregate selection verified against a real example (James Harden 2025-26, 2TM/LAC/CLE); no multi-team double counting across 100+ cases |
| Season/league scope | NBA-only filtering; season-label conversion (2001→"2000-01"); every season 1996-97 → latest exists |
| Qualification | Comparison pool strictly meets the 500-min/20-game bar in every season, including lockout 1998-99; no tiny sample slips through |
| Feature integrity | Zero NaN/Inf across all 12 similarity features; all 7 trait percentiles stay within [0, 100]; exactly 12 similarity features (regression test) |
| Full-range integrity | Complete finite features for every qualified row; unit-variance standardization per season; stable player ids across the 2000 boundary; same-name players keep distinct ids |
| Determinism | Byte-identical percentiles, archetypes, and PCA coordinates across a full pipeline rerun |
| Similarity formula | Identical vectors score exactly 100; symmetric; bounded [0, 100]; weights match spec exactly |
| Archetypes | Spot-checked against real players (e.g. Curry 2015-16 → Primary Creator, Gobert 2017-18 → Defensive Anchor); regression test for a past mislabeling bug |

## TypeScript tests — 93/93 passing (6 files)

`npm test`

| File | Tests | Verifies |
|---|---|---|
| `similarity.parity.test.ts` | 33 | Python and TypeScript similarity engines agree on 32 real player-season pairs |
| `similarity.behavior.test.ts` | 11 | Self-match exclusion, filters, result ordering, feature-count regression |
| `explain.test.ts` | 3 | Deterministic match-explanation generator |
| `search.test.ts` | 14 | Search ranking, diacritics, same-name players keyed by id |
| `compareKey.test.ts` | 10 | `/compare` prefill keys: valid/malformed/out-of-range parsing, first and latest season, nonexistent player-seasons, same player+season blocked, same player different season allowed, same-name ids distinct |
| `crossEra.test.ts` | 22 | Window clamping at both season bounds, shared map layout, one season per match, shipped-data checks: 2001+ vectors unchanged (hash), qualification rule per season, stable ids |

## Lint / typecheck / build

```bash
npm run lint       # 0 errors, 0 warnings
npx tsc --noEmit    # 0 errors
npm run build       # succeeds, all 9 routes
```

## Responsive QA

Playwright runs across **6 widths × 8 routes = 48 combinations**
(360 / 390 / 430 / 768 / 1024 / 1280px; all major routes). **48/48 pass**,
zero horizontal overflow.

## Accessibility / interaction

- **Keyboard navigation**: Tab order reaches all interactive elements.
- **Focus visibility**: a visible outline renders on every focused element.
- **Reduced motion**: animation duration drops to 0 under
  `prefers-reduced-motion`; all trait/percentile numbers remain in the DOM
  regardless, so no information is lost.
- **Hover independence**: interactive states are plain CSS, never gated
  behind a motion-safe media query or Tailwind variant.
- **Alt text / ARIA**: Court Print and Player Map both carry full
  `aria-label`s describing plotted values in words; photo fallbacks carry
  descriptive alt text.

## Browser coverage

Chromium only. Firefox and WebKit could not be installed in this build
environment (network restriction) and were not tested — this should not be
assumed equivalent to being verified.

## Console errors

Zero JavaScript console or page errors across all routes and widths tested.

## Shooting Profile browser QA (Phase 5)

`python3 docs/qa/shot_ui_qa.py` drives real Chromium input (mouse, keyboard, touch) against a production build: tooltip show/update/hide and viewport clamping, click selection surviving hover previews, single-zone emphasis, dots on/off and All/Made/Missed (tooltip numbers unchanged), keyboard focus + Escape, touch (no sticky tooltip), independent Compare courts, season change clearing stale state, Kobe 2008-09, Luka 2018-19 and 2025-26, 1996-97 (22-ft line), simulated unavailable-data fallback, load error + retry, payload and timing (`docs/qa/shot_ui_metrics.json`). Screenshots: `docs/screenshots/phase5/`. Phase 6 (court visual refinement) added checks for the uniform #111820 court, boundary-only highlights (hover/selected/focus-dashed), band-wide hover targets (grid sweep), the 22-ft 1996-97 line and the new instructions. Phase 7 (deep threes) added: the 30-ft hover/select/keyboard/touch behaviour, zero-attempt and small-sample deep zones, partial-coverage labelling, the 1996-97 line, Compare independence and the five-zone fallback. Last run: 111/111 passed (Chromium only; Firefox and WebKit not tested). The "unavailable season" case is simulated by stripping `locations` in transit, because every in-range season has data. The sandbox blocks external hosts (web fonts), so those console errors are filtered.

Phase 7 automated checks (this build): `python3 -m pytest tests -q` 119 passed; `npx vitest run` 190 passed (30-ft boundary at 299/300/301 tenths and off-axis 3-4-5 points, two-pointers never deep, every shipped player-season and baseline reconciles, geometry vs classifier agreement); `npx tsc --noEmit`, `npx eslint .` and `npm run build` clean; `python3 analysis/shot_band_validation.py` exits 0.
Not run: Firefox/WebKit, real touch hardware or screen readers, a Vercel preview build, and any check of NBA.com's redistribution terms.
