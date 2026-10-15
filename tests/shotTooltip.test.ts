import { describe, expect, it } from "vitest";
import { isHoverPointer, placeTooltip, previewZone, tooltipContent } from "@/lib/shotTooltip";
import { SHORT_LINE_LAST_SEASON, ZONE_ORDER, boundaryPathsFor, threeLineFor, threePointLinePath, zoneAtPoint, zonePathsFor } from "@/lib/courtGeometry";

describe("tooltip content (same numbers as the details panel)", () => {
  it("exact counts match the spec example", () => {
    const t = tooltipContent({ name: "Three-pointers", attempts: 336, makes: 118, pct: 118 / 336, none: false, basis: "exact" });
    expect([t.title, t.counts, t.shooting]).toEqual(["Three-pointers", "118 made / 336 attempts", "35.1% shooting"]);
  });
  it("partial-source counts are labelled recorded, fallback counts estimated", () => {
    expect(tooltipContent({ name: "Mid-range", attempts: 10, makes: 4, pct: 0.4, none: false, basis: "recorded" }).counts).toBe("Recorded: 4 made / 10 attempts");
    expect(tooltipContent({ name: "Mid-range", attempts: 10, makes: 4, pct: 0.4, none: false, basis: "estimated" }).counts).toBe("≈4 made / ≈10 attempts (estimated)");
  });
  it("a zone without attempts says so instead of showing 0%", () => {
    const t = tooltipContent({ name: "Long two", attempts: 0, makes: 0, pct: null, none: true, basis: "exact" });
    expect(t.counts).toBe("0 made / 0 attempts");
    expect(t.shooting).toBe("— shooting");
    expect(tooltipContent({ name: "Long two", attempts: 0, makes: 0, pct: null, none: true, basis: "estimated" }).counts).toBe("No attempts");
  });
});

describe("tooltip placement stays inside the viewport", () => {
  const vp = { w: 1000, h: 700 };
  const tip = { w: 200, h: 70 };
  it("is offset from the cursor (never under it)", () => {
    const p = placeTooltip({ x: 100, y: 100 }, tip, vp);
    expect(p.x).toBeGreaterThan(100);
    expect(p.y).toBeGreaterThan(100);
  });
  it("flips to the left/top near the right and bottom edges", () => {
    const p = placeTooltip({ x: 990, y: 690 }, tip, vp);
    expect(p.x + tip.w).toBeLessThanOrEqual(990);
    expect(p.y + tip.h).toBeLessThanOrEqual(690);
  });
  it("clamps inside the margin on tiny viewports", () => {
    const p = placeTooltip({ x: 5, y: 5 }, { w: 300, h: 80 }, { w: 320, h: 400 });
    expect(p.x).toBeGreaterThanOrEqual(8);
    expect(p.x + 300).toBeLessThanOrEqual(312);
    expect(p.y).toBeGreaterThanOrEqual(8);
  });
});

describe("preview state", () => {
  it("hover wins over focus; Escape dismisses both; nothing previewed otherwise", () => {
    expect(previewZone("x3p", "x3_10", false)).toBe("x3p");
    expect(previewZone(null, "x3_10", false)).toBe("x3_10");
    expect(previewZone("x3p", "x3_10", true)).toBeNull();
    expect(previewZone(null, null, false)).toBeNull();
  });
  it("touch never produces a hover tooltip", () => {
    expect(isHoverPointer("touch")).toBe(false);
    expect(isHoverPointer("mouse")).toBe(true);
    expect(isHoverPointer("pen")).toBe(true);
  });
});

describe("season-aware three-point line", () => {
  it("1996-97 uses the 22-ft line all the way around, later seasons the modern line", () => {
    expect(SHORT_LINE_LAST_SEASON).toBe(1997);
    expect(threeLineFor(1997)).toEqual({ radius: 220, corner: 220 });
    expect(threeLineFor(1998)).toEqual({ radius: 237.5, corner: 220 });
    expect(zonePathsFor(1997).x3p).not.toBe(zonePathsFor(1998).x3p);
    expect(zonePathsFor(2009)).toBe(zonePathsFor(2026));
    for (const k of ZONE_ORDER) expect(typeof zonePathsFor(1997)[k]).toBe("string");
  });
  it("a point 23 ft out is a long two on the modern court and a three on the 1997 court", () => {
    expect(zoneAtPoint(250, 52.5 + 230, 2009)).toBe("x16_3p");
    expect(zoneAtPoint(250, 52.5 + 230, 1997)).toBe("x3p");
  });
});

