import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  findClosestMatches,
  inSeasonWindow,
  parseCompareWindow,
  playerSeasonKey,
  windowBounds,
  windowToFilters,
  hasUsableVector,
  type SimilarityPoolEntry,
} from "../lib/similarity";
import { computeSharedEmbedding } from "../lib/embedding";
import { SIMILARITY_FEATURES, SEASON_MIN, SEASON_MAX, seasonLabel } from "../lib/config";

function vec(seed: number): Record<string, number> {
  const out: Record<string, number> = {};
  let s = seed;
  for (const f of SIMILARITY_FEATURES) {
    s = (s * 9301 + 49297) % 233280;
    out[f] = (s / 233280) * 4 - 2;
  }
  return out;
}
function entry(id: string, season: number, seed: number): SimilarityPoolEntry {
  return { player_id: id, player: id, season, season_label: "", pos_group: "Wing", archetype: "Balanced Wing", vector: vec(seed) };
}

describe("compare-across windows", () => {
  it("clamps relative windows to the dataset", () => {
    expect(windowBounds("5", SEASON_MIN, SEASON_MIN, SEASON_MAX)).toEqual([SEASON_MIN, SEASON_MIN + 5]);
    expect(windowBounds("10", SEASON_MAX, SEASON_MIN, SEASON_MAX)).toEqual([SEASON_MAX - 10, SEASON_MAX]);
    // 2009 - 10 = 1999, which is inside the dataset, so ±10 does not clamp here.
    expect(windowBounds("10", 2009, SEASON_MIN, SEASON_MAX)).toEqual([1999, 2019]);
    expect(windowBounds("10", 2003, SEASON_MIN, SEASON_MAX)).toEqual([SEASON_MIN, 2013]);
    expect(windowBounds("all", 2009, SEASON_MIN, SEASON_MAX)).toEqual([SEASON_MIN, SEASON_MAX]);
    expect(windowBounds("season", 2009, SEASON_MIN, SEASON_MAX)).toEqual([2009, 2009]);
  });

  it("one predicate defines every window", () => {
    const f5 = windowToFilters("5");
    expect(inSeasonWindow(2014, 2009, f5)).toBe(true);
    expect(inSeasonWindow(2015, 2009, f5)).toBe(false);
    expect(inSeasonWindow(2009, 2009, windowToFilters("season"))).toBe(true);
    expect(inSeasonWindow(2010, 2009, windowToFilters("season"))).toBe(false);
    expect(inSeasonWindow(SEASON_MAX, SEASON_MIN, windowToFilters("all"))).toBe(true);
  });

  it("starts at 1996-97 and clamps every window at both boundaries", () => {
    expect(seasonLabel(SEASON_MIN)).toBe("1996-97");
    expect(SEASON_MAX).toBeGreaterThan(SEASON_MIN);
    expect(windowBounds("season", SEASON_MIN, SEASON_MIN, SEASON_MAX)).toEqual([SEASON_MIN, SEASON_MIN]);
    expect(windowBounds("5", SEASON_MIN, SEASON_MIN, SEASON_MAX)).toEqual([SEASON_MIN, SEASON_MIN + 5]);
    expect(windowBounds("10", SEASON_MIN, SEASON_MIN, SEASON_MAX)).toEqual([SEASON_MIN, SEASON_MIN + 10]);
    expect(windowBounds("all", SEASON_MIN, SEASON_MIN, SEASON_MAX)).toEqual([SEASON_MIN, SEASON_MAX]);
    expect(windowBounds("season", SEASON_MAX, SEASON_MIN, SEASON_MAX)).toEqual([SEASON_MAX, SEASON_MAX]);
    expect(windowBounds("5", SEASON_MAX, SEASON_MIN, SEASON_MAX)).toEqual([SEASON_MAX - 5, SEASON_MAX]);
    expect(windowBounds("all", SEASON_MAX, SEASON_MIN, SEASON_MAX)).toEqual([SEASON_MIN, SEASON_MAX]);
  });

  it("falls back to Season for unknown URL values", () => {
    expect(parseCompareWindow("banana")).toBe("season");
    expect(parseCompareWindow(null)).toBe("season");
    expect(parseCompareWindow("10")).toBe("10");
  });
});

