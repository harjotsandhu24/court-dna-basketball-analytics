import type { ShotDna } from "@/lib/types";

/**
 * Simplified distance bands (Basketball-Reference definitions). These are
 * DISTANCE groups, not locations: nothing here knows left/right/corner.
 * Attempt counts are ESTIMATES (rounded source share x season FGA).
 */
export const DISTANCE_CAPTION = "Simplified distance zones—not exact shot locations.";
export const SMALL_SAMPLE_ATTEMPTS = 20;
/** Five 3-decimal shares can legitimately total 1 ± 5 × 0.0005. Mirrors analysis/shot_bands.py. */
export const SHARE_ROUNDING_TOLERANCE = 0.0025;

export type BandKey = "x0_3" | "x3_10" | "x10_16" | "x16_3p" | "x3p";
/** Zones of the located-shot court: the five distance bands, where "x3p" means three-pointers under 30 ft once located shots split off "x3d". */
export type ShotZoneKey = BandKey | "x3d";
/** Deep threes: recorded three-point attempts at least this far (feet) from the basket. */
export const DEEP_THREE_FT = 30;
export const DEEP_BAND = { key: "x3d" as const, label: "Deep threes (30+ ft)", short: "30+ ft", name: "Deep threes", simple: "Deep threes · 30+ ft", definition: "Three-point attempts 30 feet or more from the basket (end-of-period heaves included)." };

export const BANDS: { key: BandKey; label: string; short: string; name: string; simple: string; definition: string }[] = [
  { key: "x0_3", label: "At the rim (0–3 ft)", short: "0–3 ft", name: "At the rim", simple: "At the rim · 0–3 ft", definition: "Field-goal attempts within 3 feet of the basket." },
  { key: "x3_10", label: "Close range (3–10 ft)", short: "3–10 ft", name: "Close range", simple: "Close range · 3–10 ft", definition: "Attempts from 3 to under 10 feet." },
  { key: "x10_16", label: "Mid-range (10–16 ft)", short: "10–16 ft", name: "Mid-range", simple: "Mid-range · 10–16 ft", definition: "Attempts from 10 to under 16 feet." },
  { key: "x16_3p", label: "Long two (16 ft–3PT line)", short: "16 ft–3PT", name: "Long two", simple: "Long two · 16 ft to 3-point line", definition: "Two-point attempts from 16 feet out to the three-point line." },
  { key: "x3p", label: "Three-pointers", short: "3PT", name: "Three-pointers", simple: "Three-pointers · beyond the line", definition: "All three-point attempts, including corners and heaves." },
];

export interface BaselineBand { share: number | null; fg_pct: number | null }
export interface SeasonBaseline {
  players: number;
  league_player_seasons: number;
  excluded_missing: number;
  excluded_incomplete: number;
  excluded_overallocated: number;
  fga_covered: number;
  league_fga: number;
  fga_coverage: number | null;
  bands: Record<BandKey, BaselineBand>;
}

/** Wording for the baseline: never calls a restricted sample "the league". */
export function baselineLabel(b: SeasonBaseline, minMinutes = 0): string {
  if (minMinutes > 0) return `Estimated average among players with ${minMinutes}+ minutes.`;
  const cov = b.fga_coverage != null ? `${(b.fga_coverage * 100).toFixed(1)}%` : "unknown share";
  return `Estimated average among NBA players with a complete shot distribution in the source (${b.players} of ${b.league_player_seasons} player-seasons; ${cov} of the season's attempts), regular season.`;
}

/** 'source_none' = share 0 AND FG% blank (the source reports no attempts);
 * 'unavailable' = no share; 'inconsistent' = share and FG% disagree about whether attempts exist; 'ok' otherwise. */
export type BandState = "ok" | "source_none" | "unavailable" | "inconsistent";
export type DistributionStatus = "ok" | "incomplete" | "overallocated" | "missing";

export interface BandStat {
  key: BandKey;
  label: string;
  short: string;
  name: string;
  simple: string;
  definition: string;
  state: BandState;
  /** PRIMARY (source): rounded share of attempts, null = unavailable */
  share: number | null;
  /** PRIMARY (source): FG% in the band; null when no attempts were reported (never 0) */
  fgPct: number | null;
  /** SECONDARY (estimates; rounding order: attempts = round(share×FGA), makes = round(attempts×FG%)) */
  attempts: number | null;
  makes: number | null;
  /** estimated attempts round to 0 although the source reports attempts in this band */
  belowOneEstimate: boolean;
  smallSample: boolean;
  baseline: BaselineBand | null;
}

export function bandState(share: number | null, fg: number | null): BandState {
  if (share == null) return "unavailable";
  if (share === 0 && fg == null) return "source_none";
  if ((share === 0) !== (fg == null)) return "inconsistent";
  return "ok";
}

export function distributionStatus(total: number | null | undefined): DistributionStatus {
  if (total == null) return "missing";
  if (total < 1 - SHARE_ROUNDING_TOLERANCE - 1e-9) return "incomplete";
  if (total > 1 + SHARE_ROUNDING_TOLERANCE + 1e-9) return "overallocated";
  return "ok";
}

export function computeBandStats(data: ShotDna, baseline?: SeasonBaseline | null): BandStat[] {
  return BANDS.map((b) => {
    const share = (data[`percent_fga_from_${b.key}_range` as keyof ShotDna] as number | null | undefined) ?? null;
    const fg = (data[`fg_percent_from_${b.key}_range` as keyof ShotDna] as number | null | undefined) ?? null;
    const fga = data.fga ?? null;
    const state = bandState(share, fg);
    const attempts = share != null && fga != null ? Math.round(share * fga) : null;
    const makes = attempts != null && fg != null ? Math.min(attempts, Math.round(attempts * fg)) : null;
    const belowOne = state === "ok" && attempts === 0;
    return {
      ...b,
      state,
      share,
      fgPct: state === "source_none" ? null : fg,
      attempts: state === "source_none" ? 0 : attempts,
      makes: state === "source_none" ? 0 : belowOne ? null : makes,
      belowOneEstimate: belowOne,
      smallSample: state === "ok" && (belowOne || (attempts != null ? attempts < SMALL_SAMPLE_ATTEMPTS : share != null && share < 0.03)),
      baseline: baseline?.bands[b.key] ?? null,
    };
  });
}

/** Click selects; clicking the selected zone clears; another zone switches. */
export function toggleZone(current: ShotZoneKey | null, clicked: ShotZoneKey): ShotZoneKey | null {
  return current === clicked ? null : clicked;
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  return v == null ? "—" : `${(v * 100).toFixed(digits)}%`;
}

/** Fill scale for zones AND the legend (single source of truth). Share saturates at 40%. */
export const SHARE_SCALE_MAX = 0.4;
export const LEGEND_STEPS = [0, 0.1, 0.2, 0.3, 0.4];
export const ZERO_FILL = "hsl(24 30% 30% / 0.18)";
export function shareFill(share: number | null): string {
  if (share == null || share <= 0) return ZERO_FILL;
  const t = Math.min(share, SHARE_SCALE_MAX) / SHARE_SCALE_MAX;
  const alpha = 0.3 + 0.6 * t;
  return `hsl(24 90% 45% / ${alpha.toFixed(3)})`;
}
