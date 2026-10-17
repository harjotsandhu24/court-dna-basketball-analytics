"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { classifyError, stateFor, type LoadState, type Settled } from "./loadState";

/**
 * Loads data for `key` and returns its state plus a `retry` function. Ignores responses that belong to an older key
 * or an older attempt, never sets state synchronously inside an effect, and returns "loading" the moment the key
 * changes (so the previous player is never shown for the new one). A null key means "nothing to load".
 *
 * `loader` is read through a ref: pass an inline function without worrying about dependencies; only `key` and Retry
 * start a new request.
 */
export function useLoad<T>(key: string | null, loader: () => Promise<T>): [LoadState<T>, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const loaderRef = useRef(loader);
  useEffect(() => { loaderRef.current = loader; });
  const fullKey = key == null ? null : `${key}#${attempt}`;

  useEffect(() => {
    if (fullKey == null) return;
    let live = true;
    loaderRef.current().then(
      (data) => { if (live) setSettled({ key: fullKey, outcome: { status: "ready", data } }); },
      (e) => { if (live) { const c = classifyError(e); if (c.status === "notfound" || c.status === "error") setSettled({ key: fullKey, outcome: c }); } },
    );
    return () => { live = false; };
  }, [fullKey]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return [stateFor(fullKey, settled), retry];
}
