import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BracketsFile, DataSource, FeatureShard, ModelFile, TeamsFile } from "@/lib/sim/types";

const ROOT = join(process.cwd(), "public", "data", "sim");
const read = <T>(p: string): T => JSON.parse(readFileSync(join(ROOT, p), "utf8")) as T;

export function nodeSource(overrides: Partial<DataSource> = {}): DataSource {
  const cache = new Map<string, unknown>();
  const memo = <T>(k: string, f: () => T): T => {
    if (!cache.has(k)) cache.set(k, f());
    return cache.get(k) as T;
  };
  return {
    model: async () => memo("m", () => read<ModelFile>("model.json")),
    features: async (s) => memo(`f${s}`, () => read<FeatureShard>(`features/${s}.json`)),
    teams: async (s) => memo(`t${s}`, () => read<TeamsFile>(`teams/${s}.json`)),
    brackets: async () => memo("b", () => read<BracketsFile>("brackets.json")),
    ...overrides,
  };
}

export const model = () => nodeSource().model();
