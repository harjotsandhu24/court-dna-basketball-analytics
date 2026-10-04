"use client";

import { useCallback, useEffect, useState } from "react";

export type AsyncStatus = "idle" | "loading" | "ready" | "error";

export interface AsyncResult<T> {
  status: AsyncStatus;
  data: T | undefined;
  error: Error | undefined;
  /** Genuinely re-runs the loader (failed loads are never cached by
   * lib/dataLoader, so this really refetches). */
  retry: () => void;
}

interface Settled<T> {
  key: string;
  nonce: number;
  data?: T;
  error?: Error;
}

/**
 * Keyed async loader with stale-response protection.
 *
 * - `key` identifies *what* is being loaded (e.g. a player id + season).
 *   Whenever it changes, status is "loading" immediately and `data` is
 *   undefined -- a previous key's data is never returned for a new key, so
 *   views can't show the previous player/season under the new one.
 * - A response arriving after the key changed (or after unmount) is
 *   ignored.
 * - `retry()` bumps a nonce, which both returns to "loading" and re-runs
 *   the loader.
 * - Pass `null` to stay idle.
 */
export function useAsync<T>(key: string | null, load: () => Promise<T>): AsyncResult<T> {
  const [nonce, setNonce] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    if (key == null) return;
    let cancelled = false;
    load().then(
      (data) => {
        if (!cancelled) setSettled({ key, nonce, data });
      },
      (err: unknown) => {
        if (!cancelled) setSettled({ key, nonce, error: err instanceof Error ? err : new Error(String(err)) });
      },
    );
    return () => {
      cancelled = true;
    };
    // The loader is fully determined by `key`; including it would re-run
    // the effect on every render for inline closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  const current = key != null && settled && settled.key === key && settled.nonce === nonce ? settled : null;
  const status: AsyncStatus = key == null ? "idle" : !current ? "loading" : current.error ? "error" : "ready";
  return { status, data: current?.data, error: current?.error, retry };
}
