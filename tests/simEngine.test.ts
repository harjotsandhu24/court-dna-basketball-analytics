import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SimError, UNSUPPORTED_MESSAGE, cacheKeyFor, requestKey, runSimulation, loadPlayers } from "@/lib/sim/engine";
import type { BracketReq, SeasonReq, SeriesReq } from "@/lib/sim/engine";
import { sampleSeries, seriesDp, seriesExact, simulateSeason } from "@/lib/sim/game";
import { makeRng, normCdf, normInv } from "@/lib/sim/math";
import { evaluateLineup } from "@/lib/sim/strength";
import { checkSupport } from "@/lib/sim/support";
import { splitDimensions } from "@/lib/sim/assess";
import { homeCourt, venuePattern } from "@/lib/sim/bracket";
import type { Dimension } from "@/lib/sim/assess";
import type { LineupPick } from "@/lib/sim/types";
import { nodeSource } from "./helpers/simData";

const ds = nodeSource();

async function topPlayers(season: number, count: number, skip = 0, exclude: string[] = []): Promise<LineupPick[]> {
  const f = await ds.features(season);
  const order = f.ids.map((id, i) => ({ id, mp: f.mp[i], g: f.g[i] })).filter((p) => p.g >= 50 && !exclude.includes(p.id)).sort((a, b) => b.mp - a.mp || (a.id < b.id ? -1 : 1));
  return order.slice(skip, skip + count).map((p) => ({ id: p.id, season }));
}
async function mixedEra(): Promise<LineupPick[]> {
  const out: LineupPick[] = [];
  for (const s of [1998, 2005, 2012, 2019, 2026]) out.push(...(await topPlayers(s, 1, 0, out.map((p) => p.id))));
  return out;
}
/** A real team's starting five (top five by minutes with that team): the kind of lineup the support check should accept. */
async function teamFive(season: number, abbr: string): Promise<LineupPick[]> {
  const t = (await ds.teams(season)).teams.find((x) => x.abbr === abbr)!;
  return t.players.slice(0, 5).map(([id]) => ({ id, season }));
}
/** The league's five highest-minute players in 2005 (from five different teams): far from any real starting five. */
const unsupportedFive = () => topPlayers(2005, 5);
const supportedA = () => teamFive(2005, "PHO");
const supportedB = () => teamFive(2012, "MIA");
const series = (lineup: LineupPick[], opponent: SeriesReq["opponent"], homeCourt: SeriesReq["homeCourt"], extra: Partial<SeriesReq> = {}): SeriesReq =>
  ({ mode: "series", lineup, opponent, homeCourt, footing: "equal", seed: 5, ...extra });

describe("numeric helpers", () => {
  it("normal CDF and inverse agree", () => {
    for (const p of [0.001, 0.05, 0.3, 0.5, 0.8, 0.999]) expect(normCdf(normInv(p))).toBeCloseTo(p, 6);
    expect(normCdf(0)).toBeCloseTo(0.5, 8);
    expect(normCdf(1.96)).toBeCloseTo(0.9750021048517795, 9);
    expect(normCdf(-3)).toBeCloseTo(0.0013498980316301, 10);
  });
  it("the seeded generator repeats and differs by seed", () => {
    const a = makeRng(7), b = makeRng(7), c = makeRng(8);
    const xs = Array.from({ length: 5 }, () => a.next()), ys = Array.from({ length: 5 }, () => b.next());
    expect(xs).toEqual(ys);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(xs);
  });
});

