/**
 * Client-side data access layer. Nothing here ever loads the full
 * historical dataset -- each function fetches exactly one compact JSON
 * file (one season, one player's career, or the qualified-only similarity
 * pool) and caches it in memory so repeat views within a session don't
 * re-fetch. This is what keeps initial page load fast and the Galaxy
 * smooth despite ~9,000 qualified player-seasons existing in total.
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
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Failed to load ${path}: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function loadSeason(season: number): Promise<PlayerSeasonRecord[]> {
  if (!seasonCache.has(season)) {
    seasonCache.set(season, fetchJson<PlayerSeasonRecord[]>(`/data/seasons/${season}.json`));
  }
  return seasonCache.get(season)!;
}

export function loadCareer(playerId: string): Promise<PlayerSeasonRecord[]> {
  if (!careerCache.has(playerId)) {
    careerCache.set(playerId, fetchJson<PlayerSeasonRecord[]>(`/data/career/${playerId}.json`));
  }
  return careerCache.get(playerId)!;
}

export function loadGalaxy(season: number): Promise<GalaxySeasonData> {
  if (!galaxyCache.has(season)) {
    galaxyCache.set(season, fetchJson<GalaxySeasonData>(`/data/galaxy/${season}.json`));
  }
  return galaxyCache.get(season)!;
}

export function loadPlayersIndex(): Promise<PlayersIndex> {
  if (!playersIndexPromise) {
    playersIndexPromise = fetchJson<PlayersIndex>("/data/players_index.json");
  }
  return playersIndexPromise;
}

export function loadSimilarityPool(): Promise<SimilarityPoolEntry[]> {
  if (!similarityPoolPromise) {
    similarityPoolPromise = fetchJson<SimilarityPoolEntry[]>("/data/similarity_pool.json");
  }
  return similarityPoolPromise;
}

export function loadMeta(): Promise<DatasetMeta> {
  if (!metaPromise) {
    metaPromise = fetchJson<DatasetMeta>("/data/meta.json");
  }
  return metaPromise;
}

export async function findPlayerSeason(playerId: string, season: number): Promise<PlayerSeasonRecord | null> {
  const seasonData = await loadSeason(season);
  return seasonData.find((r) => r.player_id === playerId) ?? null;
}

/** Diacritic-insensitive, case-insensitive substring search over the
 * players index. "jokic" matches "Nikola Jokić". */
export function searchPlayers(index: PlayersIndex, query: string, limit = 20): Array<{ id: string; name: string; latest_team: string }> {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const q = norm(query.trim());
  if (!q) return [];
  const results: Array<{ id: string; name: string; latest_team: string }> = [];
  for (const [id, entry] of Object.entries(index)) {
    if (norm(entry.name).includes(q)) {
      results.push({ id, name: entry.name, latest_team: entry.latest_team });
      if (results.length >= limit) break;
    }
  }
  return results;
}
