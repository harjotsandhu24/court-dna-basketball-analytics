import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BASKET } from "@/lib/courtGeometry";
import {
  decodeShots, isDrawn, markerPath, markerState, shotToCourt, shotZone, zoneCounts, zoneShooting,
  type ShotFile, type LocationsSummary,
} from "@/lib/shotLocations";
import { toggleZone } from "@/lib/shotZones";

const vectors = JSON.parse(readFileSync("tests/shot_zone_vectors.json", "utf8")) as {
  cases: { x: number; y: number; three: boolean; zone: string; svg_x: number; svg_y: number; drawn: boolean }[];
  packed: string; packed_made: boolean[];
};
const readShots = (season: number, id: string) => JSON.parse(readFileSync(`public/data/shots/${season}/${id}.json`, "utf8")) as ShotFile;
const seasonRows = (season: number) => {
  const d = JSON.parse(readFileSync(`public/data/seasons/${season}.json`, "utf8"));
  return (Array.isArray(d) ? d : d.players) as { player_id: string; shot_dna: { locations?: LocationsSummary; fga?: number; fg?: number } }[];
};
const manifest = JSON.parse(readFileSync("public/data/shots/manifest.json", "utf8"));

describe("coordinate transformation (shared vectors with pytest)", () => {
  it("hoop is at the origin and maps to the basket centre", () => {
    expect(BASKET).toEqual({ x: 250, y: 52.5 });
    expect(shotToCourt(0, 0)).toEqual({ x: 250, y: 52.5 });
  });
  it("negative x (shooter's left) is the viewer's left; one tenth of a foot is one SVG unit", () => {
    expect(shotToCourt(-231, 0).x).toBe(19);
    expect(shotToCourt(231, 0).x).toBe(481);
    expect(shotToCourt(0, 100).y).toBe(152.5);
  });
  it.each(vectors.cases.map((c, i) => [i, c] as const))("vector %i matches the Python transform, zone and drawn rule", (_i, c) => {
    const p = shotToCourt(c.x, c.y);
    expect(p.x).toBeCloseTo(c.svg_x, 9);
    expect(p.y).toBeCloseTo(c.svg_y, 9);
    expect(shotZone(c.x, c.y, c.three)).toBe(c.zone);
    expect(isDrawn(c.x, c.y)).toBe(c.drawn);
  });
  it("zone boundaries are exact at 3, 10 and 16 ft (integer rule)", () => {
    expect(shotZone(29, 0, false)).toBe("x0_3");
    expect(shotZone(30, 0, false)).toBe("x3_10");
    expect(shotZone(99, 10, false)).toBe("x3_10");
    expect(shotZone(100, 0, false)).toBe("x10_16");
    expect(shotZone(160, 0, false)).toBe("x16_3p");
    expect(shotZone(0, 0, true)).toBe("x3p");        // shot type decides 3PT (a three under 30 ft)
    expect(shotZone(0, 884, false)).toBe("x16_3p");  // a two-point label stays a two even in the backcourt
  });
  it("deep threes start exactly at 30 ft (squared distance, integer tenths); only three-point labels can be deep", () => {
    expect(shotZone(0, 299, true)).toBe("x3p");
    expect(shotZone(0, 300, true)).toBe("x3d");      // exactly 30.0 ft is deep
    expect(shotZone(0, 301, true)).toBe("x3d");
    expect(shotZone(180, 240, true)).toBe("x3d");    // 3-4-5: exactly 30 ft off-axis
    expect(shotZone(-180, 240, true)).toBe("x3d");
    expect(shotZone(179, 240, true)).toBe("x3p");
    expect(shotZone(181, 240, true)).toBe("x3d");
    expect(shotZone(0, 884, true)).toBe("x3d");      // end-of-period heave
    expect(shotZone(0, 300, false)).toBe("x16_3p");  // a recorded two-pointer is never deep
    expect(shotZone(0, 310, false)).toBe("x16_3p");
  });
});

describe("packed shot decoding", () => {
  it("decodes the Python-packed vectors back to the same coordinates and outcomes", () => {
    const f: ShotFile = { v: 2, player_id: "x", season: 2009, season_type: "regular", attempts: vectors.cases.length, makes: 0, s: vectors.packed };
    const shots = decodeShots(f);
    expect(shots.length).toBe(vectors.cases.length);
    shots.forEach((s, i) => {
      const c = vectors.cases[i];
      expect([s.sx, s.sy]).toEqual([c.svg_x, c.svg_y]);
      expect(s.made).toBe(vectors.packed_made[i]);
      expect(s.three).toBe(c.three);
      expect(s.zone).toBe(c.zone);
      expect(s.drawn).toBe(c.drawn);
    });
  });
  it("rejects malformed or old-format files instead of guessing", () => {
    const k = readShots(2009, "bryanko01");
    expect(() => decodeShots({ ...k, s: k.s.slice(1) })).toThrow();
    expect(() => decodeShots({ ...k, s: "zz" + k.s.slice(2, 4) + "9" + k.s.slice(5) })).toThrow();
    expect(() => decodeShots({ ...k, v: 1 })).toThrow();
    expect(() => decodeShots({ ...k, attempts: k.attempts + 1 })).toThrow();
  });
});

