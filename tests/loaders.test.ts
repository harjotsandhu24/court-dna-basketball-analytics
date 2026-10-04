import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("photo manifest failures are retryable", () => {
  const originalFetch = global.fetch;
  beforeEach(() => vi.resetModules());
  afterEach(() => { global.fetch = originalFetch; });

  it("does not cache a rejected manifest; the next call refetches", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 503 } as Response;
      return { ok: true, json: async () => ({ a: { player_id: "a" } }) } as unknown as Response;
    }) as typeof fetch;
    const { loadPhotoManifest, getPhotoEntry } = await import("../lib/photoManifest");
    await expect(loadPhotoManifest()).rejects.toThrow();
    expect(await getPhotoEntry("a")).toMatchObject({ player_id: "a" });
    expect(calls).toBe(2);
  });
});
