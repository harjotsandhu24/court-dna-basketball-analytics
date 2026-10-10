/**
 * Shared 2-D map layout for the Player Map's multi-season windows.
 *
 * The per-season PCA coordinates in public/data/galaxy/ are fit separately for
 * each season, so axes differ from season to season and their points cannot be
 * drawn together. For ±5 / ±10 / 2000-present the map instead projects every
 * qualified player-season's season-standardized vector (the same 12 features
 * the similarity score uses) onto ONE principal-component basis fit on the
 * whole pool. Positions therefore stay fixed while the window changes.
 *
 * Visualization only: like the per-season map, it is an approximation.
 * Closest matches always come from the full 12-feature similarity score.
 * Missing/non-finite features are treated as 0 (the season average), the same
 * convention the pipeline's PCA uses.
 */
import { SIMILARITY_FEATURES } from "./config";
import { hasUsableVector, playerSeasonKey, type SimilarityPoolEntry } from "./similarity";

export interface EmbeddingPoint {
  x: number;
  y: number;
}

const ITERATIONS = 200;

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function matVec(m: number[][], v: number[]): number[] {
  return m.map((row) => dot(row, v));
}

function normalize(v: number[]): number[] {
  const n = Math.sqrt(dot(v, v));
  return n > 1e-12 ? v.map((x) => x / n) : v;
}

/** Top-2 eigenvectors of a symmetric matrix by deterministic power iteration
 * with deflation. Sign is fixed so the largest-magnitude entry is positive. */
function topTwoEigenvectors(cov: number[][]): number[][] {
  const d = cov.length;
  const out: number[][] = [];
  const work = cov.map((r) => r.slice());
  for (let k = 0; k < 2; k++) {
    // Deterministic, non-degenerate start vector.
    let v = normalize(Array.from({ length: d }, (_, i) => 1 + ((i * 7 + k * 3) % 5) / 10));
    for (let it = 0; it < ITERATIONS; it++) {
      const next = normalize(matVec(work, v));
      if (next.every((x) => x === 0)) break;
      v = next;
    }
    let big = 0;
    for (let i = 1; i < d; i++) if (Math.abs(v[i]) > Math.abs(v[big])) big = i;
    if (v[big] < 0) v = v.map((x) => -x);
    out.push(v);
    const lambda = dot(v, matVec(work, v));
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) work[i][j] -= lambda * v[i] * v[j];
  }
  return out;
}

const cache = new WeakMap<readonly SimilarityPoolEntry[], Map<string, EmbeddingPoint>>();

/** Coordinates keyed by playerSeasonKey. Observations with unusable vectors are
 * omitted. Computed once per pool array and cached. */
export function computeSharedEmbedding(pool: readonly SimilarityPoolEntry[]): Map<string, EmbeddingPoint> {
  const cached = cache.get(pool);
  if (cached) return cached;

  const usable = pool.filter((e) => hasUsableVector(e.vector));
  const result = new Map<string, EmbeddingPoint>();
  const d = SIMILARITY_FEATURES.length;
  if (usable.length >= 2) {
    const rows = usable.map((e) => SIMILARITY_FEATURES.map((f) => e.vector[f] as number));
    const mean = Array.from({ length: d }, (_, j) => rows.reduce((s, r) => s + r[j], 0) / rows.length);
    const cov = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    for (const r of rows) {
      for (let i = 0; i < d; i++) {
        const di = r[i] - mean[i];
        for (let j = i; j < d; j++) cov[i][j] += di * (r[j] - mean[j]);
      }
    }
    for (let i = 0; i < d; i++) {
      for (let j = i; j < d; j++) {
        cov[i][j] /= rows.length;
        cov[j][i] = cov[i][j];
      }
    }
    const [e1, e2] = topTwoEigenvectors(cov);
    usable.forEach((e, idx) => {
      const c = rows[idx].map((v, j) => v - mean[j]);
      const x = dot(c, e1);
      const y = dot(c, e2);
      if (Number.isFinite(x) && Number.isFinite(y)) result.set(playerSeasonKey(e.player_id, e.season), { x, y });
    });
  }
  cache.set(pool, result);
  return result;
}
