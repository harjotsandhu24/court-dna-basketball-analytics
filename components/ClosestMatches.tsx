"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { loadSimilarityPool } from "@/lib/dataLoader";
import { findClosestMatches, type SimilarityPoolEntry, type CandidateFilters } from "@/lib/similarity";
import { explainMatch } from "@/lib/explain";
import PlayerPhoto from "./PlayerPhoto";
import { ERA_WINDOW_SEASONS, seasonLabel } from "@/lib/config";
import { useAsync } from "@/lib/useAsync";

interface Props {
  query: SimilarityPoolEntry;
  queryName: string;
}

export default function ClosestMatches({ query, queryName }: Props) {
  const poolState = useAsync<SimilarityPoolEntry[]>("similarity-pool", loadSimilarityPool);
  const pool = useMemo(() => (poolState.status === "ready" ? poolState.data ?? [] : []), [poolState.status, poolState.data]);
  const [includeOtherSeasons, setIncludeOtherSeasons] = useState(false);
  const [seasonMode, setSeasonMode] = useState<CandidateFilters["seasonMode"]>("all");
  const [positionFilter, setPositionFilter] = useState<string | null>(null);

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
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
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
        <label className="flex min-h-11 items-center gap-2 text-sm text-stone">
          <input
            type="checkbox"
            checked={includeOtherSeasons}
            onChange={(e) => setIncludeOtherSeasons(e.target.checked)}
            className="h-5 w-5 accent-court-orange"
          />
          Include other seasons of {queryName}
        </label>
      </div>

      {poolState.status === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-line-strong bg-arena-panel px-4 py-3 text-sm text-stone">
          <span>Couldn&rsquo;t load similar players.</span>
          <button type="button" onClick={poolState.retry} className="btn btn-secondary min-h-11 px-4 py-2 text-sm">Retry</button>
        </div>
      ) : poolState.status !== "ready" ? (
        <div role="status" aria-label="Loading similar players" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  <p className="text-xs text-stone">{seasonLabel(m.season)} · {m.archetype}</p>
                  <ul className="mt-1 text-xs text-stone">
                    {reasons.map((r, i) => <li key={i} className="truncate">• {r}</li>)}
                  </ul>
                </div>
              </Link>
            );
          })}
          {matches.length === 0 && (
            <p className="text-sm text-stone sm:col-span-2">No candidates match these filters.</p>
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
        className="min-h-11 rounded-md border border-line-strong bg-arena-panel px-3 text-base text-ink-light outline-none focus:border-court-orange sm:text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
