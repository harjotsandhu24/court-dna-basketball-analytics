import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { estimatedRecord, SEASON_GAMES } from "@/lib/sim/record";
import SimResults, { ROUGH_NOTE, UNLIKE_TESTED } from "@/components/SimResults";
import type { SimResult } from "@/lib/sim/engine";

describe("estimatedRecord (display only)", () => {
  it.each([
    [0, 0, 82], [41, 41, 41], [64, 64, 18], [82, 82, 0], [63.6, 64, 18], [17.2, 17, 65],
  ])("mean %s -> %s-%s", (mean, w, l) => {
    const r = estimatedRecord(mean)!;
    expect([r.wins, r.losses]).toEqual([w, l]);
    expect(r.text).toBe(`${w}–${l}`);
  });
  it("rounds wins once at the half-win boundary and derives losses from the rounded wins", () => {
    expect(estimatedRecord(63.49)!.wins).toBe(63);
    expect(estimatedRecord(63.5)!.wins).toBe(64);
    expect(estimatedRecord(63.51)!.wins).toBe(64);
    expect(estimatedRecord(0.49)).toMatchObject({ wins: 0, losses: 82 });
    expect(estimatedRecord(81.5)).toMatchObject({ wins: 82, losses: 0 });
    for (const m of [0.5, 12.5, 40.5, 41.5, 63.5, 81.49]) {
      const r = estimatedRecord(m)!;
      expect(r.wins + r.losses).toBe(SEASON_GAMES);
    }
  });
  it("always returns whole numbers in 0..82 that total 82, across the whole range", () => {
    for (let m = 0; m <= 82; m += 0.0731) {
      const r = estimatedRecord(m)!;
      expect(Number.isInteger(r.wins) && Number.isInteger(r.losses)).toBe(true);
      expect(r.wins).toBeGreaterThanOrEqual(0);
      expect(r.wins).toBeLessThanOrEqual(82);
      expect(r.losses).toBeGreaterThanOrEqual(0);
      expect(r.wins + r.losses).toBe(82);
    }
  });
  it("returns null (an error, never a made-up record) for missing, invalid or out-of-range values", () => {
    for (const bad of [null, undefined, NaN, Infinity, -Infinity, "64", {}, [], -0.6, -3, 82.6, 100]) expect(estimatedRecord(bad)).toBeNull();
  });
  it("never produces a negative zero", () => {
    expect(Object.is(estimatedRecord(-1e-12)!.wins, 0)).toBe(true);
  });
  it("speaks wins and losses in words, with singular forms", () => {
    expect(estimatedRecord(64)!.spoken).toBe("64 wins, 18 losses");
    expect(estimatedRecord(1)!.spoken).toBe("1 win, 81 losses");
    expect(estimatedRecord(81)!.spoken).toBe("81 wins, 1 loss");
    expect(estimatedRecord(0)!.spoken).toBe("0 wins, 82 losses");
  });
});

// A minimal season result, enough for the view. The view only formats; nothing here runs the model.
function season(mean: number | null, level: "supported" | "limited" | "unsupported", label: "validated" | "experimental" = "experimental"): SimResult {
  return {
    mode: "season",
    meta: { cacheKey: "k", seed: 1, modelVersion: "m", dataVersion: "d", status: { label, note: "" } },
    env: 2005, envTeams: 29, envSkipped: [], replaced: null,
    support: { level, reasons: [], withheld: false, shownAnyway: level === "unsupported", message: null, caveat: "" },
    wins: mean == null ? null : { mean, lo: 58, hi: 70, luck: { lo: 60, hi: 68 }, dist: new Array(83).fill(1 / 83) },
    net: mean == null ? null : 5, netRange: [3, 7], ortg: null, ortgRange: null, drtg: null,
    assessment: { dimensions: [], strengths: [], weakKind: "none", weaknesses: [], usage: { scale: 1, effectNet: 0 } },
    defenseNote: "", evidence: [], uncertainty: [], assumptions: [], eraNote: "", players: [], usageScaleLimited: false, footingNote: "",
  } as unknown as SimResult;
}
const html = (r: SimResult) => renderToStaticMarkup(createElement(SimResults, { result: r }));
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the 82-game result view", () => {
  it("shows 'Estimated record' with W–L, not 'of 82', and speaks wins and losses", () => {
    const h = html(season(63.6, "supported", "validated"));
    expect(text(h)).toContain("Estimated record");
    expect(h).toMatch(/data-testid="sim-record"[^>]*>64–18</);
    expect(h).toMatch(/aria-hidden="true"[^>]*data-testid="sim-record"|data-testid="sim-record"[^>]*aria-hidden="true"/);
    expect(h).toContain("64 wins, 18 losses");
    expect(text(h)).not.toMatch(/of 82/);
    expect(text(h)).not.toContain("Estimated wins");
  });
  it("a validated, supported record has no asterisk; an uncertain one has the asterisk and the visible note", () => {
    expect(html(season(50, "supported", "validated"))).not.toContain("headline-asterisk");
    const h = html(season(50, "supported", "experimental"));
    expect(h).toContain("headline-asterisk");
    expect(h).toContain(ROUGH_NOTE);
    expect(h).toMatch(/aria-describedby="([^"]+)"/);
    const id = /aria-describedby="([^"]+)"/.exec(h)![1];
    expect(h).toContain(`id="${id}"`); // the record is described by the note that sits directly under it
    expect(h.indexOf('data-testid="sim-record"')).toBeLessThan(h.indexOf(ROUGH_NOTE));
  });
  it("unsupported lineups keep the extra note and still hide the range", () => {
    const h = html(season(50, "unsupported"));
    expect(h).toContain(ROUGH_NOTE);
    expect(h).toContain(UNLIKE_TESTED);
    expect(h).not.toContain('data-testid="sim-range"');
    expect(h).toContain("50 wins, 32 losses");
  });
  it("a supported lineup shows the range, labelled in wins", () => {
    const h = html(season(63.6, "supported", "validated"));
    expect(text(h)).toMatch(/Likely range: 58–70 wins/);
  });
  it("missing or invalid results show an error and never a record", () => {
    for (const bad of [season(null, "supported"), season(NaN, "supported"), season(-5, "supported"), season(120, "supported")]) {
      const h = html(bad);
      expect(h).toContain('role="alert"');
      expect(h).not.toContain('data-testid="sim-record"');
      expect(text(h)).not.toMatch(/\d+–\d+/); // no record and no win range built on an invalid total
    }
  });
  it("there is no 'Show the numbers anyway' button", () => {
    expect(text(html(season(50, "unsupported")))).not.toMatch(/show the numbers anyway/i);
  });
});
