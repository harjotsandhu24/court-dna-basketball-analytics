/** Pure helpers for the temporary zone-hover tooltip (tested without a DOM). */

/** Where the numbers come from: counted from shot records, counted from an incomplete set, or estimated from shares. */
export type CountBasis = "exact" | "recorded" | "estimated";

export interface TooltipInput {
  name: string;
  attempts: number | null;
  makes: number | null;
  /** makes / attempts over ALL attempts in the zone (never the Made/Missed marker filter) */
  pct: number | null;
  none: boolean;
  basis: CountBasis;
}

export interface TooltipContent { title: string; counts: string; shooting: string | null; basis: CountBasis }

export function tooltipContent(i: TooltipInput): TooltipContent {
  if (i.none) return { title: i.name, counts: i.basis === "estimated" ? "No attempts" : "0 made / 0 attempts", shooting: "— shooting", basis: i.basis };
  const pct = i.pct == null ? "—" : `${(i.pct * 100).toFixed(1)}%`;
  if (i.attempts == null || i.makes == null) return { title: i.name, counts: "Counts unavailable", shooting: `${pct} shooting`, basis: i.basis };
  const counts =
    i.basis === "estimated"
      ? `≈${i.makes} made / ≈${i.attempts} attempts (estimated)`
      : i.basis === "recorded"
        ? `Recorded: ${i.makes} made / ${i.attempts} attempts`
        : `${i.makes} made / ${i.attempts} attempts`;
  return { title: i.name, counts, shooting: `${pct} shooting`, basis: i.basis };
}

export interface Point { x: number; y: number }
export interface Size { w: number; h: number }

/** Top-left of the tooltip: offset from the cursor, flipped to the other side near an edge, always inside the viewport. */
export function placeTooltip(cursor: Point, tip: Size, viewport: Size, offset = 14, margin = 8): Point {
  let left = cursor.x + offset;
  let top = cursor.y + offset;
  if (left + tip.w > viewport.w - margin) left = cursor.x - offset - tip.w;
  if (top + tip.h > viewport.h - margin) top = cursor.y - offset - tip.h;
  left = Math.max(margin, Math.min(left, viewport.w - margin - tip.w));
  top = Math.max(margin, Math.min(top, viewport.h - margin - tip.h));
  return { x: left, y: top };
}

/** Which zone is previewed: hovering wins over keyboard focus; Escape (dismissed) clears both until the zone changes. */
export function previewZone<T>(hover: T | null, focus: T | null, dismissed: boolean): T | null {
  return dismissed ? null : hover ?? focus;
}

/** Hover is a pointing-device affordance: touch taps must select without leaving a sticky tooltip. */
export function isHoverPointer(pointerType: string): boolean {
  return pointerType === "mouse" || pointerType === "pen";
}
