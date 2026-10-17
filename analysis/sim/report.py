"""Writes docs/model/validation_report.md from docs/model/validation_results.json so every number in the report is the file's number.
Usage (from analysis/): python -m sim.report"""
import json, os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
R = json.load(open(os.path.join(ROOT, "docs/model/validation_results.json")))
f2 = lambda x: f"{x:.2f}"; f3 = lambda x: f"{x:.3f}"; pc = lambda x: f"{100*x:.0f}%"
def ci(c): return f"{c[0]:.2f}–{c[1]:.2f}"

def wins_table(stage):
    w, rows = stage, []
    for name, k in (("Full real rotation", "wins_real"), ("Five starters + average bench", "wins_five")):
        x = w[k]
        rows.append(f"| {name} | {x['n']} | **{f2(x['rmse'])}** ({ci(x['rmse_ci'])}) | {f2(x['mae'])} ({ci(x['mae_ci'])}) | {x['bias']:+.2f} | {pc(x['coverage80'])} | {x['mean_range_width']:.1f} | {pc(x['coverage80_game_luck_only'])} / {x['mean_width_game_luck_only']:.1f} |")
    b = w["wins_baseline_league"]; p = w["wins_baseline_prior_season"]
    rows.append(f"| Baseline: average team (41 wins) | {w['wins_real']['n']} | {f2(b['rmse'])} | {f2(b['mae'])} | | | | |")
    rows.append(f"| Baseline: last season's wins (fitted) | {p['n']} | {f2(p['rmse'])} | {f2(p['mae'])} | | | | |")
    rows.append(f"| Reference only: the season's actual net rating | | {f2(w['wins_baseline_actual_net_rating']['rmse'])} | | | | | |")
    return "\n".join(rows)

def games(g):
    out = []
    for lab, k in (("Regular season", "regular"), ("Playoffs", "playoffs")):
        r = g[k]["real"]
        out.append(f"| {lab}, real rotations | {r['n']} | {f3(r['logloss'])} | {f3(r['brier'])} | {pc(r['accuracy'])} |")
        if "five" in g[k]:
            r = g[k]["five"]; out.append(f"| {lab}, five + average bench | {r['n']} | {f3(r['logloss'])} | {f3(r['brier'])} | {pc(r['accuracy'])} |")
    return "\n".join(out)

def series(s):
    out = []
    for lab, k in (("Real rotations", "real"), ("Five + average bench", "five")):
        r = s[k]; c = r["calibration"]
        out.append(f"| {lab} | {r['n']} | {f3(r['logloss'])} ({ci(r['logloss_ci'])}) | {f3(r['brier'])} | {pc(r['accuracy'])} | {c['slope']:.2f} | {c['ece']:.3f} |")
    for lab, k in (("Baseline: average team, home court only", "average_team_home_court"), ("Baseline: better record", "better_record"), ("Baseline: last season's net rating", "prior_season_net_rating")):
        b = s["baselines"][k]; out.append(f"| {lab} | {s['real']['n']} | {f3(b['logloss'])} | {f3(b['brier'])} | | | |")
    return "\n".join(out)

