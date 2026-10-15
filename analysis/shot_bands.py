"""Shared definitions for the Basketball-Reference distance-band shot data.

Used by step 6 (export + league baselines), the validation script, and tests,
so the numbers the UI shows, the baselines, and the validation all agree.

Source facts (verified in data, see docs/shot_band_validation.json):
  * band shares are rounded to 3 decimals  -> five shares can legitimately
    total 1 +/- 5 * 0.0005 = +/-0.0025;
  * a band FG% is blank exactly when its share is 0 (never blank with share > 0,
    never present with share 0 in this dataset);
  * the source's own 2PT-range share + 3PT share = 1 (within rounding) for every row.
"""
import math

BANDS = ["x0_3", "x3_10", "x10_16", "x16_3p", "x3p"]
SHARE_COLS = [f"percent_fga_from_{b}_range" for b in BANDS]
FG_COLS = [f"fg_percent_from_{b}_range" for b in BANDS]
SHARE_ROUNDING_TOLERANCE = 5 * 0.0005  # five 3-decimal shares
TWO_PLUS_THREE_TOLERANCE = 0.0015     # x2p_range + x3p_range vs 1
SMALL_SAMPLE_ATTEMPTS = 20


def js_round(x):
    """Math.round semantics (half up) -- what the browser uses."""
    return math.floor(x + 0.5)


def isnull(v):
    return v is None or (isinstance(v, float) and math.isnan(v))


def shares_total(row):
    vals = [row.get(c) for c in SHARE_COLS]
    return None if any(isnull(v) for v in vals) else round(sum(vals), 4)


def distribution_status(total):
    """'missing' | 'ok' | 'incomplete' (total < 1 - tol) | 'overallocated' (total > 1 + tol)."""
    if total is None:
        return "missing"
    if total < 1 - SHARE_ROUNDING_TOLERANCE - 1e-9:
        return "incomplete"
    if total > 1 + SHARE_ROUNDING_TOLERANCE + 1e-9:
        return "overallocated"
    return "ok"


def band_state(share, fg):
    """source_none: share 0 and FG% blank (source reports no attempts);
    unavailable: share missing; partial: share>0 but FG% blank or share 0 with FG%; ok."""
    if isnull(share):
        return "unavailable"
    if share == 0 and isnull(fg):
        return "source_none"
    if (share == 0) != isnull(fg):
        return "inconsistent"
    return "ok"


def displayed_counts(share, fg, fga):
    """EXACT calculation used by the interface: attempts = round(share*FGA); makes = round(attempts*FG%)."""
    if isnull(share) or isnull(fga):
        return None, None
    att = js_round(share * fga)
    mk = 0 if isnull(fg) else min(att, js_round(att * fg))
    return att, mk


def unrounded_counts(share, fg, fga):
    if isnull(share) or isnull(fga):
        return None, None
    att = share * fga
    return att, (0.0 if isnull(fg) else att * fg)


def pooled_baseline(rows):
    """rows: iterable of dicts with SHARE_COLS, FG_COLS, 'fga' (already filtered to the population).
    FG% is pooled makes / pooled attempts (never a mean of player percentages).
    A row whose band has share>0 but a blank FG% contributes attempts to the share only and is
    excluded from that band's FG% pool (counted in fg_missing_rows); blank FG% is zero makes only
    when share == 0 (no attempts)."""
    att = {b: 0.0 for b in BANDS}
    fg_att = {b: 0.0 for b in BANDS}
    mk = {b: 0.0 for b in BANDS}
    fg_missing = {b: 0 for b in BANDS}
    tot = 0.0
    n = 0
    for r in rows:
        fga = r["fga"]
        tot += fga
        n += 1
        for b in BANDS:
            s, f = r[f"percent_fga_from_{b}_range"], r[f"fg_percent_from_{b}_range"]
            a = s * fga
            att[b] += a
            if isnull(f):
                if s > 0:
                    fg_missing[b] += 1
                continue
            fg_att[b] += a
            mk[b] += a * f
    bands = {}
    for b in BANDS:
        bands[b] = {
            "share": round(att[b] / tot, 4) if tot else None,
            "fg_pct": round(mk[b] / fg_att[b], 4) if fg_att[b] > 0 else None,
            "est_attempts": round(att[b], 1),
            "fg_missing_rows": fg_missing[b],
        }
    return {"players": n, "fga_covered": int(tot), "bands": bands}
