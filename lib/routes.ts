/**
 * Strict validation of values that come from the address bar. Nothing here accepts a numeric prefix
 * ("2005abc"), a non-integer ("2005.5", "NaN"), or a season outside the dataset, so an invalid link can
 * never turn into a real request for some other player-season.
 */
import { SEASON_MAX, SEASON_MIN } from "./config";

/** Basketball-Reference style ids: letters then two digits (every id in the players index matches). */
const PLAYER_ID = /^[a-z]{2,12}\d{2}$/;
const SEASON_TEXT = /^\d{4}$/;

export function isValidPlayerId(value: string): boolean {
  return PLAYER_ID.test(value);
}

/** A whole four-digit season inside the supported range, or null. "2005abc", "NaN", "1996", "2027" are all null. */
export function parseSeasonParam(value: string): number | null {
  if (!SEASON_TEXT.test(value)) return null;
  const n = Number(value);
  return n >= SEASON_MIN && n <= SEASON_MAX ? n : null;
}

export type PlayerRoute =
  | { kind: "ok"; playerId: string; season: number }
  | { kind: "invalid-player" }
  | { kind: "invalid-season"; playerId: string };

/** Validates both parts of /player/[playerId]/[season] before anything is fetched. */
export function parsePlayerRoute(playerId: string, season: string): PlayerRoute {
  let id = playerId;
  try { id = decodeURIComponent(playerId); } catch { return { kind: "invalid-player" }; }
  if (!isValidPlayerId(id)) return { kind: "invalid-player" };
  let seasonText = season;
  try { seasonText = decodeURIComponent(season); } catch { return { kind: "invalid-season", playerId: id }; }
  const s = parseSeasonParam(seasonText);
  return s == null ? { kind: "invalid-season", playerId: id } : { kind: "ok", playerId: id, season: s };
}

/** Career route: only the id is a parameter. */
export function parseCareerRoute(playerId: string): { kind: "ok"; playerId: string } | { kind: "invalid-player" } {
  let id = playerId;
  try { id = decodeURIComponent(playerId); } catch { return { kind: "invalid-player" }; }
  return isValidPlayerId(id) ? { kind: "ok", playerId: id } : { kind: "invalid-player" };
}
