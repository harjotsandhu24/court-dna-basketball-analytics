# COURT DNA — QA

Re-run any of the checks below with the commands shown. The Responsive QA,
Accessibility and Browser coverage sections below are from the earlier QA pass;
they were not re-run after the final surgical correction (Player Map filter
validation and wheel behavior, search punctuation matching, photo credit
popup, Compare setup, navigation).

## Python tests — 20/20 passing

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
| Season/league scope | NBA-only filtering; season-label conversion (2001→"2000-01") |
| Qualification | Comparison pool strictly meets the 500-min/20-game bar; no tiny sample slips through |
| Feature integrity | Zero NaN/Inf across all 12 similarity features; all 7 trait percentiles stay within [0, 100]; exactly 12 similarity features (regression test) |
| Determinism | Byte-identical percentiles, archetypes, and PCA coordinates across a full pipeline rerun |
| Similarity formula | Identical vectors score exactly 100; symmetric; bounded [0, 100]; weights match spec exactly |
| Archetypes | Spot-checked against real players (e.g. Curry 2015-16 → Primary Creator, Gobert 2017-18 → Defensive Anchor); regression test for a past mislabeling bug |

## TypeScript tests — 79 tests across 6 files

`npm test`

The per-file counts below are counted from the test files (the parity file
is 1 sanity test plus 1 test per fixture pair). **The pass/fail result must
come from a real `npm test` run**; the final correction pass was prepared in
an environment where the npm registry was unreachable, so it was not run
there. Record the actual result here after running it.

| File | Tests | Verifies |
|---|---|---|
| `similarity.parity.test.ts` | 33 | Python and TypeScript similarity engines agree on 32 real player-season pairs |
| `similarity.behavior.test.ts` | 11 | Self-match exclusion, filters, result ordering, feature-count regression |
| `explain.test.ts` | 3 | Deterministic match-explanation generator |
| `search.test.ts` | 22 | Player search ranking, partial names, diacritics, punctuation/separator-forgiving matching (`O'Neal`/`oneal`/`o neal`, `D'Angelo`, `Al-Farouq`), map vs all scope, cross-season resolution |
| `mapView.test.ts` | 9 | Player Map sizing (`mapHeight`, incl. the 80%-viewport cap: `mapHeight(1200, 900)` = 720), URL params, hit-testing, overlay placement |
| `loaders.test.ts` | 1 | A failed photo-manifest request is never cached; the next call refetches |

## Lint / typecheck / build

```bash
npm run lint
npx tsc --noEmit
npm run build
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
