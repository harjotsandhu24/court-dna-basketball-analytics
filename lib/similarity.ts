/**
 * COURT DNA similarity formula — TypeScript implementation.
 *
 * MUST match analysis/similarity.py exactly. See that file's docstring for
 * the full formula writeup; this is the browser-side implementation so
 * comparisons run instantly without a server round-trip.
 *
 * This is a distance metric on season-standardized statistical vectors,
 * not a probability model. A score of 91 means 91/100 on this project's
 * statistical similarity index -- not a 91% chance two players are alike.
 */
import { FEATURE_WEIGHTS, SIMILARITY_FEATURES, SIMILARITY_SCALE } from "./config";

export type FeatureVector = Readonly<Record<string, number | null | undefined>>;

const TOTAL_WEIGHT = Object.values(FEATURE_WEIGHTS).reduce((a, b) => a + b, 0);

export function weightedRmsDistance(a: FeatureVector, b: FeatureVector): number {
  let acc = 0;
  for (const f of SIMILARITY_FEATURES) {
    const av = a[f];
    const bv = b[f];
    if (av == null || bv == null) continue;
    const diff = av - bv;
    acc += FEATURE_WEIGHTS[f] * (diff * diff);
  }
  return Math.sqrt(acc / TOTAL_WEIGHT);
}

export function similarityIndex(a: FeatureVector, b: FeatureVector): number {
  const dist = weightedRmsDistance(a, b);
  return Math.max(0, 100 - SIMILARITY_SCALE * dist);
}

export interface FeatureDiff {
  feature: string;
  weight: number;
  diff: number;
  absWeightedDiff: number;
}

/** Per-feature signed differences (a - b), largest weighted gap first. Used
 * to generate the deterministic "where they match / where they separate"
 * explanations -- no free text generation, just template filling from
 * this sorted list. */
export function featureDiffs(a: FeatureVector, b: FeatureVector): FeatureDiff[] {
  const out: FeatureDiff[] = [];
  for (const f of SIMILARITY_FEATURES) {
    const av = a[f];
    const bv = b[f];
    if (av == null || bv == null) continue;
    const diff = av - bv;
    out.push({ feature: f, weight: FEATURE_WEIGHTS[f], diff, absWeightedDiff: FEATURE_WEIGHTS[f] * Math.abs(diff) });
  }
  out.sort((x, y) => y.absWeightedDiff - x.absWeightedDiff);
  return out;
}

export interface CandidateFilters {
  season?: number;
  excludePlayerId?: string;
  includeOtherSeasonsOfSamePlayer?: boolean;
  seasonMode?: "all" | "same_season" | "same_era";
  eraWindow?: number;
  positionGroup?: string | null;
  /** Keep only each matched player's single best season. Off by default so
   * existing callers (profile pages) are unchanged; the Player Map turns it on
   * so a long career cannot fill the whole list. */
  onePerPlayer?: boolean;
}

export interface SimilarityPoolEntry {
  player_id: string;
  player: string;
  season: number;
  season_label: string;
  pos_group: string;
  archetype: string;
  vector: FeatureVector;
}

export interface MatchResult extends SimilarityPoolEntry {
  similarity: number;
}

/** True only when every similarity feature is a finite number. A partial
 * vector would score on fewer dimensions (or, with none, a false 100), so
 * match search skips such observations instead of ranking them. */
export function hasUsableVector(v: FeatureVector): boolean {
  return SIMILARITY_FEATURES.every((f) => typeof v[f] === "number" && Number.isFinite(v[f] as number));
}

/** Stable identity of one player-season. Never use a name for this. */
export function playerSeasonKey(playerId: string, season: number): string {
  return `${playerId}_${season}`;
}

/**
 * Player Map "Compare across" choices. These are relative to the selected
 * player-season, not fixed calendar buckets, and are clamped to the dataset.
 */
export type CompareWindow = "season" | "5" | "10" | "all";
export const COMPARE_WINDOWS: readonly CompareWindow[] = ["season", "5", "10", "all"];

