import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFENSE_INPUTS_NOTE, LINEUP_DIMENSIONS, lineupScores } from "@/lib/lineup";
import { DIMENSION_DISPLAY_LABEL } from "@/lib/courtPrint";
import type { PlayerSeasonRecord } from "@/lib/types";

describe("lineup identity card: the defensive row", () => {
  const def = LINEUP_DIMENSIONS.find((d) => d.key === "Defensive Activity")!;
  it("is labelled 'Defensive box-score signals', not 'Defense'", () => {
    expect(def.label).toBe("Defensive box-score signals");
    expect(LINEUP_DIMENSIONS.map((d) => d.label)).not.toContain("Defense");
  });
  it("its short explanation names exactly the stats the calculation uses (checked against the trait definition)", () => {
    const cfg = readFileSync("analysis/config.py", "utf8");
    const line = cfg.split("\n").find((l) => l.includes('"Defensive Activity"'))!;
    const inputs = [...line.matchAll(/\("([a-z_]+)"/g)].map((m) => m[1]);
    expect(inputs).toEqual(["stl_percent", "blk_percent"]); // no defensive-rebound input, so the note must not claim one
    expect(def.note).toBe(DEFENSE_INPUTS_NOTE);
    expect(DEFENSE_INPUTS_NOTE).toBe("Based on steals and blocks.");
    expect(DEFENSE_INPUTS_NOTE.toLowerCase()).not.toContain("rebound");
  });
  it("other rows have no note, and the profile label stays 'Steals & Blocks'", () => {
    expect(LINEUP_DIMENSIONS.filter((d) => d.note).map((d) => d.key)).toEqual(["Defensive Activity"]);
    expect(DIMENSION_DISPLAY_LABEL["Defensive Activity"]).toBe("Steals & Blocks");
  });
  it("relabelling changes no score: the value is still the plain average of the Defensive Activity trait", () => {
    const mk = (v: number) => ({ traits: { "Defensive Activity": v, Playmaking: 50, "Perimeter Profile": 50, "Rim Pressure": 50, Rebounding: 50 }, vector: { usg_percent: 0 } }) as unknown as PlayerSeasonRecord;
    const s = lineupScores([mk(10), mk(20), mk(30), mk(40), mk(50)])!;
    expect(s["Defensive Activity"]).toBe(30);
    expect(Object.keys(s)).toContain("Defensive Activity");
  });
});
