import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { nearestQualifiedSeason, nearestSeasonIn } from "../lib/dataLoader";
import {
  hasMissingLineupStats,
  isSmallSampleSeason,
  latestLineupSeason,
  lineupObservations,
  lineupScores,
  lineupSeasons,
  lineupValue,
} from "../lib/lineup";
import type { PlayerSeasonRecord, PlayersIndex } from "../lib/types";

function rec(over: Partial<PlayerSeasonRecord> & { traits?: Record<string, number | null>; usg?: number | null }): PlayerSeasonRecord {
  const { usg, traits, ...rest } = over;
  return {
    player_id: "p1", player: "P One", season: 2026, season_label: "2025-26", team: "AAA", pos: "SG", pos_group: "Guard",
    age: 25, g: 50, gs: 10, mp: 300, qualified: false, small_sample: true,
    basic: { pts: 1, trb: 1, ast: 1, stl: 1, blk: 1, fg_percent: 0.4, x3p_percent: 0.3, ft_percent: 0.7 },
    vector: { usg_percent: usg === undefined ? 0 : usg },
    traits: { Playmaking: 50, "Perimeter Profile": 50, "Rim Pressure": 50, Rebounding: 50, "Defensive Activity": 50, ...(traits ?? {}) },
    archetype: "x", trait_tags: [], shot_dna: {} as PlayerSeasonRecord["shot_dna"], galaxy: null,
    career: { ht_in_in: null, wt: null, birth_date: null, hof: false, from_year: null, to_year: null }, team_stints: [],
    ...rest,
  } as PlayerSeasonRecord;
}

describe("lineup season pool", () => {
  const thybulle = { name: "Matisse Thybulle", seasons: [2020, 2021, 2022, 2023, 2024, 2025, 2026], qualified_seasons: [2020, 2021, 2022, 2023, 2024], latest_team: "POR" };

  it("offers every display-eligible season, and defaults to the latest", () => {
    expect(lineupSeasons(thybulle)).toEqual([2020, 2021, 2022, 2023, 2024, 2025, 2026]);
    expect(latestLineupSeason(thybulle)).toBe(2026);
  });

  it("flags only seasons below the comparison cutoff as small samples", () => {
    expect(isSmallSampleSeason(thybulle, 2024)).toBe(false);
    expect(isSmallSampleSeason(thybulle, 2025)).toBe(true);
    expect(isSmallSampleSeason(thybulle, 2026)).toBe(true);
    expect(isSmallSampleSeason(thybulle, 2010)).toBe(false); // not a season he played
  });

  it("handles a player with only small-sample seasons", () => {
    const only = { seasons: [2019, 2020], qualified_seasons: [] as number[] };
    expect(latestLineupSeason(only)).toBe(2020);
    expect(isSmallSampleSeason(only, 2019)).toBe(true);
    expect(nearestQualifiedSeason(only, 2020)).toBeNull(); // the shared default pool is unchanged
    expect(nearestSeasonIn(only.seasons, 2020)).toBe(2020);
  });

  it("nearestSeasonIn matches nearestQualifiedSeason's rules", () => {
    expect(nearestSeasonIn([], 2000)).toBeNull();
    expect(nearestSeasonIn([2000, 2010], 2005)).toBe(2010); // tie -> more recent
    expect(nearestSeasonIn([2001, 2016], 2018)).toBe(2016);
    expect(nearestQualifiedSeason({ qualified_seasons: [2000, 2010] }, 2005)).toBe(2010);
  });
});