describe("cross-era match search", () => {
  const query = entry("kobe", 2009, 1);
  const pool = [
    query,
    entry("kobe", 2007, 1), // same vector as the query: closest of all, but the same player
    entry("kobe", 2011, 2),
    entry("wade", 2009, 3),
    entry("wade", 2003, 3),
    entry("harden", 2019, 5),
    entry("harden", 2012, 5),
  ];

  it("excludes the reference and the reference player's other seasons by default", () => {
    const r = findClosestMatches(query, pool, { seasonMode: "all", onePerPlayer: true }, 10);
    expect(r.some((m) => m.player_id === "kobe")).toBe(false);
  });

  it("returns at most one season per matched player", () => {
    const r = findClosestMatches(query, pool, { seasonMode: "all", onePerPlayer: true }, 10);
    const ids = r.map((m) => m.player_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(["harden", "wade"]);
  });

  it("keeps each player's best season", () => {
    const all = findClosestMatches(query, pool, { seasonMode: "all" }, 10).filter((m) => m.player_id === "wade");
    const one = findClosestMatches(query, pool, { seasonMode: "all", onePerPlayer: true }, 10).find((m) => m.player_id === "wade");
    expect(one?.similarity).toBe(Math.max(...all.map((m) => m.similarity)));
  });

  it("only looks inside the chosen window", () => {
    const r = findClosestMatches(query, pool, { ...windowToFilters("5"), onePerPlayer: true }, 10);
    expect(r.every((m) => Math.abs(m.season - 2009) <= 5)).toBe(true);
    expect(r.find((m) => m.player_id === "harden")?.season).toBe(2012);
  });

  it("orders ties deterministically", () => {
    const twins = [entry("b", 2010, 9), entry("a", 2010, 9), entry("c", 2008, 9)];
    const a = findClosestMatches(query, twins, {}, 3).map((m) => playerSeasonKey(m.player_id, m.season));
    const b = findClosestMatches(query, [...twins].reverse(), {}, 3).map((m) => playerSeasonKey(m.player_id, m.season));
    expect(a).toEqual(b);
    expect(a).toEqual(["a_2010", "b_2010", "c_2008"]);
  });

  it("skips observations with missing features and never emits NaN", () => {
    const broken: SimilarityPoolEntry = { ...entry("broken", 2009, 4), vector: { ...vec(4), ast_percent: null, ts_percent: Number.NaN } };
    const empty: SimilarityPoolEntry = { ...entry("empty", 2009, 4), vector: {} };
    expect(hasUsableVector(broken.vector)).toBe(false);
    const r = findClosestMatches(query, [...pool, broken, empty], { seasonMode: "all" }, 20);
    expect(r.some((m) => m.player_id === "broken" || m.player_id === "empty")).toBe(false);
    expect(r.every((m) => Number.isFinite(m.similarity))).toBe(true);
    expect(findClosestMatches(broken, pool, {}, 5)).toEqual([]);
  });

  it("works for a player with a single season", () => {
    const solo = entry("rookie", 2026, 8);
    expect(() => findClosestMatches(solo, [solo, ...pool], { seasonMode: "all", onePerPlayer: true }, 5)).not.toThrow();
  });
});

describe("shared map layout", () => {
  const pool = Array.from({ length: 60 }, (_, i) => entry(`p${i}`, 2001 + (i % 20), i + 1));

  it("is deterministic and finite", () => {
    const a = computeSharedEmbedding(pool);
    const b = computeSharedEmbedding([...pool]);
    expect(a.size).toBe(60);
    for (const [k, p] of a) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(b.get(k)).toEqual(p);
    }
  });

  it("is keyed by player-season, so one player's seasons get distinct points", () => {
    const two = computeSharedEmbedding([entry("a", 2005, 1), entry("a", 2006, 2), entry("b", 2005, 3)]);
    expect(two.has("a_2005") && two.has("a_2006") && two.has("b_2005")).toBe(true);
    expect(two.get("a_2005")).not.toEqual(two.get("a_2006"));
  });

  it("omits unusable observations and tolerates tiny pools", () => {
    const bad: SimilarityPoolEntry = { ...entry("bad", 2005, 1), vector: {} };
    expect(computeSharedEmbedding([bad]).size).toBe(0);
    expect(computeSharedEmbedding([]).size).toBe(0);
  });
});

