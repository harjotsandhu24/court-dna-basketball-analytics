"use client";

import { useEffect, useId, useRef, useState } from "react";
import { loadPlayersIndex, searchPlayers, nearestQualifiedSeason, nearestSeasonIn, type PlayerSearchResult } from "@/lib/dataLoader";
import { SMALL_SAMPLE_LABEL, SMALL_SAMPLE_NOTE, isSmallSampleSeason } from "@/lib/lineup";
import { seasonLabel } from "@/lib/config";
import type { PlayersIndex } from "@/lib/types";

export interface PlayerAutocompleteSelection {
  id: string;
  name: string;
  /** The season this selection actually resolves to -- equal to
   * `preferredSeason` when the player qualified there, otherwise the
   * nearest season they did qualify in (see `nearestQualifiedSeason`). */
  season: number;
  /** True when `season` differs from the season the user was viewing when
   * they searched, i.e. a season switch is about to happen. */
  seasonChanged: boolean;
  latestTeam: string;
}

interface PlayerAutocompleteProps {
  onSelect: (selection: PlayerAutocompleteSelection) => void;
  /** The season currently being viewed, if any -- used to decide whether
   * a found player needs a different (nearest qualified) season. Omit for
   * contexts with no "current season" concept. */
  preferredSeason?: number;
  placeholder?: string;
  size?: "sm" | "lg";
  autoFocus?: boolean;
  className?: string;
  /** Clears the input back to empty immediately after a selection is
   * made. Most call sites want this (search-to-navigate); Build a Lineup
   * wants it too since each slot gets its own fresh search. */
  clearOnSelect?: boolean;
  /** Which seasons a pick may resolve to. "qualified" (default, used by every
   * existing call site) keeps the comparison-pool seasons only. "all" offers
   * every display-eligible season, as Explore does; Build a Lineup uses it. */
  seasonPool?: "qualified" | "all";
  /** Ignore picks and lock the input (e.g. while a lineup add is loading). */
  disabled?: boolean;
  /** Called when a picked player has no season to resolve to, so the caller
   * can say so instead of the pick silently doing nothing. */
  onUnavailable?: (name: string) => void;
}

type Status = "idle" | "loading" | "ready" | "error";

