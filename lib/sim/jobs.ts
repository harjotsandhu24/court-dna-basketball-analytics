/**
 * Job control for the Simulate panel: one job at a time, late results never win, repeated clicks don't start
 * duplicates. Pure logic (no React, no Worker) so it is easy to test.
 */
export type JobState<R> =
  | { status: "idle" }
  | { status: "running"; id: number; key: string; progress: number; label?: string }
  | { status: "done"; id: number; key: string; result: R }
  | { status: "error"; id: number; key: string; message: string }
  | { status: "cancelled"; id: number; key: string };

export interface RunHooks { progress: (f: number, label?: string) => void; cancelled: () => boolean }

export interface Runner<Req, R> {
  /** runs the request; must resolve to null when `cancelled()` becomes true */
  run(req: Req, hooks: RunHooks): Promise<R | null>;
}

export class JobController<Req, R> {
  private nextId = 1;
  private current: { id: number; key: string; cancelled: boolean } | null = null;
  state: JobState<R> = { status: "idle" };
  private listeners = new Set<() => void>();

  constructor(private runner: Runner<Req, R>, private keyOf: (r: Req) => string, private errorText: (e: unknown) => string) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(s: JobState<R>) {
    this.state = s;
    this.listeners.forEach((l) => l());
  }

  get running(): boolean {
    return this.state.status === "running";
  }

  /** Start a job. If the same request is already running this does nothing. Returns the job id or null. */
  start(req: Req): number | null {
    const key = this.keyOf(req);
    if (this.current && !this.current.cancelled && this.current.key === key && this.state.status === "running") return null;
    if (this.current) this.current.cancelled = true; // a newer request supersedes the old one
    const job = { id: this.nextId++, key, cancelled: false };
    this.current = job;
    this.set({ status: "running", id: job.id, key, progress: 0 });
    this.runner
      .run(req, {
        progress: (f, label) => {
          if (this.current !== job || job.cancelled) return;
          this.set({ status: "running", id: job.id, key, progress: Math.max(0, Math.min(1, f)), label });
        },
        cancelled: () => job.cancelled,
      })
      .then((r) => {
        if (this.current !== job || job.cancelled) return; // late response: ignore
        if (r === null) this.set({ status: "cancelled", id: job.id, key });
        else this.set({ status: "done", id: job.id, key, result: r });
      })
      .catch((e) => {
        if (this.current !== job || job.cancelled) return;
        this.set({ status: "error", id: job.id, key, message: this.errorText(e) });
      });
    return job.id;
  }

  /** User pressed Cancel. */
  cancel(): void {
    if (this.current && this.state.status === "running") {
      this.current.cancelled = true;
      this.set({ status: "cancelled", id: this.current.id, key: this.current.key });
    }
  }

  /** The lineup or settings changed: drop any result or running job at once. */
  invalidate(): void {
    if (this.current) this.current.cancelled = true;
    this.current = null;
    if (this.state.status !== "idle") this.set({ status: "idle" });
  }
}
