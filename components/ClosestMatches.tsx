"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadSimilarityPool } from "@/lib/dataLoader";
import { findClosestMatches, type SimilarityPoolEntry, type CandidateFilters } from "@/lib/similarity";
import { explainMatch } from "@/lib/explain";
import PlayerPhoto from "./PlayerPhoto";
import { ERA_WINDOW_SEASONS } from "@/lib/config";

interface Props {
  query: SimilarityPoolEntry;
  queryName: string;
}

export default function ClosestMatches({ query, queryName }: Props) {
  const [pool, setPool] = useState<SimilarityPoolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeOtherSeasons, setIncludeOtherSeasons] = useState(false);
  const [seasonMode, setSeasonMode] = useState<CandidateFilters["seasonMode"]>("all");
  const [positionFilter, setPositionFilter] = useState<string | null>(null);

  useEffect(() => {
    loadSimilarityPool().then((p) => {
      setPool(p);
      setLoading(false);
    });
  }, []);

  const matches = useMemo(() => {
    if (pool.length === 0) return [];
    return findClosestMatches(
      query,
      pool,
      {
        includeOtherSeasonsOfSamePlayer: includeOtherSeasons,
        seasonMode,
        eraWindow: ERA_WINDOW_SEASONS,
        positionGroup: positionFilter,
      },
      8,
    );
  }, [pool, query, includeOtherSeasons, seasonMode, positionFilter]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterSelect
          label="Seasons"
          value={seasonMode ?? "all"}
          onChange={(v) => setSeasonMode(v as CandidateFilters["seasonMode"])}
          options={[
            { value: "all", label: "All seasons" },
            { value: "same_season", label: "Same season" },
            { value: "same_era", label: `Same era (±${ERA_WINDOW_SEASONS})` },
          ]}
        />
        <FilterSelect
          label="Position"
          value={positionFilter ?? "any"}
          onChange={(v) => setPositionFilter(v === "any" ? null : v)}
          options={[
            { value: "any", label: "Any position" },
            { value: "Guard", label: "Guards" },
            { value: "Wing", label: "Wings" },
            { value: "Big", label: "Bigs" },
          ]}
        />
        <label className="flex items-center gap-2 text-sm text-stone">
          <input
            type="checkbox"
            checked={includeOtherSeasons}
            onChange={(e) => setIncludeOtherSeasons(e.target.checked)}
            className="h-4 w-4 accent-court-orange"
          />
          Include other seasons of {queryName}
        </label>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-arena-panel" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {matches.map((m) => {
            const { similarities, differences } = explainMatch(queryName, query.vector, m.player, m.vector);
            const reasons = [...similarities.slice(0, 2), differences[0]].filter(Boolean);
            return (
              <Link
                key={`${m.player_id}-${m.season}`}
                href={`/compare?a=${query.player_id}_${query.season}&b=${m.player_id}_${m.season}`}
                className="card-interactive flex gap-3 rounded-xl bg-arena-panel p-3.5"
              >
                <PlayerPhoto playerId={m.player_id} name={m.player} posGroup={m.pos_group} size={48} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-ink-light">{m.player}</p>
                    <span className="font-display shrink-0 text-lg text-court-orange-bright tabular">{Math.round(m.similarity)}</span>
                  </div>
                  <p className="text-xs text-stone-light">{m.season_label} · {m.archetype}</p>
                  <ul className="mt-1 text-[11px] text-stone">
                    {reasons.map((r, i) => <li key={i} className="truncate">• {r}</li>)}
                  </ul>
                </div>
              </Link>
            );
          })}
          {matches.length === 0 && (
            <p className="col-span-2 text-sm text-stone-light">No candidates match these filters.</p>
          )}
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-stone">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-line-strong bg-arena-panel px-2.5 py-1.5 text-ink-light outline-none focus:border-court-orange"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
