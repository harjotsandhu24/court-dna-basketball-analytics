/**
 * Runs simulations in a Web Worker when the browser has one, otherwise on the main thread in small chunks.
 * Either way the request/response shape is the same, and cancellation is cooperative.
 *
 * Failure handling (createRunner is dependency-injected so each branch is unit-tested with a fake worker):
 *  - A worker that fails to start, throws, or sends an unreadable message is terminated and forgotten; the pending job
 *    is settled exactly once, its listeners and timers are removed, and it is never re-posted to the dead worker.
 *  - A worker that fails before sending anything (startup) means workers can't be used here: the job runs once on the
 *    main thread instead, and later jobs use the main thread too. A job that already cancelled resolves null instead.
 *  - A worker that fails after it was running rejects with a short error (the panel offers Retry). A fresh worker is
 *    created for the retry; two crashes in a row switch to the main thread.
 *  - A worker that goes quiet for STALL_MS (no progress and no result) is treated as stuck. Data loading reports
 *    progress, so a slow connection keeps the timer fresh; only silence trips it.
 */
import { runSimulation, SimError } from "./engine";
import type { SimRequest, SimResult } from "./engine";
import { browserSource } from "./dataSource";
import type { Runner, RunHooks } from "./jobs";

/** Silence longer than this means the worker is stuck. Generous: a full season/bracket run reports progress often. */
export const STALL_MS = 60_000;
const POLL_MS = 50;

export class WorkerFailure extends Error {
  constructor(message: string, public phase: "startup" | "runtime" | "stalled") {
    super(message);
    this.name = "WorkerFailure";
  }
}

/** The part of a Worker the runner uses (a fake implements this in tests). */
export interface WorkerLike {
  addEventListener(type: "message" | "error" | "messageerror", fn: (e: any) => void): void; // eslint-disable-line @typescript-eslint/no-explicit-any
  removeEventListener(type: "message" | "error" | "messageerror", fn: (e: any) => void): void; // eslint-disable-line @typescript-eslint/no-explicit-any
  postMessage(m: unknown): void;
  terminate(): void;
}

export interface RunnerDeps {
  /** Creates a worker, or returns null when the browser has none. May throw. */
  makeWorker: () => WorkerLike | null;
  /** Runs the request on the main thread. */
  fallback: (req: SimRequest, hooks: RunHooks) => Promise<SimResult | null>;
  origin: () => string;
  stallMs?: number;
}

export function createRunner(deps: RunnerDeps): Runner<SimRequest, SimResult> {
  const stallMs = deps.stallMs ?? STALL_MS;
  let worker: WorkerLike | null = null;
  let workersUnusable = false;
  let crashesInARow = 0;
  let seq = 1;

  function getWorker(): WorkerLike | null {
    if (workersUnusable) return null;
    if (worker) return worker;
    try {
      worker = deps.makeWorker();
    } catch {
      worker = null;
    }
    if (!worker) workersUnusable = true;
    return worker;
  }

  function discard(w: WorkerLike) {
    try { w.terminate(); } catch { /* already gone */ }
    if (worker === w) worker = null;
  }

  return {
    run(req, hooks) {
      const found = getWorker();
      if (!found) return deps.fallback(req, hooks);
      const w: WorkerLike = found;
      const id = seq++;
      return new Promise<SimResult | null>((resolve, reject) => {
        let settled = false;
        let heard = false; // has this worker said anything for this job?
        let told = false;
        let poll: ReturnType<typeof setInterval> | null = null;
        let stall: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
          w.removeEventListener("message", onMsg);
          w.removeEventListener("error", onErr);
          w.removeEventListener("messageerror", onBadMsg);
          if (poll) clearInterval(poll);
          if (stall) clearTimeout(stall);
          poll = stall = null;
        };
        const armStall = () => {
          if (stall) clearTimeout(stall);
          stall = setTimeout(() => fail("stalled"), stallMs);
        };
        const done = (v: SimResult | null) => { if (settled) return; settled = true; cleanup(); resolve(v); };
        const bad = (e: Error) => { if (settled) return; settled = true; cleanup(); reject(e); };

        function fail(phase: "startup" | "runtime" | "stalled") {
          if (settled) return;
          discard(w);
          crashesInARow++;
          if (phase === "startup" || crashesInARow >= 2) workersUnusable = true;
          // A cancelled job just ends. A startup failure is safe to run once on the main thread (nothing ran yet).
          if (hooks.cancelled()) return done(null);
          if (phase === "startup") {
            settled = true;
            cleanup();
            deps.fallback(req, hooks).then(resolve, reject);
            return;
          }
          bad(new WorkerFailure(
            phase === "stalled" ? "The simulation stopped responding." : "The simulation worker stopped unexpectedly.",
            phase,
          ));
        }

        function onMsg(e: MessageEvent) {
          const m = e.data;
          if (!m || typeof m !== "object") return fail(heard ? "runtime" : "startup");
          if (m.id !== id) return;
          heard = true;
          armStall();
          if (m.type === "progress") hooks.progress(m.f, m.label);
          else if (m.type === "done") { crashesInARow = 0; done(m.result as SimResult | null); }
          else if (m.type === "error") bad(m.code === "ERROR" ? new Error(m.message) : new SimError(m.code, m.message));
        }
        function onErr() { fail(heard ? "runtime" : "startup"); }
        function onBadMsg() { fail(heard ? "runtime" : "startup"); }

        w.addEventListener("message", onMsg);
        w.addEventListener("error", onErr);
        w.addEventListener("messageerror", onBadMsg);
        poll = setInterval(() => {
          if (!told && hooks.cancelled()) { told = true; try { w.postMessage({ type: "cancel", id }); } catch { /* worker already gone */ } }
        }, POLL_MS);
        armStall();
        try {
          w.postMessage({ type: "run", id, req, origin: deps.origin() });
        } catch {
          fail("startup");
        }
      });
    },
  };
}

export function describeError(e: unknown): string {
  if (e instanceof SimError) return e.message;
  if (e instanceof WorkerFailure) return `${e.message} Try again.`;
  const msg = e instanceof Error ? e.message : String(e);
  if (/Failed to load|not found|HTTP \d/i.test(msg)) return "Couldn't load the player data for this simulation. Check your connection and try again.";
  return "The simulation couldn't finish. Try again, or change the lineup.";
}

export const simRunner: Runner<SimRequest, SimResult> = createRunner({
  makeWorker: () =>
    typeof Worker === "undefined" ? null : new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
  fallback: (req, hooks) => runSimulation(req, browserSource(), { progress: hooks.progress, cancelled: hooks.cancelled }),
  origin: () => location.origin,
});
