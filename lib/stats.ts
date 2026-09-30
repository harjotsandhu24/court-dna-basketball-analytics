/** Standard normal CDF approximation (Abramowitz & Stegun 7.1.26), used only
 * to convert a standardized z-score into an approximate 0-100 percentile
 * for the "Ball Dominance" Build-a-Five dimension, which draws on usage
 * rate directly rather than one of the seven precomputed trait dimensions
 * from the main pipeline. This is an approximation, not the same
 * season-relative rank computation used elsewhere -- documented as such in
 * docs/methodology.md "Build a Five". */
export function zToApproxPercentile(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return Math.max(0, Math.min(100, p * 100));
}