describe("Kobe Bryant 2008-09 regression (exact against trusted totals)", () => {
  const f = readShots(2009, "bryanko01");
  const shots = decodeShots(f);
  const row = seasonRows(2009).find((r) => r.player_id === "bryanko01")!;
  it("1,712 attempts / 800 makes; 3PT 336 / 118", () => {
    expect(shots.length).toBe(1712);
    expect(shots.filter((s) => s.made).length).toBe(800);
    const z = zoneCounts(shots);
    expect(z.x3p[0] + z.x3d[0]).toBe(336);
    expect(z.x3p[1] + z.x3d[1]).toBe(118);   // the original three-point total, now split at 30 ft
    expect(row.shot_dna.locations!.status).toBe("exact");
    expect(row.shot_dna.locations!.attempts).toBe(row.shot_dna.fga);
    expect(row.shot_dna.locations!.makes).toBe(row.shot_dna.fg);
  });
  it("zone counts from the file equal the summary the court labels use", () => {
    expect(zoneCounts(shots)).toEqual(row.shot_dna.locations!.zones);
  });
});

describe("every shipped file agrees with its summary and the manifest", () => {
  const integrated = Object.entries(manifest.seasons as Record<string, { status: string; files: number }>).filter(([, e]) => e.status === "integrated");
  it("30 seasons are integrated and each directory holds exactly the manifest's files", () => {
    expect(integrated.length).toBeGreaterThanOrEqual(1);
    for (const [s, e] of integrated) expect(readdirSync(`public/data/shots/${s}`).length).toBe(e.files);
  });
  it("counts, makes, drawn rule and status semantics hold for every file", () => {
    let files = 0;
    for (const [s] of integrated) {
      for (const r of seasonRows(Number(s))) {
        const loc = r.shot_dna.locations;
        const path = `public/data/shots/${s}/${r.player_id}.json`;
        if (!loc) { expect(existsSync(path)).toBe(false); continue; }
        const d = decodeShots(readShots(Number(s), r.player_id));
        files++;
        expect(zoneCounts(d)).toEqual(loc.zones);
        expect(d.length).toBe(loc.attempts);
        expect(d.filter((x) => x.made).length).toBe(loc.makes);
        expect(d.filter((x) => !x.drawn).length).toBe(loc.undrawn);
        expect(loc.trusted_fga).toBe(r.shot_dna.fga);
        expect(loc.status === "exact").toBe(loc.attempts === loc.trusted_fga && loc.makes === loc.trusted_fgm);
        if (loc.status === "partial") expect(loc.attempts).toBeLessThan(loc.trusted_fga);
        if (loc.status === "differs") expect(loc.attempts).toBeGreaterThanOrEqual(loc.trusted_fga);
      }
    }
    expect(files).toBe(integrated.reduce((a, [, e]) => a + e.files, 0));
  }, 120000);
});

describe("heaves, filtering and stable metrics", () => {
  const shots = decodeShots(readShots(2009, "bryanko01"));
  const count = (filter: "all" | "made" | "missed", sel: Parameters<typeof markerState>[2], st: string) =>
    shots.filter((s) => markerState(s, filter, sel) === st).length;
  it("long heaves are counted in the 3PT zone but never drawn", () => {
    const heave = decodeShots({ v: 2, player_id: "x", season: 2009, season_type: "regular", attempts: 1, makes: 0, s: vectors.packed.slice(5 * 21, 5 * 22) });
    expect(heave[0].drawn).toBe(false);
    expect(markerState(heave[0], "all", null)).toBe("hidden");
  });
  it("filters by outcome, drawn shots only", () => {
    const drawn = shots.filter((s) => s.drawn);
    expect(count("all", null, "normal")).toBe(drawn.length);
    expect(count("made", null, "normal")).toBe(drawn.filter((s) => s.made).length);
    expect(count("missed", null, "normal")).toBe(drawn.filter((s) => !s.made).length);
  });
  it("emphasises only the previewed/selected zone's shots and dims the rest", () => {
    for (const zk of ["x3p", "x3d"] as const) {
      const e = count("all", zk, "emphasis");
      expect(e).toBeGreaterThan(0);
      expect(e + count("all", zk, "dim")).toBe(shots.filter((s) => s.drawn).length);
      expect(shots.filter((s) => markerState(s, "all", zk) === "emphasis").every((s) => s.zone === zk)).toBe(true);
    }
    expect(count("all", null, "dim") + count("all", null, "emphasis")).toBe(0);
  });
  it("shooting % never depends on the Made/Missed filter", () => {
    const loc = seasonRows(2009).find((r) => r.player_id === "bryanko01")!.shot_dna.locations!;
    const near = zoneShooting(loc, "x3p");
    const deep = zoneShooting(loc, "x3d");
    expect(near.attempts + deep.attempts).toBe(336);
    expect(near.makes + deep.makes).toBe(118);
    expect(near.pct).toBeCloseTo(near.makes / near.attempts, 10);
    expect(deep.share).toBeCloseTo(deep.attempts / 1712, 10);
    expect(near.share! + deep.share!).toBeCloseTo(336 / 1712, 10);   // the original three-point share
  });
  it("deep-three emphasis, counts and the 30-ft rule agree (recomputed from coordinates)", () => {
    const f = readShots(2009, "bryanko01");
    const deepFromCoords = shots.filter((s) => s.three && (s.sx - 250) ** 2 + (s.sy - 52.5) ** 2 >= 90000);
    expect(deepFromCoords.length).toBe(zoneCounts(shots).x3d[0]);
    expect(shots.filter((s) => s.zone === "x3d").every((s) => s.three)).toBe(true);
    expect(shots.filter((s) => !s.three).every((s) => s.zone !== "x3d" && s.zone !== "x3p")).toBe(true);
    expect(markerState(deepFromCoords.find((s) => s.drawn)!, "all", "x3d")).toBe("emphasis");
    expect(markerState(shots.find((s) => s.zone === "x3p")!, "all", "x3d")).toBe("dim");
    expect(f.attempts).toBe(1712);
  });
  it("one path per marker, nothing invented", () => {
    const some = shots.filter((s) => s.drawn).slice(0, 7);
    expect((markerPath(some, "made", 3).match(/M/g) ?? []).length).toBe(7);
    expect((markerPath(some, "missed", 3).match(/M/g) ?? []).length).toBe(14);
  });
  it("select, switch and clear", () => {
    const a = toggleZone(null, "x3p");
    expect(toggleZone(a, "x3_10")).toBe("x3_10");
    expect(toggleZone("x3_10", "x3_10")).toBeNull();
  });
});

