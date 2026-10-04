"use client";

import { useMemo, useRef, useState } from "react";
import PlayerPhoto from "@/components/PlayerPhoto";
import PlayerAutocomplete, { type PlayerAutocompleteSelection } from "@/components/PlayerAutocomplete";
import { loadPlayersIndex, loadSeason } from "@/lib/dataLoader";
import { zToApproxPercentile } from "@/lib/stats";
import { SEASON_MAX, SEASON_MIN, seasonLabel } from "@/lib/config";
import type { PlayerSeasonRecord } from "@/lib/types";

const DIMENSIONS = [
  { key: "Playmaking", label: "Passing & Creation" },
  { key: "Perimeter Profile", label: "Three-Point Shooting" },
  { key: "Rim Pressure", label: "Attacking the Basket" },
  { key: "Rebounding", label: "Rebounding" },
  { key: "Defensive Activity", label: "Defense" },
  { key: "__ball_dominance", label: "How Much They Handle the Ball" },
] as const;

const MAX_PLAYERS = 5;

interface Slot {
  id: string;
  name: string;
  season: number;
  status: "loading" | "ready" | "error";
  record: PlayerSeasonRecord | null;
  /** Seasons this player can be switched to. */
  options: number[];
}

const ALL_SEASONS = Array.from({ length: SEASON_MAX - SEASON_MIN + 1 }, (_, i) => SEASON_MAX - i);

