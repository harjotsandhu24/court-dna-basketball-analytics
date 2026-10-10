/**
 * Client-side data access layer. Nothing here ever loads the full
 * historical dataset -- each function fetches exactly one compact JSON
 * file (one season, one player's career, or the qualified-only similarity
 * pool) and caches it in memory so repeat views within a session don't
 * re-fetch. This is what keeps initial page load fast and the Player Map
 * smooth despite ~9,000 qualified player-seasons existing in total.
 *
 * Caching rule: a successful result is cached forever (the underlying
 * files don't change during a session). A *failed* request is never
 * cached -- the promise is removed from its cache on rejection, so the
 * very next call genuinely retries the fetch instead of replaying the
 * same failure forever. Without this, one transient network blip would
 * permanently break that piece of data until a full page reload.
 */
import type {
  PlayerSeasonRecord,
  PlayersIndex,
  GalaxySeasonData,
  DatasetMeta,
} from "./types";
import type { SimilarityPoolEntry } from "./similarity";

const seasonCache = new Map<number, Promise<PlayerSeasonRecord[]>>();
const careerCache = new Map<string, Promise<PlayerSeasonRecord[]>>();
const galaxyCache = new Map<number, Promise<GalaxySeasonData>>();
let playersIndexPromise: Promise<PlayersIndex> | null = null;
let similarityPoolPromise: Promise<SimilarityPoolEntry[]> | null = null;
let metaPromise: Promise<DatasetMeta> | null = null;

async function fetchJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path);
  } catch {
    // Network-level failure (offline, DNS, CORS, etc.) -- normalize to the
    // same Error shape as an HTTP error so callers have one thing to check.
    throw new Error(`Failed to load ${path}: network error`);
  }
  if (!res.ok) {
    throw new Error(`Failed to load ${path}: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Wraps a cache-populating fetch so a rejection evicts its own cache
 * entry before the rejection propagates to the caller -- the next call
 * for the same key then genuinely retries rather than returning the same
 * dead promise. Generic over the Map's key type so it works for the
 * numeric (season/galaxy) and string (career) caches alike. */
function cachedFetch<K, T>(cache: Map<K, Promise<T>>, key: K, path: string): Promise<T> {
  if (!cache.has(key)) {
    const p = fetchJson<T>(path).catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, p);
  }
  return cache.get(key)!;
}

/** Same eviction-on-failure behavior for the three singleton (non-keyed)
 * resources, via a getter/setter pair for the module-level promise. */
function cachedSingleton<T>(get: () => Promise<T> | null, set: (p: Promise<T> | null) => void, path: string): Promise<T> {
  const existing = get();
  if (existing) return existing;
  const p = fetchJson<T>(path).catch((err) => {
    set(null);
    throw err;
  });
  set(p);
  return p;
}

export function loadSeason(season: number): Promise<PlayerSeasonRecord[]> {
  return cachedFetch(seasonCache, season, `/data/seasons/${season}.json`);
}

export function loadCareer(playerId: string): Promise<PlayerSeasonRecord[]> {
  return cachedFetch(careerCache, playerId, `/data/career/${playerId}.json`);
}

export function loadGalaxy(season: number): Promise<GalaxySeasonData> {
  return cachedFetch(galaxyCache, season, `/data/galaxy/${season}.json`);
}

export function loadPlayersIndex(): Promise<PlayersIndex> {
  return cachedSingleton(() => playersIndexPromise, (p) => { playersIndexPromise = p; }, "/data/players_index.json");
}

export function loadSimilarityPool(): Promise<SimilarityPoolEntry[]> {
  return cachedSingleton(() => similarityPoolPromise, (p) => { similarityPoolPromise = p; }, "/data/similarity_pool.json");
}

export function loadMeta(): Promise<DatasetMeta> {
  return cachedSingleton(() => metaPromise, (p) => { metaPromise = p; }, "/data/meta.json");
}

export async function findPlayerSeason(playerId: string, season: number): Promise<PlayerSeasonRecord | null> {
  const seasonData = await loadSeason(season);
  return seasonData.find((r) => r.player_id === playerId) ?? null;
}

/** Diacritic/case-insensitive normalization shared by every search below. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export interface PlayerSearchResult {
  id: string;
  name: string;
  latest_team: string;
  /** How the query matched -- used for ranking (exact beats prefix beats
   * substring); can drive UI emphasis if useful. */
  matchType: "exact" | "prefix" | "substring";
}

/** Diacritic-insensitive, case-insensitive search over the players index,
 * ranked exact match first, then "starts with" (including per-word, so
 * "james" ranks "LeBron James" as a prefix hit via its second word), then
 * "contains anywhere" -- each tier alphabetical within itself. "jokic"
 * matches "Nikola Jokić". */
export function searchPlayers(index: PlayersIndex, query: string, limit = 20): PlayerSearchResult[] {
  const q = normalize(query.trim());
  if (!q) return [];

  const exact: PlayerSearchResult[] = [];
  const prefix: PlayerSearchResult[] = [];
  const substring: PlayerSearchResult[] = [];

  for (const [id, entry] of Object.entries(index)) {
    const n = normalize(entry.name);
    const words = n.split(/\s+/);
    if (n === q) {
      exact.push({ id, name: entry.name, latest_team: entry.latest_team, matchType: "exact" });
    } else if (n.startsWith(q) || words.some((w) => w.startsWith(q))) {
      prefix.push({ id, name: entry.name, latest_team: entry.latest_team, matchType: "prefix" });
    } else if (n.includes(q)) {
      substring.push({ id, name: entry.name, latest_team: entry.latest_team, matchType: "substring" });
    }
  }

  const byName = (a: PlayerSearchResult, b: PlayerSearchResult) => a.name.localeCompare(b.name);
  exact.sort(byName);
  prefix.sort(byName);
  substring.sort(byName);

  return [...exact, ...prefix, ...substring].slice(0, limit);
}

/** Given a player and a target season, returns that season if the player
 * has a qualified record there, otherwise the nearest qualified season
 * (ties broken toward the more recent one). Returns null only if the
 * player has no qualified seasons at all. Used anywhere a player might be
 * selected while viewing a season they didn't qualify in (e.g. Player Map
 * search) so the UI can switch to a real season rather than show nothing. */
export function nearestQualifiedSeason(entry: { qualified_seasons: number[] }, targetSeason: number): number | null {
  if (entry.qualified_seasons.length === 0) return null;
  if (entry.qualified_seasons.includes(targetSeason)) return targetSeason;
  let best = entry.qualified_seasons[0];
  let bestDist = Math.abs(best - targetSeason);
  for (const s of entry.qualified_seasons) {
    const dist = Math.abs(s - targetSeason);
    if (dist < bestDist || (dist === bestDist && s > best)) {
      best = s;
      bestDist = dist;
    }
  }
  return best;
}
