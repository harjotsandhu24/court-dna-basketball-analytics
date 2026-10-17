import { describe, expect, it } from "vitest";
import { DataError, classifyError, stateFor, type Settled } from "@/lib/loadState";

describe("load state machine", () => {
  it("keeps 'not found' (404: retrying can't help) apart from 'error' (Retry may help)", () => {
    expect(classifyError(new DataError("gone", "not-found", 404)).status).toBe("notfound");
    for (const kind of ["network", "http", "parse"] as const) expect(classifyError(new DataError("x", kind)).status).toBe("error");
    expect(classifyError(new TypeError("Failed to fetch")).status).toBe("error");
    expect(classifyError("weird").status).toBe("error");
  });
  it("is idle with no key and loading until an outcome for THIS key arrives", () => {
    expect(stateFor(null, null)).toEqual({ status: "idle" });
    expect(stateFor("a#0", null)).toEqual({ status: "loading" });
  });
  it("ignores an outcome that belongs to an older key (a late response for a previous route is never shown)", () => {
    const old: Settled<number> = { key: "a#0", outcome: { status: "ready", data: 1 } };
    expect(stateFor("b#0", old)).toEqual({ status: "loading" });
    expect(stateFor("a#0", old)).toEqual({ status: "ready", data: 1 });
  });
  it("a Retry (new attempt number) goes back to loading instead of showing the old error", () => {
    const failed: Settled<number> = { key: "a#0", outcome: { status: "error", message: "x" } };
    expect(stateFor("a#1", failed)).toEqual({ status: "loading" });
  });
});
