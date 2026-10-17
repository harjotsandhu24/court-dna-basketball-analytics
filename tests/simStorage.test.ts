import { describe, expect, it } from "vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { STORAGE_KEY as LINEUP_KEY } from "@/lib/lineupStorage";
import { DEFAULT_SETTINGS, SIM_SETTINGS_KEY, SIM_SETTINGS_KEY_V1, loadSettings, parseSettings, saveSettings, serializeSettings } from "@/lib/simStorage";

describe("saved Simulate settings", () => {
  it("round-trips valid settings", () => {
    const s = { ...DEFAULT_SETTINGS, mode: "bracket" as const, bracketSeason: 2005, replay: "path" as const, seed: 42, env: 2001 };
    expect(parseSettings(serializeSettings(s))).toEqual({ settings: s, reset: [] });
  });
  it("nothing saved gives defaults with nothing reset", () => {
    expect(parseSettings(null)).toEqual({ settings: DEFAULT_SETTINGS, reset: [] });
  });
  it.each(["{", "null", "[]", "42", '"x"', '{"v":3}', '{"v":0}', '{"mode":"season"}'])("corrupted, unversioned or unknown-version %s falls back to defaults", (raw) => {
    const r = parseSettings(raw);
    expect(r.settings).toEqual(DEFAULT_SETTINGS);
    expect(r.reset).toEqual(["all"]);
  });
  it("resets only the invalid fields and keeps the valid ones", () => {
    const r = parseSettings(JSON.stringify({ v: 1, mode: "bracket", env: 1850, footing: "real", homeCourt: "moon", seed: -3, replay: "path", bracketSeason: "2005" }));
    expect(r.settings).toMatchObject({ mode: "bracket", footing: "real", replay: "path", env: "auto", homeCourt: "you", seed: null, bracketSeason: null });
    expect(r.reset.sort()).toEqual(["bracketSeason", "env", "homeCourt", "seed"]);
  });
  it("the equal-record home-court choice defaults to point differential, is optional in v2, and an invalid value resets only that field", () => {
    expect(DEFAULT_SETTINGS.tieHome).toBe("net");
    const old = parseSettings(JSON.stringify({ v: 2, mode: "bracket", leagueMode: "add" }));
    expect(old.settings.tieHome).toBe("net");
    expect(old.reset).toEqual([]);
    expect(parseSettings(JSON.stringify({ v: 2, tieHome: "mine" })).settings.tieHome).toBe("mine");
    const bad = parseSettings(JSON.stringify({ v: 2, mode: "bracket", tieHome: "coin" }));
    expect(bad.settings).toMatchObject({ mode: "bracket", tieHome: "net" });
    expect(bad.reset).toEqual(["tieHome"]);
  });
  it("never stores lineups or results, even if they were injected", () => {
    const r = parseSettings(JSON.stringify({ v: 1, mode: "season", lineup: [{ id: "x" }], result: { wins: 82 } }));
    expect(Object.keys(r.settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });
  it("rejects non-integer, out-of-range and non-numeric seeds and seasons", () => {
    for (const bad of [1.5, 2 ** 32, "7", NaN]) {
      expect(parseSettings(JSON.stringify({ v: 1, seed: bad })).settings.seed).toBeNull();
    }
    expect(parseSettings(JSON.stringify({ v: 1, env: 2027 })).settings.env).toBe("auto");
  });
});

describe("saved settings migration and storage failures", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => (store.has(k) ? store.get(k)! : null), setItem: (k: string, v: string) => { store.set(k, v); } } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a version 1 entry migrates: valid fields are kept, the new field takes its default, the old entry is left alone", () => {
    const v1 = JSON.stringify({ v: 1, mode: "bracket", env: 2001, footing: "real", seed: 9, bracketSeason: 2005 });
    store.set(SIM_SETTINGS_KEY_V1, v1);
    const r = loadSettings();
    expect(r.settings).toMatchObject({ mode: "bracket", env: 2001, footing: "real", seed: 9, bracketSeason: 2005, leagueMode: "add" });
    expect(r.reset).toEqual([]);
    expect(store.get(SIM_SETTINGS_KEY_V1)).toBe(v1); // nothing deleted or rewritten
    saveSettings(r.settings);
    expect(JSON.parse(store.get(SIM_SETTINGS_KEY)!).v).toBe(2);
    expect(store.get(SIM_SETTINGS_KEY_V1)).toBe(v1);
  });
  it("a version 1 entry with bad fields resets only those fields", () => {
    store.set(SIM_SETTINGS_KEY_V1, JSON.stringify({ v: 1, mode: "season", env: 3000, homeCourt: "neutral" }));
    const r = loadSettings();
    expect(r.settings).toMatchObject({ mode: "season", env: "auto", homeCourt: "neutral" });
    expect(r.reset).toEqual(["env"]);
  });
  it("version 2 is preferred over an old version 1 entry, and validates leagueMode", () => {
    store.set(SIM_SETTINGS_KEY_V1, JSON.stringify({ v: 1, mode: "bracket" }));
    store.set(SIM_SETTINGS_KEY, JSON.stringify({ v: 2, mode: "series", leagueMode: "replace" }));
    expect(loadSettings().settings).toMatchObject({ mode: "series", leagueMode: "replace" });
    store.set(SIM_SETTINGS_KEY, JSON.stringify({ v: 2, leagueMode: "sideways" }));
    const r = loadSettings();
    expect(r.settings.leagueMode).toBe("add");
    expect(r.reset).toEqual(["leagueMode"]);
  });
  it("a version 1 entry cannot set the version 2 field", () => {
    expect(parseSettings(JSON.stringify({ v: 1, leagueMode: "replace" })).settings.leagueMode).toBe("add");
  });
  it("unavailable storage never throws: reads give defaults and writes are silently skipped", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); } } });
    expect(loadSettings()).toEqual({ settings: DEFAULT_SETTINGS, reset: [] });
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
    vi.unstubAllGlobals(); // no window at all (server render)
    expect(loadSettings()).toEqual({ settings: DEFAULT_SETTINGS, reset: [] });
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
  });
  it("saved lineups live under a different key that settings code never reads or writes", () => {
    store.set(LINEUP_KEY, "SAVED");
    saveSettings(DEFAULT_SETTINGS);
    loadSettings();
    expect(store.get(LINEUP_KEY)).toBe("SAVED");
  });
});
