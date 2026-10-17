/**
 * Loading state machine shared by every data-dependent view. Pure (no React) so it is tested directly.
 *
 * Four outcomes are kept apart because they need different messages and actions:
 *   loading   - waiting for a response
 *   notfound  - the server answered 404: the thing doesn't exist (retrying can't help)
 *   error     - the request failed (network, 5xx, unreadable file): Retry may help
 *   ready     - data
 * "Invalid link" is decided before anything is fetched (lib/routes.ts) and never reaches this machine.
 */
export type LoadState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "notfound"; message: string }
  | { status: "error"; message: string };

/** A fetch that failed, with enough detail to tell "missing" from "couldn't reach it". */
export class DataError extends Error {
  constructor(message: string, public kind: "not-found" | "network" | "http" | "parse", public status?: number) {
    super(message);
    this.name = "DataError";
  }
}

export function classifyError(e: unknown): LoadState<never> {
  if (e instanceof DataError) {
    if (e.kind === "not-found") return { status: "notfound", message: e.message };
    return { status: "error", message: e.message };
  }
  return { status: "error", message: e instanceof Error ? e.message : String(e) };
}

/** What a hook remembers: the request it was for and how it ended. */
export interface Settled<T> { key: string; outcome: Exclude<LoadState<T>, { status: "idle" } | { status: "loading" }> }

/**
 * The state to show for the request `key`. An outcome that belongs to an older key is ignored, so a late response
 * for a previous route or selection can never be displayed (and nothing has to be reset by hand).
 */
export function stateFor<T>(key: string | null, settled: Settled<T> | null): LoadState<T> {
  if (key == null) return { status: "idle" };
  if (settled && settled.key === key) return settled.outcome;
  return { status: "loading" };
}
