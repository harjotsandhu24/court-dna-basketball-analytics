/** Plain-language assessment built only from measurable model terms. No tactical claims. */
import { dimensionContributions, usageOverlapEffect } from "./strength";
import type { LineupEval } from "./strength";
import type { ModelFile, SimFeature } from "./types";

export interface Dimension {
  name: string;
  /** net-rating points per 100 possessions versus the average lineup */
  value: number;
  evidence: string;
}

/**
 * Display names. The fitted model file keeps its original keys (coefficients are untouched); only what the person
 * reads changes. Defense is described by the box-score inputs it actually uses. The fitted group also carries height,
 * which the note below says, so the label stays short without hiding an input.
 */
export const DEFENSE_DIM = "Steals, blocks & defensive rebounds";
const DISPLAY_NAME: Record<string, string> = {
  Creation: "Playmaking",
  "Possession control": "Ball security & rebounding",
  "Defensive box-score signals": DEFENSE_DIM,
};
export const displayName = (modelKey: string) => DISPLAY_NAME[modelKey] ?? modelKey;
export const DEFENSE_NOTE =
  "Steals, blocks & defensive rebounds (with height) are box-score inputs. They are statistical associations with the model's fitted net rating, not measured defensive impact. The model does not give an expected defensive rating.";
/** a dimension counts as clearly above or below average only past this many net-rating points per 100 possessions */
export const CLEAR = 0.1;

const pct = (x: number, digits = 1) => `${x.toFixed(digits)}%`;

function envValue(model: ModelFile, env: number, f: SimFeature, z: number): number {
  const s = model.seasons[String(env)];
  return s.mean[f] + z * s.sd[f];
}
function envMean(model: ModelFile, env: number, f: SimFeature): number {
  return model.seasons[String(env)].mean[f];
}

/** Evidence sentences use the starters' own stats mapped into the environment season's league. */
export function dimensionEvidence(model: ModelFile, env: number, ev: LineupEval): Record<string, string> {
  const v = ev.vector;
  const ts = envValue(model, env, "ts_percent", v.s_uts) * 100;
  const tsAvg = envMean(model, env, "ts_percent") * 100;
  const ast = envValue(model, env, "ast_percent", v.s_ast);
  const astMax = envValue(model, env, "ast_percent", v.s_maxast);
  const astAvg = envMean(model, env, "ast_percent");
  const x3 = envValue(model, env, "x3p_ar", v.s_x3) * 100;
  const x3Avg = envMean(model, env, "x3p_ar") * 100;
  const tov = envValue(model, env, "tov_percent", v.s_tov);
  const tovAvg = envMean(model, env, "tov_percent");
  const orb = envValue(model, env, "orb_percent", v.s_orb);
  const orbAvg = envMean(model, env, "orb_percent");
  const drb = envValue(model, env, "drb_percent", v.s_drb);
  const drbAvg = envMean(model, env, "drb_percent");
  const stl = envValue(model, env, "stl_percent", v.s_stl);
  const stlAvg = envMean(model, env, "stl_percent");
  const blk = envValue(model, env, "blk_percent", v.s_blk);
  const blkAvg = envMean(model, env, "blk_percent");
  return {
    "Scoring efficiency": `Starters shoot ${pct(ts)} true shooting after sharing the ball (typical player: ${pct(tsAvg)}).`,
    Playmaking: `Starters average a ${pct(ast)} assist rate and the best passer is at ${pct(astMax)} (typical: ${pct(astAvg)}).`,
    Spacing: `Starters take ${pct(x3)} of their shots from three (typical: ${pct(x3Avg)}).`,
    "Ball security & rebounding": `Turnover rate ${pct(tov)} (typical ${pct(tovAvg)}) and offensive rebound rate ${pct(orb)} (typical ${pct(orbAvg)}).`,
    [DEFENSE_DIM]: `Defensive rebound ${pct(drb)} (typical ${pct(drbAvg)}), steals ${pct(stl, 2)} (typical ${pct(stlAvg, 2)}), blocks ${pct(blk, 2)} (typical ${pct(blkAvg, 2)}).`,
  };
}

export interface Assessment {
  dimensions: Dimension[];
  /** areas clearly above average (up to three; fewer when the data supports fewer) */
  strengths: Dimension[];
  /** "below": clearly below average. "relative": every area is above average, so these are only the weakest. "none": nothing stands out. */
  weakKind: "below" | "relative" | "none";
  weaknesses: Dimension[];
  usage: { scale: number; effectNet: number };
}

/** Splits dimension values into strengths and weaknesses without over-claiming (pure; tested directly). */
export function splitDimensions(dims: Dimension[]): Pick<Assessment, "strengths" | "weakKind" | "weaknesses"> {
  const byName = (a: Dimension, b: Dimension) => (a.name < b.name ? -1 : 1);
  const desc = [...dims].sort((a, b) => b.value - a.value || byName(a, b));
  const asc = [...dims].sort((a, b) => a.value - b.value || byName(a, b));
  const strengths = desc.filter((d) => d.value >= CLEAR).slice(0, 3);
  if (dims.length && dims.every((d) => d.value > 0)) return { strengths, weakKind: "relative", weaknesses: asc.slice(0, 2) };
  const weaknesses = asc.filter((d) => d.value <= -CLEAR).slice(0, 2);
  return { strengths, weakKind: weaknesses.length ? "below" : "none", weaknesses };
}

export function assess(model: ModelFile, env: number, ev: LineupEval): Assessment {
  const contrib = dimensionContributions(ev, model);
  const evidence = dimensionEvidence(model, env, ev);
  const dims: Dimension[] = Object.keys(contrib).map((key) => {
    const name = displayName(key);
    return { name, value: contrib[key], evidence: evidence[name] ?? "" };
  });
  return { dimensions: dims, ...splitDimensions(dims), usage: { scale: ev.k, effectNet: usageOverlapEffect(ev, model) } };
}

/** The three biggest differences between two teams, by model contribution to net rating. */
export function matchupFactors(model: ModelFile, env: number, a: LineupEval, b: LineupEval) {
  const ca = dimensionContributions(a, model);
  const cb = dimensionContributions(b, model);
  const ea = dimensionEvidence(model, env, a);
  const eb = dimensionEvidence(model, env, b);
  return Object.keys(ca)
    .map((key) => ({ name: displayName(key), diff: ca[key] - cb[key], a: ea[displayName(key)], b: eb[displayName(key)] }))
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff) || (x.name < y.name ? -1 : 1))
    .slice(0, 3);
}
