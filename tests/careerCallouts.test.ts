import { describe, expect, it } from "vitest";
import { CALLOUT_NOTE, CALLOUT_THRESHOLD, careerCallouts } from "@/lib/careerCallouts";
import type { PlayerSeasonRecord } from "@/lib/types";

type S = Pick<PlayerSeasonRecord, "season_label" | "traits">;
const mk = (label: string, traits: Record<string, number | null>) => ({ season_label: label, traits } as unknown as S);

describe("career callouts", () => {
  it("writes a line for a real change and names it in percentile points", () => {
    const out = careerCallouts([mk("2003-04", { Scoring: 40 }), mk("2009-10", { Scoring: 80 })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/rose 40 percentile points from 2003-04 to 2009-10/);
  });
  it("never reads a missing value as 0: no false rise, no false fall", () => {
    // Without the fix, null -> 0 would read "Rebounding fell 70 percentile points".
    expect(careerCallouts([mk("2003-04", { Rebounding: 70 }), mk("2004-05", { Rebounding: null }), mk("2005-06", { Rebounding: 68 })])).toEqual([]);
    expect(careerCallouts([mk("2003-04", { Rebounding: null }), mk("2004-05", { Rebounding: 70 })])).toEqual([]);
  });
  it("compares the first and last season that actually have the value", () => {
    const out = careerCallouts([mk("2001-02", { Scoring: null }), mk("2002-03", { Scoring: 30 }), mk("2003-04", { Scoring: null }), mk("2004-05", { Scoring: 60 })]);
    expect(out[0]).toMatch(/Scoring rose 30 percentile points from 2002-03 to 2004-05/);
  });
  it("preserves a real zero", () => {
    const out = careerCallouts([mk("2001-02", { Rebounding: 50 }), mk("2002-03", { Rebounding: 0 })]);
    expect(out[0]).toMatch(/fell 50 percentile points/);
  });
  it("needs a real change and two seasons", () => {
    expect(careerCallouts([mk("2001-02", { Scoring: 50 })])).toEqual([]);
    expect(careerCallouts([mk("2001-02", { Scoring: 50 }), mk("2002-03", { Scoring: 50 + CALLOUT_THRESHOLD - 1 })])).toEqual([]);
  });
  it("explains that percentile movement is not raw improvement", () => {
    expect(CALLOUT_NOTE).toMatch(/percentile points/i);
    expect(CALLOUT_NOTE).toMatch(/isn't the same as improving a raw stat/);
  });
});