export function parseCompareWindow(raw: string | null | undefined): CompareWindow {
  return COMPARE_WINDOWS.find((w) => w === raw) ?? "season";
}

/** Maps a window choice onto the candidate-filter vocabulary used below. */
export function windowToFilters(window: CompareWindow): Pick<CandidateFilters, "seasonMode" | "eraWindow"> {
  if (window === "season") return { seasonMode: "same_season" };
  if (window === "all") return { seasonMode: "all" };
  return { seasonMode: "same_era", eraWindow: Number(window) };
}

/** Inclusive [first, last] season range a window covers around `season`,
 * clamped to the dataset bounds. */
export function windowBounds(
  window: CompareWindow,
  season: number,
  datasetMin: number,
  datasetMax: number,
): [number, number] {
  if (window === "season") return [season, season];
  if (window === "all") return [datasetMin, datasetMax];
  const span = Number(window);
  return [Math.max(datasetMin, season - span), Math.min(datasetMax, season + span)];
}

/** The one season-window predicate, shared by the similarity search and the
 * Player Map's candidate pool so the two can never disagree. */
export function inSeasonWindow(
  candidateSeason: number,
  querySeason: number,
  { seasonMode = "all", eraWindow = 5 }: Pick<CandidateFilters, "seasonMode" | "eraWindow">,
): boolean {
  if (seasonMode === "same_season") return candidateSeason === querySeason;
  if (seasonMode === "same_era") return Math.abs(candidateSeason - querySeason) <= eraWindow;
  return true;
}

/**
 * Find the top N closest matches for a query player-season against a
 * candidate pool, applying the candidate filters in Section 6 of the
 * spec. The query player's OWN season is always excluded (self-match
 * exclusion); other seasons of the same player are excluded by default
 * unless includeOtherSeasonsOfSamePlayer is true.
 *
 * Cross-era note: every vector in the pool is already standardized against
 * its own season's qualified players (analysis/step3), so comparing across
 * seasons compares playing-style tendencies relative to each season's league
 * environment -- no extra normalization happens here. Results are ordered by
 * similarity, then player id, then season, so ties never reorder between
 * renders; a non-finite score is dropped rather than sorted.
 */
export function findClosestMatches(
  query: SimilarityPoolEntry,
  pool: readonly SimilarityPoolEntry[],
  filters: CandidateFilters,
  topN = 8,
): MatchResult[] {
  const {
    excludePlayerId = query.player_id,
    includeOtherSeasonsOfSamePlayer = false,
    seasonMode = "all",
    eraWindow = 5,
    positionGroup = null,
    onePerPlayer = false,
  } = filters;

  if (!hasUsableVector(query.vector)) return [];

  const results: MatchResult[] = [];
  for (const cand of pool) {
    if (!hasUsableVector(cand.vector)) continue;
    // self-match exclusion: never match a player-season to itself
    if (cand.player_id === query.player_id && cand.season === query.season) continue;

    // other-seasons-of-same-player toggle
    if (!includeOtherSeasonsOfSamePlayer && cand.player_id === excludePlayerId) continue;

    if (!inSeasonWindow(cand.season, query.season, { seasonMode, eraWindow })) continue;

    if (positionGroup && cand.pos_group !== positionGroup) continue;

    const sim = similarityIndex(query.vector, cand.vector);
    if (!Number.isFinite(sim)) continue;
    results.push({ ...cand, similarity: sim });
  }

  results.sort(
    (a, b) =>
      b.similarity - a.similarity ||
      (a.player_id < b.player_id ? -1 : a.player_id > b.player_id ? 1 : 0) ||
      a.season - b.season,
  );

  if (!onePerPlayer) return results.slice(0, topN);

  const seen = new Set<string>();
  const unique: MatchResult[] = [];
  for (const r of results) {
    if (seen.has(r.player_id)) continue;
    seen.add(r.player_id);
    unique.push(r);
    if (unique.length === topN) break;
  }
  return unique;
}
