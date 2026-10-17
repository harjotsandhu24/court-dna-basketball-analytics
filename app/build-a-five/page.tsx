"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import PlayerPhoto from "@/components/PlayerPhoto";
import SimulatePanel from "@/components/SimulatePanel";
import LineupCourt, { type CourtSpot } from "@/components/LineupCourt";
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
import { POSITIONS, emptyBoard, findSlot, moveOrSwap, placeAt, removeAt, type Board } from "@/lib/lineupBoard";
import { clearSaved, hasAnySaved, parseSavedLineup, readSavedRaw, writeSaved } from "@/lib/lineupStorage";
import type { PlayerSeasonRecord } from "@/lib/types";

/** Every display-eligible season for a player, and which of them are below the comparison cutoff. */
interface SeasonInfo {
  seasons: number[];
  qualified: number[];
}
interface Slot {
  rec: PlayerSeasonRecord;
  info: SeasonInfo;
}
/** The one add/replace request that may be loading at a time. */
interface Op {
  token: number;
  slot: number;
  kind: "add" | "replace";
  name: string;
}

const POSITION_NOTE = "Positions help you arrange your lineup. They don’t affect the scores.";

export default function BuildAFivePage() {
  const [slots, setSlots] = useState<Board<Slot>>(() => emptyBoard<Slot>());
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const [mode, setMode] = useState<"menu" | "search">("menu");
  const [moving, setMoving] = useState<number | null>(null);
  const [op, setOp] = useState<Op | null>(null);
  // A season the user just picked whose data is still loading (shown in the
  // picker right away; the stats change when the data arrives).
  const [pendingSeason, setPendingSeason] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Saved lineup: "restoring" while it is being validated and loaded, "failed" if it could not be loaded
  // (the saved copy is kept untouched until the user retries or starts fresh).
  const [restore, setRestore] = useState<"idle" | "restoring" | "failed">("idle");
  const [confirmClear, setConfirmClearState] = useState(false);
  function setConfirmClear(v: boolean) {
    confirmClearRef.current = v;
    setConfirmClearState(v);
  }

  // Refs give async handlers the current board and the latest request, so a
  // slow response can never fill the wrong spot, overwrite a newer choice or
  // bring back a removed player.
  const slotsRef = useRef(slots);
  const openSlotRef = useRef<number | null>(null);
  const movingRef = useRef<number | null>(null);
  const opRef = useRef<Op | null>(null);
  const confirmClearRef = useRef(false);
  const modeRef = useRef<"menu" | "search">("menu");
  const seasonRequest = useRef(new Map<string, number>());
  const counter = useRef(0);
  const spotRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLElement>(null);
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<"idle" | "restoring" | "failed">("idle");
  const savingRef = useRef(false); // true once the saved lineup has been dealt with (restored, skipped or cleared)
  const panelId = `lineup-controls-${useId().replace(/:/g, "")}`;

  function updateSlots(fn: (prev: Board<Slot>) => Board<Slot>) {
    const next = fn(slotsRef.current);
    slotsRef.current = next;
    setSlots(next);
  }
  function setOpenSlotBoth(v: number | null) {
    openSlotRef.current = v;
    setOpenSlot(v);
  }
  function setModeBoth(m: "menu" | "search") {
    modeRef.current = m;
    setMode(m);
  }
  function setRestoreBoth(v: "idle" | "restoring" | "failed") {
    restoreRef.current = v;
    setRestore(v);
  }
  function setMovingBoth(v: number | null) {
    movingRef.current = v;
    setMoving(v);
  }
  function setOpBoth(v: Op | null) {
    opRef.current = v;
    setOp(v);
  }
  function focusSpot(i: number) {
    requestAnimationFrame(() => spotRefs.current[i]?.focus());
  }
  function clearPending(id: string) {
    setPendingSeason((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }
  const inLineup = (id: string) => findSlot(slotsRef.current, (s) => s.rec.player_id === id) >= 0;

  /** Stops the loading add/replace: its response will be ignored and nothing changes. */
  function cancelOp() {
    if (!opRef.current) return;
    setOpBoth(null);
    setAnnouncement("Cancelled.");
  }
  function closePanel(returnFocus = true) {
    const i = openSlotRef.current;
    cancelOp();
    setOpenSlotBoth(null);
    setModeBoth("menu");
    if (returnFocus && i != null) focusSpot(i);
  }
  function cancelMove(returnFocus = true) {
    const i = movingRef.current;
    if (i == null) return;
    setMovingBoth(null);
    setAnnouncement("Move cancelled.");
    if (returnFocus) focusSpot(i);
  }

  function handleSpotClick(i: number) {
    if (opRef.current || restoreRef.current !== "idle") return; // loading: ignore repeated clicks
    if (movingRef.current != null) {
      moveTo(i);
      return;
    }
    if (openSlotRef.current === i) {
      closePanel();
      return;
    }
    setNotice(null);
    setOpenSlotBoth(i);
    setModeBoth(slotsRef.current[i] ? "menu" : "search");
  }

  function moveTo(target: number) {
    const from = movingRef.current;
    if (from == null) return;
    if (target === from) {
      cancelMove();
      return;
    }
    const before = slotsRef.current;
    const mover = before[from];
    const other = before[target];
    const { kind } = moveOrSwap(before, from, target);
    if (kind === "none" || !mover) {
      cancelMove();
      return;
    }
    updateSlots((prev) => moveOrSwap(prev, from, target).board);
    setMovingBoth(null);
    setAnnouncement(
      kind === "moved"
        ? `Moved ${mover.rec.player} to ${POSITIONS[target].code}.`
        : `Swapped ${mover.rec.player} and ${other?.rec.player} (${POSITIONS[from].code} and ${POSITIONS[target].code}).`,
    );
    focusSpot(target);
  }

  function startMove(i: number) {
    if (opRef.current || !slotsRef.current[i]) return;
    setOpenSlotBoth(null);
    setModeBoth("menu");
    setMovingBoth(i);
    setNotice(null);
    setAnnouncement(`Moving ${slotsRef.current[i]!.rec.player}. Choose a position, or press Escape to cancel.`);
    focusSpot(i);
  }

  function removeSlot(i: number) {
    if (opRef.current) return;
    const s = slotsRef.current[i];
    if (!s) return;
    seasonRequest.current.delete(s.rec.player_id); // any season request still loading for them is now ignored
    clearPending(s.rec.player_id);
    updateSlots((prev) => removeAt(prev, i));
    setOpenSlotBoth(null);
    setModeBoth("menu");
    setAnnouncement(`Removed ${s.rec.player} from ${POSITIONS[i].code}.`);
    setNotice(null);
    focusSpot(i);
  }

  /** Empties the lineup (after the user confirmed) and forgets the saved copy. */
  function clearLineup() {
    cancelOp();
    setMovingBoth(null);
    setOpenSlotBoth(null);
    setModeBoth("menu");
    seasonRequest.current.clear(); // any season request still loading is now ignored
    setPendingSeason({});
    updateSlots(() => emptyBoard<Slot>());
    clearSaved();
    setConfirmClear(false);
    setNotice(null);
    setAnnouncement("Lineup cleared.");
    focusSpot(0);
  }

  /** Reads the saved lineup, checks every entry against the data, and puts back what is still available. */
  async function restoreSaved(isCancelled: () => boolean) {
    const parsed = parseSavedLineup(readSavedRaw());
    if (!hasAnySaved(parsed.slots)) {
      if (parsed.dropped > 0) clearSaved(); // unreadable saved data: forget it
      savingRef.current = true;
      setRestoreBoth("idle");
      return;
    }
    setRestoreBoth("restoring");
    try {
      const idx = await loadPlayersIndex();
      const seasons = [...new Set(parsed.slots.flatMap((e) => (e ? [e.season] : [])))];
      const loaded = await Promise.all(seasons.map((y) => loadSeason(y).then((rows) => [y, rows] as const)));
      if (isCancelled()) return;
      const bySeason = new Map(loaded);
      const skipped: string[] = [];
      let board = emptyBoard<Slot>();
      parsed.slots.forEach((e, i) => {
        if (!e) return;
        const entry = idx[e.id];
        const rec = bySeason.get(e.season)?.find((r) => r.player_id === e.id);
        if (!entry || !rec || !entry.seasons.includes(e.season)) {
          skipped.push(`${entry?.name ?? "a saved player"} (${seasonLabel(e.season)}) at ${POSITIONS[i].code}`);
          return;
        }
        board = placeAt(board, i, { rec, info: { seasons: lineupSeasons(entry), qualified: entry.qualified_seasons } });
      });
      updateSlots(() => board);
      const restored = board.filter(Boolean).length;
      const problems = [
        skipped.length ? `Skipped ${skipped.join("; ")}: no record found.` : "",
        parsed.dropped > 0 ? `${parsed.dropped} saved ${parsed.dropped === 1 ? "entry was" : "entries were"} invalid and skipped.` : "",
      ].filter(Boolean);
      if (problems.length) setNotice(`Restored ${restored} saved ${restored === 1 ? "player" : "players"}. ${problems.join(" ")}`);
      setAnnouncement(`Restored your saved lineup: ${restored} ${restored === 1 ? "player" : "players"}.`);
      savingRef.current = true;
      setRestoreBoth("idle");
    } catch {
      if (isCancelled()) return;
      setRestoreBoth("failed"); // the saved lineup stays in storage, untouched
    }
  }

  /** Add to an empty spot, or replace the player in an occupied one. The original stays until the new player has loaded. */
  async function handlePick(picked: PlayerAutocompleteSelection) {
    const slot = openSlotRef.current;
    if (slot == null || opRef.current) return; // nothing open, or one request already loading
    const occupant = slotsRef.current[slot];
    if (occupant && occupant.rec.player_id === picked.id) {
      closePanel();
      return;
    }
    if (inLineup(picked.id)) {
      setNotice(`${picked.name} is already in your lineup.`);
      return;
    }
    const kind: Op["kind"] = occupant ? "replace" : "add";
    const token = ++counter.current;
    setOpBoth({ token, slot, kind, name: picked.name });
    setNotice(null);
    const stillCurrent = () => opRef.current?.token === token;
    try {
      const [seasonData, idx] = await Promise.all([loadSeason(picked.season), loadPlayersIndex()]);
      if (!stillCurrent()) return; // cancelled, or the panel was closed
      const rec = seasonData.find((r) => r.player_id === picked.id);
      const entry = idx[picked.id];
      if (!rec || !entry) {
        setOpBoth(null);
        setNotice(
          `No ${seasonLabel(picked.season)} record found for ${picked.name}.${occupant ? ` Kept ${occupant.rec.player} in ${POSITIONS[slot].code}.` : ""}`,
        );
        return;
      }
      // Re-check the board as it is now, not as it was when the pick was made.
      const now = slotsRef.current[slot];
      const sameSpot = kind === "add" ? now == null : now != null && now.rec.player_id === occupant?.rec.player_id;
      if (!sameSpot || inLineup(picked.id)) {
        setOpBoth(null);
        setNotice(`The lineup changed while ${picked.name} was loading, so nothing was changed.`);
        return;
      }
      if (occupant) {
        seasonRequest.current.delete(occupant.rec.player_id);
        clearPending(occupant.rec.player_id);
      }
      updateSlots((prev) =>
        placeAt(prev, slot, { rec, info: { seasons: lineupSeasons(entry), qualified: entry.qualified_seasons } }),
      );
      setOpBoth(null);
      setOpenSlotBoth(null);
      setModeBoth("menu");
      setAnnouncement(
        occupant
          ? `Replaced ${occupant.rec.player} with ${rec.player} (${rec.season_label}) at ${POSITIONS[slot].code}.`
          : `Added ${rec.player} (${rec.season_label}) at ${POSITIONS[slot].code}.`,
      );
      focusSpot(slot);
    } catch {
      if (!stillCurrent()) return;
      setOpBoth(null);
      setNotice(
        `Couldn’t load ${picked.name} (${seasonLabel(picked.season)}). ${
          occupant ? `Kept ${occupant.rec.player} in ${POSITIONS[slot].code}.` : "Check your connection and try again."
        }`,
      );
    }
  }

  async function changeSeason(playerId: string, newSeason: number) {
    const at = findSlot(slotsRef.current, (s) => s.rec.player_id === playerId);
    const current = at >= 0 ? slotsRef.current[at] : null;
    if (!current || !current.info.seasons.includes(newSeason)) return;
    const token = ++counter.current;
    seasonRequest.current.set(playerId, token);
    setPendingSeason((prev) => ({ ...prev, [playerId]: newSeason }));
    setNotice(null);
    const name = current.rec.player;
    const shown = current.rec.season;
    try {
      const seasonData = await loadSeason(newSeason);
      if (seasonRequest.current.get(playerId) !== token) return; // a newer pick (or a removal/replacement) won
      const rec = seasonData.find((r) => r.player_id === playerId);
      clearPending(playerId);
      if (!rec) {
        setNotice(`No ${seasonLabel(newSeason)} record found for ${name}. Showing ${seasonLabel(shown)} instead.`);
        return;
      }
      // They may have moved while this loaded: find their spot now.
      updateSlots((prev) => {
        const now = findSlot(prev, (s) => s.rec.player_id === playerId);
        return now < 0 ? prev : placeAt(prev, now, { ...prev[now]!, rec });
      });
    } catch {
      if (seasonRequest.current.get(playerId) !== token) return;
      clearPending(playerId);
      setNotice(`Couldn’t load ${name} for ${seasonLabel(newSeason)}. Showing ${seasonLabel(shown)} instead.`);
    }
  }

  // Escape: cancel a move; otherwise cancel a loading request; otherwise step back / close the controls.
  useEffect(() => {
    if (openSlot == null && moving == null && !confirmClear) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (confirmClearRef.current) {
        e.preventDefault();
        setConfirmClear(false);
        requestAnimationFrame(() => clearButtonRef.current?.focus());
      } else if (movingRef.current != null) {
        e.preventDefault();
        cancelMove();
      } else if (opRef.current) {
        e.preventDefault();
        cancelOp();
      } else if (openSlotRef.current != null) {
        e.preventDefault();
        const i = openSlotRef.current;
        if (modeRef.current === "search" && slotsRef.current[i]) setModeBoth("menu");
        else closePanel();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSlot, moving, confirmClear]);

  // Bring the controls into view when they open (they sit under the court on phones).
  // Move focus into the controls when they open (the add-search focuses itself) and keep them in view;
  // scroll instantly when the person prefers reduced motion.
  useEffect(() => {
    if (openSlot == null) return;
    if (mode === "menu") controlsRef.current?.focus({ preventScroll: true });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panelRef.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [openSlot, mode]);

  // Restore the saved lineup once, on arrival; then keep the saved copy up to date.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void restoreSaved(() => cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!savingRef.current) return; // never overwrite the saved lineup before it has been restored
    writeSaved(slots.map((sl) => (sl ? { id: sl.rec.player_id, season: sl.rec.season } : null)));
  }, [slots]);

  const selected = useMemo(() => slots.flatMap((s) => (s ? [s.rec] : [])), [slots]);
  const dimensionScores = useMemo(() => lineupScores(selected), [selected]);
  const observations = useMemo(
    () => (dimensionScores ? lineupObservations(selected, dimensionScores) : []),
    [dimensionScores, selected],
  );
  const anyUnavailable = dimensionScores != null && DIMENSIONS.some((d) => dimensionScores[d.key] == null);

  const spots: (CourtSpot | null)[] = slots.map((s) =>
    s ? { playerId: s.rec.player_id, name: s.rec.player, seasonLabel: s.rec.season_label, posGroup: s.rec.pos_group, smallSample: s.rec.small_sample, updating: pendingSeason[s.rec.player_id] != null } : null,
  );
  // The displayed scores always describe the lineup as currently shown. While something is still loading, say so.
  const updatingIds = Object.keys(pendingSeason);
  const staleNote = (() => {
    if (updatingIds.length === 1) {
      const sl = slots.find((x) => x && x.rec.player_id === updatingIds[0]);
      if (sl) return `Updating ${sl.rec.player} to ${seasonLabel(pendingSeason[updatingIds[0]])}. The scores below still use ${seasonLabel(sl.rec.season)}.`;
    }
    if (updatingIds.length > 1) return `Updating ${updatingIds.length} players. The scores below still use their previous seasons.`;
    if (op) {
      const sl = slots[op.slot];
      return sl
        ? `Loading ${op.name}. The scores below still include ${sl.rec.player}.`
        : `Loading ${op.name}. The scores below don\u2019t include them yet.`;
    }
    return null;
  })();
  const movingPlayer = moving != null ? slots[moving] : null;
  const active = openSlot != null ? slots[openSlot] : null;
  const pos = openSlot != null ? POSITIONS[openSlot] : null;
  const pendingFor = active ? pendingSeason[active.rec.player_id] : undefined;

  const buttonClass = "btn btn-secondary min-h-11 px-3 py-2 text-sm";

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-10 md:px-8">
      <h1 className="font-display text-4xl text-ink mb-1">Build a Lineup</h1>
      <p className="mb-6 max-w-2xl text-sm text-stone-light">
        Pick five different players and see what their combined playing style looks like — based on real stats.
        The scores describe style. To estimate wins, use Simulate below the scores.
      </p>

      <div className="mb-4 min-h-5 max-w-2xl text-xs">
        {notice && <p role="alert" className="text-court-orange-bright">{notice}</p>}
      </div>
      {restore === "restoring" && <p role="status" className="mb-4 text-xs text-stone-light">Restoring your saved lineup&hellip;</p>}
      {restore === "failed" && (
        <div role="alert" className="mb-4 flex max-w-2xl flex-wrap items-center gap-3 text-xs text-court-orange-bright">
          <span>Couldn&rsquo;t restore your saved lineup. Check your connection and try again.</span>
          <button type="button" className="btn btn-secondary min-h-11 px-3 py-2 text-sm" onClick={() => void restoreSaved(() => false)}>Try again</button>
          <button type="button" className="btn btn-secondary min-h-11 px-3 py-2 text-sm" onClick={() => { clearSaved(); savingRef.current = true; setRestoreBoth("idle"); }}>Start fresh</button>
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>

      <div className="mb-10 grid gap-6 lg:grid-cols-[minmax(0,640px)_minmax(0,1fr)]">
        <div>
          {movingPlayer && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-court-orange/60 bg-court-orange/10 px-3 py-2 text-sm text-ink-light">
              <span>
                Moving <strong className="font-semibold text-ink">{movingPlayer.rec.player}</strong> ({movingPlayer.rec.season_label}).
                Choose a position, or press Escape.
              </span>
              <button type="button" onClick={() => cancelMove()} className={buttonClass}>Cancel move</button>
            </div>
          )}
          <LineupCourt
            spots={spots}
            activeSlot={openSlot}
            movingSlot={moving}
            loadingSlot={op ? op.slot : null}
            locked={op != null || restore !== "idle"}
            controlsId={panelId}
            onSpotClick={handleSpotClick}
            spotRefs={spotRefs}
          />
          <p className="mt-3 text-xs text-stone-light">{POSITION_NOTE}</p>
          {selected.length > 0 && restore === "idle" && (
            <div className="mt-3">
              {confirmClear ? (
                <div role="group" aria-label="Confirm clear lineup" className="flex flex-wrap items-center gap-2 rounded-lg border border-court-orange/60 bg-court-orange/10 px-3 py-2 text-sm text-ink-light">
                  <span className="mr-auto">Clear {selected.length === 1 ? "the selected player" : `all ${selected.length} selected players`}?</span>
                  <button type="button" onClick={clearLineup} className={`${buttonClass} text-court-orange-bright`}>Yes, clear lineup</button>
                  <button
                    type="button"
                    ref={keepButtonRef}
                    onClick={() => { setConfirmClear(false); requestAnimationFrame(() => clearButtonRef.current?.focus()); }}
                    className={buttonClass}
                  >
                    Keep lineup
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  ref={clearButtonRef}
                  onClick={() => { setConfirmClear(true); requestAnimationFrame(() => keepButtonRef.current?.focus()); }}
                  className={buttonClass}
                >
                  Clear lineup
                </button>
              )}
            </div>
          )}
        </div>

        <div ref={panelRef} id={panelId} className="min-w-0">
          {openSlot != null && pos ? (
            <section ref={controlsRef} tabIndex={-1} aria-label={`Controls for ${pos.code}`} className="rounded-xl border border-line bg-arena-panel p-4">
              {mode === "search" || !active ? (
                <>
                  <p className="text-eyebrow mb-1">{pos.code} &middot; {pos.name}</p>
                  <h2 className="mb-1 font-display text-2xl text-ink">
                    {active ? `Change ${active.rec.player}` : `Add a player to ${pos.code}`}
                  </h2>
                  <p className="mb-3 text-xs text-stone-light">Any player can play any position.</p>
                  <PlayerAutocomplete
                    key={`${openSlot}-${active ? "replace" : "add"}`}
                    onSelect={handlePick}
                    onUnavailable={(name) => setNotice(`No season data found for ${name}.`)}
                    placeholder={active ? "Search for a replacement…" : "Search any player…"}
                    clearOnSelect
                    seasonPool="all"
                    disabled={op != null}
                    autoFocus
                  />
                  <div className="mt-3 min-h-5 text-xs">
                    {op && <p role="status" className="text-stone-light">Loading {op.name}&hellip;{op.kind === "replace" && active ? ` ${active.rec.player} stays until it loads.` : ""}</p>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {op ? (
                      <button type="button" onClick={cancelOp} className={buttonClass}>Cancel loading</button>
                    ) : active ? (
                      <button type="button" onClick={() => setModeBoth("menu")} className={buttonClass}>Back</button>
                    ) : (
                      <button type="button" onClick={() => closePanel()} className={buttonClass}>Cancel</button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-3 flex items-center gap-3">
                    <PlayerPhoto playerId={active.rec.player_id} name={active.rec.player} posGroup={active.rec.pos_group} size={56} />
                    <div className="min-w-0">
                      <p className="text-eyebrow">{pos.code} &middot; {pos.name}</p>
                      <h2 className="truncate font-display text-2xl text-ink">{active.rec.player}</h2>
                      <p className="text-xs text-stone-light">{active.rec.season_label} &middot; {active.rec.team}</p>
                    </div>
                  </div>

                  {active.rec.small_sample && (
                    <div className="mb-3">
                      <span className="inline-block rounded-full border border-court-orange/50 bg-court-orange/10 px-2 py-0.5 text-[11px] font-medium text-court-orange-bright">
                        {SMALL_SAMPLE_LABEL}
                      </span>
                      <p className="mt-1 text-xs text-stone-light">{SMALL_SAMPLE_NOTE}</p>
                    </div>
                  )}
                  {hasMissingLineupStats(active.rec) && <p className="mb-3 text-xs text-stone-light">Some stats unavailable</p>}

                  <label className="mb-1 block text-xs text-stone-light" htmlFor={`${panelId}-season`}>Season</label>
                  <select
                    id={`${panelId}-season`}
                    aria-busy={pendingFor != null}
                    value={pendingFor ?? active.rec.season}
                    onChange={(e) => changeSeason(active.rec.player_id, parseInt(e.target.value, 10))}
                    className="mb-1 min-h-11 w-full rounded-md border border-line-strong bg-arena-panel-strong px-2 py-2 text-base text-ink-light outline-none focus:border-court-orange sm:text-sm"
                  >
                    {active.info.seasons.map((s) => (
                      <option key={s} value={s}>
                        {seasonLabel(s)}
                        {isSmallSampleSeason({ seasons: active.info.seasons, qualified_seasons: active.info.qualified }, s) ? ` · ${SMALL_SAMPLE_LABEL}` : ""}
                      </option>
                    ))}
                  </select>
                  <div className="mb-3 min-h-4 text-[11px] text-stone-light">
                    {pendingFor != null && <p role="status">Updating&hellip;</p>}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setModeBoth("search")} className={buttonClass}>Change player</button>
                    <button type="button" onClick={() => startMove(openSlot)} className={buttonClass}>Move</button>
                    <button type="button" onClick={() => removeSlot(openSlot)} className={`${buttonClass} text-court-orange-bright`}>Remove</button>
                    <button type="button" onClick={() => closePanel()} className={buttonClass}>Close</button>
                  </div>
                </>
              )}
            </section>
          ) : (
            <div className="rounded-xl border border-dashed border-line p-4 text-sm text-stone-light">
              <p className="font-medium text-ink-light">Click a position to get started.</p>
              <p className="mt-1">
                Click an empty spot to add a player. Click a player to change them, switch their season, move them or remove them.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Lineup identity card */}
      {dimensionScores && (
        <div className="rounded-2xl border border-court-orange/30 bg-gradient-to-br from-arena-panel to-arena-panel-strong p-8">
          <p className="text-eyebrow mb-1">Lineup Identity Card</p>
          <h2 className="font-display text-3xl text-ink mb-6">
            {selected.length === 5 ? "Full Five" : `${selected.length} of 5 Selected`}
          </h2>

          {staleNote && <p role="status" className="mb-4 text-xs font-medium text-court-orange-bright">{staleNote}</p>}
          <div aria-busy={staleNote != null} className={`grid grid-cols-1 gap-5 transition-opacity sm:grid-cols-2 ${staleNote ? "opacity-60" : ""}`}>
            {DIMENSIONS.map((dim) => {
              const raw = dimensionScores[dim.key];
              const v = raw == null ? null : Math.max(0, Math.min(100, raw));
              return (
                <div key={dim.key}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-stone">{dim.label}</span>
                    <span className="tabular font-semibold text-ink-light">{v == null ? "Unavailable" : Math.round(v)}</span>
                  </div>
                  {dim.note && <p className="mb-1 text-[11px] text-stone-light">{dim.note}</p>}
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

          <p className="mt-5 text-xs">
            <Link href="/methodology#lineup-scores" className="font-medium text-court-orange-bright hover:underline">
              How this is calculated
            </Link>
          </p>

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
            These scores describe the combined playing style of the selected players. They are not used to predict wins;
            Simulate below uses a separate model.
          </p>
        </div>
      )}

      <SimulatePanel
        lineup={slots.flatMap((x) => (x ? [{ id: x.rec.player_id, name: x.rec.player, season: x.rec.season }] : []))}
        busyNote={staleNote}
      />
    </div>
  );
}
