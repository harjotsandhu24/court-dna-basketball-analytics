"use client";

import { useMemo, useState } from "react";
import PlayerPhoto from "@/components/PlayerPhoto";
import PlayerAutocomplete, { type PlayerAutocompleteSelection } from "@/components/PlayerAutocomplete";
import { loadPlayersIndex, loadSeason } from "@/lib/dataLoader";
import { zToApproxPercentile } from "@/lib/stats";
import { seasonLabel } from "@/lib/config";
import type { PlayerSeasonRecord } from "@/lib/types";

const DIMENSIONS = [
  { key: "Playmaking", label: "Passing & Creation" },
  { key: "Perimeter Profile", label: "Three-Point Shooting" },
  { key: "Rim Pressure", label: "Attacking the Basket" },
  { key: "Rebounding", label: "Rebounding" },
  { key: "Defensive Activity", label: "Defense" },
  { key: "__ball_dominance", label: "How Much They Handle the Ball" },
] as const;

export default function BuildAFivePage() {
  const [selected, setSelected] = useState<PlayerSeasonRecord[]>([]);
  // Every added player's full list of qualified seasons, so the season
  // picker on each roster card can offer real alternatives -- populated
  // alongside `selected` rather than re-fetched per render.
  const [seasonOptions, setSeasonOptions] = useState<Record<string, number[]>>({});
  const [loadErrorFor, setLoadErrorFor] = useState<string | null>(null);

  async function addPlayer(picked: PlayerAutocompleteSelection) {
    if (selected.length >= 5) return;
    if (selected.some((s) => s.player_id === picked.id)) return; // prevent duplicate player
    setLoadErrorFor(null);
    try {
      const [seasonData, idx] = await Promise.all([loadSeason(picked.season), loadPlayersIndex()]);
      const rec = seasonData.find((r) => r.player_id === picked.id);
      if (rec) {
        setSelected((prev) => [...prev, rec]);
        setSeasonOptions((prev) => ({ ...prev, [picked.id]: idx[picked.id]?.qualified_seasons ?? [picked.season] }));
      }
    } catch {
      setLoadErrorFor(picked.name);
    }
  }

  async function changeSeason(playerId: string, newSeason: number) {
    try {
      const seasonData = await loadSeason(newSeason);
      const rec = seasonData.find((r) => r.player_id === playerId);
      if (rec) {
        setSelected((prev) => prev.map((p) => (p.player_id === playerId ? rec : p)));
      }
    } catch {
      setLoadErrorFor(playerId);
    }
  }

  function removePlayer(id: string) {
    setSelected((prev) => prev.filter((p) => p.player_id !== id));
    setSeasonOptions((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  const dimensionScores = useMemo(() => {
    if (selected.length === 0) return null;
    const out: Record<string, number> = {};
    for (const dim of DIMENSIONS) {
      const vals = selected.map((p) => {
        if (dim.key === "__ball_dominance") {
          return zToApproxPercentile(p.vector.usg_percent ?? 0);
        }
        return p.traits[dim.key] ?? 0;
      });
      out[dim.key] = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    return out;
  }, [selected]);

  const observations = useMemo(() => {
    if (!dimensionScores || selected.length < 3) return [];
    const obs: string[] = [];
    const highUsageCreators = selected.filter((p) => (p.traits["Playmaking"] ?? 0) >= 70 && zToApproxPercentile(p.vector.usg_percent ?? 0) >= 70).length;
    if (highUsageCreators >= 2) obs.push(`Several players who handle the ball and create shots often (${highUsageCreators} of ${selected.length})`);

    if (dimensionScores["Perimeter Profile"] >= 65) obs.push("The lineup takes a lot of three-point shots");
    if (dimensionScores["Rebounding"] < 40) obs.push("Fewer rebounds than most players in the dataset");
    if (dimensionScores["Defensive Activity"] >= 65) obs.push("The lineup produces a high number of steals and blocks");
    if (dimensionScores["Rim Pressure"] >= 65) obs.push("Several players attack the basket often");

    const posGroups = selected.map((p) => p.pos_group);
    const uniquePos = new Set(posGroups).size;
    if (uniquePos === 1) obs.push(`All five players share one position group (${posGroups[0]})`);

    return obs.slice(0, 5);
  }, [dimensionScores, selected]);

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
            placeholder="Add a player…"
            clearOnSelect
          />
        </div>
      )}
      {loadErrorFor && (
        <p className="mb-6 max-w-md text-xs text-court-orange-bright">
          Couldn&rsquo;t load {loadErrorFor} &mdash; check your connection and try again.
        </p>
      )}
      {!loadErrorFor && <div className="mb-8" />}

      {/* Selected roster -- 2 columns on phones, 3 at tablet widths, 5
          only once there's genuinely enough room at lg+. The previous
          1-column-then-straight-to-5 jump made the 5-card row cramped
          through the whole ~640-1023px tablet range. */}
      <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => {
          const p = selected[i];
          const options = p ? seasonOptions[p.player_id] ?? [p.season] : [];
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
                      value={p.season}
                      onChange={(e) => changeSeason(p.player_id, parseInt(e.target.value, 10))}
                      className="tap-target-44 w-full rounded-md border border-line-strong bg-arena-panel-strong px-1 py-1 text-center text-[11px] text-stone-light outline-none focus:border-court-orange"
                    >
                      {options.map((s) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
                    </select>
                  ) : (
                    <p className="text-[10px] text-stone-light">{p.season_label}</p>
                  )}
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
              const v = Math.max(0, Math.min(100, dimensionScores[dim.key]));
              return (
                <div key={dim.key}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-stone">{dim.label}</span>
                    <span className="tabular font-semibold text-ink-light">{Math.round(v)}</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-arena-panel-strong">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-court-orange-deep to-court-orange-bright transition-[width] duration-500"
                      style={{ width: `${v}%` }}
                    />
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

          <p className="mt-6 text-xs text-stone-light">
            This shows the combined playing style of the selected players. It does not predict how many games the
            lineup would win.
          </p>
        </div>
      )}
    </div>
  );
}
