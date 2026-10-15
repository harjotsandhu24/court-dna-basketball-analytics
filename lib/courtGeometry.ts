/**
 * Half-court geometry for the Shooting Profile (viewBox units; 10 units = 1 ft,
 * baseline at y=0, basket centre at (250, 52.5)). Zones are non-overlapping
 * REGIONS bounded by rings around the basket, because the data are distance
 * groups: they carry no left/right or corner information.
 */
import { DEEP_THREE_FT, type ShotZoneKey } from "./shotZones";

export const COURT_W = 500;
export const COURT_H = 400;
export const BASKET = { x: 250, y: 52.5 };
export const RADII = { rim: 30, close: 100, mid: 160, three: 237.5 };
/** Deep-three radius in SVG units (10 per foot); squared for exact comparisons. */
export const DEEP_R = DEEP_THREE_FT * 10;
export const CORNER_X = 220; // 22 ft from the basket's centre line

/** The NBA used a 22-ft three-point line all the way around through 1996-97 (the first season in the app). */
export const SHORT_LINE_LAST_SEASON = 1997;
export interface ThreeLine { radius: number; corner: number }
export function threeLineFor(season?: number | null): ThreeLine {
  return season != null && season <= SHORT_LINE_LAST_SEASON ? { radius: 220, corner: 220 } : { radius: RADII.three, corner: CORNER_X };
}

const circle = (r: number) =>
  `M${BASKET.x - r} ${BASKET.y} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`;

function buildZonePaths(line: ThreeLine, deep: boolean): Record<ShotZoneKey, string> {
  const arcY = BASKET.y + Math.sqrt(line.radius ** 2 - line.corner ** 2);
  const twoPt = `M${BASKET.x - line.corner} 0 V${arcY.toFixed(1)} A${line.radius} ${line.radius} 0 0 0 ${BASKET.x + line.corner} ${arcY.toFixed(1)} V0 Z`;
  return {
    x0_3: circle(RADII.rim),
    x3_10: circle(RADII.close) + circle(RADII.rim),
    x10_16: circle(RADII.mid) + circle(RADII.close),
    x16_3p: twoPt + circle(RADII.mid),
    // three-pointers under 30 ft = the 30-ft disc minus the two-point area; deep threes = the court minus the 30-ft disc (the disc contains the whole two-point area)
    // without a deep-three split (distance-band fallback) the three-point zone is everything beyond the line
    x3p: deep ? circle(DEEP_R) + twoPt : `M0 0H${COURT_W}V${COURT_H}H0Z` + twoPt,
    x3d: `M0 0H${COURT_W}V${COURT_H}H0Z` + circle(DEEP_R),
  };
}

const PATHS = {
  modern: { deep: buildZonePaths(threeLineFor(), true), flat: buildZonePaths(threeLineFor(), false) },
  short: { deep: buildZonePaths(threeLineFor(SHORT_LINE_LAST_SEASON), true), flat: buildZonePaths(threeLineFor(SHORT_LINE_LAST_SEASON), false) },
};
/** Disjoint regions (fill-rule evenodd; clipped to the court rectangle), for the season's three-point line. */
export function zonePathsFor(season?: number | null, deepSplit = true): Record<ShotZoneKey, string> {
  const p = season != null && season <= SHORT_LINE_LAST_SEASON ? PATHS.short : PATHS.modern;
  return deepSplit ? p.deep : p.flat;
}
/** Modern-line regions (kept for callers that do not care about the season). */
export const ZONE_PATHS: Record<ShotZoneKey, string> = PATHS.modern.deep;

/** DOM / tab order: nearest the basket first. */
export const ZONE_ORDER: ShotZoneKey[] = ["x0_3", "x3_10", "x10_16", "x16_3p", "x3p", "x3d"];

/** Which zone a court point falls in (same radii/corners as the drawn paths). */
export function zoneAtPoint(x: number, y: number, season?: number | null): ShotZoneKey | null {
  if (x < 0 || x > COURT_W || y < 0 || y > COURT_H) return null;
  const line = threeLineFor(season);
  const dx = x - BASKET.x, dy = y - BASKET.y;
  const d = Math.hypot(dx, dy);
  if (d < RADII.rim) return "x0_3";
  const outsideArc = d >= line.radius || Math.abs(x - BASKET.x) > line.corner;
  if (outsideArc) return dx * dx + dy * dy >= DEEP_R * DEEP_R ? "x3d" : "x3p";
  if (d < RADII.close) return "x3_10";
  if (d < RADII.mid) return "x10_16";
  return "x16_3p";
}

/** Three-point line: both corner segments and the arc, never the court's rectangular edge (drawn from the baseline up). */
export function threePointLinePath(line: ThreeLine): string {
  const arcY = BASKET.y + Math.sqrt(line.radius ** 2 - line.corner ** 2);
  return `M${BASKET.x - line.corner} 0 V${arcY.toFixed(1)} A${line.radius} ${line.radius} 0 0 0 ${BASKET.x + line.corner} ${arcY.toFixed(1)} V0`;
}

/**
 * One OUTER distance boundary per band (the only thing highlighted on hover/selection): rim 3 ft, close 10 ft, mid 16 ft;
 * the long-two and three-point bands both end at the three-point line.
 */
export function boundaryPathsFor(season?: number | null): Record<ShotZoneKey, string> {
  const three = threePointLinePath(threeLineFor(season));
  return { x0_3: circle(RADII.rim), x3_10: circle(RADII.close), x10_16: circle(RADII.mid), x16_3p: three, x3p: three, x3d: circle(DEEP_R) };
}
