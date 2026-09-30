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

/**
 * Find the top N closest matches for a query player-season against a
 * candidate pool, applying the candidate filters in Section 6 of the
 * spec. The query player's OWN season is always excluded (self-match
 * exclusion); other seasons of the same player are excluded by default
 * unless includeOtherSeasonsOfSamePlayer is true.
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
  } = filters;

  const results: MatchResult[] = [];
  for (const cand of pool) {
    // self-match exclusion: never match a player-season to itself
    if (cand.player_id === query.player_id && cand.season === query.season) continue;

    // other-seasons-of-same-player toggle
    if (!includeOtherSeasonsOfSamePlayer && cand.player_id === excludePlayerId) continue;

    if (seasonMode === "same_season" && cand.season !== query.season) continue;
    if (seasonMode === "same_era" && Math.abs(cand.season - query.season) > eraWindow) continue;

    if (positionGroup && cand.pos_group !== positionGroup) continue;

    const sim = similarityIndex(query.vector, cand.vector);
    results.push({ ...cand, similarity: sim });
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, topN);
}
