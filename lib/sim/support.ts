/**
 * Support check: does a lineup look like the teams the model was fitted on?
 * Mirrors analysis/sim/support.py (a parity fixture checks it).
 *
 * The distance is a Mahalanobis distance from the training teams' starting-five feature vectors, so an unusual
 * combination of features counts even when each feature alone is ordinary. "Supported" only means "resembles teams the
 * model was tested on". It never means a custom lineup is validated: no real team ever played a lineup like it.
 */
import type { ModelFile, SimPlayer } from "./types";

export type SupportLevel = "supported" | "limited" | "unsupported";
export type SupportReason = "combination_far" | "combination_unusual" | "net_outside" | "small_sample" | "mixed_era";

export const UNSUPPORTED_MESSAGE = "This lineup is too different from the teams used to test the model.";

export interface SupportResult {
  level: SupportLevel;
  d2: number;
  reasons: SupportReason[];
  /** projected net rating the net check used */
  projectedNet: number;
}

export function mahalanobis2(model: ModelFile, vec: Record<string, number>): number {
  const s = model.support;
  const d = s.dims.map((k, i) => vec[k] - s.mean[i]);
  let t = 0;
  for (let i = 0; i < d.length; i++) {
    let row = 0;
    for (let j = 0; j < d.length; j++) row += s.precision[i][j] * d[j];
    t += d[i] * row;
  }
  return t;
}

export function checkSupport(model: ModelFile, vec: Record<string, number>, projectedNet: number, players: SimPlayer[]): SupportResult {
  const s = model.support;
  const d2 = mahalanobis2(model, vec);
  const reasons: SupportReason[] = [];
  if (d2 > s.unsupported) reasons.push("combination_far");
  else if (d2 > s.limited) reasons.push("combination_unusual");
  if (projectedNet > s.net.max || projectedNet < s.net.min) reasons.push("net_outside");
  if (players.some((p) => p.mp < s.minMp || p.g < s.minG)) reasons.push("small_sample");
  const seasons = players.map((p) => p.season);
  if (Math.max(...seasons) - Math.min(...seasons) >= s.eraSpan) reasons.push("mixed_era");
  const level: SupportLevel = reasons.includes("combination_far") || reasons.includes("net_outside") ? "unsupported" : reasons.length ? "limited" : "supported";
  return { level, d2, reasons, projectedNet };
}

/** The worse of two levels (a series or bracket is only as supported as its weakest custom lineup). */
export function worst(a: SupportLevel, b: SupportLevel): SupportLevel {
  const order: SupportLevel[] = ["supported", "limited", "unsupported"];
  return order[Math.max(order.indexOf(a), order.indexOf(b))];
}

const f = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}`;

export function reasonText(model: ModelFile, r: SupportResult, players: SimPlayer[]): string[] {
  const s = model.support;
  const out: string[] = [];
  const seasons = players.map((p) => p.season);
  const span = Math.max(...seasons) - Math.min(...seasons);
  const small = players.filter((p) => p.mp < s.minMp || p.g < s.minG).length;
  if (r.reasons.includes("combination_far"))
    out.push(`The mix of strengths is more extreme than ${(s.unsupportedQ * 100).toFixed(1)}% of the ${s.n} real teams the model was fitted on, so it has no close real-world comparison.`);
  else if (r.reasons.includes("combination_unusual"))
    out.push(`The mix of strengths is more unusual than ${(s.limitedQ * 100).toFixed(0)}% of the real teams the model was fitted on.`);
  if (r.reasons.includes("net_outside"))
    out.push(`The projected net rating (${f(r.projectedNet)} per 100 possessions) is outside the range of the real teams the model was fitted on (${f(s.net.min)} to ${f(s.net.max)}).`);
  if (r.reasons.includes("small_sample"))
    out.push(`${small} of ${players.length} player-seasons are small samples (under ${s.minMp} minutes or ${s.minG} games), so their numbers are noisier.`);
  if (r.reasons.includes("mixed_era"))
    out.push(`The players come from seasons ${span} years apart. League-relative adjustments put them on one scale, but no real team mixed eras, so this has not been tested.`);
  if (!out.length) out.push("The mix of strengths resembles real teams the model was fitted on, the samples are full, and the seasons are close together.");
  return out;
}

export const SUPPORT_CAVEAT =
  "Being inside the range of past teams does not prove a custom lineup is validated: no real team ever played this exact combination, and the model has only been tested on real teams.";
