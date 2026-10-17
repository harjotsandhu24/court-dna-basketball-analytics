# Simulation and honors: software tests

These check that the **code** behaves as specified. They do not measure how accurate the predictions are; for that see `docs/model/validation_report.md`.

| Suite | What it covers |
|---|---|
| `tests/simEngine.test.ts` | Φ and inverse accuracy; seeded generator; identical opponents are even on a neutral court; reversing opponents gives complementary probabilities; series and length probabilities sum to 1; every sampled series ends legally; real-team opponent and "real rotation" warning; exactly three factors; same player on both teams allowed but not twice on one; wins within 0–82 (including an extreme lineup); same seed repeats; position swaps leave ratings, assessment and results unchanged; cache keys change with players, seasons, settings, seed, data and model version; missing/failed data become errors, not zeros; small samples lower confidence; cancellation returns null; every supported bracket's 8/4/2/1 shape, formats, feeders and home court; unsupported seasons refused; title and advancement probabilities add up; replaced slot taken over; historical path has no title odds; incomplete field blocks title odds; beyond-range warning; awards never imported by simulation or similarity code |
| `tests/simParity.test.ts` | TypeScript engine matches the Python reference within tight tolerances (`tests/sim_parity_fixture.json`) |
| `tests/simJobs.test.ts` | One job at a time, no duplicate on repeated clicks, late responses ignored, rapid edits, invalidate on lineup change, cancel, errors, progress clamping |
| `tests/simStorage.test.ts` | Saved settings: round trip, corrupted/unversioned/out-of-range values reset, no lineups or results ever stored |
| `tests/honors.test.ts` | Nash MVP in 2005 and 2006 only, a non-MVP season, traded players, shared winners, award introduction years, "no recorded honors" vs unavailable coverage, awards never alter inputs or similarity |
| `tests/test_sim_model.py` | Split ordering, leakage perturbation tests (z-scores local to a season; scrambling test-season results leaves training fits unchanged), no award/playoff features, bracket shape and formats for all 19 supported postseasons, best-of-five first rounds 1997–2002, honors data rules |
| `docs/qa/sim_ui_qa.py` | Chromium-only browser run (see below) |

## Browser checks

`docs/qa/sim_ui_qa.py`, output in `docs/qa/sim_ui_qa_output.txt`, screenshots in `docs/screenshots/phase10/`. **Chromium only** (Playwright); Firefox and Safari were not tested. It covers the four-link nav, disabled/enabled Simulate, collapsed settings, all three modes, cancel, duplicate click, late response after a lineup change, reproducible results, corrupted saved settings, reduced motion, keyboard, phone width with touch, and Nash's honors pages.

## Phase 10 revision: what the added tests cover

- Support check (TypeScript and Python, with a parity fixture): supported, limited and unsupported levels; small sample; mixed eras; net rating outside the fitted range; withheld numbers in season, series and bracket modes; `reveal` is part of the cache key.
- Uncertainty: luck-only range narrower than the full range; more runs leave the model-uncertainty part unchanged; no 80% claim for custom lineups.
- Bracket rules for all 30 postseasons: formats, best-of-five first rounds to 2002, Finals 2-3-2 then 2-2-1-1-1, neutral-site 2020, home court by record (seeds are display-only), replaced-slot inheritance, path mode has no title odds.
- Season mode: replace a real team or add one, no duplicate teams, results independent of slot order.
- Storage: settings v2, v1 migration (the old key is never deleted), invalid fields reset individually, saved lineups untouched.
- Honors: Finals MVP (one per Finals, on the champion), verified 2025–26 awards, "No recorded honors" versus incomplete coverage, Nash MVP 2004–05 and 2005–06 only, shared winners, recipients without an app profile, the roster-versus-appearance labels.
- Home-court ties: real host, better record, an uneven season series, then the labelled assumption (point differential, your lineup, its opponent); a custom lineup never uses a real series; the choice is part of the request and cache key; the saved `tieHome` setting defaults to point differential and resets alone if invalid.
- Staged honors import (`tests/test_honors_stage.py`): conflicting winners, Finals MVPs or champions stop the export; duplicate identities, incomplete teams, invalid seasons, broken joins and broken bracket progression are errors; unresolved players are quarantined; missing, single-source, derived, verified and conflict stay distinct; reruns write nothing; a failed write rolls back; a conflicting import leaves the app files byte-identical; templates are never overwritten; honors-only changes leave similarity, shot and simulation data untouched.
- Python: split ordering, leakage perturbation tests, bracket and format data, game-data reconciliation.

