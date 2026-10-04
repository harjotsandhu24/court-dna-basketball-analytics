"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  loadPlayersIndex,
  resolveSeason,
  searchPlayers,
  type PlayerSearchResult,
  type SearchScope,
} from "@/lib/dataLoader";
import { seasonLabel } from "@/lib/config";
import type { PlayersIndex } from "@/lib/types";

export interface PlayerAutocompleteSelection {
  id: string;
  name: string;
  /** The season this selection resolves to: `preferredSeason` when the
   * player has a valid record there, otherwise the nearest valid season. */
  season: number;
  /** True when `season` differs from `preferredSeason`. */
  seasonChanged: boolean;
}

interface PlayerAutocompleteProps {
  onSelect: (selection: PlayerAutocompleteSelection) => void;
  /** "map" only offers players that can actually open on the Player Map
   * (at least one qualified season). "all" offers everyone with a profile
   * page. Default "all". */
  scope?: SearchScope;
  /** Season currently in view; the nearest valid season to it is used. */
  preferredSeason?: number;
  placeholder?: string;
  size?: "sm" | "lg";
  autoFocus?: boolean;
  className?: string;
  /** Empty the input after a selection (search-to-navigate, lineup slots).
   * When false the chosen player's name stays in the input. */
  clearOnSelect?: boolean;
  /** Name of the currently selected player, owned by the parent (e.g. the
   * Player Map). The input mirrors it; clearing the input calls onClear. */
  selectedName?: string | null;
  onClear?: () => void;
  ariaLabel?: string;
  disabled?: boolean;
}

type LoadState = "idle" | "loading" | "error";

const MAX_RESULTS = 20;

