/**
 * COURT PRINT — deterministic visual parameter mapping.
 *
 * Every COURT DNA player-season gets a Court Print: a signature radial
 * graphic built directly from that season's seven percentile trait
 * dimensions (analysis/config.py TRAIT_DIMENSIONS). Nothing about the
 * shape, size, or color is random or decorative -- every visual element
 * traces back to a specific number, documented in the legend rendered
 * alongside it. See docs/methodology.md "Court Print" for the full spec.
 *
 * Geometry: 7 spokes radiate from a center point at even 360/7-degree
 * intervals (a fixed, deterministic order -- see DIMENSION_ORDER). Each
 * spoke's length is that dimension's season-relative percentile (0-100)
 * scaled to the print's radius. The 7 spoke tips are connected with a
 * smooth closed curve through them, evoking court arcs rather than a
 * generic straight-edged radar polygon.
 */
import type { TraitDimension } from "./config";

export const DIMENSION_ORDER: TraitDimension[] = [
  "Scoring",
  "Perimeter Profile",
  "Playmaking",
  "Defensive Activity",
  "Rebounding",
  "Rim Pressure",
  "Efficiency",
];

/** Plain-English display labels for the Court Print's seven spokes --
 * presentation only. The underlying dimension keys above (which drive the
 * actual data lookups, e.g. traits["Perimeter Profile"]) are unchanged;
 * this is purely what's rendered as user-facing text, so recruiters and
 * fans who don't know basketball-analytics shorthand (and don't need
 * "PLM"/"3PT"/"RIM" to understand the chart) can read it directly. See
 * docs/methodology.md for the full technical dimension names. */
export const DIMENSION_DISPLAY_LABEL: Record<TraitDimension, string> = {
  Scoring: "Scoring",
  "Perimeter Profile": "Three-Point Style",
  Playmaking: "Passing & Creation",
  "Defensive Activity": "Defense",
  Rebounding: "Rebounding",
  "Rim Pressure": "Attacking the Basket",
  Efficiency: "Scoring Efficiency",
};

export interface SpokePoint {
  dimension: TraitDimension;
  value: number; // 0-100 percentile
  angleDeg: number;
  x: number;
  y: number;
}

/** pos_group -> base hue (degrees). Guards run warmer/redder, Bigs run
 * deeper amber, Wings sit at the core COURT DNA orange -- a subtle,
 * intentional family variation, not a random color. */
const POS_GROUP_HUE: Record<string, number> = {
  Guard: 14, // red-orange
  Wing: 24, // core court-orange
  Big: 34, // amber
};

export function computeSpokes(
  traits: Record<string, number | null | undefined>,
  center: number,
  maxRadius: number,
  minRadius: number,
): SpokePoint[] {
  const n = DIMENSION_ORDER.length;
  return DIMENSION_ORDER.map((dim, i) => {
    const angleDeg = -90 + (360 / n) * i; // start pointing up, go clockwise
    const angleRad = (angleDeg * Math.PI) / 180;
    const raw = traits[dim] ?? 0;
    const pct = Math.max(0, Math.min(100, raw));
    const r = minRadius + (maxRadius - minRadius) * (pct / 100);
    return {
      dimension: dim,
      value: pct,
      angleDeg,
      x: center + r * Math.cos(angleRad),
      y: center + r * Math.sin(angleRad),
    };
  });
}

/** Catmull-Rom through the closed loop of spoke tips, rendered as a smooth
 * SVG path -- gives the print an organic, court-arc feel instead of a
 * sharp-edged radar polygon. */
export function smoothClosedPath(points: { x: number; y: number }[]): string {
  const n = points.length;
  if (n < 3) return "";
  const p = (i: number) => points[((i % n) + n) % n];
  let d = `M ${p(0).x.toFixed(2)} ${p(0).y.toFixed(2)} `;
  for (let i = 0; i < n; i++) {
    const p0 = p(i - 1);
    const p1 = p(i);
    const p2 = p(i + 1);
    const p3 = p(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += `C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} `;
  }
  return d + "Z";
}

export function hueForPosGroup(posGroup: string): number {
  return POS_GROUP_HUE[posGroup] ?? POS_GROUP_HUE.Wing;
}

export interface SpokeLabelPosition {
  dimension: TraitDimension;
  /** Anchor point, as a percentage of the chart's bounding box, for an
   * absolutely-positioned HTML label placed just outside the spoke tip. */
  leftPct: number;
  topPct: number;
  /** Which way the label's text should grow from its anchor point, so
   * multi-word labels (e.g. "Passing & Creation") never drift back over
   * the chart itself. */
  align: "left" | "right" | "center";
}

/** Tablet/desktop on-chart label positions: one per spoke, placed just
 * outside the chart's outer radius along that spoke's exact angle, so
 * each label visually lines up with the direction it describes.
 *
 * labelRadiusPx: distance from center to each label's anchor point, in
 * the same pixel units as the chart itself -- callers should pass
 * maxRadius (the chart's own outer ring) plus a fixed clearance (e.g.
 * +34px), NOT a value smaller than maxRadius, or labels will sit inside
 * a spoke that reaches full value (100) rather than outside it.
 * boxSizePx: the square bounding box's side length the result is
 * expressed against (as a percentage), i.e. CourtPrint's outerBoxSize. */
export function computeSpokeLabelPositions(labelRadiusPx: number, boxSizePx: number): SpokeLabelPosition[] {
  const n = DIMENSION_ORDER.length;
  const radiusPct = (labelRadiusPx / boxSizePx) * 100;
  return DIMENSION_ORDER.map((dim, i) => {
    const angleDeg = -90 + (360 / n) * i;
    const angleRad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const align: SpokeLabelPosition["align"] = cos > 0.35 ? "left" : cos < -0.35 ? "right" : "center";
    return {
      dimension: dim,
      leftPct: 50 + radiusPct * cos,
      topPct: 50 + radiusPct * sin,
      align,
    };
  });
}
