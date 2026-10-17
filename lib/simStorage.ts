/** Saved Simulate settings (never results, never lineups): validated on read, written only when valid. */
export const SIM_SETTINGS_KEY = "courtdna.sim.settings.v2";
/** Version 1 settings are read once and migrated; the old entry is left in place (nothing is deleted). */
export const SIM_SETTINGS_KEY_V1 = "courtdna.sim.settings.v1";
export const SEASON_RANGE: [number, number] = [1997, 2026];
export const SETTINGS_VERSION = 2;

export interface SimSettings {
  mode: "season" | "series" | "bracket";
  env: "auto" | number;
  /** season mode: "add" puts the lineup in the league as an extra team; "replace" takes a real team's place */
  leagueMode: "add" | "replace";
  footing: "equal" | "real";
  homeCourt: "you" | "opponent" | "neutral";
  bracketSeason: number | null;
  replay: "full" | "path";
  /** bracket mode: who hosts when two teams have equal records and the season series doesn't settle it (a simulation assumption) */
  tieHome: "net" | "mine" | "theirs";
  seed: number | null;
}

export const DEFAULT_SETTINGS: SimSettings = {
  mode: "season", env: "auto", leagueMode: "add", footing: "equal", homeCourt: "you", bracketSeason: null, replay: "full", tieHome: "net", seed: null,
};

const isSeason = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= SEASON_RANGE[0] && x <= SEASON_RANGE[1];

/**
 * Returns valid settings plus the names of any fields that had to be reset. Never throws.
 * Version 1 (no leagueMode) migrates field by field; a version this code doesn't know resets everything.
 */
export function parseSettings(raw: string | null): { settings: SimSettings; reset: string[]; migratedFrom?: number } {
  const out: SimSettings = { ...DEFAULT_SETTINGS };
  const reset: string[] = [];
  if (raw === null) return { settings: out, reset };
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return { settings: out, reset: ["all"] }; }
  const v = typeof obj === "object" && obj !== null ? (obj as { v?: unknown }).v : undefined;
  if (v !== 1 && v !== 2) return { settings: out, reset: ["all"] };
  const o = obj as Record<string, unknown>;
  const take = <K extends keyof SimSettings>(k: K, ok: (v: unknown) => boolean) => {
    if (!(k in o)) return;
    if (ok(o[k])) (out[k] as unknown) = o[k]; else reset.push(k);
  };
  take("mode", (x) => x === "season" || x === "series" || x === "bracket");
  take("env", (x) => x === "auto" || isSeason(x));
  take("footing", (x) => x === "equal" || x === "real");
  take("homeCourt", (x) => x === "you" || x === "opponent" || x === "neutral");
  take("bracketSeason", (x) => x === null || isSeason(x));
  take("replay", (x) => x === "full" || x === "path");
  take("tieHome", (x) => x === "net" || x === "mine" || x === "theirs"); // added after version 2 shipped: older entries simply lack it
  take("seed", (x) => x === null || (typeof x === "number" && Number.isInteger(x) && x >= 0 && x < 2 ** 32));
  if (v === 2) take("leagueMode", (x) => x === "add" || x === "replace");
  return { settings: out, reset, migratedFrom: v === 1 ? 1 : undefined };
}

export function serializeSettings(s: SimSettings): string {
  return JSON.stringify({ v: SETTINGS_VERSION, ...s });
}

export function loadSettings(): { settings: SimSettings; reset: string[] } {
  try {
    const cur = window.localStorage.getItem(SIM_SETTINGS_KEY);
    if (cur !== null) return parseSettings(cur);
    const old = window.localStorage.getItem(SIM_SETTINGS_KEY_V1);
    if (old !== null) return parseSettings(old);
    return { settings: { ...DEFAULT_SETTINGS }, reset: [] };
  } catch { return { settings: { ...DEFAULT_SETTINGS }, reset: [] }; }
}

export function saveSettings(s: SimSettings): void {
  try {
    const { settings } = parseSettings(serializeSettings(s)); // only validated values are written
    window.localStorage.setItem(SIM_SETTINGS_KEY, serializeSettings(settings));
  } catch { /* storage unavailable: settings just aren't remembered */ }
}