export default function PlayerAutocomplete({
  onSelect,
  preferredSeason,
  placeholder = "Search any player…",
  size = "sm",
  autoFocus = false,
  className = "",
  clearOnSelect = true,
  seasonPool = "qualified",
  disabled = false,
  onUnavailable,
}: PlayerAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [index, setIndex] = useState<PlayersIndex | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [announcement, setAnnouncement] = useState("");

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Guards against an older debounce/fetch resolving after a newer one
  // (stale-response protection for rapid typing).
  const requestIdRef = useRef(0);

  const baseId = useId().replace(/:/g, "");
  const listboxId = `${baseId}-listbox`;
  const optionId = (i: number) => `${baseId}-option-${i}`;

  // Load the index once, lazily, on first real keystroke -- not on mount,
  // so an autocomplete that's never used costs nothing.
  const indexPromiseRef = useRef<ReturnType<typeof loadPlayersIndex> | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      // Legitimate synchronous reset: the query was cleared, so any
      // in-flight/previous results are immediately stale -- not a
      // response to async data, just mirroring the cleared input.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      setStatus("idle");
      setOpen(false);
      return;
    }

    const myRequestId = ++requestIdRef.current;
    setStatus("loading");

    const timer = setTimeout(() => {
      if (!indexPromiseRef.current) indexPromiseRef.current = loadPlayersIndex();
      indexPromiseRef.current
        .then((idx) => {
          if (myRequestId !== requestIdRef.current) return; // superseded by a newer keystroke
          setIndex(idx);
          const matches = searchPlayers(idx, q, 20);
          setResults(matches);
          setStatus("ready");
          setOpen(true);
          setActiveIndex(matches.length > 0 ? 0 : -1);
          setAnnouncement(
            matches.length === 0
              ? `No players found for "${q}"`
              : `${matches.length} player${matches.length === 1 ? "" : "s"} found`,
          );
        })
        .catch(() => {
          if (myRequestId !== requestIdRef.current) return;
          indexPromiseRef.current = null; // allow retry to actually re-fetch
          setStatus("error");
          setOpen(true);
          setAnnouncement("Search failed. Press retry.");
        });
    }, 150); // debounce

    return () => clearTimeout(timer);
  }, [query]);

  // Outside click/tap dismissal.
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  // Default pool: the player's nearest qualified season (unchanged).
  // "all" pool: nearest display-eligible season, latest when none is given.
  function resolveSeason(entry: PlayersIndex[string] | undefined): number | null {
    if (!entry) return null;
    if (seasonPool === "all") {
      const latest = entry.seasons[entry.seasons.length - 1];
      return nearestSeasonIn(entry.seasons, preferredSeason ?? latest);
    }
    return nearestQualifiedSeason(entry, preferredSeason ?? entry.qualified_seasons[entry.qualified_seasons.length - 1]);
  }

  function commitSelection(r: PlayerSearchResult) {
    if (disabled) return;
    const entry = index?.[r.id];
    const resolvedSeason = resolveSeason(entry);
    if (resolvedSeason == null) onUnavailable?.(r.name);
    if (resolvedSeason != null) {
      onSelect({
        id: r.id,
        name: r.name,
        season: resolvedSeason,
        seasonChanged: preferredSeason != null && resolvedSeason !== preferredSeason,
        latestTeam: r.latest_team,
      });
    }
    setOpen(false);
    setActiveIndex(-1);
    if (clearOnSelect) {
      setQuery("");
      setResults([]);
    } else {
      setQuery(r.name);
    }
    // Dismiss the mobile keyboard -- selection is complete, nothing more
    // to type.
    inputRef.current?.blur();
  }

  function retry() {
    indexPromiseRef.current = null;
    // re-trigger the effect by touching query through a no-op state set
    setQuery((q) => q);
    setStatus("loading");
    const q = query.trim();
    if (!q) return;
    loadPlayersIndex()
      .then((idx) => {
        setIndex(idx);
        const matches = searchPlayers(idx, q, 20);
        setResults(matches);
        setStatus("ready");
        setActiveIndex(matches.length > 0 ? 0 : -1);
      })
      .catch(() => {
        indexPromiseRef.current = null;
        setStatus("error");
      });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open && results.length > 0) {
        setOpen(true);
        setActiveIndex(0);
        return;
      }
      setActiveIndex((i) => (results.length === 0 ? -1 : Math.min(i + 1, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (results.length === 0 ? -1 : Math.max(i - 1, 0)));
    } else if (e.key === "Enter") {
      // Works with no prior Arrow Down: Enter commits the highlighted
      // row, which defaults to the best (first) match as soon as results
      // arrive -- an exact/best match is reachable by typing + Enter
      // alone.
      if (open && activeIndex >= 0 && results[activeIndex]) {
        e.preventDefault();
        commitSelection(results[activeIndex]);
      } else if (open && results.length > 0) {
        e.preventDefault();
        commitSelection(results[0]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      } else if (query) {
        setQuery("");
      }
    }
  }

  // Keep the active option scrolled into view as Arrow keys move it.
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const el = document.getElementById(optionId(activeIndex));
    el?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  const sizeClasses = size === "lg" ? "px-4 py-3 text-base" : "px-3 py-2 text-base sm:text-sm";

  // Players who share a display name (e.g. father/son pairs) are told apart by
  // their career span; identity stays the player id, never the name.
  const nameCounts = new Map<string, number>();
  for (const r of results) nameCounts.set(r.name, (nameCounts.get(r.name) ?? 0) + 1);

  const showDropdown = !disabled && open && (status === "loading" || status === "error" || results.length > 0 || (status === "ready" && results.length === 0));

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          enterKeyHint="search"
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (results.length > 0 || status === "error") setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className={`w-full rounded-md border border-line-strong bg-arena-panel text-ink placeholder:text-stone-light outline-none focus:border-court-orange disabled:opacity-60 ${sizeClasses}`}
        />
      </div>

      {/* Live region: announces result counts / errors to screen readers
          without moving focus. */}
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>

      {showDropdown && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Player search results"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-line-strong bg-arena-panel-strong shadow-xl"
        >
          {status === "loading" && (
            <li className="px-4 py-3 text-sm text-stone-light">Searching…</li>
          )}
          {status === "error" && (
            <li className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-stone-light">
              <span>Search failed.</span>
              <button type="button" onClick={retry} className="shrink-0 rounded-md border border-line-strong px-3 py-2 text-xs font-medium text-ink-light hover:border-court-orange">
                Retry
              </button>
            </li>
          )}
          {status === "ready" && results.length === 0 && (
            <li className="px-4 py-3 text-sm text-stone-light">No players found for &ldquo;{query}&rdquo;.</li>
          )}
          {status === "ready" && results.map((r, i) => {
            const isActive = i === activeIndex;
            const entry = index?.[r.id];
            const resolvedSeason = resolveSeason(entry);
            const smallSample = seasonPool === "all" && entry != null && resolvedSeason != null && isSmallSampleSeason(entry, resolvedSeason);
            const careerSpan =
              entry && (nameCounts.get(r.name) ?? 0) > 1
                ? `${seasonLabel(entry.seasons[0])} to ${seasonLabel(entry.seasons[entry.seasons.length - 1])}`
                : null;
            const willSwitchSeason = preferredSeason != null && resolvedSeason != null && resolvedSeason !== preferredSeason;
            return (
              <li
                key={r.id}
                id={optionId(i)}
                role="option"
                aria-selected={isActive}
                onPointerDown={(e) => {
                  // pointerdown (not click) so it fires before the
                  // input's blur-driven outside-click handler can close
                  // the list first -- works for touch and mouse alike.
                  e.preventDefault();
                  commitSelection(r);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-sm ${
                  isActive ? "bg-court-orange/15 text-ink" : "text-ink-light"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate">{r.name}</span>
                  {careerSpan && <span className="block truncate text-xs text-stone-light">Career {careerSpan}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs">
                  {resolvedSeason != null && (
                    <span className={willSwitchSeason ? "font-medium text-court-orange-bright" : "text-stone-light"}>
                      {seasonLabel(resolvedSeason)}
                    </span>
                  )}
                  {smallSample && (
                    <span title={SMALL_SAMPLE_NOTE} className="rounded-full border border-court-orange/50 bg-court-orange/10 px-1.5 py-0.5 text-[10px] font-medium text-court-orange-bright">
                      {SMALL_SAMPLE_LABEL}
                    </span>
                  )}
                  <span className="text-stone-light">{r.latest_team}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