export default function PlayerAutocomplete({
  onSelect,
  scope = "all",
  preferredSeason,
  placeholder = "Search any player…",
  size = "sm",
  autoFocus = false,
  className = "",
  clearOnSelect = true,
  selectedName,
  onClear,
  ariaLabel = "Search players",
  disabled = false,
}: PlayerAutocompleteProps) {
  const [query, setQuery] = useState(selectedName ?? "");
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [searched, setSearched] = useState(false); // results correspond to a real search of `query`
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [announcement, setAnnouncement] = useState("");
  const [prevSelectedName, setPrevSelectedName] = useState(selectedName);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const indexRef = useRef<PlayersIndex | null>(null);
  // Every search/submit takes a ticket; only the latest ticket may apply
  // its result (stale-response protection for fast typing and slow loads).
  const ticketRef = useRef(0);
  const resultsQueryRef = useRef("");
  const lastSubmitRef = useRef(0);

  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const listboxId = `${baseId}-listbox`;
  const statusId = `${baseId}-status`;
  const optionId = (i: number) => `${baseId}-option-${i}`;

  // Mirror an externally owned selection into the input (during render --
  // the documented way to adjust state when a prop changes).
  if (selectedName !== prevSelectedName) {
    setPrevSelectedName(selectedName);
    if (selectedName) {
      setQuery(selectedName);
      setResults([]);
      setSearched(false);
      setOpen(false);
      setActiveIndex(-1);
    } else if (prevSelectedName) {
      setQuery("");
      setResults([]);
      setSearched(false);
      setOpen(false);
    }
  }

  const ensureIndex = useCallback(async (): Promise<PlayersIndex> => {
    if (indexRef.current) return indexRef.current;
    const idx = await loadPlayersIndex(); // never caches a failure
    indexRef.current = idx;
    return idx;
  }, []);

  const seasonFor = useCallback(
    (r: PlayerSearchResult): number | null =>
      resolveSeason({ qualified_seasons: r.qualifiedSeasons, seasons: r.seasons }, preferredSeason, scope),
    [preferredSeason, scope],
  );

  const reset = useCallback(() => {
    ticketRef.current++;
    setResults([]);
    setSearched(false);
    setLoadState("idle");
    setOpen(false);
    setActiveIndex(-1);
    setAnnouncement("");
  }, []);

  const applyResults = useCallback((q: string, matches: PlayerSearchResult[]) => {
    resultsQueryRef.current = q.trim();
    setResults(matches);
    setSearched(true);
    setLoadState("idle");
    setOpen(true);
    setActiveIndex(matches.length > 0 ? 0 : -1);
    setAnnouncement(
      matches.length === 0
        ? `No players found for ${q.trim()}`
        : `${matches.length} player${matches.length === 1 ? "" : "s"} found. Use up and down arrows to review, Enter to select.`,
    );
  }, []);

  /** Runs a search for `q`. Synchronous when the index is already loaded
   * (no debounce needed -- matching ~2,000 names is instant), otherwise
   * waits for the index, applying only if still the latest request. */
  const runSearch = useCallback(
    async (q: string): Promise<PlayerSearchResult[] | null> => {
      const ticket = ++ticketRef.current;
      if (!q.trim()) {
        reset();
        return [];
      }
      try {
        let idx = indexRef.current;
        if (!idx) {
          setLoadState("loading");
          setOpen(true);
          idx = await ensureIndex();
        }
        if (ticket !== ticketRef.current) return null;
        const matches = searchPlayers(idx, q, MAX_RESULTS, { scope });
        applyResults(q, matches);
        return matches;
      } catch {
        if (ticket !== ticketRef.current) return null;
        setLoadState("error");
        setOpen(true);
        setAnnouncement("Search couldn't load. Retry is available.");
        return null;
      }
    },
    [applyResults, ensureIndex, reset, scope],
  );

  // Outside tap/click closes the list.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  // Keep the keyboard-active option in view.
  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(`${baseId}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, baseId]);

  function commit(r: PlayerSearchResult) {
    const season = seasonFor(r);
    if (season == null) {
      setAnnouncement(`${r.name} can't be opened here.`);
      return;
    }
    ticketRef.current++; // invalidate any in-flight search
    onSelect({
      id: r.id,
      name: r.name,
      season,
      seasonChanged: preferredSeason != null && season !== preferredSeason,
    });
    setOpen(false);
    setActiveIndex(-1);
    setLoadState("idle");
    setResults([]);
    setSearched(false);
    setQuery(clearOnSelect ? "" : r.name);
    // Selection is complete: dismiss the phone keyboard.
    inputRef.current?.blur();
  }

  /** Enter / phone Search key / form submit. Works immediately: it does not
   * depend on typing having settled or on the list having rendered. */
  async function submit() {
    const now = Date.now();
    if (now - lastSubmitRef.current < 250) return; // keydown + submit double-fire
    lastSubmitRef.current = now;
    const q = (inputRef.current?.value ?? query).trim();
    if (!q) return;
    if (searched && resultsQueryRef.current === q && results.length > 0) {
      commit(results[activeIndex >= 0 ? activeIndex : 0]);
      return;
    }
    const matches = await runSearch(q);
    if (matches && matches.length > 0) commit(matches[0]);
  }

  function clearAll() {
    setQuery("");
    reset();
    if (selectedName) onClear?.();
    inputRef.current?.focus();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    if (!v.trim()) {
      reset();
      if (selectedName) onClear?.();
      return;
    }
    void runSearch(v);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const visible = open && results.length > 0;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!visible) {
        if (results.length > 0) {
          setOpen(true);
          setActiveIndex(0);
        } else if (query.trim()) void runSearch(query);
        return;
      }
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (visible) setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Home" && visible) {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End" && visible) {
      e.preventDefault();
      setActiveIndex(results.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      } else if (query) {
        e.preventDefault();
        clearAll();
      }
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const sizeClasses = size === "lg" ? "min-h-12 px-4 py-3 text-base" : "min-h-11 px-3 py-2 text-base sm:text-sm";
  const listVisible = open && results.length > 0;
  const showPanel = open && !listVisible && (loadState !== "idle" || (searched && results.length === 0));

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="relative">
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-label={ariaLabel}
            aria-haspopup="listbox"
            aria-expanded={listVisible}
            aria-controls={listVisible ? listboxId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={listVisible && activeIndex >= 0 ? optionId(activeIndex) : undefined}
            aria-describedby={showPanel ? statusId : undefined}
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus={autoFocus}
            disabled={disabled}
            placeholder={placeholder}
            value={query}
            onChange={onChange}
            onFocus={() => {
              void ensureIndex().catch(() => {}); // warm the index; errors surface on typing
              if (results.length > 0) setOpen(true);
            }}
            onKeyDown={onKeyDown}
            className={`w-full rounded-md border border-line-strong bg-arena-panel pr-11 text-ink placeholder:text-stone-light outline-none focus:border-court-orange [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden ${sizeClasses}`}
          />
          {query && (
            <button
              type="button"
              onClick={clearAll}
              aria-label="Clear search"
              className="absolute right-0 top-0 flex h-full min-w-11 items-center justify-center rounded-md text-stone hover:text-court-orange-bright"
            >
              <span aria-hidden="true" className="text-lg leading-none">×</span>
            </button>
          )}
        </div>
      </form>

      {/* Live region: result counts / errors, without moving focus. */}
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>

      {listVisible && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Player search results"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-line-strong bg-arena-panel-strong shadow-xl"
        >
          {results.map((r, i) => {
            const isActive = i === activeIndex;
            const season = seasonFor(r);
            const switches = preferredSeason != null && season != null && season !== preferredSeason;
            return (
              <li
                key={r.id}
                id={optionId(i)}
                role="option"
                aria-selected={isActive}
                aria-label={season != null ? `${r.name}, ${seasonLabel(season)}${switches ? ", opens a different season" : ""}` : r.name}
                // Keep input focus while pressing; select on click so
                // scrolling the list by touch never selects by accident.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(r)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-sm ${
                  isActive ? "bg-court-orange/15 text-ink" : "text-ink-light"
                }`}
              >
                <span className="min-w-0 truncate">{r.name}</span>
                {season != null && (
                  <span
                    className={`shrink-0 text-xs tabular ${switches ? "font-semibold text-court-orange-bright" : "text-stone"}`}
                  >
                    {switches ? `Opens ${seasonLabel(season)}` : seasonLabel(season)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {showPanel && (
        <div
          id={statusId}
          className="absolute left-0 right-0 top-full z-30 mt-1 rounded-md border border-line-strong bg-arena-panel-strong px-4 py-3 text-sm text-stone shadow-xl"
        >
          {loadState === "loading" && <span>Loading players…</span>}
          {loadState === "error" && (
            <span className="flex items-center justify-between gap-3">
              <span>Couldn&rsquo;t load the player list.</span>
              <button
                type="button"
                onClick={() => void runSearch(query)}
                className="min-h-11 shrink-0 rounded-md border border-line-strong px-3 text-sm font-medium text-ink-light hover:border-court-orange"
              >
                Retry
              </button>
            </span>
          )}
          {loadState === "idle" && searched && results.length === 0 && (
            <span>
              No players found for &ldquo;{query.trim()}&rdquo;
              {scope === "map" ? " on the Player Map" : ""}.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
