/**
 * "What changed" lines for the career page. A line is written only when the trait is present in both seasons it
 * compares; a missing value is never read as 0, so no false rise or fall can appear. Changes are in percentile points
 * of a player's standing among players of the same season, which is not the same as a raw-stat improvement.
 */
import { TRAIT_DIMENSIONS } from "./config";
import { DIMENSION_DISPLAY_LABEL } from "./courtPrint";
import type { PlayerSeasonRecord } from "./types";

export const CALLOUT_THRESHOLD = 15; // percentile points
export const CALLOUT_NOTE =
  "Percentile points compare a player with others in the same season, so a change here isn't the same as improving a raw stat.";

type Seasonal = Pick<PlayerSeasonRecord, "season_label" | "traits">;

const has = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

export function careerCallouts(seasons: Seasonal[]): string[] {
  if (seasons.length < 2) return [];
  const rows = TRAIT_DIMENSIONS.flatMap((dim) => {
    const withDim = seasons.filter((s) => has(s.traits[dim]));
    if (withDim.length < 2) return [];
    const first = withDim[0];
    const last = withDim[withDim.length - 1];
    const delta = (last.traits[dim] as number) - (first.traits[dim] as number);
    return Math.abs(delta) >= CALLOUT_THRESHOLD ? [{ dim, delta, first, last }] : [];
  });
  rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  return rows.slice(0, 4).map((d) => {
    const n = Math.abs(Math.round(d.delta));
    return `${DIMENSION_DISPLAY_LABEL[d.dim]} ${d.delta > 0 ? "rose" : "fell"} ${n} percentile points from ${d.first.season_label} to ${d.last.season_label}`;
  });
}
