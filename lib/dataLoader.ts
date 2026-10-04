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
export function normalizeSearchText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Apostrophes (straight, curly, modifier, backtick, acute) and periods
    // vanish: "O'Neal" -> "oneal", "D'Angelo" -> "dangelo".
    .replace(/[.'\u2018\u2019\u02bc`\u00b4]/g, "")
    // Every other separator (hyphens, dashes, underscores, slashes, ...) is a space.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** True when the compact query matches the compact name starting at a word
 * boundary ("oneal" in "shaquille oneal"). */
function compactWordStartMatch(nameNorm: string, qCompact: string): boolean {
  const words = nameNorm.split(" ");
  for (let i = 0; i < words.length; i++) {
    if (words.slice(i).join("").startsWith(qCompact)) return true;
  }
  return false;
}

export type SearchScope = "all" | "map";

export interface PlayerSearchResult {
  id: string;
  name: string;
  /** How the query matched -- used for ranking. */
  matchType: "exact" | "prefix" | "word" | "substring";
  /** Seasons with a Player Map / comparison-qualified record. */
  qualifiedSeasons: number[];
  /** Every season with a profile page. */
  seasons: number[];
}

const TIER: Record<PlayerSearchResult["matchType"], number> = { exact: 0, prefix: 1, word: 2, substring: 3 };

/** Diacritic-insensitive, case-insensitive, partial-name search over the
 * players index.
 *
 * Ranking: exact full name, then full-name prefix ("kobe b"), then every
 * query word starting some name word ("bryant ko", "james le"), then
 * contains-anywhere. Inside a tier, players with more seasons come first
 * (so the more established "Stephen Curry" tops a one-season namesake),
 * then alphabetical.
 *
 * scope "map" only returns players that have at least one Player Map
 * qualified season, so a result can always be opened on the map; scope
 * "all" returns every player with a profile page. */
export function searchPlayers(
  index: PlayersIndex,
  query: string,
  limit = 20,
  opts: { scope?: SearchScope } = {},
): PlayerSearchResult[] {
  const q = normalizeSearchText(query);
  if (!q) return [];
  const scope = opts.scope ?? "all";
  const tokens = q.split(" ");
  const qCompact = q.replace(/ /g, "");
  const out: PlayerSearchResult[] = [];

  for (const [id, entry] of Object.entries(index)) {
    if (scope === "map" && entry.qualified_seasons.length === 0) continue;
    const n = normalizeSearchText(entry.name);
    let matchType: PlayerSearchResult["matchType"] | null = null;
    if (n === q) matchType = "exact";
    else if (n.startsWith(q)) matchType = "prefix";
    else {
      const words = n.split(" ");
      if (tokens.every((t) => words.some((w) => w.startsWith(t)))) matchType = "word";
      else if (n.includes(q)) matchType = "substring";
      // Separator-forgiving fallback, only for names the checks above
      // missed so existing ranking is untouched: "oneal" / "o neal" vs
      // "O'Neal", "alfarouq" vs "Al-Farouq", "d angelo" vs "D'Angelo".
      else if (qCompact.length > 0) {
        if (compactWordStartMatch(n, qCompact)) matchType = "word";
        else if (n.replace(/ /g, "").includes(qCompact)) matchType = "substring";
      }
    }
    if (matchType) {
      out.push({ id, name: entry.name, matchType, qualifiedSeasons: entry.qualified_seasons, seasons: entry.seasons });
    }
  }

  out.sort(
    (a, b) =>
      TIER[a.matchType] - TIER[b.matchType] ||
      b.seasons.length - a.seasons.length ||
      a.name.localeCompare(b.name),
  );
  return out.slice(0, limit);
}

/** Given a player and a target season, returns that season if the player
 * has a qualified record there, otherwise the nearest qualified season
 * (ties broken toward the more recent one). Returns null only if the
 * player has no qualified seasons at all. */
export function nearestQualifiedSeason(entry: { qualified_seasons: number[] }, targetSeason: number): number | null {
  return nearestSeason(entry.qualified_seasons, targetSeason);
}

function nearestSeason(list: number[], targetSeason: number): number | null {
  if (list.length === 0) return null;
  if (list.includes(targetSeason)) return targetSeason;
  let best = list[0];
  let bestDist = Math.abs(best - targetSeason);
  for (const s of list) {
    const dist = Math.abs(s - targetSeason);
    if (dist < bestDist || (dist === bestDist && s > best)) {
      best = s;
      bestDist = dist;
    }
  }
  return best;
}

/** The season a search result should open in.
 * - "map": only qualified seasons are valid; nearest to `target` (or the
 *   latest qualified season when there is no target).
 * - "all": same, but a player with no qualified season still opens their
 *   latest profile season, since every indexed player has a detail page. */
export function resolveSeason(
  entry: { qualified_seasons: number[]; seasons: number[] },
  target: number | undefined,
  scope: SearchScope,
): number | null {
  const pool =
    scope === "map" ? entry.qualified_seasons : entry.qualified_seasons.length > 0 ? entry.qualified_seasons : entry.seasons;
  if (pool.length === 0) return null;
  const goal = target ?? Math.max(...pool);
  return nearestSeason(pool, goal);
}

/** Seasons a player can be compared in: only their comparison / Player Map
 * qualified seasons. Never falls back to ordinary profile seasons. */
export function comparableSeasons(
  index: PlayersIndex | undefined,
  id: string,
): number[] {
  const entry = index?.[id];
  return entry ? [...entry.qualified_seasons].sort((x, y) => y - x) : [];
}

/** True unless the record is explicitly flagged as not meeting the
 * comparison threshold (`qualified === false`). */
export function isComparisonQualified(record: { qualified: boolean }): boolean {
  return record.qualified !== false;
}
