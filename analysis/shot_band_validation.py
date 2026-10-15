"""Actionable validation of the distance-band shooting data that the app ships.

Exit status 0 = no unexpected problems. Documented exceptions stay visible in the report.
Hard failures (exit 1): duplicate player-seasons, missing FGA, impossible percentages,
share/FG% state inconsistencies, share-total deviations that are not in the reviewed exception list
(new, changed or stale entries, or a source-checksum mismatch), exported flags or league baselines that disagree with an independent recomputation,
displayed makes estimates outside the documented error bound for records with consistent shares.

Reviewed exceptions: analysis/reviewed_distribution_exceptions.json lists every reviewed player-season (ids, source values, source checksum, issue). Validation never writes that file and never accepts an exception it discovers itself. The source's own
2PT-range share + 3PT share equals 1 (within rounding) but the four 2PT distance zones sum to
more or less than the 2PT-range share, so some 2PT attempts are unassigned (or over-assigned)
to a zone. Such records are flagged in the UI and excluded from league baselines; shares are never normalized.

Run: python3 analysis/shot_band_validation.py      (needs pipeline steps 1-6 outputs)
Writes docs/shot_band_validation.json and docs/shot_band_validation.md
"""
import glob
import json
import math
import os
import sys

import numpy as np
import pandas as pd

import shot_bands as sb
import utils


REVIEWED_EXCEPTIONS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reviewed_distribution_exceptions.json")


def key(r):
    return f"{r['player_id']}_{int(r['season'])}"


