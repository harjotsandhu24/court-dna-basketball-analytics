/**
 * Saves the lineup in this browser only (localStorage): which player-season
 * stands in each of the five positions. Nothing here talks to a server.
 * Saved data is untrusted input: it is validated on the way in, and a bad or
 * unavailable entry is skipped (and reported) rather than breaking the page.
 */
import { SEASON_MAX, SEASON_MIN } from "./config";
import { SLOT_COUNT } from "./lineupBoard";

export const STORAGE_KEY = "courtdna.lineup.v1";

export interface SavedSlot {
  id: string;
  season: number;
}

const ID_PATTERN = /^[A-Za-z0-9_.-]{1,40}$/;

export function serializeLineup(slots: (SavedSlot | null)[]): string {
  return JSON.stringify({ v: 1, slots: slots.slice(0, SLOT_COUNT).map((s) => (s ? { id: s.id, season: s.season } : null)) });
}

/** Parses saved text. Never throws; entries that are malformed or duplicate a player are dropped and counted. */
export function parseSavedLineup(raw: string | null): { slots: (SavedSlot | null)[]; dropped: number } {
  const empty: (SavedSlot | null)[] = Array.from({ length: SLOT_COUNT }, () => null);
  if (!raw) return { slots: empty, dropped: 0 };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { slots: empty, dropped: 1 };
  }
  const list = (data as { v?: unknown; slots?: unknown } | null)?.slots;
  if (!data || (data as { v?: unknown }).v !== 1 || !Array.isArray(list)) return { slots: empty, dropped: 1 };
  const seen = new Set<string>();
  let dropped = 0;
  const slots = empty.map((_, i) => {
    const e = list[i] as { id?: unknown; season?: unknown } | null | undefined;
    if (e == null) return null;
    const ok =
      typeof e.id === "string" &&
      ID_PATTERN.test(e.id) &&
      typeof e.season === "number" &&
      Number.isInteger(e.season) &&
      e.season >= SEASON_MIN &&
      e.season <= SEASON_MAX &&
      !seen.has(e.id);
    if (!ok) {
      dropped++;
      return null;
    }
    seen.add(e.id as string);
    return { id: e.id as string, season: e.season as number };
  });
  if (list.length > SLOT_COUNT) dropped += list.slice(SLOT_COUNT).filter((x) => x != null).length;
  return { slots, dropped };
}

export function hasAnySaved(slots: (SavedSlot | null)[]): boolean {
  return slots.some((s) => s != null);
}

/** Storage can be missing or blocked (private mode, disabled cookies, quota): every call is safe to fail. */
export function readSavedRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
export function writeSaved(slots: (SavedSlot | null)[]): void {
  try {
    if (hasAnySaved(slots)) window.localStorage.setItem(STORAGE_KEY, serializeLineup(slots));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* the lineup still works, it just won't be remembered */
  }
}
export function clearSaved(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
