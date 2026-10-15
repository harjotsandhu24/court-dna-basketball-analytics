import { describe, expect, it } from "vitest";
import {
  BANDS, LEGEND_STEPS, SHARE_SCALE_MAX, ZERO_FILL, baselineLabel, bandState, computeBandStats,
  distributionStatus, fmtPct, shareFill, toggleZone, DISTANCE_CAPTION, type SeasonBaseline, type ShotZoneKey,
} from "@/lib/shotZones";
import { COURT_H, COURT_W, ZONE_ORDER, ZONE_PATHS, zoneAtPoint } from "@/lib/courtGeometry";
import type { ShotDna } from "@/lib/types";

const base: ShotDna = {
  percent_fga_from_x0_3_range: 0.2, percent_fga_from_x3_10_range: 0.1, percent_fga_from_x10_16_range: 0.0,
  percent_fga_from_x16_3p_range: 0.4, percent_fga_from_x3p_range: 0.3,
  fga: 1000, fg: 450, shares_total: 1, distribution_status: "ok",
  fg_percent_from_x0_3_range: 0.6, fg_percent_from_x3_10_range: 0.4, fg_percent_from_x10_16_range: null,
  fg_percent_from_x16_3p_range: 0.42, fg_percent_from_x3p_range: 0.35,
  avg_dist_fga: 14, percent_assisted_x2p_fg: 0.3, percent_assisted_x3p_fg: 0.6,
  percent_dunks_of_fga: 0.02, percent_corner_3s_of_3pa: 0.1, corner_3_point_percent: 0.4,
};

describe("toggleZone", () => {
  it("selects, clears on re-click, and switches directly", () => {
    let z: ShotZoneKey | null = toggleZone(null, "x0_3");
    expect(z).toBe("x0_3");
    z = toggleZone(z, "x3p");
    expect(z).toBe("x3p");
    expect(toggleZone(z, "x3p")).toBeNull();
  });
});

describe("band states: confirmed zero vs estimated vs unavailable", () => {
  it("share 0 with blank FG% is a source-reported zero", () => {
    expect(bandState(0, null)).toBe("source_none");
  });
  it("missing share is unavailable, never zero", () => {
    expect(bandState(null, null)).toBe("unavailable");
    const t = computeBandStats({ ...base, percent_fga_from_x3_10_range: null as unknown as number });
    expect(t[1].state).toBe("unavailable");
    expect(t[1].attempts).toBeNull();
  });
  it("share 0 WITH an FG% (or share>0 without) is flagged inconsistent, not treated as zero", () => {
    expect(bandState(0, 0.5)).toBe("inconsistent");
    expect(bandState(0.1, null)).toBe("inconsistent");
  });
  it("tiny positive share that rounds to <1 attempt is NOT shown as 0 attempts", () => {
    const t = computeBandStats({ ...base, fga: 100, percent_fga_from_x3_10_range: 0.004, fg_percent_from_x3_10_range: 1 });
    expect(t[1].attempts).toBe(0);
    expect(t[1].belowOneEstimate).toBe(true);
    expect(t[1].state).toBe("ok");
    expect(t[1].makes).toBeNull();
    expect(t[1].smallSample).toBe(true);
  });
});

describe("computeBandStats (displayed rounding order)", () => {
  const s = computeBandStats(base);
  it("covers five non-overlapping distance bands in order", () => {
    expect(s.map((x) => x.key)).toEqual(BANDS.map((b) => b.key));
  });
  it("attempts = round(share×FGA); makes = round(attempts×FG%), never above attempts", () => {
    expect(s[0].attempts).toBe(200);
    expect(s[0].makes).toBe(120);
    const odd = computeBandStats({ ...base, fga: 77, percent_fga_from_x0_3_range: 0.123, fg_percent_from_x0_3_range: 0.667 });
    expect(odd[0].attempts).toBe(Math.round(0.123 * 77)); // 9
    expect(odd[0].makes).toBe(Math.round(9 * 0.667)); // 6, rounding the already-rounded attempts
    for (const x of s) if (x.attempts != null && x.makes != null) expect(x.makes).toBeLessThanOrEqual(x.attempts);
  });
  it("confirmed zero → 0 attempts and null FG% (never 0%)", () => {
    expect(s[2].state).toBe("source_none");
    expect(s[2].attempts).toBe(0);
    expect(s[2].fgPct).toBeNull();
    expect(fmtPct(s[2].fgPct)).toBe("—");
  });
  it("primary source numbers are passed through unchanged", () => {
    expect(s[3].share).toBe(0.4);
    expect(s[3].fgPct).toBe(0.42);
  });
  it("small samples are flagged on estimated attempts", () => {
    expect(computeBandStats({ ...base, fga: 100 })[1].smallSample).toBe(true); // ≈10
    expect(s[1].smallSample).toBe(false);
  });
  it("without total FGA, estimated counts are null but source numbers remain", () => {
    const t = computeBandStats({ ...base, fga: null });
    expect(t[0].attempts).toBeNull();
    expect(t[0].share).toBe(0.2);
  });
  it("does not adjust rounded shares", () => {
    expect(computeBandStats({ ...base, percent_fga_from_x3p_range: 0.296 })[4].share).toBe(0.296);
  });
  it("attaches the baseline for the same band only", () => {
    const bl = { bands: Object.fromEntries(BANDS.map((b) => [b.key, { share: 0.2, fg_pct: 0.5 }])) } as unknown as SeasonBaseline;
    expect(computeBandStats(base, bl)[3].baseline?.fg_pct).toBe(0.5);
    expect(computeBandStats(base, null)[3].baseline).toBeNull();
  });
  it("uses the required caption", () => {
    expect(DISTANCE_CAPTION).toBe("Simplified distance zones—not exact shot locations.");
  });
});

