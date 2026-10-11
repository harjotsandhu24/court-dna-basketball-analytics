import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isSamePlayerSeason, parsePlayerSeasonKey, playerSeasonKey } from "../lib/similarity";
import { SEASON_MAX, SEASON_MIN } from "../lib/config";

const read = <T,>(p: string): T => JSON.parse(readFileSync(path.join(__dirname, "../public/data", p), "utf8")) as T;
const hasPlayerSeason = (id: string, season: number) =>
  read<{ player_id: string }[]>(`seasons/${season}.json`).some((r) => r.player_id === id);

describe("/compare prefill keys (playerId_season)", () => {
  it("parses a valid player-season key", () => {
    expect(parsePlayerSeasonKey("bryanko01_2009")).toEqual({ id: "bryanko01", season: 2009 });
  });

  it("accepts the first and the latest supported season", () => {
    expect(parsePlayerSeasonKey(`jordami01_${SEASON_MIN}`)).toEqual({ id: "jordami01", season: SEASON_MIN });
    expect(parsePlayerSeasonKey(`doncilu01_${SEASON_MAX}`)).toEqual({ id: "doncilu01", season: SEASON_MAX });
  });

  it("rejects malformed keys", () => {
    for (const bad of [null, undefined, "", "bryanko01", "bryanko01_", "_2009", "bryanko01_20x9", "bryanko01_2009abc", "bryanko01_09", "Bryanko01_2009", "bry anko_2009", "bryanko01_2009_2010", "../x_2009"]) {
      expect(parsePlayerSeasonKey(bad)).toBeNull();
    }
  });

  it("rejects seasons outside the supported range", () => {
    expect(parsePlayerSeasonKey(`bryanko01_${SEASON_MIN - 1}`)).toBeNull();
    expect(parsePlayerSeasonKey(`bryanko01_${SEASON_MAX + 1}`)).toBeNull();
    expect(parsePlayerSeasonKey("bryanko01_0000")).toBeNull();
  });

  it("leaves nonexistent player-seasons to the data check, which finds nothing (never a substitute season)", () => {
    const unknownPlayer = parsePlayerSeasonKey("zzzzzzz99_2009")!;
    expect(hasPlayerSeason(unknownPlayer.id, unknownPlayer.season)).toBe(false);
    // Grant Hill played too little in 2000-01 to have a season record, but did in 1999-00.
    const hill = parsePlayerSeasonKey("hillgr01_2001")!;
    expect(hasPlayerSeason(hill.id, hill.season)).toBe(false);
    expect(hasPlayerSeason("hillgr01", 2000)).toBe(true);
  });

  it("resolves real prefills for the earliest and latest seasons", () => {
    expect(hasPlayerSeason("jordami01", SEASON_MIN)).toBe(true);
    expect(hasPlayerSeason("doncilu01", SEASON_MAX)).toBe(true);
  });
});

describe("comparison slot identity", () => {
  const kobe09 = { id: "bryanko01", season: 2009 };

  it("treats the same player and the same season as a duplicate", () => {
    expect(isSamePlayerSeason(kobe09, { id: "bryanko01", season: 2009 })).toBe(true);
  });

  it("allows the same player in a different season", () => {
    expect(isSamePlayerSeason(kobe09, { id: "bryanko01", season: 2006 })).toBe(false);
  });

  it("allows a different player in the same season", () => {
    expect(isSamePlayerSeason(kobe09, { id: "jamesle01", season: 2009 })).toBe(false);
  });

  it("keeps same-name players distinct by id", () => {
    const index = read<Record<string, { name: string }>>("players_index.json");
    expect(index.jamesmi01.name).toBe(index.jamesmi02.name);
    expect(playerSeasonKey("jamesmi01", 2008)).not.toBe(playerSeasonKey("jamesmi02", 2008));
    expect(isSamePlayerSeason({ id: "jamesmi01", season: 2018 }, { id: "jamesmi02", season: 2018 })).toBe(false);
  });
});