def main(canon_path=None, out_dir=None, exceptions_path=None, manifest_path=None):
    canon = pd.read_csv(canon_path or utils.data_path("canonical_player_seasons.csv"))
    out_dir = out_dir or os.path.join(utils.repo_root(), "docs")
    failures, notes = [], []
    rep = {"canonical_player_seasons": int(len(canon)), "tolerance": sb.SHARE_ROUNDING_TOLERANCE}

    # 1. duplicates / completeness / impossible values
    dup = int(canon.duplicated(["player_id", "season"]).sum())
    rep["duplicate_player_seasons"] = dup
    if dup:
        failures.append(f"{dup} duplicate player-season rows")
    missing_dist = canon[canon[sb.SHARE_COLS].isna().any(axis=1)]
    rep["missing_shot_distribution"] = {"rows": int(len(missing_dist)),
                                       "max_mp": float(missing_dist["mp"].max()) if len(missing_dist) else None,
                                       "examples": [key(r) for _, r in missing_dist.head(5).iterrows()]}
    have = canon.drop(missing_dist.index).copy()
    no_fga = int(have["fga"].isna().sum())
    rep["rows_with_shots_but_no_fga"] = no_fga
    if no_fga:
        failures.append(f"{no_fga} rows with shot data but no FGA total")
    bad_pct = int(((have[sb.SHARE_COLS + sb.FG_COLS] < 0) | (have[sb.SHARE_COLS + sb.FG_COLS] > 1)).any(axis=1).sum())
    rep["impossible_percentages"] = bad_pct
    if bad_pct:
        failures.append(f"{bad_pct} rows with a percentage outside [0, 1]")

    # 2. band states (zero semantics)
    states = {"ok": 0, "source_none": 0, "inconsistent": 0, "unavailable": 0}
    zero_share_big_fga = 0
    below_one = 0
    for r in have.to_dict("records"):
        for s_col, f_col in zip(sb.SHARE_COLS, sb.FG_COLS):
            st = sb.band_state(r[s_col], r[f_col])
            states[st] += 1
            if st == "source_none" and r["fga"] >= 1000:
                zero_share_big_fga += 1  # a ≤1-shot band is invisible at 3-decimal shares; FG% blank is the evidence
            if st == "ok" and sb.js_round(r[s_col] * r["fga"]) == 0:
                below_one += 1
    rep["band_states"] = states
    rep["zero_share_bands_where_one_attempt_would_round_to_zero_share"] = zero_share_big_fga
    rep["bands_with_attempts_but_estimate_rounds_to_zero"] = below_one
    if states["inconsistent"]:
        failures.append(f"{states['inconsistent']} bands where share and FG% disagree about attempts")

    # 3. share totals vs the explicit, human-reviewed exception list (never auto-approved)
    have["total"] = have[sb.SHARE_COLS].sum(axis=1).round(4)
    have["status"] = have["total"].apply(sb.distribution_status)
    off = have[have["status"] != "ok"].copy()
    off["two_plus_three"] = (off["percent_fga_from_x2p_range"] + off["percent_fga_from_x3p_range"]).round(4)
    off["unlocated_share"] = (1 - off["total"]).round(4)
    ex_path = exceptions_path or REVIEWED_EXCEPTIONS
    reviewed = json.load(open(ex_path))
    man_path = manifest_path or utils.data_path("source_manifest.json")
    src_sha = json.load(open(man_path))["files"]["Player Shooting.csv"]["sha256"]
    rev = {e["id"]: e for e in reviewed["exceptions"]}
    cur = {key(r): r for _, r in off.iterrows()}
    new_ids = sorted(set(cur) - set(rev))
    stale_ids = sorted(set(rev) - set(cur))
    changed = []
    for i in sorted(set(cur) & set(rev)):
        r, e = cur[i], rev[i]
        if abs(float(r["total"]) - e["shares_total"]) > 1e-9 or abs(float(r["percent_fga_from_x2p_range"]) - e["x2p_range"]) > 1e-9 or abs(float(r["percent_fga_from_x3p_range"]) - e["x3p_range"]) > 1e-9:
            changed.append(i)
    sha_ok = reviewed["source"]["sha256"] == src_sha
    rep["share_total_ok_rows"] = int((have["status"] == "ok").sum())
    rep["share_total_deviations"] = {
        "incomplete": int((off["status"] == "incomplete").sum()), "overallocated": int((off["status"] == "overallocated").sum()),
        "reviewed_exceptions_in_file": len(rev), "matching_reviewed": len(set(cur) & set(rev)) - len(changed),
        "NEW_unreviewed": new_ids[:50], "CHANGED_since_review": changed[:50], "STALE_no_longer_exceptions": stale_ids[:50],
        "source_checksum_matches_review": sha_ok, "reviewed_source_sha256": reviewed["source"]["sha256"], "current_source_sha256": src_sha,
        "review": reviewed.get("reviewed"), "issue": reviewed.get("issue"),
        "min_total": float(have["total"].min()), "max_total": float(have["total"].max()),
        "by_season": {int(k): int(v) for k, v in off.groupby("season").size().items()},
    }
    if not sha_ok:
        failures.append("Player Shooting.csv checksum differs from the one the exceptions were reviewed against; re-review required")
    if new_ids:
        failures.append(f"{len(new_ids)} NEW unreviewed share-total deviations: " + ", ".join(new_ids[:5]))
    if changed:
        failures.append(f"{len(changed)} reviewed exceptions CHANGED since review: " + ", ".join(changed[:5]))
    if stale_ids:
        failures.append(f"{len(stale_ids)} reviewed exceptions are no longer deviations (list is stale): " + ", ".join(stale_ids[:5]))
    rep["share_total_deviation_records"] = [
        {"id": i, "player": r["player"], "season": int(r["season"]), "team": r["team"], "mp": float(r["mp"]), "fga": int(r["fga"]), "shares_total": float(r["total"]),
         "status": r["status"], "unlocated_share": float(r["unlocated_share"]), "x2p_plus_x3p": float(r["two_plus_three"]),
         "review": "reviewed" if i in rev and i not in changed else ("CHANGED" if i in rev else "NEW")}
        for i, r in sorted(cur.items(), key=lambda kv: kv[1]["total"])]
    hay = canon[(canon["player_id"] == "hayesja02") & (canon["season"] == 2023)].iloc[0]
    rep["trace_lowest_display_record"] = {
        "id": "hayesja02_2023", "player": "Jaxson Hayes", "team": hay["team"], "mp": float(hay["mp"]), "fga": int(hay["fga"]),
        "bands": {b: float(hay[f"percent_fga_from_{b}_range"]) for b in sb.BANDS},
        "source_2pt_range_share": float(hay["percent_fga_from_x2p_range"]),
        "sum_of_four_2pt_bands": round(float(sum(hay[f"percent_fga_from_{b}_range"] for b in sb.BANDS[:4])), 3),
        "shares_total": round(float(hay[sb.SHARE_COLS].sum()), 3), "three_point_share": float(hay["percent_fga_from_x3p_range"]),
        "conclusion": "Source inconsistency: the source's 2PT-range share (81.4%) is larger than the sum of its four 2PT zones (78.2%); ~3.2% of attempts (~5 of 156) are not assigned to any zone. 3PT share is exact (29/156). Cause is not documented in the dataset; unresolved at source.",
    }

    # 4. displayed vs unrounded estimates (both methods)
    ok_mask = have["status"] == "ok"
    shares = have[sb.SHARE_COLS].to_numpy(float)
    fgs = np.nan_to_num(have[sb.FG_COLS].to_numpy(float))
    fga = have["fga"].to_numpy(float)[:, None]
    att_u = shares * fga
    mk_u = att_u * fgs
    att_d = np.floor(shares * fga + 0.5)
    mk_d = np.minimum(att_d, np.floor(att_d * fgs + 0.5))
    have["makes_unrounded"] = mk_u.sum(axis=1)
    have["makes_displayed"] = mk_d.sum(axis=1)
    have["attempts_displayed"] = att_d.sum(axis=1)
    for m in ("unrounded", "displayed"):
        have[f"err_{m}"] = have[f"makes_{m}"] - have["fg"]
    have["err_attempts_displayed"] = have["attempts_displayed"] - have["fga"]

    def summarize(mask, col):
        e = have.loc[mask, col].abs()
        return {"n": int(mask.sum()), "median": round(float(e.median()), 3), "p95": round(float(e.quantile(.95)), 3), "p99": round(float(e.quantile(.99)), 3),
                "max": round(float(e.max()), 3), "n_ge_1": int((e >= 1).sum()), "n_ge_2": int((e >= 2).sum()), "n_ge_5": int((e >= 5).sum())}

    def worst(col, n=10):
        w = have.reindex(have[col].abs().sort_values(ascending=False).index).head(n)
        return [{"id": key(r), "player": r["player"], "season": int(r["season"]), "fga": int(r["fga"]), "fgm_reported": int(r["fg"]),
                 "makes_unrounded": round(float(r["makes_unrounded"]), 1), "makes_displayed": int(r["makes_displayed"]),
                 "attempts_displayed_minus_fga": int(r["err_attempts_displayed"]), "shares_total": float(r["total"]), "distribution": r["status"]}
                for _, r in w.iterrows()]

    rep["estimate_reconciliation_total_makes_vs_FGM"] = {
        "note": "error = sum of per-zone estimated makes − reported season FGM. 'displayed' replicates the interface (attempts rounded first, then makes).",
        "unrounded": {"all": summarize(have.index == have.index, "err_unrounded"), "consistent_shares": summarize(ok_mask, "err_unrounded"), "flagged_distribution": summarize(~ok_mask, "err_unrounded")},
        "displayed": {"all": summarize(have.index == have.index, "err_displayed"), "consistent_shares": summarize(ok_mask, "err_displayed"), "flagged_distribution": summarize(~ok_mask, "err_displayed")},
        "displayed_attempts_minus_FGA": {"all": summarize(have.index == have.index, "err_attempts_displayed")},
        "worst_unrounded": worst("err_unrounded"),
        "worst_displayed": worst("err_displayed"),
    }
    bound = 0.0025 * have["fga"] + 5.0
    over = have[ok_mask & (have["err_displayed"].abs() > bound)]
    rep["displayed_error_bound"] = "0.0025 × FGA + 5 (share rounding + five-zone count rounding), applied to records with consistent share totals"
    rep["displayed_error_bound_violations"] = [key(r) for _, r in over.iterrows()]
    if len(over):
        failures.append(f"{len(over)} consistent-share records exceed the displayed-estimate error bound")
    if (have["makes_displayed"] > have["attempts_displayed"]).any():
        failures.append("displayed makes exceed attempts")

    # 5. baselines: independent recomputation vs exported file; sensitivity to the exclusion
    exp_path = utils.public_data_path("shot_baselines.json")
    exp = json.load(open(exp_path))
    rep["baseline_population"] = exp["population"]
    rep["baseline_season_type"] = exp["season_type"]
    cov = []
    sens = 0.0
    for season, g in canon.groupby("season"):
        ent = exp["seasons"][str(int(season))]
        gg = g.dropna(subset=sb.SHARE_COLS).copy()
        gg["tot"] = gg[sb.SHARE_COLS].sum(axis=1).round(4)
        inc = gg[(gg["tot"] - 1).abs() <= sb.SHARE_ROUNDING_TOLERANCE + 1e-9]
        for b in sb.BANDS:
            s_, f_ = f"percent_fga_from_{b}_range", f"fg_percent_from_{b}_range"
            att = (inc[s_] * inc["fga"])
            pooled_fg = ((att * inc[f_].fillna(0)).sum() / att[inc[f_].notna()].sum()) if att[inc[f_].notna()].sum() > 0 else None
            share = att.sum() / inc["fga"].sum()
            e = ent["bands"][b]
            if abs(share - e["share"]) > 1e-4 or (pooled_fg is None) != (e["fg_pct"] is None) or (pooled_fg is not None and abs(pooled_fg - e["fg_pct"]) > 1e-4):
                failures.append(f"baseline mismatch {int(season)} {b}")
            # sensitivity: located attempts from ALL rows with data (incl. flagged), band share of located attempts
            att_all = gg[s_] * gg["fga"]
            loc_all = (gg[sb.SHARE_COLS].sum(axis=1) * gg["fga"]).sum()
            sens = max(sens, abs(att_all.sum() / loc_all - share))
        cov.append({"season": int(season), "player_seasons": ent["league_player_seasons"], "included": ent["players"],
                    "excluded_missing": ent["excluded_missing"], "excluded_incomplete": ent["excluded_incomplete"],
                    "excluded_overallocated": ent["excluded_overallocated"], "fga_coverage": ent["fga_coverage"]})
    rep["baseline_coverage_by_season"] = cov
    rep["baseline_max_share_change_if_flagged_rows_were_included"] = round(float(sens), 4)
    low = [c for c in cov if c["fga_coverage"] is not None and c["fga_coverage"] < 0.95]
    rep["baseline_seasons_below_95pct_fga_coverage"] = [(c["season"], c["fga_coverage"]) for c in low]
    for c in low:
        notes.append(f"baseline {c['season']} covers only {c['fga_coverage']*100:.1f}% of league FGA; disclosed in the UI label")

    # 6. exported player records carry the same status flags
    mism = 0
    checked = 0
    status_by_key = {key(r): r["status"] for _, r in have.iterrows()}
    for path in glob.glob(utils.public_data_path("seasons", "*.json")):
        data = json.load(open(path))
        recs = data if isinstance(data, list) else data.get("players", [])
        for r in recs:
            exp_status = status_by_key.get(f"{r['player_id']}_{r['season']}")
            checked += 1
            if exp_status != r["shot_dna"].get("distribution_status"):
                mism += 1
    rep["exported_records_checked"] = checked
    rep["exported_status_mismatches"] = mism
    if mism or not checked:
        failures.append(f"exported distribution_status mismatches: {mism} of {checked}")

    # 7. similarity inputs untouched
    rep["similarity_pool_sha256"] = utils.sha256_of_file(utils.public_data_path("similarity_pool.json"))

    rep["failures"] = failures
    rep["notes"] = notes
    rep["reviewed_exceptions"] = len(rev)
    out_json = os.path.join(out_dir, "shot_band_validation.json")
    json.dump(rep, open(out_json, "w"), indent=1)
    write_markdown(rep, os.path.join(out_dir, "shot_band_validation.md"))
    print(json.dumps({k: rep[k] for k in ("duplicate_player_seasons", "impossible_percentages", "band_states", "share_total_deviations", "exported_status_mismatches", "failures", "notes")}, indent=1, default=str)[:3500])
    return 1 if failures else 0