describe("deep threes reconcile for every shipped player-season and baseline", () => {
  it("ordinary + deep three-pointers equal the three-point total in the shot file; zones sum to attempts and makes", () => {
    let n = 0, deepTotal = 0;
    for (const [s, e] of Object.entries(manifest.seasons as Record<string, { status: string }>)) {
      if (e.status !== "integrated") continue;
      for (const r of seasonRows(Number(s))) {
        const loc = r.shot_dna.locations;
        if (!loc) continue;
        const d = decodeShots(readShots(Number(s), r.player_id));
        const threes = d.filter((x) => x.three);
        const z = loc.zones;
        expect(z.x3p[0] + z.x3d[0]).toBe(threes.length);
        expect(z.x3p[1] + z.x3d[1]).toBe(threes.filter((x) => x.made).length);
        expect(z.x3d[0]).toBe(threes.filter((x) => (x.sx - 250) ** 2 + (x.sy - 52.5) ** 2 >= 90000).length);
        expect(Object.values(z).reduce((a, v) => a + v[0], 0)).toBe(loc.attempts);
        expect(Object.values(z).reduce((a, v) => a + v[1], 0)).toBe(loc.makes);
        n++; deepTotal += z.x3d[0];
      }
    }
    expect(n).toBe(11635);
    expect(deepTotal).toBeGreaterThan(30000);
  }, 240000);
  it("season baselines carry the deep zone and reconcile", () => {
    const b = JSON.parse(readFileSync("public/data/shot_baselines.json", "utf8")).seasons as Record<string, { shots?: { attempts: number; makes: number; zones: Record<string, { attempts: number; makes: number; share: number; fg_pct: number | null }> } }>;
    let seasons = 0;
    for (const e of Object.values(b)) {
      if (!e.shots) continue;
      const z = e.shots.zones;
      expect(Object.keys(z).sort()).toEqual(["x0_3", "x10_16", "x16_3p", "x3_10", "x3d", "x3p"]);
      expect(Object.values(z).reduce((a, v) => a + v.attempts, 0)).toBe(e.shots.attempts);
      expect(Object.values(z).reduce((a, v) => a + v.makes, 0)).toBe(e.shots.makes);
      expect(z.x3d.attempts).toBeGreaterThan(0);
      for (const v of Object.values(z)) if (v.attempts) expect(v.fg_pct).toBeCloseTo(v.makes / v.attempts, 3);
      seasons++;
    }
    expect(seasons).toBe(30);
  });
});

describe("season coverage in the manifest and summaries", () => {
  it("partial records have fewer attempts and coverage below 1; every integrated season reconciles at league level", () => {
    for (const [s, e] of Object.entries(manifest.seasons as Record<string, { status: string; coverage: number; shots: number; trusted_fga: number }>)) {
      if (e.status !== "integrated") continue;
      expect(e.coverage).toBeGreaterThan(0.995);
      expect(e.coverage).toBeLessThan(1.005);
      expect(e.shots / e.trusted_fga).toBeCloseTo(e.coverage, 4);
      for (const r of seasonRows(Number(s))) {
        const l = r.shot_dna.locations;
        if (l?.status === "partial") expect(l.coverage!).toBeLessThan(1);
      }
    }
  });
});
