/// <reference lib="webworker" />
import { runSimulation, SimError } from "./engine";
import type { SimRequest } from "./engine";
import { createBrowserSource } from "./dataSource";

type In = { type: "run"; id: number; req: SimRequest; origin: string } | { type: "cancel"; id: number };
const cancelled = new Set<number>();
let source: ReturnType<typeof createBrowserSource> | null = null;

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.type === "cancel") {
    cancelled.add(m.id);
    return;
  }
  source ??= createBrowserSource(m.origin);
  try {
    const result = await runSimulation(m.req, source, {
      progress: (f, label) => self.postMessage({ type: "progress", id: m.id, f, label }),
      cancelled: () => cancelled.has(m.id),
    });
    self.postMessage({ type: "done", id: m.id, result });
  } catch (err) {
    const code = err instanceof SimError ? err.code : "ERROR";
    self.postMessage({ type: "error", id: m.id, code, message: err instanceof Error ? err.message : String(err) });
  } finally {
    cancelled.delete(m.id);
  }
};