describe("boundary highlights", () => {
  it("long-two and three-point bands highlight the same three-point line (corners + arc, no court rectangle)", () => {
    const b = boundaryPathsFor(2009);
    expect(b.x16_3p).toBe(b.x3p);
    expect(b.x3p).toBe(threePointLinePath(threeLineFor(2009)));
    expect(b.x3p).not.toMatch(/H500|V400|Z/);
    expect(b.x3p).toContain("A237.5 237.5");
  });
  it("inner bands highlight one outer circle each (3, 10, 16 ft)", () => {
    const b = boundaryPathsFor(2009);
    for (const [k, r] of [["x0_3", 30], ["x3_10", 100], ["x10_16", 160]] as const) {
      expect(b[k].match(/a/g)).toHaveLength(2);
      expect(b[k]).toContain(`M${250 - r} 52.5`);
    }
  });
  it("the shortened 1996-97 line is 22 ft all round", () => {
    const b = boundaryPathsFor(1997);
    expect(b.x3p).toContain("A220 220");
    expect(b.x3p.startsWith("M30 0 V52.5")).toBe(true);
    expect(boundaryPathsFor(1998).x3p).toContain("A237.5 237.5");
  });
});

import { shotZone } from "@/lib/shotLocations";
describe("deep-three geometry (hover regions, boundary, classifier agree)", () => {
  it("the deep boundary is the 30-ft circle; ordinary threes still highlight the official line", () => {
    const b = boundaryPathsFor(2009);
    expect(b.x3d).toContain("a300 300");
    expect(b.x3d.startsWith("M-50 52.5")).toBe(true);
    expect(b.x3p).toBe(threePointLinePath(threeLineFor(2009)));
    expect(boundaryPathsFor(1997).x3d).toBe(b.x3d);   // 30 ft does not depend on the historical line
  });
  it("hit regions: deep = court minus the 30-ft disc; threes under 30 ft = disc minus the two-point area; fallback x3p = everything beyond the line", () => {
    const p = zonePathsFor(2009);
    expect(p.x3d).toBe(`M0 0H500V400H0Z` + p.x3d.slice("M0 0H500V400H0Z".length));
    expect(p.x3p.startsWith("M-50 52.5")).toBe(true);
    const flat = zonePathsFor(2009, false);
    expect(flat.x3p.startsWith("M0 0H500V400H0Z")).toBe(true);
    expect(zonePathsFor(2009, false)).toBe(zonePathsFor(2026, false));
  });
  it("zoneAtPoint agrees with the shot classifier just below, at and above 30 ft, on and off axis, for both lines", () => {
    for (const season of [1997, 2009]) {
      for (const [x, y] of [[0, 299], [0, 300], [0, 301], [180, 240], [179, 240], [181, 240], [-180, 240], [-60, 294], [-59, 295]]) {
        const want = shotZone(x, y, true);
        expect(zoneAtPoint(250 + x, 52.5 + y, season)).toBe(want);
      }
    }
    expect(zoneAtPoint(250, 52.5 + 299.9)).toBe("x3p");
    expect(zoneAtPoint(250, 52.5 + 300)).toBe("x3d");
    expect(zoneAtPoint(250, 52.5 + 237.4)).toBe("x16_3p");
    expect(zoneAtPoint(250, 52.5 + 238)).toBe("x3p");
  });
  it("random points: region and classifier agree wherever a recorded three lies outside the drawn line", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    let checked = 0;
    for (let i = 0; i < 4000; i++) {
      const x = Math.floor(rnd() * 501) - 250, y = Math.floor(rnd() * 400) - 52;   // integer source units: exact in both
      const z = zoneAtPoint(250 + x, 52.5 + y, 2009);
      if (z !== "x3p" && z !== "x3d") continue;
      expect(shotZone(x, y, true)).toBe(z);
      checked++;
    }
    expect(checked).toBeGreaterThan(500);
  });
});
