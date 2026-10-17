import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { POSITIONS, SLOT_COUNT, emptyBoard, findSlot, moveOrSwap, placeAt, removeAt } from "../lib/lineupBoard";
import { lineupObservations, lineupScores } from "../lib/lineup";
import type { PlayerSeasonRecord } from "../lib/types";

describe("lineup board", () => {
  it("has the five positions in order", () => {
    expect(POSITIONS.map((p) => p.code)).toEqual(["PG", "SG", "SF", "PF", "C"]);
    expect(SLOT_COUNT).toBe(5);
    expect(emptyBoard()).toEqual([null, null, null, null, null]);
  });

  it("places and removes without touching other spots, and never mutates the input", () => {
    const b0 = emptyBoard<string>();
    const b1 = placeAt(b0, 2, "x");
    expect(b0[2]).toBeNull();
    expect(b1).toEqual([null, null, "x", null, null]);
    expect(removeAt(b1, 2)).toEqual(emptyBoard());
    expect(findSlot(b1, (s) => s === "x")).toBe(2);
    expect(findSlot(b1, (s) => s === "nope")).toBe(-1);
  });

  it("moves into an empty spot", () => {
    const { board, kind } = moveOrSwap<string>(["a", null, "b", null, null], 0, 3);
    expect(kind).toBe("moved");
    expect(board).toEqual([null, null, "b", "a", null]);
  });

  it("swaps when the target is occupied", () => {
    const { board, kind } = moveOrSwap<string>(["a", "b", null, null, null], 0, 1);
    expect(kind).toBe("swapped");
    expect(board).toEqual(["b", "a", null, null, null]);
  });

  it("does nothing for the same spot or an empty source", () => {
    expect(moveOrSwap<string>(["a", null, null, null, null], 0, 0).kind).toBe("none");
    expect(moveOrSwap<string>([null, "a", null, null, null], 0, 1).kind).toBe("none");
  });

  it("keeps each item's own data (e.g. its season) when moving or swapping", () => {
    const a = { id: "a", season: 2026 };
    const b = { id: "b", season: 2009 };
    const { board } = moveOrSwap([a, b, null, null, null], 0, 1);
    expect(board[0]).toBe(b);
    expect(board[1]).toBe(a);
    expect(board[0]!.season).toBe(2009);
    expect(board[1]!.season).toBe(2026);
  });
});

describe("rearranging the same five player-seasons", () => {
  const root = join(__dirname, "..", "public", "data", "seasons");
  const idx = JSON.parse(readFileSync(join(__dirname, "..", "public", "data", "players_index.json"), "utf8")) as Record<string, { name: string }>;
  const id = (name: string) => Object.keys(idx).find((k) => idx[k].name === name)!;
  const pick = (name: string, season: number) =>
    (JSON.parse(readFileSync(join(root, `${season}.json`), "utf8")) as PlayerSeasonRecord[]).find((r) => r.player_id === id(name))!;
  const five = [
    pick("Matisse Thybulle", 2026),
    pick("LeBron James", 2009),
    pick("Stephen Curry", 2016),
    pick("Kevin Durant", 2014),
    pick("Nikola Jokić", 2022),
  ];

  function permutations<T>(xs: T[]): T[][] {
    if (xs.length <= 1) return [xs];
    return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
  }

  it("gives identical scores and observations for all 120 arrangements", () => {
    expect(five.every(Boolean)).toBe(true);
    const base = lineupScores(five)!;
    const baseObs = lineupObservations(five, base);
    const perms = permutations(five);
    expect(perms.length).toBe(120);
    for (const p of perms) {
      expect(lineupScores(p)).toEqual(base); // exact equality, not just rounded
      expect(lineupObservations(p, lineupScores(p)!)).toEqual(baseObs);
    }
  });

  it("changes the scores if a player's season changes (so the check above is meaningful)", () => {
    const other = [...five];
    other[1] = pick("LeBron James", 2013);
    expect(lineupScores(other)).not.toEqual(lineupScores(five));
  });
});