t, v = R["test"], R["validation_stage"]
sup = t["support"]["levels"]
lab = R["labels"]
md = f"""# Simulation model: validation report ({R['model_version']})

Data version `{R['data_version']}`. Generated from `docs/model/validation_results.json` by `analysis/sim/report.py`.
This report is about **model accuracy**. Whether the code does what it says is a separate question; see `docs/sim_software_tests.md`.

## 1. What is being estimated

The simulator uses what players did over a **completed season** to estimate how a hypothetical team would have done. It is **not a preseason forecast**: it does not know injuries, trades, or how players change. Everything below tests the model in that retrospective sense.

## 2. Protocol (chronological, frozen before the test)

- **Train** {R['splits']['train'][0]}–{R['splits']['train'][1]} (fitting). **Validation** {R['splits']['validation'][0]}–{R['splits']['validation'][1]} (every choice was made here). **Test** {R['splits']['test'][0]}–{R['splits']['test'][1]} (scored once, after the choices were frozen in `docs/model/frozen_choices.json`, sha256 `{R['frozen']['sha256'][:16]}…`).
- The final model is fitted on {R['final']['fit_seasons'][0]}–{R['final']['fit_seasons'][1]} and applied unchanged to the test seasons.
- **Already seen before the freeze:** {R['frozen']['already_seen_before_this_freeze']}. The earlier 2013–2015 "test" was inspected in the previous release, so those seasons are **development data**, not untouched test data. The new test seasons are 2020–2026 for games, series and brackets and 2021–22 to 2025–26 for 82-game win totals (the two shortened seasons have no 82-game total). Because team-season wins and net ratings for 2013–2026 had been looked at earlier, the win-total test is cleaner than before but is not a fully blind test. It is stated here rather than hidden.
- **What is known at prediction time.** Win totals use the same season's completed stats (retrospective, by design). Playoff predictions use only regular-season stats; no playoff games, results or awards enter any input. Each season's z-scores use only that season's regular-season pool. The game model's slope and home advantage are fitted on earlier seasons only.
- No tuning on the test set. Choices made on validation: feature set `{R['final']['feature_set']}`, ridge alpha {R['final']['alpha']}, whether playoffs need their own game parameters (they don't: validation log loss {f3(R['stage1']['game_model_choice']['val_playoff_logloss_regular_params'])} with the regular-season parameters against {f3(R['stage1']['game_model_choice']['val_playoff_logloss_playoff_params'])} with their own).
- Decision rules for the labels (written before scoring): `{json.dumps(lab['rules'])}`.

## 3. 82-game win totals

RMSE is the root-mean-square error in wins; MAE is the mean absolute error in wins. They are different numbers and are reported separately. "80% range" columns show how often the model's 80% range held and its average width in wins, for the full range (game luck plus model error) and for game luck alone.

### Test, seasons 2021–22 to 2025–26 (the test)

| Model | Team-seasons | RMSE (95% CI) | MAE (95% CI) | Bias | Range held | Width | Luck-only held / width |
|---|---|---|---|---|---|---|---|
{wins_table(t)}

**Reading it.** With real full rotations the model is clearly better than both baselines. With **five starters plus an average bench** (what the Build-a-Five page does) RMSE is {f2(t['wins_five']['rmse'])} and MAE {f2(t['wins_five']['mae'])}, and that **does not beat the prior-season baseline on RMSE** ({f2(t['wins_baseline_prior_season']['rmse'])}); its MAE ({f2(t['wins_five']['mae'])} against {f2(t['wins_baseline_prior_season']['mae'])}) is slightly lower, a difference well inside the confidence intervals. The pre-registered rule uses RMSE, so the label says it did not beat last season. It beats the average-team baseline ({f2(t['wins_baseline_league']['rmse'])}). Full rotation and five-plus-bench are different questions and are never mixed in one number. The earlier release reported a custom-lineup RMSE of **9.98 against a prior-season 9.84**; that also did not beat the baseline, and this release does not claim otherwise.

The five-plus-bench model also runs low on average (bias {t['wins_five']['bias']:+.2f} wins).

### Validation seasons 2014–2019 (development evidence, not a test)

| Model | Team-seasons | RMSE (95% CI) | MAE (95% CI) | Bias | Range held | Width | Luck-only held / width |
|---|---|---|---|---|---|---|---|
{wins_table(v)}

## 4. Game results (log loss, Brier, accuracy)

Log loss and Brier are lower-is-better. A coin flip is 0.693 and 0.250. Neutral-site games ({t['games']['excluded_neutral_site_games']} in the 2020 restart) are excluded because the model has a home-court term.

| Games, test seasons | n | Log loss | Brier | Accuracy |
|---|---|---|---|---|
{games(t['games'])}

Regular-season calibration slope for real rotations is {t['games']['regular']['real']['calibration']['slope']:.2f} (1.0 is ideal); the calibration table is in the JSON. Baselines: always-home log loss {f3(t['games']['regular']['baselines']['home_rate']['logloss'])}, prior-season net rating {f3(t['games']['regular']['baselines']['prior_season_net_rating']['logloss'])}; the whole-season net rating (an oracle that includes these games, not a prediction) is {f3(t['games']['regular']['baselines']['actual_season_net_rating_oracle']['logloss'])}.

## 5. Playoff series

| Series, test seasons | n | Log loss (95% CI) | Brier | Accuracy | Calibration slope | ECE |
|---|---|---|---|---|---|---|
{series(t['series'])}

With only {t['series']['real']['n']} series, intervals are wide. The calibration slope for real rotations ({t['series']['real']['calibration']['slope']:.2f}) is **below the pre-registered 0.75–1.25 band**, which means series probabilities were somewhat too extreme. For that reason series odds stay **Experimental** even for real teams. For five-plus-bench, slope {t['series']['five']['calibration']['slope']:.2f}: not reliable. Observed series lengths (4/5/6/7 games): {t['series']['length_observed']['4']}/{t['series']['length_observed']['5']}/{t['series']['length_observed']['6']}/{t['series']['length_observed']['7']}; mean games {t['series']['real']['mean_games_actual']:.2f} observed, {t['series']['real']['mean_games_model']:.2f} modelled.

## 6. Full-bracket title odds

Seven postseasons. Mean log score of the champion's predicted title probability (lower is better; 2.77 is a uniform guess over 16 teams): real rotations **{f2(t['bracket']['real_rotations']['mean_log_score'])}**, five-plus-bench {f2(t['bracket']['five_plus_average_bench']['mean_log_score'])}. The favourite won {pc(t['bracket']['real_rotations']['favorite_hit_rate'])} of the time (real rotations); the best regular-season record won {pc(t['bracket']['real_rotations']['best_record_hit_rate'])}. Seven seasons is far too few to establish calibration, so title odds are Experimental.

## 7. The support check

For a custom lineup the check asks whether the starters' mix of strengths looks like any real team the model was fitted on (Mahalanobis distance on nine starter features, Ledoit–Wolf covariance, cut-offs at the 95th and 99.5th percentiles of the {R['final']['support']['n']} fitted teams), whether the projected net rating is inside the fitted range ({R['final']['support']['net']['min']} to {R['final']['support']['net']['max']}), and whether any player has a small sample or the lineup mixes seasons six or more years apart.

- On the {t['support']['n']} real test teams: {sup['supported']['n']} supported, {sup['limited']['n']} limited, {sup['unsupported']['n']} unsupported.
- Net-rating RMSE on the test teams: supported {f2(sup['supported']['net_rmse'])}, limited {f2(sup['limited']['net_rmse'])}, unsupported {f2(sup['unsupported']['net_rmse'])} (the unsupported group is only {sup['unsupported']['n']} teams).
- By distance tercile (near / middle / far): {', '.join(f2(t['support']['by_distance_tercile'][k]['net_rmse']) for k in ('near','middle','far'))}. Spearman correlation between distance and absolute error is {t['support']['spearman_distance_vs_abs_error']:.3f}.

**What this does and does not show.** Real teams are all "inside" the range by construction, and distance did **not** predict error among them. So the check cannot be called validated: being inside the range does not prove a custom lineup is accurately estimated. What the check does reliably is flag lineups that no real team resembles (for example five all-stars; of random same-season lineups {R['support_synthetic']['random_same_season']['unsupported']} of 300 were unsupported and {R['support_synthetic']['random_same_season']['limited']} limited) and withhold their numbers by default. The check is blunt and can mark real teams "limited".

## 8. Two kinds of uncertainty

Game randomness is the luck in 82 games or a seven-game series; more simulated runs make that estimate steadier. Model uncertainty is the error between the model's average and what a real team did (win-total model error τ = {f2(R['final']['tau']['real'])} net points for real rotations, {f2(R['final']['tau']['five'])} for five-plus-bench, in the fitted data). Running more simulations does not shrink model uncertainty. The luck-only range covered {pc(t['wins_real']['coverage80_game_luck_only'])} of real teams (full rotation) and {pc(t['wins_five']['coverage80_game_luck_only'])} (five plus bench) against a nominal 80%, which is why the interface shows the luck-only range only as a labelled component and never as the headline. For real rotations the full range covered {pc(t['wins_real']['coverage80'])}; for five-plus-bench {pc(t['wins_five']['coverage80'])}. **No 80% claim is made for custom lineups**: nothing has measured it for invented lineups, so the interface says so in the result.

## 9. Mode labels shipped

- Season: **{lab['season']['status']}**. Historical real teams validated: {lab['season']['historical_teams_validated']}. Five + average bench validated: {lab['season']['five_avg_bench_validated']}. Five beats prior-season: {lab['season']['five_beats_prior_season']}.
- Series: **{lab['series']['status']}**. {lab['series']['reason']}
- Bracket: **{lab['bracket']['status']}**. {lab['bracket']['reason']}
- Expected offensive rating is shown ({lab['show_ortg']}); expected defensive rating is **withheld** (component R² on test {f2(t['components']['drtg_rel']['r2'])} < 0.30).

## 10. Limits

- Win totals use the same season's stats, so this is not a forecast and says nothing about how a lineup would do next year.
- The five-plus-bench model does not beat last season's wins as a predictor.
- Custom lineups have no ground truth. Everything for them stays Experimental.
- Team-season wins and net ratings for 2013–2026 were seen before the freeze (section 2).
- Championship roster membership is known only for Finals MVP winners; other champions are labelled "played in the playoffs for the champion". Finals MVP and 2025–26 awards were added from two or more sources read as text extractions (`docs/model/honors_validation_report.md`).
- Seeds are published seeds from one secondary source and are display-only. Home court follows the real host, then the better regular-season record (true in all 450 historical series, 27 of them tied), then an uneven season series, then a labelled simulation assumption for the remaining ties; the NBA's season-specific tiebreak rules were not obtained.
- Honors never enter similarity, scoring or simulation.
- Browser testing was Chromium only.
"""
open(os.path.join(ROOT, "docs/model/validation_report.md"), "w").write(md)
print("wrote", len(md.split("\n")), "lines")