describe("series", () => {
  it("identical lineups on a neutral court are an even bet, and the lengths add to one", async () => {
    const L = await supportedA();
    const r = (await runSimulation(series(L, { kind: "lineup", lineup: L }, "neutral"), ds))!;
    if (r.mode !== "series" || r.pA == null || !r.lengthA || !r.lengthB) throw new Error("mode");
    expect(r.pA).toBeCloseTo(0.5, 9);
    expect(r.lengthA.reduce((s, v) => s + v, 0) + r.lengthB.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    // with the same players on both sides, "A in g games" mirrors "B in g games"
    for (let g = 4; g <= 7; g++) expect(r.lengthA[g]).toBeCloseTo(r.lengthB[g], 9);
  });

  it("two lineups with identical ratings but different players are also even (same ratings, neutral)", async () => {
    const model = await ds.model();
    const r = seriesExact(model, { ratingA: 3.2, ratingB: 3.2, tauA: 3, tauB: 3, pattern: "NNNNNNN", need: 4 });
    expect(r.pA).toBeCloseTo(0.5, 9);
  });

  it("reversing the opponents gives complementary probabilities (home court follows the team)", async () => {
    const A = await supportedA();
    const B = await supportedB();
    const ab = (await runSimulation(series(A, { kind: "lineup", lineup: B }, "you"), ds))!;
    const ba = (await runSimulation(series(B, { kind: "lineup", lineup: A }, "opponent"), ds))!;
    if (ab.mode !== "series" || ba.mode !== "series" || ab.pA == null || ba.pA == null) throw new Error("mode");
    expect(ab.pA + ba.pA).toBeCloseTo(1, 9);
    const abN = (await runSimulation(series(A, { kind: "lineup", lineup: B }, "neutral"), ds))!;
    const baN = (await runSimulation(series(B, { kind: "lineup", lineup: A }, "neutral"), ds))!;
    if (abN.mode !== "series" || baN.mode !== "series" || abN.pA == null || baN.pA == null) throw new Error("mode");
    expect(abN.pA + baN.pA).toBeCloseTo(1, 9);
    // home court helps whoever has it
    expect(ab.pA).toBeGreaterThan(abN.pA);
  });

  it("series probabilities and game-length distributions are legal", () => {
    for (const need of [3, 4]) {
      for (const p of [0.05, 0.4, 0.5, 0.93]) {
        const r = seriesDp(Array(2 * need - 1).fill(p), need);
        expect(r.pA + r.lenB.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
        expect(r.lenA.slice(0, need).every((v) => v === 0)).toBe(true);
      }
    }
  });

  it("every sampled series ends with exactly one team at the winning number", async () => {
    const model = await ds.model();
    const rng = makeRng(99);
    for (let i = 0; i < 2000; i++) {
      for (const need of [3, 4]) {
        const r = sampleSeries(model, { ratingA: 6, ratingB: -4, tauA: 3, tauB: 3, pattern: need === 3 ? "HHAAH" : "HHAAHAH", need }, rng);
        expect(Math.max(r.winsA, r.winsB)).toBe(need);
        expect(Math.min(r.winsA, r.winsB)).toBeLessThan(need);
      }
    }
  });

  it("opponent can be a real team; real-rotation mode warns that the benches differ", async () => {
    const L = await supportedA();
    const r = (await runSimulation(series(L, { kind: "team", season: 2016, team: "GSW" }, "neutral", { footing: "real" }), ds))!;
    if (r.mode !== "series" || r.pA == null) throw new Error("mode");
    expect(r.b.footingNote).toMatch(/not an even comparison/);
    expect(r.comparison).toBe("mixed");
    const eq = (await runSimulation(series(L, { kind: "team", season: 2016, team: "GSW" }, "neutral"), ds))!;
    if (eq.mode !== "series" || eq.pA == null) throw new Error("mode");
    expect(eq.b.footingNote).toMatch(/same average bench/);
    expect(eq.comparison).toBe("equal");
    expect(r.pA).not.toBeCloseTo(eq.pA, 3);
  });

  it("shows exactly three matchup factors and labels the mode Experimental", async () => {
    const A = await supportedA();
    const B = await supportedB();
    const r = (await runSimulation(series(A, { kind: "lineup", lineup: B }, "you"), ds))!;
    if (r.mode !== "series" || r.pA == null || !r.pARange || !r.factors) throw new Error("mode");
    expect(r.factors).toHaveLength(3);
    expect(r.meta.status.label).toBe("experimental");
    expect(r.pARange[0]).toBeLessThan(r.pA);
    expect(r.pARange[1]).toBeGreaterThan(r.pA);
  });

  it("the same player may be on both hypothetical teams but not twice on one", async () => {
    const A = await supportedA();
    const r = await runSimulation(series(A, { kind: "lineup", lineup: A }, "neutral"), ds);
    expect(r).not.toBeNull();
    const dup = [A[0], { id: A[0].id, season: 2006 }, A[2], A[3], A[4]];
    await expect(runSimulation(series(dup, { kind: "lineup", lineup: A }, "neutral"), ds)).rejects.toMatchObject({ code: "DUPLICATE_PLAYER" });
    await expect(runSimulation(series(A, { kind: "lineup", lineup: dup }, "neutral"), ds)).rejects.toMatchObject({ code: "DUPLICATE_PLAYER" });
  });
});

describe("82-game season", () => {
  it("win counts stay within 0-82, the distribution sums to one, and the range is ordered", async () => {
    const L = await supportedB();
    const req: SeasonReq = { mode: "season", lineup: L, env: "auto", seed: 11 };
    const r = (await runSimulation(req, ds))!;
    if (r.mode !== "season" || !r.wins) throw new Error("mode");
    expect(r.wins.dist).toHaveLength(83);
    expect(r.wins.dist.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    expect(r.wins.lo).toBeGreaterThanOrEqual(0);
    expect(r.wins.hi).toBeLessThanOrEqual(82);
    expect(r.wins.lo).toBeLessThanOrEqual(r.wins.mean);
    expect(r.wins.mean).toBeLessThanOrEqual(r.wins.hi);
    expect(r.env).toBe(2012);
    expect(r.assessment.strengths.length).toBeLessThanOrEqual(3);
    expect(r.drtg).toBeNull(); // expected defensive rating stays withheld: it did not hold up on the test seasons
    expect(r.support.level).not.toBe("unsupported");
    expect(r.meta.status.label).toBe("experimental"); // five + average bench did not beat last season's record
  });

  it("an extreme lineup still ends within 0-82 wins", async () => {
    const model = await ds.model();
    for (const rating of [-30, 30]) {
      const r = (await simulateSeason(model, { rating, tau: 3, oppRatings: [0, 1, -1, 2, -2], tauOpp: 3, n: 300, seed: 3 }))!;
      expect(r.mean).toBeGreaterThanOrEqual(0);
      expect(r.mean).toBeLessThanOrEqual(82);
      expect(r.dist).toHaveLength(83);
      expect(r.luck.lo).toBeGreaterThanOrEqual(0);
      expect(r.luck.hi).toBeLessThanOrEqual(82);
    }
  });

  it("the same seed repeats exactly and a different seed changes the sampled result", async () => {
    const L = await supportedB();
    const a = await runSimulation({ mode: "season", lineup: L, env: "auto", seed: 1 }, ds);
    const b = await runSimulation({ mode: "season", lineup: L, env: "auto", seed: 1 }, ds);
    const c = await runSimulation({ mode: "season", lineup: L, env: "auto", seed: 2 }, ds);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    if (a?.mode !== "season" || c?.mode !== "season" || !a.wins || !c.wins) throw new Error("mode");
    expect(a.wins.mean).not.toBe(c.wins.mean);
  });

  it("running more seasons does not make the model's uncertainty disappear", async () => {
    const model = await ds.model();
    const common = { rating: 3, tau: model.tau.five, oppRatings: Array.from({ length: 29 }, (_, i) => (i - 14) * 0.5), tauOpp: model.tau.real, seed: 5 };
    const few = (await simulateSeason(model, { ...common, n: 1500 }))!;
    const many = (await simulateSeason(model, { ...common, n: 9000 }))!;
    // game luck alone gives a narrow range; adding model error widens it, and 6x more runs do not close the gap
    expect(few.hi - few.lo).toBeGreaterThan(few.luck.hi - few.luck.lo + 4);
    expect(many.hi - many.lo).toBeGreaterThan(many.luck.hi - many.luck.lo + 4);
    expect(Math.abs((many.hi - many.lo) - (few.hi - few.lo))).toBeLessThanOrEqual(2);
    expect(many.sd).toBeGreaterThan(3.9);
  });

  it("states minutes, usage, availability, coaching, league and schedule assumptions", async () => {
    const r = (await runSimulation({ mode: "season", lineup: await supportedB(), env: "auto", seed: 1 }, ds))!;
    if (r.mode !== "season") throw new Error("mode");
    const t = r.assumptions.join(" ");
    for (const w of [/Minutes: each starter plays about 29 minutes/, /Possessions: starters' usage/, /Availability/, /Coaching/, /League: the 2011-12 league/, /balanced hypothetical schedule, not the actual/]) expect(t).toMatch(w);
  });

  it("adds the lineup as an extra team by default, or takes a named team's place without keeping it", async () => {
    const L = await supportedB();
    const full = (await ds.teams(2012)).teams.filter((t) => t.ok).length;
    const added = (await runSimulation({ mode: "season", lineup: L, env: "auto", seed: 1, n: 300 }, ds))!;
    const swapped = (await runSimulation({ mode: "season", lineup: L, env: "auto", replace: "MIA", seed: 1, n: 300 }, ds))!;
    if (added.mode !== "season" || swapped.mode !== "season") throw new Error("mode");
    expect(added.envTeams).toBe(full);
    expect(swapped.envTeams).toBe(full - 1);
    expect(swapped.replaced).toMatch(/Miami/);
    expect(added.assumptions.join(" ")).toMatch(/extra team added/);
    expect(swapped.assumptions.join(" ")).toMatch(/takes the place of Miami/);
    await expect(runSimulation({ mode: "season", lineup: L, env: "auto", replace: "ZZZ", seed: 1 }, ds)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });
});

describe("support check: unsupported lineups keep the assessment and lose the numbers, in every mode", () => {
  it("a lineup far from real teams is flagged with the plain message", async () => {
    const model = await ds.model();
    const players = await loadPlayers(ds, model, await unsupportedFive());
    const ev = evaluateLineup(players, null, model);
    const sup = checkSupport(model, ev.vector, ev.net, players);
    expect(sup.level).toBe("unsupported");
    expect(sup.reasons).toContain("combination_far");
    expect(UNSUPPORTED_MESSAGE).toBe("This lineup is too different from the teams used to test the model.");
  });

  it("season mode: no wins, range, net or offense; assessment and usage remain", async () => {
    const r = (await runSimulation({ mode: "season", lineup: await unsupportedFive(), env: "auto", seed: 1 }, ds))!;
    if (r.mode !== "season") throw new Error("mode");
    expect(r.support.withheld).toBe(true);
    expect(r.support.message).toBe(UNSUPPORTED_MESSAGE);
    expect(r.wins).toBeNull();
    expect(r.net).toBeNull();
    expect(r.netRange).toBeNull();
    expect(r.ortg).toBeNull();
    expect(r.assessment.dimensions).toHaveLength(5);
    expect(r.players).toHaveLength(5);
  });

  it("series mode: no odds, lengths, factors or example series", async () => {
    const r = (await runSimulation(series(await unsupportedFive(), { kind: "lineup", lineup: await supportedB() }, "neutral"), ds))!;
    if (r.mode !== "series") throw new Error("mode");
    expect(r.support.withheld).toBe(true);
    for (const v of [r.pA, r.pARange, r.pAExact, r.lengthA, r.lengthB, r.expectedGames, r.factors, r.a.net, r.b.net]) expect(v).toBeNull();
    expect(r.examples).toEqual([]);
  });

  it("series mode: an unsupported OPPONENT lineup withholds the numbers too", async () => {
    const r = (await runSimulation(series(await supportedA(), { kind: "lineup", lineup: await unsupportedFive() }, "neutral"), ds))!;
    if (r.mode !== "series") throw new Error("mode");
    expect(r.pA).toBeNull();
    expect(r.support.reasons.join(" ")).toMatch(/Opponent lineup/);
  });

  it("bracket mode (full replay and historical path): no title or path odds", async () => {
    for (const replay of ["full", "path"] as const) {
      const r = (await runSimulation({ mode: "bracket", lineup: await unsupportedFive(), season: 2005, replaced: "PHO", replay, footing: "equal", seed: 1, n: 300 }, ds))!;
      if (r.mode !== "bracket") throw new Error("mode");
      expect(r.support.withheld).toBe(true);
      expect(r.full).toBeNull();
      expect(r.path).toBeNull();
    }
  });

  it("'show the numbers anyway' returns numbers marked as shown anyway, with a different cache key", async () => {
    const model = await ds.model();
    const L = await unsupportedFive();
    const base: SeasonReq = { mode: "season", lineup: L, env: "auto", seed: 1, n: 300 };
    expect(cacheKeyFor(base, model)).not.toBe(cacheKeyFor({ ...base, reveal: true }, model));
    const r = (await runSimulation({ ...base, reveal: true }, ds))!;
    if (r.mode !== "season" || !r.wins) throw new Error("mode");
    expect(r.support.shownAnyway).toBe(true);
    expect(r.support.withheld).toBe(false);
    expect(r.support.level).toBe("unsupported");
  });

  it("a supported lineup is never withheld and reveal changes nothing it shows", async () => {
    const L = await supportedA();
    const a = (await runSimulation({ mode: "season", lineup: L, env: "auto", seed: 1, n: 300 }, ds))!;
    if (a.mode !== "season" || !a.wins) throw new Error("mode");
    expect(a.support.level).toBe("supported");
    expect(a.support.withheld).toBe(false);
    expect(a.support.shownAnyway).toBe(false);
  });

  it("flags small samples, mixed eras and projections beyond the real-team range", async () => {
    const model = await ds.model();
    const players = await loadPlayers(ds, model, await mixedEra());
    const ev = evaluateLineup(players, null, model);
    expect(checkSupport(model, ev.vector, ev.net, players).reasons).toContain("mixed_era");
    const f = await ds.features(2005);
    const smallIdx = f.mp.findIndex((m) => m < model.support.minMp);
    const small = await loadPlayers(ds, model, (await supportedA()).slice(0, 4).concat([{ id: f.ids[smallIdx], season: 2005 }]));
    const ev2 = evaluateLineup(small, null, model);
    expect(checkSupport(model, ev2.vector, ev2.net, small).reasons).toContain("small_sample");
    const hi = checkSupport(model, ev2.vector, model.support.net.max + 1, small);
    expect(hi.reasons).toContain("net_outside");
    expect(hi.level).toBe("unsupported");
    expect(checkSupport(model, ev2.vector, model.support.net.min - 1, small).level).toBe("unsupported");
  });

  it("being inside the range is described as resembling real teams, not as validated", async () => {
    const r = (await runSimulation({ mode: "season", lineup: await supportedA(), env: "auto", seed: 1, n: 300 }, ds))!;
    if (r.mode !== "season") throw new Error("mode");
    expect(r.support.caveat).toMatch(/does not prove a custom lineup is validated/);
    expect(r.meta.status.label).toBe("experimental");
  });
});

describe("assessment labels", () => {
  const dims = (v: number[]): Dimension[] => v.map((value, i) => ({ name: `D${i}`, value, evidence: "" }));
  it("when every area is above average the weak ones are 'relative', and strengths are not forced to three", () => {
    const r = splitDimensions(dims([0.8, 0.5, 0.3, 0.2, 0.02]));
    expect(r.weakKind).toBe("relative");
    expect(r.weaknesses.map((d) => d.name)).toEqual(["D4", "D3"]);
    expect(splitDimensions(dims([0.5, 0.05, 0.03, 0.2, 0.02])).strengths.map((d) => d.name)).toEqual(["D0", "D3"]);
    expect(splitDimensions(dims([0.05, 0.05, 0.03, 0.02, 0.02])).strengths).toEqual([]);
  });
  it("below-average areas are listed only when they really are below average", () => {
    const r = splitDimensions(dims([1.2, 0.4, -0.05, -0.6, -1.1]));
    expect(r.weakKind).toBe("below");
    expect(r.weaknesses.map((d) => d.name)).toEqual(["D4", "D3"]);
    const none = splitDimensions(dims([0.5, 0.2, 0.0, -0.02, 0.3]));
    expect(none.weakKind).toBe("none");
    expect(none.weaknesses).toEqual([]);
  });
  it("the simulator labels its defense area by the box-score inputs, never as a complete 'Defense' rating", async () => {
    const r = (await runSimulation({ mode: "season", lineup: await supportedA(), env: "auto", seed: 1, n: 300 }, ds))!;
    if (r.mode !== "season") throw new Error("mode");
    expect(r.assessment.dimensions.map((d) => d.name)).toContain("Steals, blocks & defensive rebounds");
    expect(r.assessment.dimensions.map((d) => d.name)).not.toContain("Defense");
    const names = r.assessment.dimensions.map((d) => d.name);
    expect(names).toContain("Playmaking");
    expect(names).toContain("Ball security & rebounding");
    expect(names).not.toContain("Creation");
    expect(names).not.toContain("Possession control");
    expect(r.assessment.dimensions.every((d) => d.evidence.length > 0)).toBe(true);
    expect(r.defenseNote).toMatch(/not measured defensive impact/);
  });
});

describe("accuracy claims", () => {
  it("report RMSE and MAE separately, five-plus-bench apart from real rotations, and the baseline it did not beat", async () => {
    const r = (await runSimulation({ mode: "season", lineup: await supportedA(), env: "auto", seed: 1, n: 300 }, ds))!;
    if (r.mode !== "season") throw new Error("mode");
    const t = r.evidence.join(" ");
    expect(t).toMatch(/RMSE/);
    expect(t).toMatch(/mean absolute error/);
    expect(t).not.toMatch(/average error/);
    expect(t).toMatch(/full rotations/);
    expect(t).toMatch(/Five starters plus an average bench/);
    expect(t).toMatch(/did not beat last season's record/);
    expect(t).toMatch(/RMSE 9\.98 against 9\.84/);
  });
});

describe("position labels do not matter", () => {
  it("every arrangement of the same players gives identical ratings, assessment and results", async () => {
    const L = await supportedB();
    const ref = JSON.stringify(await runSimulation({ mode: "season", lineup: L, env: "auto", seed: 4, n: 400 }, ds));
    const perms = [[4, 3, 2, 1, 0], [2, 0, 4, 1, 3], [1, 2, 3, 4, 0], [3, 4, 0, 2, 1]];
    for (const p of perms) {
      const shuffled = p.map((i) => L[i]);
      expect(JSON.stringify(await runSimulation({ mode: "season", lineup: shuffled, env: "auto", seed: 4, n: 400 }, ds))).toEqual(ref);
    }
    const A = await supportedA();
    const B = await supportedB();
    const s1 = JSON.stringify(await runSimulation(series(A, { kind: "lineup", lineup: B }, "you"), ds));
    const s2 = JSON.stringify(await runSimulation(series([...A].reverse(), { kind: "lineup", lineup: [...B].reverse() }, "you"), ds));
    expect(s2).toEqual(s1);
    const model = await ds.model();
    const p1 = evaluateLineup(await loadPlayers(ds, model, L), null, model);
    const p2 = evaluateLineup(await loadPlayers(ds, model, [...L].reverse()), null, model);
    expect(p2.net).toBe(p1.net);
    expect(cacheKeyFor({ mode: "season", lineup: L, env: "auto", seed: 4, n: 400 }, model)).toBe(cacheKeyFor({ mode: "season", lineup: [...L].reverse(), env: "auto", seed: 4, n: 400 }, model));
    // the same holds for withheld results and for bracket mode
    const U = await unsupportedFive();
    expect(JSON.stringify(await runSimulation({ mode: "season", lineup: U, env: "auto", seed: 2 }, ds))).toBe(JSON.stringify(await runSimulation({ mode: "season", lineup: [...U].reverse(), env: "auto", seed: 2 }, ds)));
    const br = (l: LineupPick[]) => runSimulation({ mode: "bracket", lineup: l, season: 2005, replaced: "PHO", replay: "full", footing: "equal", seed: 3, n: 300 }, ds);
    expect(JSON.stringify(await br(L))).toBe(JSON.stringify(await br([...L].reverse())));
  });
});

describe("cache keys", () => {
  it("change with players, seasons, settings, seed, data version and model version", async () => {
    const model = await ds.model();
    const L = await topPlayers(2005, 5);
    const base: SeasonReq = { mode: "season", lineup: L, env: "auto", seed: 1 };
    const k = (r: SeasonReq, m = model) => cacheKeyFor(r, m);
    const keys = new Set([
      k(base), k({ ...base, seed: 2 }), k({ ...base, env: 2010 }),
      k({ ...base, lineup: [...L.slice(1), { id: L[0].id, season: 2006 }] }),
      k(base, { ...model, dataVersion: "x" }), k(base, { ...model, modelVersion: "y" }),
      k({ ...base, reveal: true }), k({ ...base, replace: "PHO" }), k({ ...base, n: 100 }),
    ]);
    expect(keys.size).toBe(9);
    const sr = (o: Partial<SeriesReq>) => cacheKeyFor(series(L, { kind: "team", season: 2005, team: "PHO" }, "you", o), model);
    expect(new Set([sr({}), sr({ footing: "real" }), sr({ homeCourt: "neutral" })]).size).toBe(3);
    const bk = (o: Partial<BracketReq>) => cacheKeyFor({ mode: "bracket", lineup: L, season: 2005, replaced: "PHO", replay: "full", footing: "equal", seed: 1, ...o }, model);
    expect(new Set([bk({}), bk({ replay: "path" }), bk({ footing: "real" }), bk({ season: 2006 }), bk({ replaced: "SAS" })]).size).toBe(5);
  });
});

describe("missing data and errors", () => {
  it("needs five players", async () => {
    const L = await topPlayers(2005, 4);
    await expect(runSimulation({ mode: "season", lineup: L, env: "auto", seed: 1 }, ds)).rejects.toMatchObject({ code: "NEED_FIVE" });
  });
  it("reports a player the data doesn't have rather than guessing", async () => {
    const L = await topPlayers(2005, 4);
    const bad = [...L, { id: "nobody99", season: 2005 }];
    const e = await runSimulation({ mode: "season", lineup: bad, env: "auto", seed: 1 }, ds).catch((x) => x);
    expect(e).toBeInstanceOf(SimError);
    expect(e.code).toBe("MISSING_PLAYER");
  });
  it("a failed data request surfaces as an error, not a zero", async () => {
    const L = await topPlayers(2005, 5);
    const broken = nodeSource({ features: async () => { throw new Error("Failed to load /data/sim/features/2005.json: 500"); } });
    await expect(runSimulation({ mode: "season", lineup: L, env: "auto", seed: 1 }, broken)).rejects.toThrow(/Failed to load/);
  });
  it("a league without enough usable teams is refused", async () => {
    const L = await topPlayers(2005, 5);
    const thin = nodeSource({
      teams: async (s) => { const t = await ds.teams(s); return { ...t, teams: t.teams.map((x, i) => (i < 15 ? { ...x, ok: false } : x)) }; },
    });
    await expect(runSimulation({ mode: "season", lineup: L, env: "auto", seed: 1 }, thin)).rejects.toMatchObject({ code: "DATA" });
  });
  it("small-sample players are flagged and the reason says so", async () => {
    const model = await ds.model();
    const f = await ds.features(2005);
    const smallIdx = f.mp.findIndex((m) => m < model.support.minMp);
    const L = (await supportedA()).slice(0, 4).concat([{ id: f.ids[smallIdx], season: 2005 }]);
    const r = (await runSimulation({ mode: "season", lineup: L, env: "auto", seed: 1, n: 200, reveal: true }, ds))!;
    if (r.mode !== "season") throw new Error("mode");
    expect(r.support.level).not.toBe("supported");
    expect(r.support.reasons.join(" ")).toMatch(/small samples/);
  });
});

describe("cancellation", () => {
  it("returns null when cancelled and never produces a result", async () => {
    const L = await supportedA();
    let calls = 0;
    const r = await runSimulation({ mode: "season", lineup: L, env: "auto", seed: 1 }, ds, { cancelled: () => ++calls > 2 });
    expect(r).toBeNull();
  });
});

describe("historical brackets", () => {
  const bf = JSON.parse(readFileSync(join(process.cwd(), "public/data/sim/brackets.json"), "utf8"));
  type S = { id: string; round: number; need: number; pattern: string; hc: string; other: string; feeders: string[] | null; neutral?: boolean; history: { winner: string; games: number; wins_hc: number; wins_other: number } };
  type B = { champion: string; neutral?: boolean; seedSource: string; teams: Record<string, { seed: number; w: number; l: number; mov: number; conf: number }>; series: S[] };
  it("covers every postseason from 1996-97 to 2025-26", () => {
    const seasons = Object.keys(bf.brackets).map(Number);
    expect(seasons).toEqual(Array.from({ length: 30 }, (_, i) => 1997 + i));
    for (let y = 1997; y <= 2026; y++) expect(bf.status[String(y)]).toEqual({ supported: true, reason: null });
  });
  it("every postseason keeps its 8/4/2/1 shape, season-specific formats and Finals pattern", () => {
    for (const s of Object.keys(bf.brackets).map(Number)) {
      const b = bf.brackets[String(s)] as B;
      const rounds = [1, 2, 3, 4].map((r) => b.series.filter((x) => x.round === r).length);
      expect(rounds).toEqual([8, 4, 2, 1]);
      for (const x of b.series) {
        const expectedNeed = x.round === 1 && s <= 2002 ? 3 : 4; // best-of-5 first rounds through 2002
        expect(x.need).toBe(expectedNeed);
        expect(x.pattern).toBe(expectedNeed === 3 ? "HHAAH" : x.round === 4 && s <= 2013 ? "HHAAAHH" : "HHAAHAH"); // Finals were 2-3-2 through 2013
        const h = x.history;
        expect(Math.max(h.wins_hc, h.wins_other)).toBe(x.need);
        expect(h.games).toBe(h.wins_hc + h.wins_other);
        expect(h.games).toBeLessThanOrEqual(x.pattern.length);
        expect(h.winner === x.hc || h.winner === x.other).toBe(true);
      }
    }
  });
  it("later rounds are fed by exactly the winners of the earlier series, up to the real champion", () => {
    for (const b of Object.values(bf.brackets) as B[]) {
      const byId = Object.fromEntries(b.series.map((s) => [s.id, s]));
      for (const s of b.series) {
        if (!s.feeders) continue;
        expect(new Set(s.feeders.map((f) => byId[f].history.winner))).toEqual(new Set([s.hc, s.other]));
      }
      expect(b.series[b.series.length - 1].history.winner).toBe(b.champion);
    }
  });
  it("the team with the better regular-season record hosted every real series (seeds do not decide it)", () => {
    expect(bf.homeRule).toMatchObject({ series: 450, host_worse_record: 0 });
    expect(bf.homeRule.host_better_record + bf.homeRule.tied_record).toBe(450);
    for (const b of Object.values(bf.brackets) as B[]) {
      for (const s of b.series) {
        const h = b.teams[s.hc], o = b.teams[s.other];
        expect(h.w / (h.w + h.l)).toBeGreaterThanOrEqual(o.w / (o.w + o.l));
      }
    }
  });
  it("seeds are published for every season (with the reconstruction kept as `pos`), and the 2020 postseason is marked as one neutral site", () => {
    for (const b of Object.values(bf.brackets) as B[]) {
      expect(b.seedSource).toBe("published");
      expect(Object.values(b.teams).every((t) => typeof (t as { pos?: number }).pos === "number")).toBe(true);
    }
    expect(bf.brackets["2020"].neutral).toBe(true);
    expect(bf.brackets["2019"].neutral).toBeFalsy();
    const b = bf.brackets["2020"] as B;
    expect(b.series.every((s) => venuePattern(b as never, s as never) === "N".repeat(s.pattern.length))).toBe(true);
  });
  it("home court for hypothetical matchups follows record, then point differential, and keeps a real host when the teams really met", () => {
    const mk = (t: Record<string, { w: number; l: number; mov: number }>, series: S[] = []) =>
      ({ season: 2000, champion: "A", teams: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { conf: 0, seed: 1, name: k, ...v }])), series }) as never;
    const s0 = { id: "x", round: 4, need: 4, pattern: "HHAAAHH", hc: "A", other: "B", feeders: null, history: { winner: "A", games: 4, wins_hc: 4, wins_other: 0 } } as S;
    const rec = mk({ A: { w: 60, l: 22, mov: 5 }, B: { w: 50, l: 32, mov: 3 }, C: { w: 50, l: 32, mov: 4 } });
    expect(homeCourt(rec, s0 as never, "A", "B")).toBe("A");
    expect(homeCourt(rec, s0 as never, "B", "A")).toBe("A"); // order of the arguments never matters
    expect(homeCourt(rec, s0 as never, "B", "C")).toBe("C"); // equal records: higher point differential
    expect(homeCourt(rec, s0 as never, "C", "B")).toBe("C");
    // a seed that disagrees with record never wins: the better-seeded team here has the worse record
    const odd = mk({ A: { w: 40, l: 42, mov: 0 }, B: { w: 55, l: 27, mov: 4 } });
    (odd as { teams: Record<string, { seed: number }> }).teams.A.seed = 1;
    (odd as { teams: Record<string, { seed: number }> }).teams.B.seed = 4;
    expect(homeCourt(odd, s0 as never, "A", "B")).toBe("B");
    // teams that really met keep their real host
    const met = mk({ A: { w: 40, l: 42, mov: 0 }, B: { w: 55, l: 27, mov: 4 } }, [s0]);
    expect(homeCourt(met, s0 as never, "B", "A")).toBe("A");
  });
  it("tied records: a real uneven season series decides, otherwise a labelled assumption (never silently an official rule)", () => {
    const mk = (tie?: Record<string, [number, number]>, mov = { A: 2, B: 5 }) =>
      ({ season: 2000, champion: "A", tieH2H: tie, teams: { A: { conf: 0, seed: 1, name: "A", w: 50, l: 32, mov: mov.A }, B: { conf: 0, seed: 2, name: "B", w: 50, l: 32, mov: mov.B } }, series: [] }) as never;
    const s0 = { id: "x", round: 1, need: 4, pattern: "HHAAAHH", hc: "A", other: "B", feeders: null } as never;
    // uneven series: A won it 3-1, so A hosts although B has the better point differential
    expect(homeCourt(mk({ "A|B": [3, 1] }), s0, "A", "B")).toBe("A");
    expect(homeCourt(mk({ "A|B": [1, 3] }), s0, "B", "A")).toBe("B");
    // an even series (or none) falls back to the assumption, default point differential
    expect(homeCourt(mk({ "A|B": [2, 2] }), s0, "A", "B")).toBe("B");
    expect(homeCourt(mk(), s0, "A", "B")).toBe("B");
    // a custom lineup replacing A never uses the real series; the user's choice applies
    const t = mk({ "A|B": [3, 1] });
    expect(homeCourt(t, s0, "A", "B", { mine: "A", tie: "net" })).toBe("B");
    expect(homeCourt(t, s0, "A", "B", { mine: "A", tie: "mine" })).toBe("A");
    expect(homeCourt(t, s0, "B", "A", { mine: "A", tie: "theirs" })).toBe("B");
    // the choice never overrides a better record
    const better = mk(); (better as { teams: Record<string, { w: number }> }).teams.A.w = 55;
    expect(homeCourt(better, s0, "A", "B", { mine: "A", tie: "theirs" })).toBe("A");
  });
  it("the tie choice is part of the request key and the cache key, and the result states the assumption", async () => {
    const base: BracketReq = { mode: "bracket", lineup: await supportedA(), season: 2005, replaced: "PHO", replay: "full", footing: "equal", seed: 1 };
    expect(requestKey({ ...base, tie: "net" })).not.toBe(requestKey({ ...base, tie: "mine" }));
    const out = await runSimulation({ ...base, tie: "theirs" }, ds);
    expect(out?.mode).toBe("bracket");
    expect(JSON.stringify(out)).toMatch(/simulation assumption|assumption/i);
  });
  it("a postseason marked unsupported is refused with its reason", async () => {
    const gappy = nodeSource({ brackets: async () => { const b = await ds.brackets(); return { ...b, status: { ...b.status, "2005": { supported: false, reason: "Player data is incomplete for XYZ." } } }; } });
    const req: BracketReq = { mode: "bracket", lineup: await supportedA(), season: 2005, replaced: "PHO", replay: "full", footing: "equal", seed: 1 };
    await expect(runSimulation(req, gappy)).rejects.toMatchObject({ code: "UNSUPPORTED", message: "Player data is incomplete for XYZ." });
    await expect(runSimulation({ ...req, season: 1990 }, ds)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });
  it("the latest postseason (2025-26) and the neutral-site 2020 postseason both run", async () => {
    for (const [season, replaced] of [[2026, "OKC"], [2020, "LAL"]] as const) {
      const r = (await runSimulation({ mode: "bracket", lineup: await supportedA(), season, replaced, replay: "full", footing: "equal", seed: 2, n: 300 }, ds))!;
      if (r.mode !== "bracket") throw new Error("mode");
      expect(Object.keys(r.teamNames)).toHaveLength(16);
      expect(r.neutral).toBe(season === 2020);
    }
  });
});

describe("bracket replay", () => {
  const base = async (over: Partial<BracketReq> = {}): Promise<BracketReq> =>
    ({ mode: "bracket", lineup: await supportedA(), season: 2005, replaced: "PHO", replay: "full", footing: "equal", seed: 21, n: 1500, ...over });

  it("title and advancement probabilities add up for the whole field", async () => {
    const r = (await runSimulation(await base(), ds))!;
    if (r.mode !== "bracket" || !r.full) throw new Error("mode");
    const teams = Object.keys(r.full.champion);
    expect(teams).toHaveLength(16);
    expect(teams.reduce((s, t) => s + r.full!.champion[t], 0)).toBeCloseTo(1, 9);
    const roundSums = [0, 1, 2, 3].map((i) => teams.reduce((s, t) => s + r.full!.reach[t][i], 0));
    expect(roundSums[0]).toBeCloseTo(16, 9);
    expect(roundSums[1]).toBeCloseTo(8, 9);
    expect(roundSums[2]).toBeCloseTo(4, 9);
    expect(roundSums[3]).toBeCloseTo(2, 9);
    for (const t of teams) {
      const x = r.full.reach[t];
      expect(x[0]).toBe(1);
      expect(x[1]).toBeLessThanOrEqual(x[0]);
      expect(x[2]).toBeLessThanOrEqual(x[1]);
      expect(x[3]).toBeLessThanOrEqual(x[2]);
      expect(r.full.champion[t]).toBeLessThanOrEqual(x[3]);
    }
    expect(r.meta.status.label).toBe("experimental");
    expect(r.path).toBeNull();
    expect(r.footingNote).toMatch(/same average bench/);
    expect(r.assumptions.join(" ")).toMatch(/play-in tournament is not simulated/);
  });

  it("every postseason from 1997 to 2026 plays out completely: 15 series, one champion, odds sum to one", async () => {
    for (let season = 1997; season <= 2026; season++) {
      const bracket = (await ds.brackets()).brackets[String(season)];
      const replaced = Object.keys(bracket.teams)[0];
      const r = (await runSimulation({ mode: "bracket", lineup: await supportedA(), season, replaced, replay: "full", footing: "equal", seed: 9, n: 200 }, ds))!;
      if (r.mode !== "bracket" || !r.full) throw new Error("mode");
      expect(bracket.series).toHaveLength(15);
      expect(Object.values(r.full.champion).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      expect(Object.values(r.full.reach).reduce((a, x) => a + x[3], 0)).toBeCloseTo(2, 9);
    }
  });

  it("the replaced team's slot is taken over by the custom lineup", async () => {
    const r = (await runSimulation(await base(), ds))!;
    if (r.mode !== "bracket") throw new Error("mode");
    expect(r.teamNames.PHO).toBe("Your lineup");
    expect(r.replaced).toBe("PHO");
    expect(r.assumptions.join(" ")).toMatch(/inherits its slot, regular-season record and home-court status/);
  });

  it("full replay and historical path are labelled differently, and only the replay gives title odds", async () => {
    const full = (await runSimulation(await base({ n: 300 }), ds))!;
    const path = (await runSimulation(await base({ replay: "path" }), ds))!;
    if (full.mode !== "bracket" || path.mode !== "bracket") throw new Error("mode");
    expect(full.assumptions.join(" ")).toMatch(/Replay the full bracket: every series is simulated together/);
    expect(path.assumptions.join(" ")).toMatch(/hypothetical sequence of real opponents, not a bracket simulation, so it is not a title chance/);
    expect(full.full).not.toBeNull();
    expect(path.full).toBeNull();
  });

  it("the historical path plays the replaced team's real opponents in order and reports no title odds", async () => {
    const r = (await runSimulation(await base({ replay: "path", n: undefined }), ds))!;
    if (r.mode !== "bracket" || !r.path) throw new Error("mode");
    expect(r.full).toBeNull();
    const bf = (await ds.brackets()).brackets["2005"];
    const real = bf.series.filter((s) => s.hc === "PHO" || s.other === "PHO");
    expect(r.path.steps.map((s) => s.step.opponent)).toEqual(real.map((s) => (s.hc === "PHO" ? s.other : s.hc)));
    expect(r.path.steps.map((s) => s.step.round)).toEqual(real.map((s) => s.round));
    const reach = r.path.steps.map((s) => s.pReach);
    for (let i = 1; i < reach.length; i++) expect(reach[i]).toBeLessThanOrEqual(reach[i - 1]);
    expect(r.path.pWinAll).toBeLessThanOrEqual(reach[reach.length - 1]);
    expect(Object.keys(r.path)).not.toContain("champion");
  });

  it("an unsupported replaced team is refused", async () => {
    await expect(runSimulation(await base({ replaced: "ZZZ" }), ds)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("a team with incomplete player data blocks the whole bracket instead of faking odds", async () => {
    const gappy = nodeSource({
      teams: async (s) => { const t = await ds.teams(s); return { ...t, teams: t.teams.map((x) => (x.abbr === "MIA" ? { ...x, ok: false } : x)) }; },
    });
    await expect(runSimulation(await base(), gappy)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });
});

describe("awards never touch model inputs", () => {
  it("no simulation or similarity code imports honors, and data files carry no honors", () => {
    const files = [...readdirSync("lib/sim").map((f) => join("lib/sim", f)), "lib/similarity.ts", "lib/embedding.ts"];
    for (const f of files) expect(readFileSync(f, "utf8")).not.toMatch(/honors|award/i);
    const model = readFileSync("public/data/sim/model.json", "utf8");
    expect(model).not.toMatch(/mvp|allstar|honor/i);
    const shard = readFileSync("public/data/sim/features/2005.json", "utf8");
    expect(Object.keys(JSON.parse(shard)).sort()).toEqual(["ast", "blk", "drb", "g", "ftr", "ids", "mp", "orb", "season", "stl", "tov", "ts", "usg", "x3ar"].sort());
  });
});

describe("sample bracket (round-by-round view)", () => {
  const req = async (over: Partial<BracketReq> = {}): Promise<BracketReq> =>
    ({ mode: "bracket", lineup: await supportedA(), season: 2005, replaced: "PHO", replay: "full", footing: "equal", seed: 77, n: 400, ...over });

  it("is one complete, consistent bracket: every winner played, winners advance, a champion is named", async () => {
    const r = (await runSimulation(await req(), ds))!;
    if (r.mode !== "bracket" || !r.sample) throw new Error("no sample");
    const s = r.sample;
    expect(s.series).toHaveLength(15);
    const winners = new Map(s.series.map((x) => [x.id, x.winner]));
    for (const x of s.series) {
      expect([x.hc, x.other]).toContain(x.winner);
      const winsW = x.winner === x.hc ? x.winsHc : x.winsOther;
      expect(winsW).toBe(x.need);
      expect(x.winsHc === x.need ? x.winsOther : x.winsHc).toBeLessThan(x.need);
    }
    // later rounds feature exactly the earlier winners
    const byRound = [1, 2, 3, 4].map((n) => s.series.filter((x) => x.round === n));
    expect(byRound.map((a) => a.length)).toEqual([8, 4, 2, 1]);
    for (let n = 1; n < 4; n++) {
      const advanced = new Set(byRound[n - 1].map((x) => x.winner));
      for (const x of byRound[n]) { expect(advanced.has(x.hc)).toBe(true); expect(advanced.has(x.other)).toBe(true); }
    }
    expect(s.champion).toBe(winners.get(byRound[3][0].id));
  });

  it("is reproducible and never changes the probabilities", async () => {
    const a = (await runSimulation(await req(), ds))!;
    const b = (await runSimulation(await req(), ds))!;
    const c = (await runSimulation(await req({ seed: 78 }), ds))!;
    if (a.mode !== "bracket" || b.mode !== "bracket" || c.mode !== "bracket") throw new Error("mode");
    expect(a.sample).toEqual(b.sample);
    expect(a.full).toEqual(b.full);
    expect(JSON.stringify(a.sample)).not.toBe(JSON.stringify(c.sample));
  });

  it("the path replay has no sample bracket", async () => {
    const r = (await runSimulation(await req({ replay: "path" }), ds))!;
    if (r.mode !== "bracket") throw new Error("mode");
    expect(r.sample).toBeNull();
    expect(r.path).not.toBeNull();
  });

  it("an unsupported lineup shown with reveal has numbers but no sample withheld state", async () => {
    const r = (await runSimulation(await req({ lineup: await unsupportedFive(), reveal: true }), ds))!;
    if (r.mode !== "bracket") throw new Error("mode");
    expect(r.support.level).toBe("unsupported");
    expect(r.support.shownAnyway).toBe(true);
    expect(r.full).not.toBeNull();
    expect(r.sample).not.toBeNull();
  });
});

describe("missing data gives a useful error, never invented numbers", () => {
  it("a player-season the model can't use stops the run with a message naming the season", async () => {
    const five = await supportedA();
    const broken = [...five.slice(0, 4), { id: "nosuchplayer99", season: 2005 }];
    await expect(runSimulation({ mode: "season", lineup: broken, env: "auto", seed: 1, n: 100 }, ds)).rejects.toMatchObject({
      code: "MISSING_PLAYER",
      message: expect.stringMatching(/nosuchplayer99 in 2004-05\. Choose a different season/),
    });
  });
});
