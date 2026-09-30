import { describe, it, expect } from "vitest";
import { similarityIndex, findClosestMatches, type SimilarityPoolEntry } from "../lib/similarity";
import { SIMILARITY_FEATURES } from "../lib/config";

function vec(seed: number): Record<string, number> {
  const out: Record<string, number> = {};
  let s = seed;
  for (const f of SIMILARITY_FEATURES) {
    s = (s * 9301 + 49297) % 233280;
    out[f] = (s / 233280) * 4 - 2;
  }
  return out;
}

function entry(id: string, season: number, seed: number, posGroup = "Wing"): SimilarityPoolEntry {
  return {
    player_id: id,
    player: id,
    season,
    season_label: `${season - 1}-${String(season).slice(-2)}`,
    pos_group: posGroup,
    archetype: "Balanced Wing",
    vector: vec(seed),
  };
}

describe("similarity engine behavior", () => {
  it("uses exactly 12 similarity features (regression: docs previously said 11 in nine places)", () => {
    expect(SIMILARITY_FEATURES.length).toBe(12);
  });

  it("identical vectors return exactly 100", () => {
    const v = vec(1);
    expect(similarityIndex(v, v)).toBe(100);
  });

  it("is symmetric", () => {
    const a = vec(1);
    const b = vec(2);
    expect(similarityIndex(a, b)).toBeCloseTo(similarityIndex(b, a), 9);
  });

  it("is bounded between 0 and 100", () => {
    for (let i = 0; i < 50; i++) {
      const s = similarityIndex(vec(i), vec(i + 100));
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it("excludes self-match from closest-match results", () => {
    const query = entry("p1", 2020, 1);
    const pool = [query, entry("p2", 2020, 2), entry("p3", 2020, 3)];
    const results = findClosestMatches(query, pool, {});
    expect(results.find((r) => r.player_id === "p1" && r.season === 2020)).toBeUndefined();
  });

  it("excludes other seasons of the same player by default", () => {
    const query = entry("p1", 2020, 1);
    const pool = [query, entry("p1", 2019, 1.1), entry("p2", 2020, 2)];
    const results = findClosestMatches(query, pool, {});
    expect(results.find((r) => r.player_id === "p1")).toBeUndefined();
  });

  it("includes other seasons of the same player when the toggle is on", () => {
    const query = entry("p1", 2020, 1);
    const pool = [query, entry("p1", 2019, 1.1), entry("p2", 2020, 2)];
    const results = findClosestMatches(query, pool, { includeOtherSeasonsOfSamePlayer: true });
    expect(results.find((r) => r.player_id === "p1" && r.season === 2019)).toBeDefined();
  });

  it("same_season filter only returns candidates from the query season", () => {
    const query = entry("p1", 2020, 1);
    const pool = [query, entry("p2", 2020, 2), entry("p3", 2019, 3)];
    const results = findClosestMatches(query, pool, { seasonMode: "same_season" });
    expect(results.every((r) => r.season === 2020)).toBe(true);
  });

  it("same_era filter respects the era window", () => {
    const query = entry("p1", 2020, 1);
    const pool = [query, entry("p2", 2023, 2), entry("p3", 2030, 3)];
    const results = findClosestMatches(query, pool, { seasonMode: "same_era", eraWindow: 5 });
    expect(results.find((r) => r.player_id === "p3")).toBeUndefined();
    expect(results.find((r) => r.player_id === "p2")).toBeDefined();
  });

  it("position filter only returns the matching position group", () => {
    const query = entry("p1", 2020, 1, "Guard");
    const pool = [query, entry("p2", 2020, 2, "Big"), entry("p3", 2020, 3, "Guard")];
    const results = findClosestMatches(query, pool, { positionGroup: "Guard" });
    expect(results.every((r) => r.pos_group === "Guard")).toBe(true);
  });

  it("orders results by descending similarity", () => {
    const query = entry("p1", 2020, 1);
    const pool = [query, entry("p2", 2020, 2), entry("p3", 2020, 3), entry("p4", 2020, 4)];
    const results = findClosestMatches(query, pool, {}, 10);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
    }
  });
});
