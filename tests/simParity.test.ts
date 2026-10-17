import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateLineup } from "@/lib/sim/strength";
import { seriesExact, simulateSeason } from "@/lib/sim/game";
import { evaluateTeam } from "@/lib/sim/teams";
import { checkSupport } from "@/lib/sim/support";
import { loadEnvironment, loadPlayers } from "@/lib/sim/engine";
import { nodeSource } from "./helpers/simData";

const fx = JSON.parse(readFileSync("tests/sim_parity_fixture.json", "utf8"));
const ds = nodeSource();

describe("TypeScript engine matches the Python reference model", () => {
  it("lineup features, usage scale and ratings agree to 1e-9", async () => {
    const model = await ds.model();
    expect(fx.lineups.length).toBeGreaterThanOrEqual(15);
    for (const L of fx.lineups) {
      const players = await loadPlayers(ds, model, L.picks);
      const ev = evaluateLineup(players, null, model);
      expect(ev.k).toBeCloseTo(L.k, 9);
      for (const f of model.features) expect(ev.vector[f]).toBeCloseTo(L.vector[f], 9);
      expect(ev.net).toBeCloseTo(L.net, 8);
      expect(ev.ortgRel).toBeCloseTo(L.ortg_rel, 8);
      expect(ev.drtgRel).toBeCloseTo(L.drtg_rel, 8);
      // the support check agrees with the Python reference: same distance, same level, same reasons
      const sup = checkSupport(model, ev.vector, ev.net, players);
      expect(sup.d2).toBeCloseTo(L.support.d2, 6);
      expect(sup.level).toBe(L.support.level);
      expect([...sup.reasons].sort()).toEqual([...L.support.reasons].sort());
    }
  });

  it("real-team ratings (real rotation and equal footing) agree", async () => {
    const model = await ds.model();
    for (const t of fx.teams) {
      const [shard, tf] = [await ds.features(t.season), await ds.teams(t.season)];
      const entry = tf.teams.find((x) => x.abbr === t.team)!;
      const ev = evaluateTeam(entry, shard, model, t.footing === "real" ? "real" : "equal")!;
      expect(ev.net).toBeCloseTo(t.net, 8);
      expect(ev.k).toBeCloseTo(t.k, 9);
      if (t.footing === "equal") {
        const players = (await import("@/lib/sim/teams")).teamPlayers(entry, shard, model).slice(0, 5);
        const sup = checkSupport(model, ev.vector, ev.net, players);
        expect(sup.d2).toBeCloseTo(t.support.d2, 6);
        expect(sup.level).toBe(t.support.level);
      }
    }
  });

  it("series probabilities match the Monte Carlo reference", async () => {
    const model = await ds.model();
    for (const s of fx.series) {
      const a = fx.lineups[s.a].net, b = fx.lineups[s.b].net;
      const r = seriesExact(model, { ratingA: a, ratingB: b, tauA: model.tau.five, tauB: model.tau.five, pattern: "HHAAHAH", need: 4 });
      expect(Math.abs(r.pA - s.p_a)).toBeLessThan(0.006);
      let expectedGames = 0, refGames = 0;
      for (let g = 4; g <= 7; g++) { expectedGames += g * (r.lenA[g] + r.lenB[g]); refGames += g * (s.length[String(g)] ?? 0); }
      expect(Math.abs(expectedGames - refGames)).toBeLessThan(0.03);
    }
  });

  it("82-game win estimates match the reference simulation", async () => {
    const model = await ds.model();
    for (const s of fx.seasons) {
      const env = await loadEnvironment(ds, model, s.env);
      expect(env.teams.length).toBe(s.teams);
      const r = (await simulateSeason(model, {
        rating: fx.lineups[s.lineup].net, tau: model.tau.five, oppRatings: env.teams.map((t) => t.rating),
        tauOpp: model.tau.real, n: 6000, seed: 77,
      }))!;
      expect(Math.abs(r.mean - s.mean)).toBeLessThan(0.5);
      expect(Math.abs(r.sd - s.sd)).toBeLessThan(0.5);
    }
  });
});
