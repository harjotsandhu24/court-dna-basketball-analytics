import { describe, it, expect } from "vitest";
import {
  buildMapQuery,
  mapAspect,
  mapHeight,
  nearestScreenPoint,
  nextPointInDirection,
  parseMapParams,
  placeOverlay,
  recenterTransform,
} from "../lib/mapView";
import { seasonLabel, normalizeSeasonText } from "../lib/config";

describe("season labels", () => {
  it("formats season-end years as 2008–09, never the raw year", () => {
    expect(seasonLabel(2009)).toBe("2008\u201309");
    expect(seasonLabel(2000 + 1)).toBe("2000\u201301");
    expect(normalizeSeasonText("2000-01")).toBe("2000\u201301");
  });
});

describe("map URL state", () => {
  const get = (q: string) => { const sp = new URLSearchParams(q); return (k: string) => sp.get(k); };
  it("round-trips season/player/filters", () => {
    const p = parseMapParams(get("season=2010&player=bryanko01&pos=Wing&archetype=Scorer"), 2026, 2001, 2026);
    expect(p).toEqual({ season: 2010, player: "bryanko01", pos: "Wing", archetype: "Scorer" });
    expect(parseMapParams(get(buildMapQuery(p)), 2026, 2001, 2026)).toEqual(p);
  });
  it("defaults to the latest season and clamps/ignores bad values", () => {
    expect(parseMapParams(get(""), 2026, 2001, 2026).season).toBe(2026);
    expect(parseMapParams(get("season=1990&pos=Robot"), 2026, 2001, 2026)).toMatchObject({ season: 2001, pos: null });
  });
});

describe("map sizing", () => {
  it("phones get a near-square map, not a fixed minimum height", () => {
    expect(mapAspect(320)).toBe(1);
    expect(mapHeight(320, 640)).toBe(320);
    expect(mapHeight(1200, 900)).toBe(720);
  });
  it("never exceeds 80% of a short landscape viewport (floor 240)", () => {
    expect(mapHeight(700, 360)).toBe(288);
  });
});

describe("screen-space hit testing", () => {
  const pts = [{ x: 10, y: 10 }, { x: 100, y: 100 }];
  it("returns the nearest point within radius, else null", () => {
    expect(nearestScreenPoint(pts, 20, 12, 26)).toBe(pts[0]);
    expect(nearestScreenPoint(pts, 60, 60, 26)).toBeNull();
  });
  it("finds the nearest point in a direction", () => {
    expect(nextPointInDirection(pts, { x: 10, y: 10 }, "right")).toBe(pts[1]);
    expect(nextPointInDirection(pts, { x: 10, y: 10 }, "left")).toBeNull();
  });
});

describe("overlay placement and recentering", () => {
  it("clamps inside the area and flips left near the right edge", () => {
    const { left, top } = placeOverlay({ x: 380, y: 5 }, { w: 120, h: 50 }, { w: 400, h: 300 });
    expect(left + 120).toBeLessThanOrEqual(396);
    expect(left).toBeGreaterThanOrEqual(4);
    expect(top).toBeGreaterThanOrEqual(4);
  });
  it("recenter puts the point at the viewport center", () => {
    const t = recenterTransform(100, 50, 400, 300, 2);
    expect(100 * t.k + t.x).toBe(200);
    expect(50 * t.k + t.y).toBe(150);
  });
});
