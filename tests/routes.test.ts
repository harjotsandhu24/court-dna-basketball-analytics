import { describe, expect, it } from "vitest";
import { isValidPlayerId, parseCareerRoute, parsePlayerRoute, parseSeasonParam } from "@/lib/routes";
import { SEASON_MAX, SEASON_MIN } from "@/lib/config";

describe("strict route validation (no parseInt prefixes)", () => {
  it("accepts a whole four-digit season in range", () => {
    expect(parseSeasonParam("2005")).toBe(2005);
    expect(parseSeasonParam(String(SEASON_MIN))).toBe(SEASON_MIN);
    expect(parseSeasonParam(String(SEASON_MAX))).toBe(SEASON_MAX);
  });
  it("rejects the confirmed bad inputs: a numeric prefix, NaN and non-integers", () => {
    for (const bad of ["2005abc", "NaN", "2005.5", "20 05", "2005 ", " 2005", "+2005", "-2005", "0x7d5", "2e3", "", "05", "20055"]) {
      expect(parseSeasonParam(bad), bad).toBeNull();
    }
  });
  it("rejects seasons outside the dataset without making any request", () => {
    expect(parseSeasonParam(String(SEASON_MIN - 1))).toBeNull();
    expect(parseSeasonParam(String(SEASON_MAX + 1))).toBeNull();
    expect(parseSeasonParam("0000")).toBeNull();
  });
  it("validates player ids by shape", () => {
    for (const ok of ["nashst01", "jamesle01", "adamsha01", "abdulma02"]) expect(isValidPlayerId(ok)).toBe(true);
    for (const bad of ["", "BAD!!", "nash", "NASHST01", "nashst1", "../x01", "nashst01/x", "a1"]) expect(isValidPlayerId(bad), bad).toBe(false);
  });
  it("classifies a whole player route", () => {
    expect(parsePlayerRoute("nashst01", "2005")).toEqual({ kind: "ok", playerId: "nashst01", season: 2005 });
    expect(parsePlayerRoute("nashst01", "2005abc")).toEqual({ kind: "invalid-season", playerId: "nashst01" });
    expect(parsePlayerRoute("nashst01", "NaN")).toEqual({ kind: "invalid-season", playerId: "nashst01" });
    expect(parsePlayerRoute("BAD!!", "2005")).toEqual({ kind: "invalid-player" });
    expect(parsePlayerRoute("%E0%A4%A", "2005")).toEqual({ kind: "invalid-player" }); // malformed escape
    expect(parsePlayerRoute("nashst01", "%E0%A4%A")).toEqual({ kind: "invalid-season", playerId: "nashst01" });
  });
  it("classifies a career route", () => {
    expect(parseCareerRoute("nashst01")).toEqual({ kind: "ok", playerId: "nashst01" });
    expect(parseCareerRoute("NaN")).toEqual({ kind: "invalid-player" });
    expect(parseCareerRoute("nosuchplayer99")).toEqual({ kind: "ok", playerId: "nosuchplayer99" }); // well formed: the data decides
  });
});