def write_markdown(rep, path):
    r = rep["estimate_reconciliation_total_makes_vs_FGM"]
    L = ["# Shot-band validation report", "", "Generated by `python3 analysis/shot_band_validation.py` (exit status 1 on any unexpected problem).", ""]
    L += [f"- Canonical player-seasons: {rep['canonical_player_seasons']}; duplicates: {rep['duplicate_player_seasons']}; impossible percentages: {rep['impossible_percentages']}",
          f"- Missing shot distribution: {rep['missing_shot_distribution']['rows']} rows (max {rep['missing_shot_distribution']['max_mp']} MP)",
          f"- Band states (rows × 5 bands): {rep['band_states']}",
          f"- Bands with attempts whose displayed estimate rounds to 0: {rep['bands_with_attempts_but_estimate_rounds_to_zero']}",
          f"- Zero-share bands in records with ≥1000 FGA (a single shot would be invisible at 3-decimal shares; blank FG% is the evidence of zero): {rep['zero_share_bands_where_one_attempt_would_round_to_zero_share']}",
          "", "## Share totals", "",
          f"Shares are rounded to 3 decimals, so five shares may total 1 ± {rep['tolerance']}. Outside that: {rep['share_total_deviations']['incomplete']} incomplete, {rep['share_total_deviations']['overallocated']} over-allocated "
          f"(reviewed exceptions matching: {rep['share_total_deviations']['matching_reviewed']}/{rep['share_total_deviations']['reviewed_exceptions_in_file']}; new: {len(rep['share_total_deviations']['NEW_unreviewed'])}; changed: {len(rep['share_total_deviations']['CHANGED_since_review'])}; stale: {len(rep['share_total_deviations']['STALE_no_longer_exceptions'])}). Range {rep['share_total_deviations']['min_total']}–{rep['share_total_deviations']['max_total']}.",
          "", "### Lowest display-eligible record (the “96.8%” case)", "", f"`{rep['trace_lowest_display_record']['id']}`: {rep['trace_lowest_display_record']['conclusion']}", "",
          "Bands: " + json.dumps(rep["trace_lowest_display_record"]["bands"]) + f"; 2PT-range share {rep['trace_lowest_display_record']['source_2pt_range_share']} vs sum of four 2PT zones {rep['trace_lowest_display_record']['sum_of_four_2pt_bands']}.",
          "", "Full list of affected records: `docs/shot_band_validation.json` → `share_total_deviation_records`.",
          "", "## Estimated counts vs reported season FGM (|error| in makes)", "", "| method | group | n | median | p95 | p99 | max | ≥1 | ≥2 | ≥5 |", "|---|---|---|---|---|---|---|---|---|---|"]
    for m in ("unrounded", "displayed"):
        for g in ("all", "consistent_shares", "flagged_distribution"):
            s = r[m][g]
            L.append(f"| {m} | {g} | {s['n']} | {s['median']} | {s['p95']} | {s['p99']} | {s['max']} | {s['n_ge_1']} | {s['n_ge_2']} | {s['n_ge_5']} |")
    L += ["", "Worst cases (displayed method):", "", "| player-season | FGA | FGM | est. makes (displayed) | shares total | distribution |", "|---|---|---|---|---|---|"]
    for w in r["worst_displayed"]:
        L.append(f"| {w['player']} {w['season']} ({w['id']}) | {w['fga']} | {w['fgm_reported']} | {w['makes_displayed']} | {w['shares_total']} | {w['distribution']} |")
    L += ["", "Worst cases (unrounded method):", "", "| player-season | FGA | FGM | est. makes | shares total | distribution |", "|---|---|---|---|---|---|"]
    for w in r["worst_unrounded"]:
        L.append(f"| {w['player']} {w['season']} ({w['id']}) | {w['fga']} | {w['fgm_reported']} | {w['makes_unrounded']} | {w['shares_total']} | {w['distribution']} |")
    L += ["", f"Displayed-error bound ({rep['displayed_error_bound']}) violations: {len(rep['displayed_error_bound_violations'])}.",
          "", "## League baselines", "", f"Population: {rep['baseline_population']}; season type: {rep['baseline_season_type']}; attempts are estimates; FG% pooled from pooled makes/attempts.",
          f"Seasons with < 95% FGA coverage: {rep['baseline_seasons_below_95pct_fga_coverage']}.",
          f"Largest change in any band share if flagged records were included: {rep['baseline_max_share_change_if_flagged_rows_were_included']}.", "",
          "| season | player-seasons | included | missing | incomplete | over | FGA coverage |", "|---|---|---|---|---|---|---|"]
    for c in rep["baseline_coverage_by_season"]:
        L.append(f"| {c['season']} | {c['player_seasons']} | {c['included']} | {c['excluded_missing']} | {c['excluded_incomplete']} | {c['excluded_overallocated']} | {c['fga_coverage']} |")
    L += ["", f"Exported records checked: {rep['exported_records_checked']}; status mismatches: {rep['exported_status_mismatches']}.",
          f"`similarity_pool.json` sha256: `{rep['similarity_pool_sha256']}`", "", "## Result", "", "Failures: " + (", ".join(rep["failures"]) if rep["failures"] else "none"), ""]
    open(path, "w").write("\n".join(L))


if __name__ == "__main__":
    sys.exit(main())
