import { describe, it, expect, beforeEach } from "vitest";
import { STORAGE_KEY, clearSaved, hasAnySaved, parseSavedLineup, readSavedRaw, serializeLineup, writeSaved } from "../lib/lineupStorage";

describe("saved lineup validation", () => {
  it("round-trips five positions with ids and seasons", () => {
    const slots = [
      { id: "thybuma01", season: 2026 },
      null,
      { id: "jamesle01", season: 2009 },
      { id: "curryst01", season: 2016 },
      null,
    ];
    const back = parseSavedLineup(serializeLineup(slots));
    expect(back.slots).toEqual(slots);
    expect(back.dropped).toBe(0);
  });

  it("treats missing or unreadable data as an empty lineup without throwing", () => {
    expect(parseSavedLineup(null)).toEqual({ slots: [null, null, null, null, null], dropped: 0 });
    expect(parseSavedLineup("not json").dropped).toBe(1);
    expect(parseSavedLineup("{}").slots).toEqual([null, null, null, null, null]);
    expect(parseSavedLineup('{"v":2,"slots":[]}').dropped).toBe(1);
    expect(parseSavedLineup('{"v":1,"slots":"x"}').dropped).toBe(1);
    expect(hasAnySaved(parseSavedLineup("[1,2,3]").slots)).toBe(false);
  });

  it("drops malformed entries, out-of-range seasons and duplicate players, and counts them", () => {
    const raw = JSON.stringify({
      v: 1,
      slots: [
        { id: "a01", season: 2020 },
        { id: "a01", season: 2021 }, // duplicate player
        { id: "<script>", season: 2020 }, // bad id
        { id: "b01", season: 1850 }, // season outside the app's range
        { id: "c01", season: 2020.5 }, // not an integer
      ],
    });
    const out = parseSavedLineup(raw);
    expect(out.slots).toEqual([{ id: "a01", season: 2020 }, null, null, null, null]);
    expect(out.dropped).toBe(4);
  });

  it("ignores entries beyond the five positions", () => {
    const raw = JSON.stringify({ v: 1, slots: [null, null, null, null, null, { id: "x01", season: 2020 }] });
    const out = parseSavedLineup(raw);
    expect(out.slots).toEqual([null, null, null, null, null]);
    expect(out.dropped).toBe(1);
  });
});

describe("storage access never throws", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    };
  });

  it("writes, reads and clears; an empty lineup removes the saved copy", () => {
    writeSaved([{ id: "a01", season: 2020 }, null, null, null, null]);
    expect(readSavedRaw()).toContain("a01");
    writeSaved([null, null, null, null, null]);
    expect(store.has(STORAGE_KEY)).toBe(false);
    writeSaved([{ id: "a01", season: 2020 }, null, null, null, null]);
    clearSaved();
    expect(readSavedRaw()).toBeNull();
  });

  it("survives blocked storage", () => {
    (globalThis as { window?: unknown }).window = {
      get localStorage(): never {
        throw new Error("blocked");
      },
    };
    expect(readSavedRaw()).toBeNull();
    expect(() => writeSaved([{ id: "a01", season: 2020 }, null, null, null, null])).not.toThrow();
    expect(() => clearSaved()).not.toThrow();
  });
});
