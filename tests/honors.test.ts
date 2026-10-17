import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { honorsFor, coveredCategories, POSTSEASON_NOTE, CHAMPION_NOTE } from "@/lib/honors";
import type { HonorsFile } from "@/lib/honors";

const file = JSON.parse(readFileSync("public/data/honors.json", "utf8")) as HonorsFile;
const labels = (id: string, season: number) => {
  const r = honorsFor(file, id, season);
  return "items" in r ? r.items.map((i) => i.label) : [];
};

describe("season honors", () => {
  it("Steve Nash shows MVP in 2004-05 and 2005-06 (season 2005 and 2006) only", () => {
    expect(labels("nashst01", 2005)).toContain("Most Valuable Player");
    expect(labels("nashst01", 2006)).toContain("Most Valuable Player");
    for (const s of [2004, 2007, 2008, 2009, 2010, 2003]) expect(labels("nashst01", s)).not.toContain("Most Valuable Player");
  });

  it("an award announced in 2005 belongs to 2004-05, not 2005-06", () => {
    // Nash's 2005 and 2006 MVPs are announced in spring 2005 and 2006: each sits on its own season
    const mvpSeasons = Object.entries(file.players.nashst01).filter(([, v]) => v.some((i) => i.k === "mvp")).map(([s]) => Number(s));
    expect(mvpSeasons.sort()).toEqual([2005, 2006]);
  });

  it("a voting runner-up is never shown as a winner (Shaquille O'Neal finished second in 2005 MVP voting)", () => {
    expect(labels("onealsh01", 2005)).not.toContain("Most Valuable Player");
    const winners = Object.values(file.players).flatMap((p) => p["2005"] ?? []).filter((i) => i.k === "mvp");
    expect(winners).toHaveLength(1);
  });

  it("exactly one MVP, DPOY, Sixth Man and Most Improved winner per covered season, and team sizes are right", () => {
    for (const k of ["mvp", "dpoy", "smoy", "mip"] as const) {
      for (let s = 1997; s <= file.coverage[k]!.to; s++) {
        const n = Object.values(file.players).flatMap((p) => p[String(s)] ?? []).filter((i) => i.k === k).length;
        expect(n, `${k} ${s}`).toBe(1);
      }
    }
    for (let s = 1997; s <= 2025; s++) {
      const all = Object.values(file.players).flatMap((p) => p[String(s)] ?? []);
      for (const t of [1, 2, 3]) expect(all.filter((i) => i.k === "allnba" && i.t === t).length, `allnba ${t} ${s}`).toBe(5);
      for (const t of [1, 2]) expect(all.filter((i) => i.k === "alldef" && i.t === t).length).toBeGreaterThanOrEqual(5);
      for (const t of [1, 2]) expect(all.filter((i) => i.k === "allrookie" && i.t === t).length).toBeGreaterThanOrEqual(5);
    }
  });

  it("shared winners are marked (2000 Rookie of the Year went to two players)", () => {
    const roy = Object.entries(file.players).filter(([, p]) => (p["2000"] ?? []).some((i) => i.k === "roy"));
    expect(roy).toHaveLength(2);
    for (const [id] of roy) {
      const r = honorsFor(file, id, 2000);
      expect("items" in r && r.items.find((i) => i.key === "roy")?.detail).toBe("Shared award");
    }
  });

  it("a traded player gets one set of honors for the season (Mutombo 2001: DPOY, All-NBA, All-Defensive)", () => {
    const l = labels("mutomdi01", 2001);
    expect(l).toContain("Defensive Player of the Year");
    expect(l).toContain("All-NBA Second Team");
    expect(l).toContain("All-Defensive First Team");
    expect(new Set(l).size).toBe(l.length);
  });

  it("separates 'No recorded honors' from incomplete coverage and from unavailable data", () => {
    // a player with no honors in a fully covered season, and in the now fully covered 2025-26
    expect(honorsFor(file, "abdulma02", 1998)).toEqual({ state: "none", message: "No recorded honors" });
    expect(honorsFor(file, "abdulma02", 2026)).toEqual({ state: "none", message: "No recorded honors" });
    expect(honorsFor(null, "nashst01", 2005).state).toBe("unavailable");
    // a season whose awards are not covered is "incomplete", never "no honors"
    const gap: HonorsFile = { ...file, coverage: { ...file.coverage, mvp: { ...file.coverage.mvp!, to: 2025 } } };
    const r = honorsFor(gap, "abdulma02", 2026);
    expect(r.state).toBe("partial");
    expect("message" in r && r.message).toMatch(/incomplete/);
  });

  it("2025-26 awards are present and verified: MVP, Finals MVP, All-NBA levels, and a champion's roster fact", () => {
    const cats = coveredCategories(file, 2026);
    expect(cats.missing).toEqual([]);
    expect(labels("gilgesh01", 2026)).toEqual(expect.arrayContaining(["Most Valuable Player", "All-NBA First Team", "All-Star"]));
    const b = labels("brunsja01", 2026);
    expect(b).toEqual(expect.arrayContaining(["Finals MVP", "All-NBA Second Team", "All-Star", "On the championship roster"]));
    expect(labels("wembavi01", 2026)).toContain("Defensive Player of the Year");
    expect(labels("flaggco01", 2026)).toContain("Rookie of the Year");
    expect(labels("johnske04", 2026)).toContain("Sixth Man of the Year");
    expect(labels("alexani01", 2026)).toContain("Most Improved Player");
    expect(labels("murraja01", 2026)).toContain("All-NBA Third Team");
  });

  it("an award never lands on another season of the same player", () => {
    expect(labels("gilgesh01", 2024)).not.toContain("Finals MVP");
    expect(labels("gilgesh01", 2025)).toContain("Finals MVP"); // his own season
    expect(labels("brunsja01", 2025)).not.toContain("Finals MVP");
    expect(labels("brunsja01", 2025)).not.toContain("On the championship roster");
  });

  it("1999 had no All-Star game and that is recorded as such, not as missing data", () => {
    expect(file.coverage.allstar!.noGame).toContain(1999);
    expect(coveredCategories(file, 1999).covered).toContain("allstar");
  });

  it("every category is covered through 2025-26 and the notes say what each badge means", () => {
    expect(file.coverage.champion!.to).toBe(2026);
    expect(file.coverage.finalsmvp).toMatchObject({ from: 1997, to: 2026 });
    expect(POSTSEASON_NOTE).toMatch(/descriptive only/);
    expect(CHAMPION_NOTE).toMatch(/appeared in a playoff game/);
    const keys = new Set(Object.values(file.players).flatMap((p) => Object.values(p).flatMap((v) => v.map((i) => i.k))));
    expect([...keys].sort()).toEqual(["allnba", "alldef", "allrookie", "allstar", "champion", "dpoy", "finalsmvp", "mip", "mvp", "ring", "roy", "smoy"].sort());
  });

  it("Finals MVP: exactly one winner per completed Finals, and he is on the champion's roster", () => {
    for (let s = 1997; s <= 2026; s++) {
      const win = Object.entries(file.players).filter(([, p]) => (p[String(s)] ?? []).some((i) => i.k === "finalsmvp"));
      expect(win.length, `Finals MVP ${s}`).toBe(1);
      expect(labels(win[0][0], s)).toContain("On the championship roster");
    }
  });

  it("three championship facts stay separate: the roster fact is only for verified members, appearance is labelled precisely", () => {
    for (let s = 1997; s <= 2026; s++) {
      const teams = new Set(Object.values(file.players).flatMap((p) => (p[String(s)] ?? []).filter((i) => i.k === "champion" || i.k === "ring").map((i) => i.tm)));
      expect(teams.size, `champion team ${s}`).toBe(1);
    }
    // Nash never won a title: a long regular-season tenure on good teams does not make him a champion
    expect(Object.values(file.players.nashst01).flat().some((i) => i.k === "champion" || i.k === "ring")).toBe(false);
    // a champion who appeared but is not a verified roster member reads as an appearance, never as a ring
    const app = Object.entries(file.players).find(([, p]) => (p["2001"] ?? []).some((i) => i.k === "champion") && !(p["2001"] ?? []).some((i) => i.k === "ring"))!;
    expect(labels(app[0], 2001)).toContain("Played in the playoffs for the champion");
    expect(labels(app[0], 2001)).not.toContain("On the championship roster");
    const rows = Object.values(file.players).flatMap((p) => Object.values(p).map((v) => v.filter((i) => i.k === "champion").length));
    expect(Math.max(...rows)).toBe(1);
  });

  it("a non-champion player-season never carries a Finals MVP or roster badge", () => {
    for (const p of Object.values(file.players)) for (const v of Object.values(p)) {
      if (v.some((i) => i.k === "finalsmvp" || i.k === "ring")) expect(v.some((i) => i.k === "champion" || i.k === "ring")).toBe(true);
    }
    expect(honorsFor(file, "abdulma02", 1998)).toEqual({ state: "none", message: "No recorded honors" });
  });

  it("shared winners are kept and recipients with no app profile still exist in the honors data", () => {
    const roy = Object.entries(file.players).filter(([, p]) => Object.entries(p).some(([, v]) => v.some((i) => i.k === "roy")));
    const per = new Map<string, number>();
    for (const [, p] of roy) for (const [s, v] of Object.entries(p)) if (v.some((i) => i.k === "roy")) per.set(s, (per.get(s) ?? 0) + 1);
    expect(Math.max(...per.values())).toBe(2);
    const idx = JSON.parse(readFileSync("public/data/players_index.json", "utf8")) as Record<string, { seasons: number[] }>;
    const noProfile = Object.entries(file.players).filter(([id, p]) => Object.keys(p).some((s) => !idx[id]?.seasons?.includes(Number(s))));
    expect(noProfile.length).toBeGreaterThan(0);
  });

  it("awards introduced after the first covered season are 'not yet awarded', not gaps", () => {
    const f2: HonorsFile = { ...file, coverage: { ...file.coverage, mip: { from: 1980, to: 2025, introduced: 1986 } } };
    const c = coveredCategories(f2, 1984);
    expect(c.notYet).toContain("mip");
    expect(c.missing).not.toContain("mip");
  });
});
