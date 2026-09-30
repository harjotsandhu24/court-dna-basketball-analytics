# COURT DNA — QA

All results below are from an actual run against the current build, not
aspirational. Re-run any of them yourself with the commands shown.

## Python pipeline tests — 20/20 passing

**Prerequisite — these tests read `raw/*.csv` and `data/*.csv`, both of
which are intentionally excluded from Git** (see `docs/data.md`). A fresh
clone cannot run the pytest command below until those files exist. Generate
them first:

```bash
python3 scripts/prepare_raw.py /path/to/archive.zip --verify-checksum
pip install -r requirements.txt

cd analysis
python3 step1_validate_source.py
python3 step2_build_canonical.py
python3 step3_features_traits.py
python3 step4_archetypes.py
python3 step5_galaxy_pca.py
python3 step6_export_frontend_data.py
```

Only then does this work:

```bash
cd analysis && python3 -m pytest ../tests/test_pipeline.py -v
```

| Test | Verifies |
|---|---|
| `test_one_canonical_row_per_player_season` | Zero duplicate (player_id, season) rows |
| `test_traded_player_aggregate_selection_real_example` | James Harden 2025-26 (real 2TM/LAC/CLE example) resolves to the 2TM row |
| `test_no_multi_team_double_counting` | Every traded player-season's canonical MP equals the aggregate row's MP, checked across 100+ real cases |
| `test_nba_only_season_range` | League filter actually removes non-NBA rows when exercised against full history |
| `test_season_label_conversion` | 2001→"2000-01", 2026→"2025-26", edge cases |
| `test_qualification_thresholds` | Comparison pool strictly meets 500min/20g; sub-threshold display rows are flagged |
| `test_no_tiny_sample_in_qualified_pool` | No sub-500-minute season in the comparison pool |
| `test_no_nan_or_inf_in_qualified_similarity_features` | Zero NaN/Inf in any of the 12 features across the qualified pool |
| `test_trait_percentiles_in_valid_range` | All 7 trait dimensions stay within [0, 100] |
| `test_deterministic_percentiles_and_archetypes_on_rerun` | Byte-identical output across a full pipeline rerun |
| `test_deterministic_pca_on_rerun` | Byte-identical PCA coordinates across a rerun |
| `test_identical_vectors_return_max_similarity` | Similarity(v, v) = 100 exactly |
| `test_similarity_symmetry` | Similarity(a,b) = Similarity(b,a) |
| `test_similarity_index_bounded_0_100` | 200 random vector pairs, always in [0, 100] |
| `test_exactly_twelve_similarity_features` | Regression test for a real documentation bug where README/docs said "11 features" in nine places while the model has always used 12 |
| `test_feature_weights_sum_to_one` / `test_group_weights_match_spec` | Weights match the spec exactly |
| `test_known_archetype_spot_checks` (×2) | Curry 2015-16 → Primary Creator; Gobert 2017-18 → Defensive Anchor |
| `test_low_usage_low_turnover_shooter_not_mislabeled_creator` | Regression test for the Klay Thompson archetype bug (see methodology.md) |

## TypeScript tests — 47/47 passing

```bash
npm test
```

| File | Tests | Verifies |
|---|---|---|
| `similarity.parity.test.ts` | 33 | Python and TypeScript similarity engines agree on 32 real player-season pairs, exact to 3 decimal places |
| `similarity.behavior.test.ts` | 11 | Self-match exclusion, same-player-season toggle, season/era/position filters, result ordering, exactly-12-features regression check |
| `explain.test.ts` | 3 | Deterministic explanation generator: correct output for identical vectors, correctly surfaces the largest gap, caps at 3 items |

## Lint / typecheck / build

```bash
npm run lint       # ESLint — 0 errors, 0 warnings
npx tsc --noEmit    # TypeScript — 0 errors
npm run build       # Next.js production build — succeeds, all 9 routes
```

Four real ESLint errors were found and fixed during development (a new,
strict `react-hooks/set-state-in-effect` rule flagging legitimate
loading-state resets before an async refetch) — each fix is a targeted,
commented exception rather than a blanket rule suppression. See git history
/ `app/compare/page.tsx`, `app/galaxy/page.tsx`,
`app/player/[playerId]/[season]/page.tsx`.

## Responsive / overflow QA

Actual Playwright runs (not manual spot checks) across **4 widths × 8
routes = 32 combinations** (1440 / 1024 / 768 / 390px; Home, Player DNA,
Compare, Galaxy, Career, Build a Five, Methodology, Credits):

**One real bug found and fixed**: the Compare page's side-by-side Court
Prints used a fixed `grid-cols-2` with a 220px-wide graphic, overflowing by
9px at 390px width. Fixed by stacking to `grid-cols-1` below the `sm`
breakpoint and reducing the Court Print size to 200px. Re-verified: **0 of
32 combinations overflow** after the fix.

## Accessibility / interaction QA

Verified directly, not assumed:
- **Keyboard navigation**: Tab order reaches real interactive elements (nav
  links, search, filters); confirmed via `page.keyboard.press('Tab')` in
  Playwright landing on the expected element.
- **Focus visibility**: a 2px orange outline renders on every focused
  element (`:focus-visible` in `globals.css`, screenshotted and confirmed
  visible).
- **Reduced motion**: with `reduced_motion='reduce'` set, `.cp-reveal`'s
  computed `animation-duration` is `0s` (confirmed via
  `getComputedStyle`); the same trait/percentile numbers remain in the DOM
  text regardless of motion setting, so no information is lost.
- **Hover-independence**: all `:hover`/`:active`/`.card-interactive` states
  in `globals.css` are plain CSS rules, never gated behind
  `@media (prefers-reduced-motion: no-preference)` or a `motion-safe:`
  Tailwind variant — buttons and links look interactive (visible border,
  background, or color shift at rest, not just on hover) on every browser
  engine tested.
- **Alt text / ARIA**: Court Print and Galaxy SVGs both carry a full
  `role="img"` + `aria-label` describing every plotted value in words, not
  just the visual; photo fallbacks carry `aria-label="No photo available for
  {name}"`.

## Browser engine coverage — Chromium only, and why

Playwright's Chromium is installed in this build environment; **Firefox and
WebKit are not**, and `npx playwright install firefox webkit` fails with a
`403 Host not in allowlist` error from this sandbox's network egress
proxy — the same restriction that blocks live Wikimedia access (see
`docs/photo-attribution.md`). This is a genuine environment limitation, not
a skipped step: Firefox/WebKit QA was not performed and should not be
assumed to have been. All CSS used (flexbox, grid, standard SVG, CSS custom
properties) is broadly-supported and framework-standard, but that is not a
substitute for actually testing those engines.

## Photo fallback under real failure conditions

The 5 real Wikimedia photo URLs in `photo_manifest.json` also return `403`
in this sandboxed build environment (same network restriction). This
happened to be a genuine, live test of the fallback path: confirmed via
screenshot that the silhouette/initials fallback renders correctly with no
broken image icon and no layout shift when the real photo fails to load.

## Console errors

Zero JavaScript console errors or page errors on any of the 8 routes at any
tested width, beyond the expected `403` resource-load failures for the 5
real Wikimedia photo URLs (which the app handles via `onError` fallback, not
a crash).
