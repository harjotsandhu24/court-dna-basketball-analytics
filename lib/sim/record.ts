/**
 * Display-only conversion of the simulated mean win total into an estimated W–L record.
 * Does not touch the model or the simulation: the same `wins.mean` is rounded ONCE, and losses are 82 minus those
 * rounded wins, so the two always add up to 82 and are whole numbers in 0..82.
 */
export const SEASON_GAMES = 82;

export interface EstimatedRecord {
  wins: number;
  losses: number;
  /** "64–18" (en dash) */
  text: string;
  /** "64 wins, 18 losses", what a screen reader should hear */
  spoken: string;
}

/** Returns null (the caller must show an error) for a missing, non-finite or out-of-range mean. Never invents a record. */
export function estimatedRecord(meanWins: unknown): EstimatedRecord | null {
  if (typeof meanWins !== "number" || !Number.isFinite(meanWins)) return null;
  if (meanWins < -1e-9 || meanWins > SEASON_GAMES + 1e-9) return null;
  const wins = Math.min(SEASON_GAMES, Math.max(0, Math.round(meanWins))) + 0; // + 0 turns -0 into 0
  const losses = SEASON_GAMES - wins;
  return {
    wins,
    losses,
    text: `${wins}–${losses}`,
    spoken: `${wins} ${wins === 1 ? "win" : "wins"}, ${losses} ${losses === 1 ? "loss" : "losses"}`,
  };
}
