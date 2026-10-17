import { describe, expect, it } from "vitest";
import { JobController, type Runner } from "@/lib/sim/jobs";

type Req = { key: string };
function manual() {
  const pending: { req: Req; resolve: (v: string | null) => void; reject: (e: unknown) => void; hooks: { progress: (f: number, l?: string) => void; cancelled: () => boolean } }[] = [];
  const runner: Runner<Req, string> = {
    run: (req, hooks) => new Promise((resolve, reject) => pending.push({ req, resolve, reject, hooks })),
  };
  const ctrl = new JobController<Req, string>(runner, (r) => r.key, (e) => `err:${(e as Error).message}`);
  return { pending, ctrl };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("job controller", () => {
  it("does not start a duplicate job for a repeated click on the same request", () => {
    const { pending, ctrl } = manual();
    expect(ctrl.start({ key: "a" })).not.toBeNull();
    expect(ctrl.start({ key: "a" })).toBeNull();
    expect(pending).toHaveLength(1);
  });

  it("a late response from a superseded job never overwrites the newer one", async () => {
    const { pending, ctrl } = manual();
    ctrl.start({ key: "a" });
    ctrl.start({ key: "b" });
    expect(pending[0].hooks.cancelled()).toBe(true);
    pending[1].resolve("B");
    await tick();
    pending[0].resolve("A"); // arrives late
    await tick();
    expect(ctrl.state).toMatchObject({ status: "done", key: "b", result: "B" });
  });

  it("rapid edits (invalidate between every start) never show a stale result", async () => {
    const { pending, ctrl } = manual();
    for (const k of ["a", "b", "c", "d"]) { ctrl.start({ key: k }); ctrl.invalidate(); }
    pending.forEach((p, i) => p.resolve(`R${i}`));
    await tick();
    expect(ctrl.state.status).toBe("idle");
  });

  it("changing the lineup drops a finished result at once", async () => {
    const { pending, ctrl } = manual();
    ctrl.start({ key: "a" });
    pending[0].resolve("A");
    await tick();
    expect(ctrl.state.status).toBe("done");
    ctrl.invalidate();
    expect(ctrl.state.status).toBe("idle");
  });

  it("cancel stops the job, and a result arriving afterwards is ignored", async () => {
    const { pending, ctrl } = manual();
    ctrl.start({ key: "a" });
    ctrl.cancel();
    expect(ctrl.state.status).toBe("cancelled");
    pending[0].resolve("A");
    await tick();
    expect(ctrl.state.status).toBe("cancelled");
    expect(ctrl.start({ key: "a" })).not.toBeNull(); // can run again after cancelling
  });

  it("a runner that stops early (null) shows as cancelled, errors show a readable message", async () => {
    const { pending, ctrl } = manual();
    ctrl.start({ key: "a" });
    pending[0].resolve(null);
    await tick();
    // controller state was never set by cancel(); null result is reported as cancelled
    expect(ctrl.state.status).toBe("cancelled");
    ctrl.start({ key: "b" });
    pending[1].reject(new Error("boom"));
    await tick();
    expect(ctrl.state).toMatchObject({ status: "error", message: "err:boom" });
  });

  it("progress is clamped and ignored once superseded", () => {
    const { pending, ctrl } = manual();
    ctrl.start({ key: "a" });
    pending[0].hooks.progress(7, "x");
    expect(ctrl.state).toMatchObject({ status: "running", progress: 1 });
    ctrl.start({ key: "b" });
    pending[0].hooks.progress(0.2);
    expect(ctrl.state).toMatchObject({ key: "b", progress: 0 });
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const { ctrl } = manual();
    let n = 0;
    const off = ctrl.subscribe(() => n++);
    ctrl.start({ key: "a" });
    expect(n).toBe(1);
    off();
    ctrl.cancel();
    expect(n).toBe(1);
  });
});
