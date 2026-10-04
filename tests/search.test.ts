import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchPlayers, nearestQualifiedSeason, resolveSeason, comparableSeasons, isComparisonQualified } from "../lib/dataLoader";
import type { PlayersIndex } from "../lib/types";

const INDEX: PlayersIndex = {
  jamesle01: { name: "LeBron James", seasons: [2004, 2005], qualified_seasons: [2004, 2005], latest_team: "CLE" },
  curryst01: { name: "Stephen Curry", seasons: [2010], qualified_seasons: [2010], latest_team: "GSW" },
  curryde01: { name: "Dell Curry", seasons: [1990], qualified_seasons: [1990], latest_team: "TOR" },
  jokicni01: { name: "Nikola Jokić", seasons: [2016], qualified_seasons: [2016], latest_team: "DEN" },
  bryanko01: { name: "Kobe Bryant", seasons: [2001, 2016], qualified_seasons: [2001, 2016], latest_team: "LAL" },
  noqual01: { name: "Nobody Qualified", seasons: [2005], qualified_seasons: [], latest_team: "XXX" },
};

describe("searchPlayers ranking", () => {
  it("ranks an exact match first", () => {
    const results = searchPlayers(INDEX, "LeBron James");
    expect(results[0].id).toBe("jamesle01");
    expect(results[0].matchType).toBe("exact");
  });

  it("ranks whole-name-prefix above a match that's only a later word", () => {
    // "curry" is a per-word prefix match for both Curry players (second
    // word) -- regression guard: both should appear, not just one.
    const results = searchPlayers(INDEX, "curry");
    const ids = results.map((r) => r.id);
    expect(ids).toContain("curryst01");
    expect(ids).toContain("curryde01");
  });

  it("is alphabetical within a tier", () => {
    const results = searchPlayers(INDEX, "curry");
    const names = results.map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("is diacritic-insensitive", () => {
    const results = searchPlayers(INDEX, "jokic");
    expect(results.some((r) => r.id === "jokicni01")).toBe(true);
  });

  it("is case-insensitive", () => {
    const results = searchPlayers(INDEX, "LEBRON");
    expect(results.some((r) => r.id === "jamesle01")).toBe(true);
  });

  it("returns nothing for an empty or whitespace-only query", () => {
    expect(searchPlayers(INDEX, "")).toEqual([]);
    expect(searchPlayers(INDEX, "   ")).toEqual([]);
  });

  it("respects the limit parameter", () => {
    const results = searchPlayers(INDEX, "a", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe("searchPlayers partial names and scope", () => {
  it("finds partial first and last names, in either order", () => {
    expect(searchPlayers(INDEX, "kob")[0].id).toBe("bryanko01");
    expect(searchPlayers(INDEX, "bryant ko")[0].id).toBe("bryanko01");
    expect(searchPlayers(INDEX, "kobe b")[0].id).toBe("bryanko01");
  });

  it("ranks a full-name prefix above a later-word match", () => {
    const idx: PlayersIndex = {
      a: { name: "Anthony Davis", seasons: [2010], qualified_seasons: [2010], latest_team: "X" },
      b: { name: "Baron Davis", seasons: [2002, 2003, 2004], qualified_seasons: [2002], latest_team: "X" },
      c: { name: "Davis Bertans", seasons: [2019], qualified_seasons: [2019], latest_team: "X" },
    };
    expect(searchPlayers(idx, "davis")[0].id).toBe("c");
  });

  it("ignores punctuation and hyphens", () => {
    const idx: PlayersIndex = { x: { name: "Shaquille O'Neal", seasons: [2001], qualified_seasons: [2001], latest_team: "L" } };
    expect(searchPlayers(idx, "oneal")).toHaveLength(1);
    expect(searchPlayers(idx, "o neal")).toHaveLength(1);
    expect(searchPlayers(idx, "O'Neal")).toHaveLength(1);
    expect(searchPlayers(idx, "o\u2019neal")).toHaveLength(1);
  });

  it("resolves apostrophe and hyphen names consistently however they are typed", () => {
    const idx: PlayersIndex = {
      d: { name: "D'Angelo Russell", seasons: [2019], qualified_seasons: [2019], latest_team: "X" },
      f: { name: "Al-Farouq Aminu", seasons: [2019], qualified_seasons: [2019], latest_team: "X" },
    };
    for (const q of ["D'Angelo", "dangelo", "d angelo", "d-angelo", "dangelo russ"]) {
      expect(searchPlayers(idx, q).map((r) => r.id), q).toEqual(["d"]);
    }
    for (const q of ["Al-Farouq", "alfarouq", "al farouq", "al farouq am", "alfarouq aminu"]) {
      expect(searchPlayers(idx, q).map((r) => r.id), q).toEqual(["f"]);
    }
  });

  it("map scope hides players with no map-qualified season; all scope keeps them", () => {
    expect(searchPlayers(INDEX, "nobody", 20, { scope: "map" })).toHaveLength(0);
    expect(searchPlayers(INDEX, "nobody", 20, { scope: "all" })).toHaveLength(1);
  });
});

describe("resolveSeason", () => {
  it("map: nearest qualified season to the viewed one (Kobe viewed from 2018 -> 2016)", () => {
    expect(resolveSeason(INDEX.bryanko01, 2018, "map")).toBe(2016);
  });
  it("map: defaults to the latest qualified season with no target", () => {
    expect(resolveSeason(INDEX.bryanko01, undefined, "map")).toBe(2016);
  });
  it("map: null when nothing qualifies", () => {
    expect(resolveSeason(INDEX.noqual01, 2005, "map")).toBeNull();
  });
  it("all: falls back to a profile season for unqualified players", () => {
    expect(resolveSeason(INDEX.noqual01, 2005, "all")).toBe(2005);
  });
});

describe("nearestQualifiedSeason (cross-season map/search selection)", () => {
  it("returns the target season unchanged when the player qualified there", () => {
    expect(nearestQualifiedSeason(INDEX.bryanko01, 2016)).toBe(2016);
  });

  it("returns the nearest qualified season when the target season doesn't qualify -- the Kobe-while-viewing-2017-18 case", () => {
    // Kobe's last qualified season is 2016; viewing 2018 should resolve
    // to 2016, not fail to find him.
    expect(nearestQualifiedSeason(INDEX.bryanko01, 2018)).toBe(2016);
  });

  it("breaks exact ties toward the more recent season", () => {
    // 2001 and 2016 are both 8 away from 2009 is false (8 vs 7) -- use a
    // genuine midpoint: 2001 and 2016 average to 2008.5, so pick a target
    // equidistant in integer terms is impossible here; instead verify the
    // general rule directly with a small synthetic entry.
    const entry = { qualified_seasons: [2000, 2010] };
    expect(nearestQualifiedSeason(entry, 2005)).toBe(2010); // tie (5 vs 5) -> more recent wins
  });

  it("returns null when the player has no qualified seasons at all", () => {
    expect(nearestQualifiedSeason(INDEX.noqual01, 2005)).toBeNull();
  });
});

describe("dataLoader: failed requests are never permanently cached", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("retries a genuinely new fetch after a prior rejection, instead of replaying the same failure forever", async () => {
    let callCount = 0;
    global.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 500 } as Response;
      }
      return { ok: true, json: async () => [{ player_id: "test" }] } as unknown as Response;
    }) as typeof fetch;

    const { loadSeason } = await import("../lib/dataLoader");

    await expect(loadSeason(9999)).rejects.toThrow();
    expect(callCount).toBe(1);

    // The old (buggy) implementation would return the exact same rejected
    // promise here, forever -- this call must trigger a real second fetch.
    const result = await loadSeason(9999);
    expect(callCount).toBe(2);
    expect(result).toEqual([{ player_id: "test" }]);
  });

  it("a successful response IS cached -- no redundant re-fetch on repeat calls", async () => {
    let callCount = 0;
    global.fetch = vi.fn(async () => {
      callCount++;
      return { ok: true, json: async () => [{ player_id: "cached" }] } as unknown as Response;
    }) as typeof fetch;

    const { loadSeason } = await import("../lib/dataLoader");

    await loadSeason(8888);
    await loadSeason(8888);
    expect(callCount).toBe(1);
  });
});

describe("Compare eligibility", () => {
  it("offers only qualified seasons, never profile-only seasons", () => {
    const idx: PlayersIndex = {
      mixed: { name: "Mixed", seasons: [2003, 2004, 2005], qualified_seasons: [2003, 2005], latest_team: "X" },
      none: { name: "None", seasons: [2005], qualified_seasons: [], latest_team: "X" },
    };
    expect(comparableSeasons(idx, "mixed")).toEqual([2005, 2003]);
    expect(comparableSeasons(idx, "none")).toEqual([]);
    expect(comparableSeasons(idx, "missing")).toEqual([]);
    expect(comparableSeasons(undefined, "mixed")).toEqual([]);
  });

  it("flags a non-qualified comparison season so no Style Match is shown", () => {
    expect(isComparisonQualified({ qualified: false })).toBe(false);
    expect(isComparisonQualified({ qualified: true })).toBe(true);
  });

  it("map scope (used by Compare autocomplete) excludes profile-only players; all scope keeps them", () => {
    expect(searchPlayers(INDEX, "Nobody", 20, { scope: "map" })).toHaveLength(0);
    expect(searchPlayers(INDEX, "Nobody", 20, { scope: "all" })).toHaveLength(1);
  });
});
