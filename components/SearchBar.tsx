"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadPlayersIndex, searchPlayers } from "@/lib/dataLoader";

interface Result {
  id: string;
  name: string;
  latest_team: string;
}

export default function SearchBar({ size = "md", autoFocus = false }: { size?: "md" | "lg"; autoFocus?: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const indexRef = useRef<Awaited<ReturnType<typeof loadPlayersIndex>> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    loadPlayersIndex().then((idx) => {
      indexRef.current = idx;
    });
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function handleChange(v: string) {
    setQuery(v);
    setActiveIdx(-1);
    if (!indexRef.current || v.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    const r = searchPlayers(indexRef.current, v, 8);
    setResults(r);
    setOpen(r.length > 0);
  }

  function goToPlayer(r: Result) {
    const idx = indexRef.current;
    const seasons = idx?.[r.id]?.qualified_seasons ?? idx?.[r.id]?.seasons ?? [];
    const season = seasons[seasons.length - 1];
    if (season) {
      router.push(`/player/${r.id}/${season}`);
      setOpen(false);
      setQuery("");
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      goToPlayer(results[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const inputClass =
    size === "lg"
      ? "w-full rounded-xl border border-line-strong bg-arena-panel px-5 py-4 text-lg text-ink placeholder:text-stone-light focus:border-court-orange outline-none"
      : "w-full rounded-lg border border-line-strong bg-arena-panel px-3.5 py-2 text-sm text-ink placeholder:text-stone-light focus:border-court-orange outline-none";

  return (
    <div ref={containerRef} className="relative w-full">
      <label htmlFor="player-search" className="sr-only">Search for a player</label>
      <input
        id="player-search"
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls="player-search-results"
        aria-autocomplete="list"
        autoFocus={autoFocus}
        placeholder="Search any player, 2000-01 to 2025-26…"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        className={inputClass}
      />
      {open && (
        <ul
          id="player-search-results"
          role="listbox"
          className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-line-strong bg-arena-panel-strong shadow-2xl"
        >
          {results.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === activeIdx}>
              <button
                type="button"
                onClick={() => goToPlayer(r)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors ${
                  i === activeIdx ? "bg-court-orange/15 text-ink" : "text-ink-light hover:bg-arena-panel"
                }`}
              >
                <span className="font-medium">{r.name}</span>
                <span className="text-xs text-stone-light">{r.latest_team}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
