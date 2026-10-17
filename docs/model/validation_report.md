# Simulation model: validation report (sim-1.1.0)

Data version `sim-data-2026-10-16-v3`. Generated from `docs/model/validation_results.json` by `analysis/sim/report.py`.
This report is about **model accuracy**. Whether the code does what it says is a separate question; see `docs/sim_software_tests.md`.

## 1. What is being estimated

The simulator uses what players did over a **completed season** to estimate how a hypothetical team would have done. It is **not a preseason forecast**: it does not know injuries, trades, or how players change. Everything below tests the model in that retrospective sense.

## 2. Protocol (chronological, frozen before the test)

- **Train** 1997–2012 (fitting). **Validation** 2013–2019 (every choice was made here). **Test** 2020–2026 (scored once, after the choices were frozen in `docs/model/frozen_choices.json`, sha256 `b94cb5b4d2c7c930…`).
- The final model is fitted on 1997–2019 and applied unchanged to the test seasons.
- **Already seen before the freeze:** team-season wins and net rating, 2013-2026; game and series outcomes, 2013-2015. The earlier 2013–2015 "test" was inspected in the previous release, so those seasons are **development data**, not untouched test data. The new test seasons are 2020–2026 for games, series and brackets and 2021–22 to 2025–26 for 82-game win totals (the two shortened seasons have no 82-game total). Because team-season wins and net ratings for 2013–2026 had been looked at earlier, the win-total test is cleaner than before but is not a fully blind test. It is stated here rather than hidden.
- **What is known at prediction time.** Win totals use the same season's completed stats (retrospective, by design). Playoff predictions use only regular-season stats; no playoff games, results or awards enter any input. Each season's z-scores use only that season's regular-season pool. The game model's slope and home advantage are fitted on earlier seasons only.
- No tuning on the test set. Choices made on validation: feature set `no_height_no_creator_max`, ridge alpha 10.0, whether playoffs need their own game parameters (they don't: validation log loss 0.626 with the regular-season parameters against 0.629 with their own).
- Decision rules for the labels (written before scoring): `{"wins_rmse_ratio_max": 0.7, "wins_rmse_ratio_max_five": 0.85, "five_must_beat_prior_season": true, "range_coverage_band": [0.7, 0.9], "component_r2_min": 0.3, "series_min_test_n": 100, "calibration_slope_band": [0.75, 1.25]}`.

## 3. 82-game win totals

RMSE is the root-mean-square error in wins; MAE is the mean absolute error in wins. They are different numbers and are reported separately. "80% range" columns show how often the model's 80% range held and its average width in wins, for the full range (game luck plus model error) and for game luck alone.

### Test, seasons 2021–22 to 2025–26 (the test)

| Model | Team-seasons | RMSE (95% CI) | MAE (95% CI) | Bias | Range held | Width | Luck-only held / width |
|---|---|---|---|---|---|---|---|
| Full real rotation | 150 | **6.61** (5.84–7.41) | 5.19 (4.53–5.89) | +0.00 | 90% | 20.1 | 62% / 10.7 |
| Five starters + average bench | 150 | **10.50** (9.22–11.88) | 8.06 (7.10–9.21) | -2.12 | 78% | 24.5 | 43% / 10.6 |
| Baseline: average team (41 wins) | 150 | 12.31 | 10.12 | | | | |
| Baseline: last season's wins (fitted) | 150 | 10.12 | 8.34 | | | | |
| Reference only: the season's actual net rating | | 3.38 | | | | | |

**Reading it.** With real full rotations the model is clearly better than both baselines. With **five starters plus an average bench** (what the Build-a-Five page does) RMSE is 10.50 and MAE 8.06, and that **does not beat the prior-season baseline on RMSE** (10.12); its MAE (8.06 against 8.34) is slightly lower, a difference well inside the confidence intervals. The pre-registered rule uses RMSE, so the label says it did not beat last season. It beats the average-team baseline (12.31). Full rotation and five-plus-bench are different questions and are never mixed in one number. The earlier release reported a custom-lineup RMSE of **9.98 against a prior-season 9.84**; that also did not beat the baseline, and this release does not claim otherwise.

The five-plus-bench model also runs low on average (bias -2.12 wins).

### Validation seasons 2014–2019 (development evidence, not a test)

| Model | Team-seasons | RMSE (95% CI) | MAE (95% CI) | Bias | Range held | Width | Luck-only held / width |
|---|---|---|---|---|---|---|---|
| Full real rotation | 180 | **6.59** (5.90–7.28) | 5.21 (4.62–5.82) | +0.01 | 89% | 20.6 | 66% / 10.6 |
| Five starters + average bench | 180 | **8.86** (7.90–9.77) | 7.00 (6.19–7.85) | -0.66 | 84% | 24.8 | 49% / 10.6 |
| Baseline: average team (41 wins) | 180 | 12.44 | 10.21 | | | | |
| Baseline: last season's wins (fitted) | 178 | 9.60 | 7.72 | | | | |
| Reference only: the season's actual net rating | | 2.94 | | | | | |

## 4. Game results (log loss, Brier, accuracy)

Log loss and Brier are lower-is-better. A coin flip is 0.693 and 0.250. Neutral-site games (171 in the 2020 restart) are excluded because the model has a home-court term.

| Games, test seasons | n | Log loss | Brier | Accuracy |
|---|---|---|---|---|
| Regular season, real rotations | 8201 | 0.632 | 0.221 | 64% |
| Regular season, five + average bench | 8201 | 0.671 | 0.238 | 60% |
| Playoffs, real rotations | 507 | 0.662 | 0.234 | 60% |
| Playoffs, five + average bench | 507 | 0.703 | 0.252 | 58% |

Regular-season calibration slope for real rotations is 0.97 (1.0 is ideal); the calibration table is in the JSON. Baselines: always-home log loss 0.692, prior-season net rating 0.670; the whole-season net rating (an oracle that includes these games, not a prediction) is 0.607.

## 5. Playoff series

| Series, test seasons | n | Log loss (95% CI) | Brier | Accuracy | Calibration slope | ECE |
|---|---|---|---|---|---|---|
| Real rotations | 105 | 0.610 (0.53–0.69) | 0.210 | 70% | 0.73 | 0.073 |
| Five + average bench | 105 | 0.738 (0.64–0.84) | 0.264 | 60% | 0.18 | 0.166 |
| Baseline: average team, home court only | 105 | 0.682 | 0.245 | | | |
| Baseline: better record | 105 | 0.696 | 0.246 | | | |
| Baseline: last season's net rating | 105 | 0.710 | 0.253 | | | |

With only 105 series, intervals are wide. The calibration slope for real rotations (0.73) is **below the pre-registered 0.75–1.25 band**, which means series probabilities were somewhat too extreme. For that reason series odds stay **Experimental** even for real teams. For five-plus-bench, slope 0.18: not reliable. Observed series lengths (4/5/6/7 games): 17/31/32/25; mean games 5.62 observed, 5.53 modelled.

## 6. Full-bracket title odds

Seven postseasons. Mean log score of the champion's predicted title probability (lower is better; 2.77 is a uniform guess over 16 teams): real rotations **1.80**, five-plus-bench 2.68. The favourite won 43% of the time (real rotations); the best regular-season record won 29%. Seven seasons is far too few to establish calibration, so title odds are Experimental.

## 7. The support check

For a custom lineup the check asks whether the starters' mix of strengths looks like any real team the model was fitted on (Mahalanobis distance on nine starter features, Ledoit–Wolf covariance, cut-offs at the 95th and 99.5th percentiles of the 682 fitted teams), whether the projected net rating is inside the fitted range (-15.2 to 12.0), and whether any player has a small sample or the lineup mixes seasons six or more years apart.

- On the 210 real test teams: 188 supported, 17 limited, 5 unsupported.
- Net-rating RMSE on the test teams: supported 4.45, limited 5.55, unsupported 4.64 (the unsupported group is only 5 teams).
- By distance tercile (near / middle / far): 4.40, 4.81, 4.44. Spearman correlation between distance and absolute error is 0.002.

**What this does and does not show.** Real teams are all "inside" the range by construction, and distance did **not** predict error among them. So the check cannot be called validated: being inside the range does not prove a custom lineup is accurately estimated. What the check does reliably is flag lineups that no real team resembles (for example five all-stars; of random same-season lineups 70 of 300 were unsupported and 71 limited) and withhold their numbers by default. The check is blunt and can mark real teams "limited".

## 8. Two kinds of uncertainty

Game randomness is the luck in 82 games or a seven-game series; more simulated runs make that estimate steadier. Model uncertainty is the error between the model's average and what a real team did (win-total model error τ = 2.71 net points for real rotations, 3.59 for five-plus-bench, in the fitted data). Running more simulations does not shrink model uncertainty. The luck-only range covered 62% of real teams (full rotation) and 43% (five plus bench) against a nominal 80%, which is why the interface shows the luck-only range only as a labelled component and never as the headline. For real rotations the full range covered 90%; for five-plus-bench 78%. **No 80% claim is made for custom lineups**: nothing has measured it for invented lineups, so the interface says so in the result.

## 9. Mode labels shipped

- Season: **experimental**. Historical real teams validated: True. Five + average bench validated: False. Five beats prior-season: False.
- Series: **experimental**. No ground truth exists for invented lineups, so any result for one stays Experimental. Real-team series odds: series calibration slope is 0.73 (needs 0.75-1.25).
- Bracket: **experimental**. No ground truth exists for invented lineups, so any result for one stays Experimental. Real-team bracket odds rest on the series model: series calibration slope is 0.73 (needs 0.75-1.25).
- Expected offensive rating is shown (True); expected defensive rating is **withheld** (component R² on test 0.21 < 0.30).

## 10. Limits

- Win totals use the same season's stats, so this is not a forecast and says nothing about how a lineup would do next year.
- The five-plus-bench model does not beat last season's wins as a predictor.
- Custom lineups have no ground truth. Everything for them stays Experimental.
- Team-season wins and net ratings for 2013–2026 were seen before the freeze (section 2).
- Championship roster membership is known only for Finals MVP winners; other champions are labelled "played in the playoffs for the champion". Finals MVP and 2025–26 awards were added from two or more sources read as text extractions (`docs/model/honors_validation_report.md`).
- Seeds are published seeds from one secondary source and are display-only. Home court follows the real host, then the better regular-season record (true in all 450 historical series, 27 of them tied), then an uneven season series, then a labelled simulation assumption for the remaining ties; the NBA's season-specific tiebreak rules were not obtained.
- Honors never enter similarity, scoring or simulation.
- Browser testing was Chromium only.
