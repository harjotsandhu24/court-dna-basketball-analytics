import { describe, expect, it } from "vitest";
import { addOpponentPick, type OppPick } from "@/components/OpponentBuilder";

const pick = (id: string, name = id): OppPick => ({ id, name, season: 2005, seasons: [2005] });

describe("OpponentBuilder add guards", () => {
  it("adds a new player", () => {
    const r = addOpponentPick([], { id: "a01", name: "A", season: 2005 }, [2004, 2005]);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.next).toEqual([{ id: "a01", name: "A", season: 2005, seasons: [2004, 2005] }]);
  });
  it("never adds the same player twice, even from a stale-looking repeat", () => {
    const one = addOpponentPick([], { id: "a01", name: "A", season: 2005 }, [2005]);
    if (!one.ok) throw new Error("x");
    const again = addOpponentPick(one.next, { id: "a01", name: "A", season: 2005 }, [2005]);
    expect(again).toEqual({ ok: false, notice: "A is already on the opponent's lineup." });
  });
  it("refuses a sixth player", () => {
    const five = ["a01", "b01", "c01", "d01", "e01"].map((i) => pick(i));
    expect(addOpponentPick(five, { id: "f01", name: "F", season: 2005 }, [2005])).toMatchObject({ ok: false });
  });
  it("two quick adds applied in order keep both (each sees the other)", () => {
    let cur: OppPick[] = [];
    for (const id of ["a01", "b01"]) {
      const r = addOpponentPick(cur, { id, name: id, season: 2005 }, [2005]);
      if (r.ok) cur = r.next;
    }
    expect(cur.map((p) => p.id)).toEqual(["a01", "b01"]);
  });
});
