/**
 * The five user-assigned lineup positions and the pure board operations on
 * them. Positions are just labels the user picks: any player can go in any
 * spot, and nothing here (or in the scores) depends on which spot it is.
 */
export const POSITIONS = [
  { code: "PG", name: "point guard", x: 50, y: 80 },
  { code: "SG", name: "shooting guard", x: 88, y: 50 },
  { code: "SF", name: "small forward", x: 12, y: 50 },
  { code: "PF", name: "power forward", x: 62, y: 22 },
  { code: "C", name: "center", x: 38, y: 22 },
] as const;

export const SLOT_COUNT = POSITIONS.length;
export type Board<T> = (T | null)[];

export function emptyBoard<T>(): Board<T> {
  return Array.from({ length: SLOT_COUNT }, () => null);
}

export function placeAt<T>(board: Board<T>, slot: number, item: T): Board<T> {
  const next = [...board];
  next[slot] = item;
  return next;
}

export function removeAt<T>(board: Board<T>, slot: number): Board<T> {
  const next = [...board];
  next[slot] = null;
  return next;
}

export function findSlot<T>(board: Board<T>, pred: (item: T) => boolean): number {
  return board.findIndex((s) => s != null && pred(s));
}

export type MoveKind = "moved" | "swapped" | "none";

/** Move into an empty spot, or swap if it's occupied. Each item keeps its own data (e.g. its season). */
export function moveOrSwap<T>(board: Board<T>, from: number, to: number): { board: Board<T>; kind: MoveKind } {
  if (from === to || board[from] == null) return { board, kind: "none" };
  const next = [...board];
  const kind: MoveKind = next[to] == null ? "moved" : "swapped";
  [next[from], next[to]] = [next[to], next[from]];
  return { board: next, kind };
}
