"""Normalize + validate raw ShotChartDetail rows and aggregate into documented zones.

Units: LOC_X / LOC_Y are tenths of a foot; basket at (0, 0); +Y toward the
opposite baseline (court is 940 long, half-court at Y=470). Orientation is
NOT assumed to match the SVG: x is left/right from the shooter's view only as
published; verify with a first live sample before drawing left/right.

Zones (non-overlapping, exhaustive for located half-court attempts):
  restricted_area  : dist <= 40 (4 ft), 2PT
  paint_non_ra     : 2PT, |x| <= 80 and y <= 142.5 (lane), dist > 40
  mid_range        : remaining 2PT
  corner_3         : 3PT with |x| >= 220 and y <= 92.5
  above_break_3    : other 3PT
  heave            : y > 400 (≈ beyond 40 ft from baseline, counted separately, not in zones)
"""
import math

THREE_RADIUS = 237.5
CORNER_X = 220.0
CORNER_Y_MAX = 92.5


def is_three_by_geometry(x, y):
    return abs(x) >= CORNER_X or math.hypot(x, y) >= THREE_RADIUS


def zone_for(x, y):
    if y > 400:
        return "heave"
    three = is_three_by_geometry(x, y)
    if three:
        return "corner_3" if (abs(x) >= CORNER_X and y <= CORNER_Y_MAX) else "above_break_3"
    d = math.hypot(x, y)
    if d <= 40:
        return "restricted_area"
    if abs(x) <= 80 and y <= 142.5:
        return "paint_non_ra"
    return "mid_range"


def normalize_shots(rows):
    """rows: list of dicts with GAME_ID, GAME_EVENT_ID, PLAYER_ID, LOC_X, LOC_Y, SHOT_MADE_FLAG, SHOT_ATTEMPTED_FLAG, SHOT_TYPE.
    Returns (clean_rows, report). Duplicates dropped on (GAME_ID, GAME_EVENT_ID, PLAYER_ID)."""
    seen, clean = set(), []
    rep = {"input": len(rows), "duplicates": 0, "invalid_coordinates": 0, "invalid_flags": 0, "three_type_mismatch": 0}
    for r in rows:
        k = (r["GAME_ID"], r["GAME_EVENT_ID"], r["PLAYER_ID"])
        if k in seen:
            rep["duplicates"] += 1
            continue
        seen.add(k)
        x, y = r.get("LOC_X"), r.get("LOC_Y")
        if x is None or y is None or not (-250 <= x <= 250) or not (-60 <= y <= 940):
            rep["invalid_coordinates"] += 1
            continue
        made, att = r.get("SHOT_MADE_FLAG"), r.get("SHOT_ATTEMPTED_FLAG")
        if made not in (0, 1) or att != 1 or made > att:
            rep["invalid_flags"] += 1
            continue
        if y <= 400 and (r.get("SHOT_TYPE", "").startswith("3PT")) != is_three_by_geometry(x, y):
            rep["three_type_mismatch"] += 1  # boundary shots; kept, API classification wins for the 2PT/3PT split
        clean.append(r)
    rep["kept"] = len(clean)
    return clean, rep


def aggregate_zones(clean):
    zones = {z: {"fga": 0, "fgm": 0} for z in
             ("restricted_area", "paint_non_ra", "mid_range", "corner_3", "above_break_3", "heave")}
    for r in clean:
        z = zone_for(r["LOC_X"], r["LOC_Y"])
        zones[z]["fga"] += 1
        zones[z]["fgm"] += r["SHOT_MADE_FLAG"]
    return zones


def reconcile(zones, trusted_fga, tolerance=0.02):
    """Compare located+heave attempts to a trusted season total (e.g. Basketball-Reference FGA)."""
    got = sum(v["fga"] for v in zones.values())
    ok = trusted_fga > 0 and abs(got - trusted_fga) / trusted_fga <= tolerance
    return {"downloaded_fga": got, "trusted_fga": trusted_fga, "within_tolerance": ok}
