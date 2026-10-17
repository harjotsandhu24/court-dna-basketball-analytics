/**
 * Pure helpers for Build a Lineup. The lineup offers every display-eligible
 * season (the same pool Explore shows: 250+ minutes); seasons below the
 * comparison cutoff (500 minutes and 20 games) are flagged as small samples.
 * Similarity rankings and qualification rules are not touched here.
 */
import { zToApproxPercentile } from "./stats";
import type { PlayerSeasonRecord, PlayersIndexEntry } from "./types";

export const SMALL_SAMPLE_LABEL = "Small sample";
export const SMALL_SAMPLE_NOTE = "Limited playing time. These stats may be less reliable.";

/** Every season Explore offers for this player, oldest first. */
export function lineupSeasons(entry: Pick<PlayersIndexEntry, "seasons">): number[] {
  return [...entry.seasons].sort((a, b) => a - b);
}

/** Latest available season: the default when no season is specified. */
export function latestLineupSeason(entry: Pick<PlayersIndexEntry, "seasons">): number | null {
  const seasons = lineupSeasons(entry);
  return seasons.length ? seasons[seasons.length - 1] : null;
}

/** True for a display-eligible season that is below the comparison cutoff. */
export function isSmallSampleSeason(
  entry: Pick<PlayersIndexEntry, "seasons" | "qualified_seasons">,
  season: number,
): boolean {
  return entry.seasons.includes(season) && !entry.qualified_seasons.includes(season);
}

/** What the "Defensive Activity" trait is built from (analysis/config.py: stl_percent and blk_percent only).
 *  Defensive rebounds are NOT part of it (they feed the separate Rebounding trait), so the note names exactly these two. */
export const DEFENSE_INPUTS_NOTE = "Based on steals and blocks.";

export const LINEUP_DIMENSIONS: ReadonlyArray<{ key: string; label: string; note?: string }> = [
  { key: "Playmaking", label: "Passing & Creation" },
  { key: "Perimeter Profile", label: "Three-Point Shooting" },
  { key: "Rim Pressure", label: "Attacking the Basket" },
  { key: "Rebounding", label: "Rebounding" },
  { key: "Defensive Activity", label: "Defensive box-score signals", note: DEFENSE_INPUTS_NOTE },
  { key: "__ball_dominance", label: "How Much They Handle the Ball" },
];

/** One player's value for a lineup dimension, or null when the stat is missing. */
export function lineupValue(p: PlayerSeasonRecord, key: string): number | null {
  if (key === "__ball_dominance") {
    const usg = p.vector?.usg_percent;
    return typeof usg === "number" && Number.isFinite(usg) ? zToApproxPercentile(usg) : null;
  }
  const v = p.traits?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** True when any lineup stat is missing for this player-season. */
export function hasMissingLineupStats(p: PlayerSeasonRecord): boolean {
  return LINEUP_DIMENSIONS.some((d) => lineupValue(p, d.key) == null);
}

/** Lineup average per dimension; null (never zero) if any selected player lacks that stat. */
export function lineupScores(selected: PlayerSeasonRecord[]): Record<string, number | null> | null {
  if (selected.length === 0) return null;
  const out: Record<string, number | null> = {};
  for (const dim of LINEUP_DIMENSIONS) {
    const vals = selected.map((p) => lineupValue(p, dim.key));
    // Sum in sorted order so the result never depends on who stands where:
    // rearranging the same player-seasons gives bit-for-bit identical scores.
    out[dim.key] = vals.some((v) => v == null) ? null : [...(vals as number[])].sort((a, b) => a - b).reduce((a, b) => a + b, 0) / vals.length;
  }
  return out;
}

/** Plain-language notes; only uses stats that are actually present. */
export function lineupObservations(selected: PlayerSeasonRecord[], scores: Record<string, number | null>): string[] {
  if (selected.length < 3) return [];
  const obs: string[] = [];
  const highUsageCreators = selected.filter((p) => {
    const play = lineupValue(p, "Playmaking");
    const usg = lineupValue(p, "__ball_dominance");
    return play != null && usg != null && play >= 70 && usg >= 70;
  }).length;
  if (highUsageCreators >= 2) obs.push(`Several selected players handle the ball and create shots often (${highUsageCreators} of ${selected.length})`);

  const per = scores["Perimeter Profile"];
  const reb = scores["Rebounding"];
  const def = scores["Defensive Activity"];
  const rim = scores["Rim Pressure"];
  if (per != null && per >= 65) obs.push("The lineup takes a lot of three-point shots");
  if (reb != null && reb < 40) obs.push("Fewer rebounds than most players in the dataset");
  if (def != null && def >= 65) obs.push("The lineup produces a high number of steals and blocks");
  if (rim != null && rim >= 65) obs.push("Several selected players attack the basket often");

  const posGroups = selected.map((p) => p.pos_group);
  if (new Set(posGroups).size === 1) obs.push(`All selected players share one position group (${posGroups[0]})`);
  return obs.slice(0, 5);
}
