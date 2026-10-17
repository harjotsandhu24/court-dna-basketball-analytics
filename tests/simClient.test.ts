import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRunner, describeError, WorkerFailure, type WorkerLike } from "@/lib/sim/client";
import type { SimRequest, SimResult } from "@/lib/sim/engine";

type Fn = (e: unknown) => void;
class FakeWorker implements WorkerLike {
  listeners: Record<string, Set<Fn>> = { message: new Set(), error: new Set(), messageerror: new Set() };
  posted: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  terminated = false;
  throwOnPost = false;
  addEventListener(t: string, f: Fn) { this.listeners[t].add(f); }
  removeEventListener(t: string, f: Fn) { this.listeners[t].delete(f); }
  postMessage(m: unknown) { if (this.throwOnPost) throw new Error("dead"); this.posted.push(m); }
  terminate() { this.terminated = true; }
  emit(t: string, e: unknown) { [...this.listeners[t]].forEach((f) => f(e)); }
  count() { return Object.values(this.listeners).reduce((n, s) => n + s.size, 0); }
}
const REQ = {} as SimRequest;
const RESULT = { ok: true } as unknown as SimResult;
const hooks = (cancelled = () => false) => ({ progress: vi.fn(), cancelled });

describe("simRunner failure handling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(opts: { stallMs?: number } = {}) {
    const workers: FakeWorker[] = [];
    const fallback = vi.fn(async () => RESULT);
    const runner = createRunner({
      makeWorker: () => { const w = new FakeWorker(); workers.push(w); return w; },
      fallback, origin: () => "http://x", stallMs: opts.stallMs,
    });
    return { runner, workers, fallback };
  }

  it("resolves a normal job and removes every listener and timer", async () => {
    const { runner, workers } = setup();
    const h = hooks();
    const p = runner.run(REQ, h);
    const w = workers[0];
    const id = w.posted[0].id;
    w.emit("message", { data: { id, type: "progress", f: 0.5, label: "x" } });
    w.emit("message", { data: { id, type: "done", result: RESULT } });
    await expect(p).resolves.toBe(RESULT);
    expect(h.progress).toHaveBeenCalledWith(0.5, "x");
    expect(w.count()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a startup error runs once on the main thread, terminates the worker, and later jobs skip workers", async () => {
    const { runner, workers, fallback } = setup();
    const p = runner.run(REQ, hooks());
    workers[0].emit("error", {});
    await expect(p).resolves.toBe(RESULT);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(workers[0].terminated).toBe(true);
    expect(workers[0].count()).toBe(0);
    await runner.run(REQ, hooks());
    expect(workers).toHaveLength(1);
    expect(fallback).toHaveBeenCalledTimes(2);
  });

  it("a worker that can't be constructed uses the main thread", async () => {
    const fallback = vi.fn(async () => RESULT);
    const runner = createRunner({ makeWorker: () => { throw new Error("no"); }, fallback, origin: () => "" });
    await expect(runner.run(REQ, hooks())).resolves.toBe(RESULT);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("a failed first post falls back instead of hanging", async () => {
    const workers: FakeWorker[] = [];
    const fallback = vi.fn(async () => RESULT);
    const runner = createRunner({ makeWorker: () => { const w = new FakeWorker(); w.throwOnPost = true; workers.push(w); return w; }, fallback, origin: () => "" });
    await expect(runner.run(REQ, hooks())).resolves.toBe(RESULT);
    expect(workers[0].terminated).toBe(true);
  });

  it("a runtime crash rejects once with a short error, never falls back, and a retry gets a fresh worker", async () => {
    const { runner, workers, fallback } = setup();
    const p = runner.run(REQ, hooks());
    const w = workers[0];
    w.emit("message", { data: { id: w.posted[0].id, type: "progress", f: 0.2 } });
    w.emit("error", {});
    await expect(p).rejects.toBeInstanceOf(WorkerFailure);
    expect(fallback).not.toHaveBeenCalled();
    expect(w.terminated).toBe(true);
    expect(w.count()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    // late events from the dead worker do nothing
    w.emit("error", {});
    const p2 = runner.run(REQ, hooks());
    expect(workers).toHaveLength(2);
    const w2 = workers[1];
    w2.emit("message", { data: { id: w2.posted[0].id, type: "done", result: RESULT } });
    await expect(p2).resolves.toBe(RESULT);
  });

  it("two crashes in a row switch to the main thread", async () => {
    const { runner, workers, fallback } = setup();
    for (let i = 0; i < 2; i++) {
      const p = runner.run(REQ, hooks());
      const w = workers[i];
      w.emit("message", { data: { id: w.posted[0].id, type: "progress", f: 0.1 } });
      w.emit("error", {});
      await expect(p).rejects.toBeInstanceOf(WorkerFailure);
    }
    await expect(runner.run(REQ, hooks())).resolves.toBe(RESULT);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("an unreadable message is a failure", async () => {
    const { runner, workers } = setup();
    const p = runner.run(REQ, hooks());
    const w = workers[0];
    w.emit("message", { data: { id: w.posted[0].id, type: "progress", f: 0.1 } });
    w.emit("messageerror", {});
    await expect(p).rejects.toBeInstanceOf(WorkerFailure);
  });

  it("a cancelled job whose worker dies resolves null (no error, no fallback, no reuse)", async () => {
    const { runner, workers, fallback } = setup();
    let cancel = false;
    const p = runner.run(REQ, hooks(() => cancel));
    const w = workers[0];
    cancel = true;
    await vi.advanceTimersByTimeAsync(60);
    expect(w.posted.some((m) => m.type === "cancel")).toBe(true);
    w.emit("error", {});
    await expect(p).resolves.toBeNull();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("a worker that goes silent is stopped after the stall limit, but progress keeps it alive", async () => {
    const { runner, workers } = setup({ stallMs: 1000 });
    const p = runner.run(REQ, hooks());
    const w = workers[0];
    const id = w.posted[0].id;
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(900);
    w.emit("message", { data: { id, type: "progress", f: 0.1 } });
    await vi.advanceTimersByTimeAsync(900);
    expect(w.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await expect(p).rejects.toMatchObject({ phase: "stalled" });
    expect(w.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a worker-reported error is passed on without discarding the worker", async () => {
    const { runner, workers } = setup();
    const p = runner.run(REQ, hooks());
    const w = workers[0];
    w.emit("message", { data: { id: w.posted[0].id, type: "error", code: "ERROR", message: "Failed to load x" } });
    await expect(p).rejects.toThrow("Failed to load x");
    expect(w.terminated).toBe(false);
  });

  it("describeError gives short plain messages", () => {
    expect(describeError(new WorkerFailure("The simulation worker stopped unexpectedly.", "runtime"))).toMatch(/Try again/);
    expect(describeError(new Error("Failed to load /x"))).toMatch(/connection/);
  });
});
