import { describe, expect, it } from "vitest";
import { DIMENSION_DISPLAY_LABEL, DIMENSION_ORDER, computeSpokes, spokeText, traitSummary, traitTagLabel } from "@/lib/courtPrint";

const full = (v: number) => Object.fromEntries(DIMENSION_ORDER.map((d) => [d, v]));

describe("Court Print: missing statistics are never turned into 0", () => {
  it("flags a missing value (null, undefined, NaN) and prints 'Unavailable'", () => {
    for (const missing of [null, undefined, NaN]) {
      const spokes = computeSpokes({ ...full(60), Rebounding: missing as unknown as number }, 100, 80, 10);
      const s = spokes.find((x) => x.dimension === "Rebounding")!;
      expect(s.missing).toBe(true);
      expect(spokeText(s)).toBe("Unavailable");
    }
  });
  it("a real 0 is a real 0: shown as '0', not flagged missing", () => {
    const s = computeSpokes({ ...full(60), Rebounding: 0 }, 100, 80, 10).find((x) => x.dimension === "Rebounding")!;
    expect(s.missing).toBe(false);
    expect(spokeText(s)).toBe("0");
  });
  it("only the missing spoke is flagged", () => {
    const spokes = computeSpokes({ ...full(60), Scoring: null as unknown as number }, 100, 80, 10);
    expect(spokes.filter((x) => x.missing).map((x) => x.dimension)).toEqual(["Scoring"]);
  });
  it("the screen-reader summary names a missing value instead of reading '0 out of 100'", () => {
    const t = traitSummary("Wing", { ...full(60), Rebounding: null });
    expect(t).toContain("Rebounding unavailable");
    expect(t).not.toMatch(/Rebounding 0 out of 100/);
    expect(traitSummary("Wing", { ...full(60), Rebounding: 0 })).toContain("Rebounding 0 out of 100");
  });
  it("a trait built only from steals and blocks is labelled that way, not as a complete 'Defense' rating", () => {
    expect(DIMENSION_DISPLAY_LABEL["Defensive Activity"]).toBe("Steals & Blocks");
    expect(traitTagLabel("Strong Defensive Activity")).toBe("Strong Steals & Blocks");
    expect(Object.values(DIMENSION_DISPLAY_LABEL)).not.toContain("Defense");
  });
});