These results say the code behaves as specified. They are not model accuracy. The browser run (`docs/qa/sim_ui_qa.py`, Chromium only) is recorded in `docs/qa/sim_ui_qa_output.txt`.

## Phase 11 cleanup: what was added

Software behavior only (does the app do what it says); nothing here changes model accuracy or any factual data.

- Number-first results: `tests/simResultsPresentation.test.ts` (exact asterisk / "unlike the teams used to test the model" wording and when the asterisk applies), plus browser checks in all three modes including unsupported lineups (no "Show the numbers anyway", no range for unsupported lineups, asterisk note attached to the headline).
- Display names: new dimension names (Playmaking, Ball security & rebounding, "Steals, blocks & defensive rebounds") are display-only in `lib/sim/assess.ts`; the model's coefficient keys are untouched.
- Sample bracket: a separate rng stream, so advancement probabilities and Python parity are unchanged (`tests/simEngine.test.ts`).
- Worker failures: `tests/simClient.test.ts` with fake workers (crash, error event, cancel, stall timeout, stale result, retry/fallback); browser run covers crash and cancellation. The 60-second stall timeout is covered by unit tests only.
- Routes and load states: `tests/routes.test.ts`, `tests/loadState.test.ts` (strict ids and seasons, no `parseInt`, out-of-range seasons rejected); `docs/qa/reliability_qa.py` (83 checks: malformed links, missing records, failed downloads, retry, Back/Forward, refresh, photo replacement, blocked/corrupted storage, small-sample-only players).
- Missing statistics: `tests/courtPrintMissing.test.ts`, `tests/careerCallouts.test.ts` ("Unavailable", never a false 0; real zeros preserved).
- OpponentBuilder: `tests/opponentBuilder.test.ts` (repeated additions and stale updates; guards are precautionary, not a reproduced bug).
- Accessibility / layout: `docs/qa/a11y_perf_qa.py` (axe-core at desktop and phone widths, touch-target audit, CLS). Chromium only; not tested with NVDA, VoiceOver, Firefox or Safari. CLS numbers are headless-Chromium, localhost, unthrottled, 5 cold loads, median; they are not real-user data.

## Phase 11 final update (estimated record, defensive label, preview script)

Display and tooling changes only. No model, simulation, coefficient, similarity, qualification, honors, bracket, shot-data or dependency change.

- Estimated record: `lib/sim/record.ts` rounds `wins.mean` once and sets losses to 82 minus those wins; `tests/estimatedRecord.test.ts` covers 0–82, 41–41, 64–18, 82–0, the half-win boundary (63.49 / 63.5 / 63.51), a 0–82 sweep (whole numbers, total 82), null / NaN / Infinity / string / out-of-range input returning no record, the spoken text ("64 wins, 18 losses"), the asterisk and the visible note below it, the unsupported-lineup note with no range, ranges still labelled in wins, and no "Show the numbers anyway" button. A bug found while writing these tests: an invalid win total still let the details show a win range; the details are now withheld too.
- Defensive label: the lineup card row is "Defensive box-score signals — Based on steals and blocks." The trait is built from steal % and block % only (`analysis/config.py`; `tests/lineupDefenseLabel.test.ts` reads that file), so the note does not mention defensive rebounds. Scores are unchanged; the player-profile label stays "Steals & Blocks".
- `preview.ps1`: exercised under PowerShell 7.4 on Linux with stand-in `robocopy.exe`, `npm.cmd` and `npx.cmd` (paths with spaces and parentheses; happy path; non-empty preview; each overlap case; missing package.json; occupied port; failing copy, `npm ci`, `verify:data` and build; missing lockfile; checksum mismatch). That checks the script's logic. It was **not** run on Windows or Windows PowerShell 5.1, and not against the real robocopy or npm.
