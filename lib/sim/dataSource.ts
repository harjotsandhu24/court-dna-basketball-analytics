/** Browser data source: fetches public/data/sim/*.json once each; a failed request is never cached. */
import type { BracketsFile, DataSource, FeatureShard, ModelFile, TeamsFile } from "./types";

function memo<K, V>(load: (k: K) => Promise<V>): (k: K) => Promise<V> {
  const cache = new Map<K, Promise<V>>();
  return (k: K) => {
    let p = cache.get(k);
    if (!p) {
      p = load(k).catch((e) => {
        cache.delete(k); // next call really retries
        throw e;
      });
      cache.set(k, p);
    }
    return p;
  };
}

async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path);
  } catch {
    throw new Error(`Failed to load ${path}: network error`);
  }
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return (await res.json()) as T;
}

export function createBrowserSource(base = ""): DataSource {
  const model = memo<number, ModelFile>(() => getJson(`${base}/data/sim/model.json`));
  const features = memo<number, FeatureShard>((s) => getJson(`${base}/data/sim/features/${s}.json`));
  const teams = memo<number, TeamsFile>((s) => getJson(`${base}/data/sim/teams/${s}.json`));
  const brackets = memo<number, BracketsFile>(() => getJson(`${base}/data/sim/brackets.json`));
  return { model: () => model(0), features, teams, brackets: () => brackets(0) };
}

let shared: DataSource | null = null;
export function browserSource(): DataSource {
  return (shared ??= createBrowserSource());
}