describe("lineup scores", () => {
  it("averages each stat across the lineup", () => {
    const a = rec({ player_id: "a", traits: { Playmaking: 80, Rebounding: 20 } });
    const b = rec({ player_id: "b", traits: { Playmaking: 40, Rebounding: 60 } });
    const s = lineupScores([a, b])!;
    expect(s.Playmaking).toBe(60);
    expect(s.Rebounding).toBe(40);
  });

  it("returns null for no players", () => {
    expect(lineupScores([])).toBeNull();
  });

  it("reports Unavailable (null), never zero, when a stat is missing", () => {
    const a = rec({ player_id: "a", traits: { Playmaking: 80 } });
    const b = rec({ player_id: "b", traits: { Playmaking: null } });
    const s = lineupScores([a, b])!;
    expect(s.Playmaking).toBeNull();
    expect(s.Rebounding).toBe(50);
    expect(hasMissingLineupStats(b)).toBe(true);
    expect(hasMissingLineupStats(a)).toBe(false);
  });

  it("treats missing usage as unavailable, but a real value of 0 as a value", () => {
    expect(lineupValue(rec({ usg: null }), "__ball_dominance")).toBeNull();
    expect(lineupValue(rec({ usg: undefined }), "__ball_dominance")).not.toBeNull();
    expect(lineupValue(rec({ traits: { Rebounding: 0 } }), "Rebounding")).toBe(0);
  });

  it("says 'selected players' (never 'five') with three, four or five players", () => {
    for (const n of [3, 4, 5]) {
      const players = Array.from({ length: n }, (_, i) => rec({ player_id: `p${i}`, pos_group: "Guard", traits: { Playmaking: 90, "Rim Pressure": 90 }, usg: 2 }));
      const obs = lineupObservations(players, lineupScores(players)!);
      expect(obs).toContain("All selected players share one position group (Guard)");
      expect(obs.join(" ")).not.toMatch(/\bfive\b/i);
      expect(obs).toContain(`Several selected players handle the ball and create shots often (${n} of ${n})`);
      expect(obs).toContain("Several selected players attack the basket often");
    }
  });

  it("does not build observations from missing stats", () => {
    const players = ["a", "b", "c"].map((id) => rec({ player_id: id, traits: { Playmaking: null, Rebounding: null, "Perimeter Profile": null } }));
    const scores = lineupScores(players)!;
    const obs = lineupObservations(players, scores);
    expect(obs.some((o) => /rebound|three-point/i.test(o))).toBe(false);
  });
});

// Every player in the real index: the lineup's season list must be exactly
// what Explore offers, and every one of those seasons must have a record.
describe("lineup seasons across every player (real data)", () => {
  const root = join(__dirname, "..", "public", "data");
  const index = JSON.parse(readFileSync(join(root, "players_index.json"), "utf8")) as PlayersIndex;
  const bySeason = new Map<string, Map<number, PlayerSeasonRecord>>();
  for (const f of readdirSync(join(root, "seasons"))) {
    const rows = JSON.parse(readFileSync(join(root, "seasons", f), "utf8")) as PlayerSeasonRecord[];
    for (const r of rows) {
      if (!bySeason.has(r.player_id)) bySeason.set(r.player_id, new Map());
      bySeason.get(r.player_id)!.set(r.season, r);
    }
  }

  it("matches the display-eligible seasons in the season files for every player", () => {
    const bad: string[] = [];
    for (const [id, entry] of Object.entries(index)) {
      const files = [...(bySeason.get(id)?.keys() ?? [])].sort((a, b) => a - b);
      if (JSON.stringify(lineupSeasons(entry)) !== JSON.stringify(files)) bad.push(id);
    }
    expect(bad).toEqual([]);
    expect(Object.keys(index).length).toBeGreaterThan(2000);
  });

  it("flags small samples exactly as the data does, and defaults to the latest season", () => {
    const bad: string[] = [];
    let smallOnly = 0;
    let gained = 0;
    for (const [id, entry] of Object.entries(index)) {
      const recs = bySeason.get(id)!;
      for (const s of lineupSeasons(entry)) {
        const r = recs.get(s)!;
        if (isSmallSampleSeason(entry, s) !== r.small_sample) bad.push(`${id}:${s}`);
        if ((r.mp ?? 0) < 250) bad.push(`${id}:${s}:mp`);
      }
      expect(latestLineupSeason(entry)).toBe(Math.max(...entry.seasons));
      if (entry.qualified_seasons.length === 0) smallOnly++;
      gained += entry.seasons.length - entry.qualified_seasons.length;
    }
    expect(bad).toEqual([]);
    expect(smallOnly).toBeGreaterThan(0); // players with only small-sample seasons exist and are covered
    expect(gained).toBeGreaterThan(0);
  });

  it("includes Matisse Thybulle's 2024-25 and 2025-26 seasons", () => {
    const entry = Object.values(index).find((e) => e.name === "Matisse Thybulle")!;
    expect(lineupSeasons(entry)).toEqual(expect.arrayContaining([2025, 2026]));
  });

  it("has every lineup stat present for every player-season (so nothing falls back to Unavailable today)", () => {
    const missing: string[] = [];
    for (const [id, recs] of bySeason) for (const [s, r] of recs) if (hasMissingLineupStats(r)) missing.push(`${id}:${s}`);
    expect(missing).toEqual([]);
  });
});
