import { describe, expect, it } from "vitest";
import { ROUGH_NOTE, UNLIKE_TESTED, isUncertain } from "@/components/SimResults";
import type { SupportInfo } from "@/lib/sim/engine";

const support = (level: SupportInfo["level"]): SupportInfo => ({ level, reasons: [], withheld: false, shownAnyway: level === "unsupported", message: null, caveat: "" });

describe("number-first presentation rules", () => {
  it("uses the exact asterisk note and unsupported-lineup wording from the brief", () => {
    expect(ROUGH_NOTE).toBe("*Rough simulation—not a reliable prediction.");
    expect(UNLIKE_TESTED).toBe("This lineup is unlike the teams used to test the model.");
  });
  it("an experimental result is always asterisked, even for a supported lineup", () => {
    expect(isUncertain("experimental", support("supported"))).toBe(true);
    expect(isUncertain("experimental", support("limited"))).toBe(true);
    expect(isUncertain("experimental", support("unsupported"))).toBe(true);
  });
  it("only a validated result inside the tested range goes without an asterisk", () => {
    expect(isUncertain("validated", support("supported"))).toBe(false);
    expect(isUncertain("validated", support("limited"))).toBe(true);
    expect(isUncertain("validated", support("unsupported"))).toBe(true);
  });
});
