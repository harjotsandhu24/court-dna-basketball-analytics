"use client";

import { useMemo, useRef, useState } from "react";
import PlayerPhoto from "@/components/PlayerPhoto";
import PlayerAutocomplete, { type PlayerAutocompleteSelection } from "@/components/PlayerAutocomplete";
import { loadPlayersIndex, loadSeason } from "@/lib/dataLoader";
import { seasonLabel } from "@/lib/config";
import {
  LINEUP_DIMENSIONS as DIMENSIONS,
  SMALL_SAMPLE_LABEL,
  SMALL_SAMPLE_NOTE,
  hasMissingLineupStats,
  isSmallSampleSeason,
  lineupObservations,
  lineupScores,
  lineupSeasons,
} from "@/lib/lineup";
import type { PlayerSeasonRecord } from "@/lib/types";

/** What the season picker on a roster card needs: every display-eligible season,
 * and which of them are below the comparison cutoff. */
interface SeasonInfo {
  seasons: number[];
  qualified: number[];
}

export default function BuildAFivePage() {
  const [selected, setSelected] = useState<PlayerSeasonRecord[]>([]);
  const [seasonInfo, setSeasonInfo] = useState<Record<string, SeasonInfo>>({});
  // A season the user just picked whose data is still loading (shown in the
  // picker right away; the stats change when the data arrives).
  const [pendingSeason, setPendingSeason] = useState<Record<string, number>>({});
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Refs let async handlers see the current roster and the latest request per
  // player, so a slow response can never overwrite a newer choice or bring
  // back a player who was removed.
  const selectedRef = useRef<PlayerSeasonRecord[]>([]);
  const addingRef = useRef(false);
  const latestRequest = useRef(new Map<string, number>());
  const requestCounter = useRef(0);

  function updateSelected(fn: (prev: PlayerSeasonRecord[]) => PlayerSeasonRecord[]) {
    const next = fn(selectedRef.current);
    selectedRef.current = next;
    setSelected(next);
  }

  function clearPending(id: string) {
    setPendingSeason((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function addPlayer(picked: PlayerAutocompleteSelection) {
    if (addingRef.current) return; // one add at a time
    if (selectedRef.current.length >= 5) {
      setNotice("Your lineup is full. Remove a player to add someone else.");
      return;
    }
    if (selectedRef.current.some((s) => s.player_id === picked.id)) {
      setNotice(`${picked.name} is already in your lineup.`);
      return;
    }
    addingRef.current = true;
    setAdding(true);
    setNotice(null);
    const token = ++requestCounter.current;
    latestRequest.current.set(picked.id, token);
    try {
      const [seasonData, idx] = await Promise.all([loadSeason(picked.season), loadPlayersIndex()]);
      if (latestRequest.current.get(picked.id) !== token) return;
      const rec = seasonData.find((r) => r.player_id === picked.id);
      const entry = idx[picked.id];
      if (!rec || !entry) {
        setNotice(`No ${seasonLabel(picked.season)} record found for ${picked.name}.`);
        return;
      }
      // Re-check now: the roster may have changed while this was loading.
      if (selectedRef.current.length >= 5 || selectedRef.current.some((s) => s.player_id === picked.id)) return;
      updateSelected((prev) => [...prev, rec]);
      setSeasonInfo((prev) => ({
        ...prev,
        [picked.id]: { seasons: lineupSeasons(entry), qualified: entry.qualified_seasons },
      }));
    } catch {
      if (latestRequest.current.get(picked.id) === token) {
        setNotice(`Couldn\u2019t load ${picked.name} (${seasonLabel(picked.season)}). Check your connection and try again.`);
      }
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  }

  async function changeSeason(playerId: string, newSeason: number) {
    const info = seasonInfo[playerId];
    const current = selectedRef.current.find((p) => p.player_id === playerId);
    if (!info || !current || !info.seasons.includes(newSeason)) return;
    const token = ++requestCounter.current;
    latestRequest.current.set(playerId, token);
    setPendingSeason((prev) => ({ ...prev, [playerId]: newSeason }));
    setNotice(null);
    try {
      const seasonData = await loadSeason(newSeason);
      if (latestRequest.current.get(playerId) !== token) return; // a newer pick (or a removal) won
      const rec = seasonData.find((r) => r.player_id === playerId);
      clearPending(playerId);
      if (!rec) {
        setNotice(`No ${seasonLabel(newSeason)} record found for ${current.player}. Showing ${seasonLabel(current.season)} instead.`);
        return;
      }
      updateSelected((prev) => prev.map((p) => (p.player_id === playerId ? rec : p)));
    } catch {
      if (latestRequest.current.get(playerId) !== token) return;
      clearPending(playerId);
      setNotice(`Couldn\u2019t load ${current.player} for ${seasonLabel(newSeason)}. Showing ${seasonLabel(current.season)} instead.`);
    }
  }

  function removePlayer(id: string) {
    latestRequest.current.delete(id); // any request still in flight for this player is now ignored
    clearPending(id);
    updateSelected((prev) => prev.filter((p) => p.player_id !== id));
    setSeasonInfo((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setNotice(null);
  }

  const dimensionScores = useMemo(() => lineupScores(selected), [selected]);
  const observations = useMemo(
    () => (dimensionScores ? lineupObservations(selected, dimensionScores) : []),
    [dimensionScores, selected],
  );
  const anyUnavailable = dimensionScores != null && DIMENSIONS.some((d) => dimensionScores[d.key] == null);

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-10 md:px-8">
      <h1 className="font-display text-4xl text-ink mb-1">Build a Lineup</h1>
      <p className="mb-8 max-w-2xl text-sm text-stone-light">
        Pick five different players and see what their combined playing style looks like — based on real stats,
        not a prediction of wins or performance.
      </p>

      {selected.length < 5 && (
        <div className="mb-3 max-w-md">
          <PlayerAutocomplete
            onSelect={addPlayer}
            onUnavailable={(name) => setNotice(`No season data found for ${name}.`)}
            placeholder="Add a player…"
            clearOnSelect
            seasonPool="all"
            disabled={adding}
          />
        </div>
      )}
      <div className="mb-8 min-h-5 max-w-md text-xs">
        {adding && <p role="status" className="text-stone-light">Adding player&hellip;</p>}
        {!adding && notice && <p role="alert" className="text-court-orange-bright">{notice}</p>}
      </div>

      {/* Selected roster -- 2 columns on phones, 3 at tablet widths, 5
          only once there's genuinely enough room at lg+. The previous
          1-column-then-straight-to-5 jump made the 5-card row cramped
          through the whole ~640-1023px tablet range. */}
      <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => {
          const p = selected[i];
          const info = p ? seasonInfo[p.player_id] : undefined;
          const options = p ? info?.seasons ?? [p.season] : [];
          const pending = p ? pendingSeason[p.player_id] : undefined;
          const smallSample = p ? p.small_sample : false;
          return (
            <div key={i} className="flex flex-col items-center gap-2 rounded-xl border border-line bg-arena-panel p-4">
              {p ? (
                <>
                  <PlayerPhoto playerId={p.player_id} name={p.player} posGroup={p.pos_group} size={64} />
                  <p className="text-center text-xs font-semibold text-ink-light">{p.player}</p>
                  {/* Season is always shown explicitly, and changeable --
                      never a silent pick the user has to go dig for. */}
                  {options.length > 1 ? (
                    <select
                      aria-label={`Season for ${p.player}`}
                      aria-busy={pending != null}
                      value={pending ?? p.season}
                      onChange={(e) => changeSeason(p.player_id, parseInt(e.target.value, 10))}
                      className="tap-target-44 w-full rounded-md border border-line-strong bg-arena-panel-strong px-1 py-1 text-center text-[11px] text-stone-light outline-none focus:border-court-orange"
                    >
                      {options.map((s) => (
                        <option key={s} value={s}>
                          {seasonLabel(s)}
                          {info && isSmallSampleSeason({ seasons: info.seasons, qualified_seasons: info.qualified }, s) ? ` \u00b7 ${SMALL_SAMPLE_LABEL}` : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-[10px] text-stone-light">{p.season_label}</p>
                  )}
                  {pending != null && <p role="status" className="text-[10px] text-stone-light">Updating&hellip;</p>}
                  {smallSample && (
                    <div className="text-center">
                      <span className="inline-block rounded-full border border-court-orange/50 bg-court-orange/10 px-2 py-0.5 text-[10px] font-medium text-court-orange-bright">
                        {SMALL_SAMPLE_LABEL}
                      </span>
                      <p className="mt-1 text-[10px] leading-snug text-stone-light">{SMALL_SAMPLE_NOTE}</p>
                    </div>
                  )}
                  {hasMissingLineupStats(p) && <p className="text-center text-[10px] text-stone-light">Some stats unavailable</p>}
                  <button onClick={() => removePlayer(p.player_id)} className="tap-target-44 text-[11px] text-court-orange-bright hover:underline">
                    Remove
                  </button>
                </>
              ) : (
                <div className="flex h-[124px] items-center justify-center text-xs text-stone-light">Empty slot</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Lineup identity card */}
      {dimensionScores && (
        <div className="rounded-2xl border border-court-orange/30 bg-gradient-to-br from-arena-panel to-arena-panel-strong p-8">
          <p className="text-eyebrow mb-1">Lineup Identity Card</p>
          <h2 className="font-display text-3xl text-ink mb-6">
            {selected.length === 5 ? "Full Five" : `${selected.length} of 5 Selected`}
          </h2>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {DIMENSIONS.map((dim) => {
              const raw = dimensionScores[dim.key];
              const v = raw == null ? null : Math.max(0, Math.min(100, raw));
              return (
                <div key={dim.key}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-stone">{dim.label}</span>
                    <span className="tabular font-semibold text-ink-light">{v == null ? "Unavailable" : Math.round(v)}</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-arena-panel-strong">
                    {v != null && (
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-court-orange-deep to-court-orange-bright transition-[width] duration-500"
                        style={{ width: `${v}%` }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {observations.length > 0 && (
            <div className="mt-8 border-t border-line pt-5">
              <p className="text-eyebrow mb-2">Observations</p>
              <ul className="flex flex-col gap-1.5 text-sm text-ink-light">
                {observations.map((o, i) => <li key={i}>• {o}</li>)}
              </ul>
            </div>
          )}

          {anyUnavailable && (
            <p className="mt-6 text-xs text-stone-light">
              Unavailable means at least one selected player has no value for that stat.
            </p>
          )}

          <p className="mt-6 text-xs text-stone-light">
            This shows the combined playing style of the selected players. It does not predict how many games the
            lineup would win.
          </p>
        </div>
      )}
    </div>
  );
}