export default function BuildAFivePage() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // Season used when adding a new player: "latest" = each player's most
  // recent qualified season, otherwise the nearest qualified season to it.
  const [pickSeason, setPickSeason] = useState<"latest" | number>("latest");

  // Each slot load takes a globally unique ticket; only the newest ticket
  // for that player may apply, so rapid season changes (or remove + re-add)
  // can never be overwritten by an older, slower response.
  const counterRef = useRef(0);
  const ticketsRef = useRef<Record<string, number>>({});

  function patchSlot(id: string, patch: Partial<Slot>) {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function loadSlot(id: string, season: number) {
    const ticket = ++counterRef.current;
    ticketsRef.current[id] = ticket;
    try {
      const [seasonData, idx] = await Promise.all([loadSeason(season), loadPlayersIndex()]);
      if (ticketsRef.current[id] !== ticket) return;
      const record = seasonData.find((r) => r.player_id === id) ?? null;
      const entry = idx[id];
      const options = entry && entry.qualified_seasons.length > 0 ? entry.qualified_seasons : [season];
      patchSlot(id, record ? { record, season, status: "ready", options } : { status: "error", options });
    } catch {
      if (ticketsRef.current[id] === ticket) patchSlot(id, { status: "error" });
    }
  }

  function addPlayer(picked: PlayerAutocompleteSelection) {
    const existing = slots.find((s) => s.id === picked.id);
    if (existing) {
      setNotice(
        `${picked.name} is already in your lineup (${seasonLabel(existing.season)}). Use that card’s season menu to change the season, or remove them first.`,
      );
      return;
    }
    if (slots.length >= MAX_PLAYERS) {
      setNotice("Your lineup already has five players. Remove one to add another.");
      return;
    }
    setNotice(null);
    setSlots((prev) => [...prev, { id: picked.id, name: picked.name, season: picked.season, status: "loading", record: null, options: [picked.season] }]);
    void loadSlot(picked.id, picked.season);
  }

  function changeSeason(id: string, season: number) {
    setNotice(null);
    patchSlot(id, { season, status: "loading" });
    void loadSlot(id, season);
  }

  function removePlayer(id: string) {
    delete ticketsRef.current[id]; // drop any in-flight response for this player
    setNotice(null);
    setSlots((prev) => prev.filter((s) => s.id !== id));
  }

  // Only fully loaded, current-season slots feed the lineup numbers.
  const ready = useMemo(
    () => slots.filter((s) => s.status === "ready" && s.record && s.record.season === s.season).map((s) => s.record!),
    [slots],
  );
  const updating = slots.some((s) => s.status === "loading");

  const dimensionScores = useMemo(() => {
    if (ready.length === 0) return null;
    const out: Record<string, number> = {};
    for (const dim of DIMENSIONS) {
      const vals = ready.map((p) =>
        dim.key === "__ball_dominance" ? zToApproxPercentile(p.vector.usg_percent ?? 0) : p.traits[dim.key] ?? 0,
      );
      out[dim.key] = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    return out;
  }, [ready]);

  const observations = useMemo(() => {
    if (!dimensionScores || ready.length < 3) return [];
    const obs: string[] = [];
    const highUsageCreators = ready.filter(
      (p) => (p.traits["Playmaking"] ?? 0) >= 70 && zToApproxPercentile(p.vector.usg_percent ?? 0) >= 70,
    ).length;
    if (highUsageCreators >= 2) obs.push(`Several players who handle the ball and create shots often (${highUsageCreators} of ${ready.length})`);
    if (dimensionScores["Perimeter Profile"] >= 65) obs.push("The lineup takes a lot of three-point shots");
    if (dimensionScores["Rebounding"] < 40) obs.push("Fewer rebounds than most players in the dataset");
    if (dimensionScores["Defensive Activity"] >= 65) obs.push("The lineup produces a high number of steals and blocks");
    if (dimensionScores["Rim Pressure"] >= 65) obs.push("Several players attack the basket often");

    const posGroups = ready.map((p) => p.pos_group);
    if (new Set(posGroups).size === 1) {
      // Only say "five" when five players are actually selected.
      const who = ready.length === MAX_PLAYERS ? "All five players" : "All selected players";
      obs.push(`${who} share one position group (${posGroups[0]})`);
    }
    return obs.slice(0, 5);
  }, [dimensionScores, ready]);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-5 md:px-8 md:py-10">
      <h1 className="font-display mb-1 text-4xl text-ink">Build a Lineup</h1>
      <p className="mb-6 max-w-2xl text-sm text-stone">
        Pick five different players and see what their combined playing style looks like — based on real stats,
        not a prediction of wins or performance. Each player is shown for one season; you can change it on their card.
      </p>

      <div className="mb-3 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <p className="text-eyebrow mb-1.5">Add a player ({slots.length} of {MAX_PLAYERS})</p>
          <PlayerAutocomplete
            scope="map"
            preferredSeason={pickSeason === "latest" ? undefined : pickSeason}
            onSelect={addPlayer}
            placeholder={slots.length >= MAX_PLAYERS ? "Lineup is full — remove a player to add another" : "Add a player…"}
            ariaLabel="Add a player to the lineup"
            disabled={slots.length >= MAX_PLAYERS}
          />
        </div>
        <label className="block">
          <span className="text-eyebrow mb-1.5 block">Season for new picks</span>
          <select
            value={pickSeason}
            onChange={(e) => setPickSeason(e.target.value === "latest" ? "latest" : parseInt(e.target.value, 10))}
            className="min-h-11 w-full rounded-md border border-line-strong bg-arena-panel px-3 text-base text-ink-light outline-none focus:border-court-orange sm:w-auto sm:text-sm"
          >
            <option value="latest">Each player&rsquo;s latest</option>
            {ALL_SEASONS.map((s) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
          </select>
        </label>
      </div>

      <div className="mb-6 min-h-6 max-w-2xl" role="status" aria-live="polite">
        {notice && <p className="text-sm text-court-orange-bright">{notice}</p>}
      </div>

      {/* 2 columns on phones, 3 at tablet widths, 5 only at lg+ */}
      <ul className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: MAX_PLAYERS }).map((_, i) => {
          const s = slots[i];
          return (
            <li key={s ? s.id : `empty-${i}`} className="flex min-w-0 flex-col items-center gap-2 rounded-xl border border-line bg-arena-panel p-3 sm:p-4">
              {s ? (
                <>
                  <PlayerPhoto playerId={s.id} name={s.name} posGroup={s.record?.pos_group} size={64} />
                  <p className="break-words text-center text-sm font-semibold text-ink-light">{s.name}</p>
                  <label className="block w-full">
                    <span className="mb-1 block text-center text-xs text-stone">Season</span>
                    <select
                      value={s.season}
                      disabled={s.options.length <= 1}
                      onChange={(e) => changeSeason(s.id, parseInt(e.target.value, 10))}
                      className="min-h-11 w-full rounded-md border border-line-strong bg-arena-panel-strong px-2 text-center text-base text-ink-light outline-none focus:border-court-orange disabled:opacity-100 sm:text-sm"
                    >
                      {s.options.map((o) => <option key={o} value={o}>{seasonLabel(o)}</option>)}
                    </select>
                  </label>
                  {s.status === "loading" && <p role="status" className="text-xs text-stone">Loading…</p>}
                  {s.status === "error" && (
                    <div role="alert" className="flex flex-col items-center gap-1 text-center text-xs text-court-orange-bright">
                      <span>Couldn&rsquo;t load {seasonLabel(s.season)}.</span>
                      <button type="button" onClick={() => changeSeason(s.id, s.season)} className="min-h-11 px-2 underline">Retry</button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removePlayer(s.id)}
                    aria-label={`Remove ${s.name}`}
                    className="min-h-11 px-2 text-sm text-court-orange-bright hover:underline"
                  >
                    Remove
                  </button>
                </>
              ) : (
                <div className="flex h-[140px] items-center justify-center text-sm text-stone">Empty slot</div>
              )}
            </li>
          );
        })}
      </ul>

      {dimensionScores && (
        <div className="rounded-2xl border border-court-orange/30 bg-gradient-to-br from-arena-panel to-arena-panel-strong p-5 sm:p-8">
          <p className="text-eyebrow mb-1">Lineup Identity Card</p>
          <h2 className="font-display mb-1 text-3xl text-ink">
            {ready.length === MAX_PLAYERS ? "Full Five" : `${ready.length} of ${MAX_PLAYERS} Selected`}
          </h2>
          {updating && <p role="status" className="mb-4 text-sm text-stone">Updating…</p>}
          <div className="mb-5" />

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {DIMENSIONS.map((dim) => {
              const v = Math.max(0, Math.min(100, dimensionScores[dim.key]));
              return (
                <div key={dim.key}>
                  <div className="mb-1 flex justify-between gap-3 text-sm">
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

          <p className="mt-6 text-sm text-stone">
            This shows the combined playing style of the selected players. It does not predict how many games the
            lineup would win.
          </p>
        </div>
      )}
    </div>
  );
}
