/**
 * Deterministic "where they match / where they separate" explanations.
 *
 * No LLM, no free text generation at runtime. Every sentence below is a
 * fixed template selected by which feature has the smallest (most similar)
 * or largest (most different) weighted gap between two standardized
 * vectors, per lib/similarity.ts featureDiffs(). The magnitude of the
 * underlying numeric difference is never invented -- only reworded into
 * plain language from a fixed lookup table.
 */
import { featureDiffs, type FeatureVector } from "./similarity";

interface Templates {
  similar: string;
  aHigher: (a: string, b: string) => string;
  bHigher: (a: string, b: string) => string;
}

const FEATURE_TEMPLATES: Record<string, Templates> = {
  pts_per_100_poss: {
    similar: "Similar scoring load per 100 possessions",
    aHigher: (a, b) => `${a} scores at a notably higher rate per 100 possessions than ${b}`,
    bHigher: (a, b) => `${b} scores at a notably higher rate per 100 possessions than ${a}`,
  },
  usg_percent: {
    similar: "Similar offensive usage",
    aHigher: (a, b) => `${a} carries a considerably larger share of the offense than ${b}`,
    bHigher: (a, b) => `${b} carries a considerably larger share of the offense than ${a}`,
  },
  ts_percent: {
    similar: "Similar scoring efficiency (true shooting %)",
    aHigher: (a, b) => `${a} scores considerably more efficiently (true shooting %) than ${b}`,
    bHigher: (a, b) => `${b} scores considerably more efficiently (true shooting %) than ${a}`,
  },
  f_tr: {
    similar: "Similar free-throw drawing rate",
    aHigher: (a, b) => `${a} draws free throws at a considerably higher rate than ${b}`,
    bHigher: (a, b) => `${b} draws free throws at a considerably higher rate than ${a}`,
  },
  avg_dist_fga: {
    similar: "Similar average shot distance",
    aHigher: (a, b) => `${a} shoots from considerably farther out, on average, than ${b}`,
    bHigher: (a, b) => `${b} shoots from considerably farther out, on average, than ${a}`,
  },
  percent_fga_from_x0_3_range: {
    similar: "Similar rim-attempt frequency",
    aHigher: (a, b) => `${a} attacks the rim considerably more often than ${b}`,
    bHigher: (a, b) => `${b} attacks the rim considerably more often than ${a}`,
  },
  percent_fga_from_x3p_range: {
    similar: "Similar three-point shot frequency",
    aHigher: (a, b) => `${a} takes considerably more of their shots from three-point range than ${b}`,
    bHigher: (a, b) => `${b} takes considerably more of their shots from three-point range than ${a}`,
  },
  ast_percent: {
    similar: "Similar playmaking involvement",
    aHigher: (a, b) => `${a} creates considerably more for teammates than ${b}`,
    bHigher: (a, b) => `${b} creates considerably more for teammates than ${a}`,
  },
  tov_percent: {
    similar: "Similar turnover rate",
    aHigher: (a, b) => `${a} turns the ball over considerably more often than ${b}`,
    bHigher: (a, b) => `${b} turns the ball over considerably more often than ${a}`,
  },
  trb_percent: {
    similar: "Similar rebounding rate",
    aHigher: (a, b) => `${a} rebounds at a considerably higher rate than ${b}`,
    bHigher: (a, b) => `${b} rebounds at a considerably higher rate than ${a}`,
  },
  stl_percent: {
    similar: "Similar steal rate",
    aHigher: (a, b) => `${a} generates considerably more steals than ${b}`,
    bHigher: (a, b) => `${b} generates considerably more steals than ${a}`,
  },
  blk_percent: {
    similar: "Similar shot-blocking rate",
    aHigher: (a, b) => `${a} blocks considerably more shots than ${b}`,
    bHigher: (a, b) => `${b} blocks considerably more shots than ${a}`,
  },
};

// A weighted-diff below this is treated as "similar"; above this "separate".
// Chosen relative to typical standardized-feature gaps (roughly the median
// weighted gap across the qualified pool) -- documented in
// docs/methodology.md "Explain the match".
const SIMILAR_THRESHOLD = 0.08;

export interface MatchExplanation {
  similarities: string[];
  differences: string[];
}

export function explainMatch(nameA: string, vecA: FeatureVector, nameB: string, vecB: FeatureVector): MatchExplanation {
  const diffs = featureDiffs(vecA, vecB);
  const similarities: string[] = [];
  const differences: string[] = [];

  // Smallest gaps = most similar; take from the END of the sorted (desc) list
  const ascending = [...diffs].reverse();
  for (const d of ascending) {
    if (similarities.length >= 3) break;
    const t = FEATURE_TEMPLATES[d.feature];
    if (t && d.absWeightedDiff <= SIMILAR_THRESHOLD) similarities.push(t.similar);
  }
  // fallback: if nothing cleared the threshold, still show the closest 2
  if (similarities.length === 0) {
    for (const d of ascending.slice(0, 2)) {
      const t = FEATURE_TEMPLATES[d.feature];
      if (t) similarities.push(t.similar);
    }
  }

  // Largest gaps = most different; take from the START of the sorted (desc) list
  for (const d of diffs) {
    if (differences.length >= 3) break;
    const t = FEATURE_TEMPLATES[d.feature];
    if (!t) continue;
    differences.push(d.diff > 0 ? t.aHigher(nameA, nameB) : t.bHigher(nameA, nameB));
  }

  return { similarities, differences };
}