describe("shipped data", () => {
  const read = <T,>(p: string): T => JSON.parse(readFileSync(path.join(__dirname, "../public/data", p), "utf8")) as T;
  const pool = read<SimilarityPoolEntry[]>("similarity_pool.json");

  it("has one pool row per player-season, all with usable vectors", () => {
    expect(new Set(pool.map((e) => playerSeasonKey(e.player_id, e.season))).size).toBe(pool.length);
    expect(pool.every((e) => hasUsableVector(e.vector))).toBe(true);
  });

  it("covers every season from the first to the last", () => {
    const seasons = new Set(pool.map((e) => e.season));
    for (let s = SEASON_MIN; s <= SEASON_MAX; s++) expect(seasons.has(s)).toBe(true);
  });

  it("keeps every 2001+ standardized vector, archetype and position group exactly as before the 1996-97 expansion", () => {
    // Fingerprint of the 8,923 pre-expansion pool rows (season >= 2001), recorded
    // from the committed 2000-01..2025-26 data. Adding earlier seasons must not
    // change any season-relative value, so this hash must never move.
    const legacy = pool
      .filter((e) => e.season >= 2001)
      .sort((a, b) => (a.player_id < b.player_id ? -1 : a.player_id > b.player_id ? 1 : a.season - b.season));
    expect(legacy).toHaveLength(8923);
    const hash = createHash("sha256")
      .update(JSON.stringify(legacy.map((e) => [e.player_id, e.season, e.archetype, e.pos_group, ...SIMILARITY_FEATURES.map((f) => e.vector[f])])))
      .digest("hex");
    expect(hash).toBe("c8eade62492fde402d05b54049e21c8447f0e6923d97bf7c3c4a8bdd6d73d7fd");
  });

  it("pool membership follows the unchanged 500 minute / 20 game rule in every season, including lockout 1998-99", () => {
    for (let s = SEASON_MIN; s <= SEASON_MAX; s++) {
      const rows = read<{ player_id: string; mp: number; g: number; qualified: boolean }[]>(`seasons/${s}.json`);
      const expected = rows.filter((r) => r.mp >= 500 && r.g >= 20).map((r) => r.player_id).sort();
      expect(rows.filter((r) => r.qualified).map((r) => r.player_id).sort()).toEqual(expected);
      expect(pool.filter((e) => e.season === s).map((e) => e.player_id).sort()).toEqual(expected);
    }
    const lockout = pool.filter((e) => e.season === 1999);
    expect(lockout.length).toBeGreaterThan(200);
    expect(lockout.length).toBeLessThan(pool.filter((e) => e.season === 2000).length);
  });

  it("keeps player ids stable across the 1999-00 / 2000-01 boundary", () => {
    const index = read<Record<string, { name: string; seasons: number[] }>>("players_index.json");
    for (const id of ["bryanko01", "onealsh01", "garneke01", "iversal01", "duncati01", "kiddja01", "hillgr01", "cartevi01"]) {
      // A player can miss the 250-minute display floor in one season (Grant Hill
      // played 4 games in 2000-01), so require 1999-00 plus later seasons under
      // the same id rather than 2000-01 specifically.
      expect(index[id].seasons).toContain(2000);
      expect(index[id].seasons.some((season) => season >= 2001)).toBe(true);
      const career = read<{ player_id: string; season: number }[]>(`career/${id}.json`);
      expect(new Set(career.map((r) => r.player_id))).toEqual(new Set([id]));
    }
  });

  it("returns one season per matched player when searching the real full-range pool", () => {
    const query = pool.find((e) => e.player_id === "bryanko01" && e.season === 1999)!;
    const matches = findClosestMatches(query, pool, { ...windowToFilters("all"), onePerPlayer: true }, 20);
    expect(matches).toHaveLength(20);
    expect(new Set(matches.map((m) => m.player_id)).size).toBe(20);
    expect(matches.every((m) => m.player_id !== "bryanko01")).toBe(true);
  });

  it("per-season map coordinates cover exactly the qualified pool", () => {
    for (let s = SEASON_MIN; s <= SEASON_MAX; s++) {
      const g = read<{ points: { player_id: string }[] }>(`galaxy/${s}.json`);
      const ids = pool.filter((e) => e.season === s).map((e) => e.player_id).sort();
      expect(g.points.map((p) => p.player_id).sort()).toEqual(ids);
    }
  });

  it("latest season is a complete one, not a partial snapshot", () => {
    // The dataset carries no in-progress flag, so completeness is judged from
    // the data itself: games played in the latest season must look like a full
    // schedule (same as the previous season), not a truncated one. This test
    // fails if a partial season is ever exported without being labelled.
    const maxG = (s: number) => Math.max(...read<{ g: number | null }[]>(`seasons/${s}.json`).map((r) => r.g ?? 0));
    expect(maxG(SEASON_MAX)).toBeGreaterThanOrEqual(maxG(SEASON_MAX - 1) - 2);
    expect(maxG(SEASON_MAX)).toBeGreaterThanOrEqual(80);
  });
});
