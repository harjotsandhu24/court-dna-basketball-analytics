/**
 * Pure helpers for the Player Map: URL state, responsive sizing,
 * screen-space hit testing and overlay placement. Kept free of React/DOM so
 * they can be unit-tested (tests/mapView.test.ts). The map is drawn in real
 * CSS pixels (no viewBox scaling), so everything here works in screen space
 * and there is no SVG-unit/CSS-pixel drift to correct for.
 */

export interface MapParams {
  season: number;
  player: string | null;
  archetype: string | null;
  pos: string | null;
}

const POS_VALUES = new Set(["Guard", "Wing", "Big"]);

export function parseMapParams(
  get: (key: string) => string | null,
  defaultSeason: number,
  minSeason: number,
  maxSeason: number,
): MapParams {
  const raw = get("season");
  const n = raw ? parseInt(raw, 10) : NaN;
  const season = Number.isFinite(n) ? Math.max(minSeason, Math.min(maxSeason, n)) : defaultSeason;
  const pos = get("pos");
  return {
    season,
    player: get("player") || null,
    archetype: get("archetype") || null,
    pos: pos && POS_VALUES.has(pos) ? pos : null,
  };
}

export function buildMapQuery(p: MapParams): string {
  const params = new URLSearchParams();
  params.set("season", String(p.season));
  if (p.player) params.set("player", p.player);
  if (p.archetype) params.set("archetype", p.archetype);
  if (p.pos) params.set("pos", p.pos);
  return params.toString();
}

/** Width / height of the map for a given container width. Phones get a
 * near-square map (so the 300-450 dots use the space instead of
 * letterboxing inside a wide canvas); desktop keeps a wide canvas. */
export function mapAspect(width: number): number {
  if (width < 480) return 1;
  if (width < 768) return 4 / 3;
  if (width < 1100) return 3 / 2;
  return 8 / 5;
}

/** Height in CSS px: from the aspect ratio, but never taller than ~80% of
 * the viewport (landscape phones) and never absurdly short. */
export function mapHeight(width: number, viewportHeight: number): number {
  const byAspect = width / mapAspect(width);
  const cap = viewportHeight > 0 ? viewportHeight * 0.8 : byAspect;
  return Math.round(Math.max(240, Math.min(byAspect, Math.max(240, cap))));
}

export interface XY {
  x: number;
  y: number;
}

/** Nearest point to (px, py) within maxDist screen pixels, or null. */
export function nearestScreenPoint<T extends XY>(points: readonly T[], px: number, py: number, maxDist: number): T | null {
  let best: T | null = null;
  let bestD2 = maxDist * maxDist;
  for (const p of points) {
    const dx = p.x - px;
    const dy = p.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      best = p;
      bestD2 = d2;
    }
  }
  return best;
}

/** Hit radius in px by input type: fingers are imprecise. */
export function hitRadius(pointerType: string): number {
  return pointerType === "mouse" ? 12 : 26;
}

/** Position an overlay box next to an anchor point, preferring the right
 * (then left) side, and clamp it fully inside the area. */
export function placeOverlay(
  anchor: XY,
  box: { w: number; h: number },
  area: { w: number; h: number },
  gap = 14,
  margin = 4,
): { left: number; top: number } {
  const boxW = Math.min(box.w, area.w - margin * 2);
  let left = anchor.x + gap;
  if (left + boxW > area.w - margin) left = anchor.x - gap - boxW;
  left = Math.max(margin, Math.min(area.w - boxW - margin, left));
  let top = anchor.y - box.h / 2;
  top = Math.max(margin, Math.min(area.h - box.h - margin, top));
  return { left, top };
}

/** Rough text width for overlay placement (labels need a width before they
 * are measured). Slightly generous so clamping errs toward staying inside. */
export function estimateTextWidth(text: string, fontPx: number): number {
  return Math.ceil(text.length * fontPx * 0.58);
}

/** Zoom transform that puts (px, py) (in unscaled map pixels) at the center
 * of a w x h viewport at scale k. */
export function recenterTransform(px: number, py: number, w: number, h: number, k: number): { x: number; y: number; k: number } {
  return { x: w / 2 - k * px, y: h / 2 - k * py, k };
}

export type Direction = "left" | "right" | "up" | "down";

/** Keyboard navigation between dots: the closest point lying mostly in the
 * pressed direction. */
export function nextPointInDirection<T extends XY>(points: readonly T[], from: XY, dir: Direction): T | null {
  let best: T | null = null;
  let bestScore = Infinity;
  for (const p of points) {
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    if (dx === 0 && dy === 0) continue;
    const along = dir === "right" ? dx : dir === "left" ? -dx : dir === "down" ? dy : -dy;
    const across = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
    if (along <= 0 || across > along * 2) continue;
    const score = along + across * 2;
    if (score < bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}