describe("distribution status", () => {
  it("accepts 3-decimal rounding error, flags real gaps without normalizing", () => {
    expect(distributionStatus(1.002)).toBe("ok");
    expect(distributionStatus(0.998)).toBe("ok");
    expect(distributionStatus(0.968)).toBe("incomplete");
    expect(distributionStatus(1.013)).toBe("overallocated");
    expect(distributionStatus(null)).toBe("missing");
  });
});

describe("baseline wording never calls a restricted sample the league", () => {
  const b = { players: 433, league_player_seasons: 539, fga_coverage: 0.7042 } as SeasonBaseline;
  it("states population, coverage and estimation", () => {
    const t = baselineLabel(b);
    expect(t).toMatch(/Estimated average among NBA players with a complete shot distribution/);
    expect(t).toMatch(/433 of 539/);
    expect(t).toMatch(/70\.4%/);
    expect(t.toLowerCase()).not.toMatch(/complete league|entire league/);
  });
  it("uses the minutes label when the population is restricted by minutes", () => {
    expect(baselineLabel(b, 250)).toBe("Estimated average among players with 250+ minutes.");
  });
});

describe("legend matches the zone color scale", () => {
  it("every legend step is rendered by shareFill, zero uses the zero fill, scale saturates at the last step", () => {
    expect(LEGEND_STEPS[0]).toBe(0);
    expect(shareFill(0)).toBe(ZERO_FILL);
    expect(shareFill(null)).toBe(ZERO_FILL);
    expect(LEGEND_STEPS[LEGEND_STEPS.length - 1]).toBe(SHARE_SCALE_MAX);
    expect(shareFill(SHARE_SCALE_MAX)).toBe(shareFill(0.9));
    const alphas = LEGEND_STEPS.slice(1).map((v) => Number(/\/ ([\d.]+)\)/.exec(shareFill(v))![1]));
    expect([...alphas].sort((a, c) => a - c)).toEqual(alphas); // monotonic
  });
});

describe("court geometry", () => {
  it("has one path per band, in tab order", () => {
    expect(ZONE_ORDER).toEqual([...BANDS.map((b) => b.key), "x3d"]);
    for (const k of ZONE_ORDER) expect(ZONE_PATHS[k].length).toBeGreaterThan(10);
  });
  it("classifies boundary points consistently", () => {
    expect(zoneAtPoint(250, 52.5)).toBe("x0_3");
    expect(zoneAtPoint(250, 52.5 + 29.9)).toBe("x0_3");
    expect(zoneAtPoint(250, 52.5 + 30.1)).toBe("x3_10");
    expect(zoneAtPoint(250, 52.5 + 99)).toBe("x3_10");
    expect(zoneAtPoint(250, 52.5 + 101)).toBe("x10_16");
    expect(zoneAtPoint(250, 52.5 + 161)).toBe("x16_3p");
    expect(zoneAtPoint(250, 52.5 + 237)).toBe("x16_3p");
    expect(zoneAtPoint(250, 52.5 + 238)).toBe("x3p");
    expect(zoneAtPoint(20, 10)).toBe("x3p"); // corner strip beyond 22 ft
    expect(zoneAtPoint(40, 10)).toBe("x16_3p"); // just inside the corner line
    expect(zoneAtPoint(-1, 10)).toBeNull();
    expect(zoneAtPoint(10, COURT_H + 1)).toBeNull();
    expect(COURT_W).toBe(500);
  });
});
