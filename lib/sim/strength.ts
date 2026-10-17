/**
 * Lineup -> team strength. Mirrors analysis/sim/model.py line by line (a parity fixture checks it).
 *
 * A lineup is five starters (fixed standard minutes) plus a bench: the "average bench" or a real team's bench.
 * Everything is an unordered set: players are put in a canonical order before any sum, so moving the same
 * players between court spots can never change a number.
 */
import { SHARD_KEY, SIM_FEATURES } from "./types";
import type { FeatureShard, LineupPick, ModelFile, SimFeature, SimPlayer, ZMap } from "./types";

export const STARTERS = 5;

export function makePlayer(shard: FeatureShard, index: number, model: ModelFile): SimPlayer {
  const stats = model.seasons[String(shard.season)];
  const z = {} as ZMap;
  const raw = {} as Record<SimFeature, number>;
  for (const f of SIM_FEATURES) {
    const v = (shard[SHARD_KEY[f]] as number[])[index];
    raw[f] = v;
    z[f] = (v - stats.mean[f]) / stats.sd[f];
  }
  return {
    id: shard.ids[index], season: shard.season, mp: shard.mp[index], g: shard.g[index],
    usg: raw.usg_percent, z, raw,
  };
}

export function playerFromShard(shard: FeatureShard, id: string, model: ModelFile): SimPlayer | null {
  const i = shard.ids.indexOf(id);
  return i < 0 ? null : makePlayer(shard, i, model);
}

export function canonical<T extends { id: string; season: number }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.season - b.season));
}

const S_MEAN: [string, SimFeature][] = [
  ["s_ast", "ast_percent"], ["s_tov", "tov_percent"], ["s_orb", "orb_percent"], ["s_drb", "drb_percent"],
  ["s_stl", "stl_percent"], ["s_blk", "blk_percent"], ["s_x3", "x3p_ar"], ["s_ftr", "f_tr"],
];
const B_MEAN: [string, SimFeature][] = [
  ["b_ts", "ts_percent"], ["b_ast", "ast_percent"], ["b_tov", "tov_percent"], ["b_orb", "orb_percent"],
  ["b_drb", "drb_percent"], ["b_stl", "stl_percent"], ["b_blk", "blk_percent"], ["b_x3", "x3p_ar"], ["b_ftr", "f_tr"],
];

export interface StarterInfo {
  features: Record<string, number>;
  /** usage scale applied to every starter */
  k: number;
  /** usage-weighted true shooting (z) without the usage-overlap adjustment */
  utsUnadjusted: number;
  /** each starter's usage before / after the adjustment (percent) */
  usage: { id: string; season: number; before: number; after: number }[];
}

export function starterFeatures(starters: SimPlayer[], benchUsage: number, model: ModelFile): StarterInfo {
  const st = canonical(starters);
  const n = st.length;
  const p = model.params;
  const fS = p.starterShare;
  const meanU = st.reduce((a, q) => a + q.usg, 0) / n;
  let k = (p.usageTarget - (1 - fS) * benchUsage) / (fS * meanU);
  k = Math.min(Math.max(k, p.kClip[0]), p.kClip[1]);
  let uts = 0, wsum = 0, utsPlain = 0, wPlain = 0;
  const usage: StarterInfo["usage"] = [];
  for (const q of st) {
    const u2 = k * q.usg;
    const sd = model.seasons[String(q.season)].sd.usg_percent;
    const ts2 = q.z.ts_percent + (p.betaTsUsg * (u2 - q.usg)) / sd;
    uts += u2 * ts2;
    wsum += u2;
    utsPlain += q.usg * q.z.ts_percent;
    wPlain += q.usg;
    usage.push({ id: q.id, season: q.season, before: q.usg, after: u2 });
  }
  const features: Record<string, number> = { s_uts: uts / wsum };
  for (const [name, f] of S_MEAN) features[name] = st.reduce((a, q) => a + q.z[f], 0) / n;
  features.s_maxast = Math.max(...st.map((q) => q.z.ast_percent));
  return { features, k, utsUnadjusted: utsPlain / wPlain, usage };
}

export function benchFeatures(bench: SimPlayer[]): { features: Record<string, number>; usage: number } {
  const b = canonical(bench);
  const tot = b.reduce((a, q) => a + q.mp, 0);
  const features: Record<string, number> = {};
  for (const [name, f] of B_MEAN) features[name] = b.reduce((a, q) => a + q.mp * q.z[f], 0) / tot;
  const usage = b.reduce((a, q) => a + q.mp * q.usg, 0) / tot;
  return { features, usage };
}

export interface LineupEval {
  vector: Record<string, number>;
  k: number;
  usage: StarterInfo["usage"];
  utsUnadjusted: number;
  /** net rating relative to a league-average team, points per 100 possessions */
  net: number;
  /** offensive rating relative to the league average */
  ortgRel: number;
  drtgRel: number;
}

function dot(model: ModelFile, which: "net" | "ortg_rel" | "drtg_rel", v: Record<string, number>): number {
  let s = model.intercept[which];
  for (const f of model.features) s += model.coef[which][f] * v[f];
  return s;
}

/** bench === null means the average bench. */
export function evaluateLineup(starters: SimPlayer[], bench: SimPlayer[] | null, model: ModelFile): LineupEval {
  let bf: Record<string, number>;
  let bu: number;
  if (bench === null) {
    bf = {};
    for (const [name] of B_MEAN) bf[name] = model.params.avgBench[name];
    bu = model.params.avgBench.usg;
  } else {
    const r = benchFeatures(bench);
    bf = r.features;
    bu = r.usage;
  }
  const s = starterFeatures(starters, bu, model);
  const vector = { ...s.features, ...bf };
  return {
    vector, k: s.k, usage: s.usage, utsUnadjusted: s.utsUnadjusted,
    net: dot(model, "net", vector), ortgRel: dot(model, "ortg_rel", vector), drtgRel: dot(model, "drtg_rel", vector),
  };
}

export const AVG_RESERVE_NOTE = "average bench";

/** Contribution of each assessment dimension to net rating, relative to the average lineup. */
export function dimensionContributions(ev: LineupEval, model: ModelFile): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [dim, feats] of Object.entries(model.dimensions)) {
    let s = 0;
    for (const f of feats) s += model.coef.net[f] * (ev.vector[f] - model.reference[f]);
    out[dim] = s;
  }
  return out;
}

/** Effect of the usage-overlap adjustment on net rating (can be tiny; reported separately). */
export function usageOverlapEffect(ev: LineupEval, model: ModelFile): number {
  return model.coef.net.s_uts * (ev.vector.s_uts - ev.utsUnadjusted);
}

export function pickKey(p: LineupPick): string {
  return `${p.id}@${p.season}`;
}
