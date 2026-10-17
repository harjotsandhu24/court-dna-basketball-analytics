"use client";

import { useEffect, useId, useRef, useState } from "react";
import PlayerAutocomplete, { type PlayerAutocompleteSelection } from "@/components/PlayerAutocomplete";
import { loadPlayersIndex } from "@/lib/dataLoader";
import { seasonLabel } from "@/lib/config";
import { lineupSeasons } from "@/lib/lineup";

export interface OppPick {
  id: string;
  name: string;
  season: number;
  seasons: number[];
}

/** Outcome of trying to add a pick to the opponent lineup (pure, so the guards are unit-tested). */
export type AddResult = { ok: true; next: OppPick[] } | { ok: false; notice: string };
export function addOpponentPick(current: OppPick[], pick: { id: string; name: string; season: number }, seasons: number[]): AddResult {
  if (current.length >= 5) return { ok: false, notice: "The opponent already has five players. Remove one to add another." };
  if (current.some((x) => x.id === pick.id)) return { ok: false, notice: `${pick.name} is already on the opponent's lineup.` };
  return { ok: true, next: [...current, { id: pick.id, name: pick.name, season: pick.season, seasons }] };
}

/**
 * Builds an opponent lineup next to your own without touching it. The same player may be on both teams, never
 * twice on one. Picks are held locally; nothing is saved.
 */
export default function OpponentBuilder({ value, onChange }: { value: OppPick[]; onChange: (next: OppPick[]) => void }) {
  const [notice, setNotice] = useState<string | null>(null);
  const baseId = useId().replace(/:/g, "");
  // The latest lineup, read AFTER the async index load so two quick picks can't overwrite each other or add the
  // same player twice. `pending` holds picks that are still loading.
  const latest = useRef(value);
  useEffect(() => { latest.current = value; }, [value]);
  const pending = useRef(new Set<string>());

  async function add(p: PlayerAutocompleteSelection) {
    if (pending.current.has(p.id)) return;
    // cheap early check so an obvious duplicate or a full lineup answers immediately
    const early = addOpponentPick(latest.current, p, []);
    if (!early.ok) { setNotice(early.notice); return; }
    pending.current.add(p.id);
    try {
      const idx = await loadPlayersIndex();
      const entry = idx[p.id];
      if (!entry) throw new Error("missing");
      const res = addOpponentPick(latest.current, p, lineupSeasons(entry));
      if (!res.ok) { setNotice(res.notice); return; }
      setNotice(null);
      latest.current = res.next;
      onChange(res.next);
    } catch {
      setNotice(`Couldn't load ${p.name}. Check your connection and try again.`);
    } finally {
      pending.current.delete(p.id);
    }
  }

  return (
    <div>
      <p className="mb-2 text-xs text-stone-light">
        Build the opponent here. Your own lineup above isn&rsquo;t changed. The same player can be on both teams, but not twice on one.
      </p>
      {value.length < 5 && (
        <PlayerAutocomplete
          onSelect={add}
          label="Search for an opponent player"
          onUnavailable={(name) => setNotice(`No season data found for ${name}.`)}
          placeholder={value.length === 0 ? "Search the opponent's first player…" : `Add player ${value.length + 1} of 5…`}
          clearOnSelect
          seasonPool="all"
        />
      )}
      <div className="mt-2 min-h-5 text-xs" role="status" aria-live="polite">
        {notice && <p className="text-court-orange-bright">{notice}</p>}
      </div>
      <ul className="mt-1 flex flex-col gap-2" aria-label="Opponent lineup">
        {value.map((p, i) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-arena-panel px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm text-ink-light">{p.name}</span>
            <label className="sr-only" htmlFor={`${baseId}-s${i}`}>Season for {p.name}</label>
            <select
              id={`${baseId}-s${i}`}
              value={p.season}
              onChange={(e) => onChange(value.map((x) => (x.id === p.id ? { ...x, season: parseInt(e.target.value, 10) } : x)))}
              className="min-h-11 rounded-md border border-line-strong bg-arena-panel-strong px-2 py-1 text-base text-ink-light outline-none focus:border-court-orange sm:text-sm"
            >
              {p.seasons.map((s) => (
                <option key={s} value={s}>{seasonLabel(s)}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-secondary min-h-11 px-3 py-1 text-sm"
              onClick={() => onChange(value.filter((x) => x.id !== p.id))}
              aria-label={`Remove ${p.name} from the opponent`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-stone-light">{value.length} of 5 players</p>
    </div>
  );
}
