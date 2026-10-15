/**
 * Real shot locations (compact per-player-season files; see docs/data.md).
 * Coordinates are the source's integer tenths of a foot with the hoop at the origin: x < 0 is the shooter's
 * left, y grows away from the baseline. One tenth of a foot is one SVG unit, so svg_x = 250 + x and
 * svg_y = 52.5 + y. Zones are classified by ONE integer rule shared with the Python importer
 * (analysis/shot_import.py; vectors in tests/shot_zone_vectors.json).
 */
import { BASKET, COURT_W } from "./courtGeometry";
import { DEEP_THREE_FT, type ShotZoneKey } from "./shotZones";

export interface LocationsSummary {
  /** exact: recorded attempts and makes equal the season totals; partial: fewer attempts recorded; differs: more, or different makes */
  status: "exact" | "partial" | "differs";
  attempts: number;
  makes: number;
  trusted_fga: number;
  trusted_fgm: number;
  coverage: number | null;
  undrawn: number;
  at_hoop_centre: number;
  /** zone -> [attempts, makes], derived from the same records as the dots */
  zones: Record<ShotZoneKey, [number, number]>;
}

export interface ShotFile {
  v: number;
  player_id: string;
  season: number;
  season_type: string;
  attempts: number;
  makes: number;
  /** packed shots: 5 characters each = x+250 (base36 x2), y+100 (base36 x2), flag (made + 2*three) */
  s: string;
}

export interface ShotBaselineZone { attempts: number; makes: number; share: number; fg_pct: number | null }
export interface ShotBaseline {
  season_type: string;
  exact_counts: boolean;
  attempts: number;
  makes: number;
  trusted_league_fga?: number;
  coverage: number | null;
  players: number;
  population: string;
  zones: Record<ShotZoneKey, ShotBaselineZone>;
}

export interface Shot {
  /** SVG court coordinates */
  sx: number;
  sy: number;
  made: boolean;
  three: boolean;
  zone: ShotZoneKey;
  /** inside the drawn half court (long heaves are counted but not drawn) */
  drawn: boolean;
}

export type ShotFilter = "all" | "made" | "missed";

export const FILE_VERSION = 2;
const PACK_X = 250;
const PACK_Y = 100;
/** Drawn part of the half court in source units: |x| <= 250, svg_y = 52.5 + y in [0, 400] => y in [-52, 347]. */
const DRAWN_Y_MIN = -52;
const DRAWN_Y_MAX = 347;
const DEEP_D2 = (DEEP_THREE_FT * 10) ** 2;

/** Zone for one recorded shot: 3PT by shot type, two-pointers by distance from the hoop (integer arithmetic, tenths of a foot). */
export function shotZone(x: number, y: number, three: boolean): ShotZoneKey {
  const d2 = x * x + y * y;
  // three-pointers split at exactly 30 ft (900 square ft = 90000 in squared tenths); a two-point label is never "deep"
  if (three) return d2 >= DEEP_D2 ? "x3d" : "x3p";
  return d2 < 900 ? "x0_3" : d2 < 10000 ? "x3_10" : d2 < 25600 ? "x10_16" : "x16_3p";
}

export function shotToCourt(x: number, y: number): { x: number; y: number } {
  return { x: BASKET.x + x, y: BASKET.y + y };
}

export function isDrawn(x: number, y: number): boolean {
  return Math.abs(x) <= COURT_W / 2 && y >= DRAWN_Y_MIN && y <= DRAWN_Y_MAX;
}

export function decodeShots(f: ShotFile): Shot[] {
  if (f.v !== FILE_VERSION) throw new Error(`Unsupported shot file version ${f.v}`);
  const str = f.s;
  if (typeof str !== "string" || str.length % 5 !== 0 || str.length / 5 !== f.attempts) throw new Error("Malformed shot file: length mismatch");
  const n = str.length / 5;
  const out: Shot[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 5;
    const x = parseInt(str.slice(o, o + 2), 36) - PACK_X;
    const y = parseInt(str.slice(o + 2, o + 4), 36) - PACK_Y;
    const flag = str.charCodeAt(o + 4) - 48;
    if (Number.isNaN(x) || Number.isNaN(y) || flag < 0 || flag > 3) throw new Error("Malformed shot file: bad value");
    const three = (flag & 2) === 2;
    const c = shotToCourt(x, y);
    out[i] = { sx: c.x, sy: c.y, made: (flag & 1) === 1, three, zone: shotZone(x, y, three), drawn: isDrawn(x, y) };
  }
  return out;
}

export function zoneCounts(shots: Shot[]): Record<ShotZoneKey, [number, number]> {
  const z: Record<ShotZoneKey, [number, number]> = { x0_3: [0, 0], x3_10: [0, 0], x10_16: [0, 0], x16_3p: [0, 0], x3p: [0, 0], x3d: [0, 0] };
  for (const s of shots) {
    z[s.zone][0] += 1;
    if (s.made) z[s.zone][1] += 1;
  }
  return z;
}

/** Marker state: filtered out entirely, shown normally, emphasised (selected zone) or dimmed (other zones). */
export function markerState(s: Shot, filter: ShotFilter, selected: ShotZoneKey | null): "hidden" | "normal" | "emphasis" | "dim" {
  if (!s.drawn) return "hidden";
  if (filter === "made" && !s.made) return "hidden";
  if (filter === "missed" && s.made) return "hidden";
  if (selected == null) return "normal";
  return s.zone === selected ? "emphasis" : "dim";
}

/** SVG path data: filled circles for made shots, × marks for misses. */
export function markerPath(shots: Shot[], kind: "made" | "missed", r: number): string {
  const parts: string[] = [];
  for (const s of shots) {
    const y = s.sy.toFixed(1);
    if (kind === "made") parts.push(`M${(s.sx - r).toFixed(1)} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`);
    else parts.push(`M${(s.sx - r).toFixed(1)} ${(s.sy - r).toFixed(1)}l${2 * r} ${2 * r}M${(s.sx + r).toFixed(1)} ${(s.sy - r).toFixed(1)}l${-2 * r} ${2 * r}`);
  }
  return parts.join("");
}

/** Shooting % from recorded shots (always all attempts in the zone, never the filtered subset). */
export function zoneShooting(summary: LocationsSummary, zone: ShotZoneKey) {
  const [att, made] = summary.zones[zone];
  return { attempts: att, makes: made, share: summary.attempts ? att / summary.attempts : null, pct: att ? made / att : null };
}

// ---- loader: cached per player-season, failures are never cached, bounded wait ----
const cache = new Map<string, Promise<ShotFile>>();
const TIMEOUT_MS = 15000;

export function loadPlayerShots(playerId: string, season: number): Promise<ShotFile> {
  const key = `${season}/${playerId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`/data/shots/${season}/${playerId}.json`, ctl ? { signal: ctl.signal } : undefined);
      if (!res.ok) throw new Error(`Failed to load shot locations: ${res.status}`);
      const f = (await res.json()) as ShotFile;
      decodeShots(f); // validate shape once
      return f;
    } finally {
      clearTimeout(timer);
    }
  })();
  cache.set(key, p);
  p.catch(() => { if (cache.get(key) === p) cache.delete(key); });
  return p;
}
