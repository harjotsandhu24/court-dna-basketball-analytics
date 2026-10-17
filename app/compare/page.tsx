"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import PlayerPhoto from "@/components/PlayerPhoto";
import CourtPrint from "@/components/CourtPrint";
import ShotDna from "@/components/ShotDna";
import LimitationsNote from "@/components/LimitationsNote";
import PlayerAutocomplete, { type PlayerAutocompleteSelection } from "@/components/PlayerAutocomplete";
import { findPlayerSeason, loadPlayersIndex } from "@/lib/dataLoader";
import { SMALL_SAMPLE_LABEL } from "@/lib/lineup";
import { isSamePlayerSeason, parsePlayerSeasonKey, playerSeasonKey, similarityIndex } from "@/lib/similarity";
import { explainMatch } from "@/lib/explain";
import { TRAIT_DIMENSIONS, seasonLabel } from "@/lib/config";
import { DIMENSION_DISPLAY_LABEL } from "@/lib/courtPrint";
import type { PlayerSeasonRecord } from "@/lib/types";
import { fmt1 } from "@/lib/format";
import StatusPanel from "@/components/StatusPanel";
import { useLoad } from "@/lib/useLoad";
import { DataError, type LoadState } from "@/lib/loadState";

const SELECT_CLASS =
  "rounded-md border border-line-strong bg-arena-panel px-3 py-2 text-base text-ink-light outline-none focus:border-court-orange sm:text-sm";

/** One comparison slot's search. Picking a player lets the user confirm the
 * exact season (defaulting to the season search resolves to) before it is
 * used; a player with a single season is used immediately. The same
 * player-season as `blockedKey` is never accepted. */
function SlotPicker({
  placeholder,
  confirmLabel,
  blockedKey,
  onConfirm,
}: {
  placeholder: string;
  confirmLabel: string;
  blockedKey?: string;
  onConfirm: (id: string, season: number) => void;
}) {
  const [pick, setPick] = useState<{ id: string; name: string; seasons: number[]; qualified: number[] } | null>(null);
  const [season, setSeason] = useState(0);
  const [message, setMessage] = useState("");

  function commit(id: string, s: number) {
    if (blockedKey === playerSeasonKey(id, s)) {
      setMessage("That is the same player-season as Player 1. Choose a different season or player.");
      return;
    }
    setMessage("");
    onConfirm(id, s);
  }

  function handleSelect(sel: PlayerAutocompleteSelection) {
    loadPlayersIndex()
      .then((idx) => {
        const seasons = idx[sel.id]?.seasons ?? [sel.season];
        if (seasons.length <= 1) {
          commit(sel.id, sel.season);
          return;
        }
        setPick({ id: sel.id, name: sel.name, seasons, qualified: idx[sel.id]?.qualified_seasons ?? [] });
        setSeason(sel.season);
        setMessage("");
      })
      .catch(() => commit(sel.id, sel.season));
  }

  return (
    <div>
      {pick ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-line-strong bg-arena-panel px-4 py-3">
          <span className="mr-auto text-sm font-medium text-ink-light">{pick.name}</span>
          <select
            aria-label={`Season for ${pick.name}`}
            value={season}
            onChange={(e) => setSeason(parseInt(e.target.value, 10))}
            className={SELECT_CLASS}
          >
            {[...pick.seasons].reverse().map((s) => (
              <option key={s} value={s} disabled={blockedKey === playerSeasonKey(pick.id, s)}>
                {seasonLabel(s)}{pick.qualified.includes(s) ? "" : ` (${SMALL_SAMPLE_LABEL.toLowerCase()})`}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => commit(pick.id, season)} className="btn btn-primary min-h-11 px-4 py-2 text-sm">
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              setPick(null);
              setMessage("");
            }}
            className="tap-target-44 text-xs text-stone-light hover:text-court-orange-bright"
          >
            Change
          </button>
        </div>
      ) : (
        <PlayerAutocomplete onSelect={handleSelect} seasonPool="all" label={placeholder} placeholder={placeholder} autoFocus />
      )}
      {message && (
        <p role="status" className="mt-2 text-sm text-court-orange-bright">
          {message}
        </p>
      )}
    </div>
  );
}

/** One side of the comparison, loaded on its own so a failure on one side never takes the other down. */
function useSide(slug: string | null) {
  const parsed = parsePlayerSeasonKey(slug);
  const [state, retry] = useLoad<PlayerSeasonRecord>(parsed ? `compare/${slug}` : null, async () => {
    const rec = await findPlayerSeason(parsed!.id, parsed!.season);
    if (!rec) throw new DataError("That player-season isn't in the dataset.", "not-found");
    return rec;
  });
  return { parsed, state, retry };
}

type Side = { parsed: { id: string; season: number } | null; state: LoadState<PlayerSeasonRecord>; retry: () => void };

function SlotView({
  label,
  slug,
  side,
  invalidMessage,
  blockedKey,
  placeholder,
  confirmLabel,
  onPick,
  onClear,
}: {
  label: string;
  slug: string | null;
  side: Side;
  invalidMessage: string;
  blockedKey?: string;
  placeholder: string;
  confirmLabel: string;
  onPick: (id: string, season: number) => void;
  onClear: () => void;
}) {
  const { parsed, state, retry } = side;
  const testId = label === "Player 1" ? "compare-slot-a" : "compare-slot-b";
  if (slug && !parsed) {
    return (
      <div data-testid={testId}>
        <p className="text-eyebrow mb-2">{label}</p>
        <StatusPanel inline tone="invalid" title={invalidMessage} message="Search below to choose a player." testId={`${testId}-invalid`} />
        <div className="mt-3"><SlotPicker placeholder={placeholder} confirmLabel={confirmLabel} blockedKey={blockedKey} onConfirm={onPick} /></div>
      </div>
    );
  }
  if (parsed && state.status === "ready") {
    return (
      <div data-testid={testId}>
        <p className="text-eyebrow mb-2">{label}</p>
        <div className="flex items-center justify-between rounded-md border border-line-strong bg-arena-panel px-4 py-3">
          <span className="text-sm font-medium text-ink-light">{state.data.player} · {state.data.season_label}</span>
          <button type="button" onClick={onClear} className="tap-target-44 text-xs text-stone-light hover:text-court-orange-bright">Change</button>
        </div>
      </div>
    );
  }
  if (parsed && state.status === "loading") {
    return (
      <div data-testid={testId}>
        <p className="text-eyebrow mb-2">{label}</p>
        <div className="h-[54px] animate-pulse rounded-md border border-line bg-arena-panel" role="status" aria-label={`Loading ${label}`} />
      </div>
    );
  }
  if (parsed && state.status === "error") {
    return (
      <div data-testid={testId}>
        <p className="text-eyebrow mb-2">{label}</p>
        <StatusPanel inline tone="error" title={`Couldn't load ${label.toLowerCase()}.`} message="Check your connection and retry." onRetry={retry} testId={`${testId}-error`}
          actions={<button type="button" onClick={onClear} className="tap-target-44 text-xs text-stone-light hover:text-court-orange-bright">Choose another</button>} />
      </div>
    );
  }
  return (
    <div data-testid={testId}>
      <p className="text-eyebrow mb-2">{label} — search to choose</p>
      {parsed && state.status === "notfound" && (
        <div className="mb-3"><StatusPanel inline tone="notfound" title={`That ${label.toLowerCase()} isn't available.`} message="Choose a different player or season." testId={`${testId}-notfound`} /></div>
      )}
      <SlotPicker placeholder={placeholder} confirmLabel={confirmLabel} blockedKey={blockedKey} onConfirm={onPick} />
    </div>
  );
}

function CompareSkeleton() {
  return (
    <div className="mx-auto max-w-[1400px] px-5 py-10 md:px-8" data-testid="compare-loading" role="status" aria-label="Loading comparison">
      <div className="mb-8 h-10 w-64 animate-pulse rounded bg-arena-panel" />
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div className="h-28 animate-pulse rounded-lg bg-arena-panel" />
        <div className="mx-auto h-28 w-28 animate-pulse rounded-full bg-arena-panel" />
        <div className="h-28 animate-pulse rounded-lg bg-arena-panel" />
      </div>
      <div className="mt-10 grid grid-cols-1 gap-6 border-t border-line pt-10 lg:grid-cols-2">
        <div className="mx-auto h-[300px] w-full max-w-[300px] animate-pulse rounded-lg bg-arena-panel" />
        <div className="mx-auto h-[300px] w-full max-w-[300px] animate-pulse rounded-lg bg-arena-panel" />
      </div>
      <div className="mt-10 h-72 animate-pulse rounded-lg bg-arena-panel" />
    </div>
  );
}

function ComparePageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const aSlug = params.get("a");
  const bSlug = params.get("b");
  const sideA = useSide(aSlug);
  const sideB = useSide(bSlug);
  const pa = sideA.parsed;
  const pb = sideB.parsed;
  const duplicate = !!(pa && pb && isSamePlayerSeason(pa, pb));
  const a = sideA.state.status === "ready" ? sideA.state.data : null;
  const b = sideB.state.status === "ready" ? sideB.state.data : null;

  if (!a || !b || duplicate) {
    const bothLoading = !duplicate && pa && pb && [sideA.state.status, sideB.state.status].every((x) => x === "loading" || x === "ready");
    if (bothLoading) return <CompareSkeleton />;

    // The valid side is kept in the link whichever side is replaced.
    const keepA = pa && sideA.state.status === "ready" ? aSlug : null;
    const keepB = pb && sideB.state.status === "ready" && !duplicate ? bSlug : null;
    const go = (na: string | null, nb: string | null) => {
      const q = [na ? `a=${na}` : null, nb ? `b=${nb}` : null].filter(Boolean).join("&");
      router.push(q ? `/compare?${q}` : "/compare");
    };
    const effB: Side = duplicate ? { ...sideB, parsed: null } : sideB;

    return (
      <div className="mx-auto max-w-2xl px-5 py-20 md:px-8">
        <h1 className="font-display text-4xl text-ink mb-2 text-center">Compare Players</h1>
        <p className="mb-8 text-center text-stone">Pick two player-seasons to compare side by side.</p>

        {duplicate && (
          <p role="status" className="mb-5 rounded-md border border-line-strong bg-arena-panel px-4 py-3 text-sm text-ink-light">
            Player 2 is the same player-season as Player 1. Choose a different season or player.
          </p>
        )}

        <div className="flex flex-col gap-5">
          <SlotView
            label="Player 1"
            slug={aSlug}
            side={sideA}
            invalidMessage="The first player-season in that link isn't valid."
            blockedKey={keepB ?? undefined}
            placeholder="Search for the first player…"
            confirmLabel={keepB ? "Compare" : "Select"}
            onPick={(id, season) => go(playerSeasonKey(id, season), keepB)}
            onClear={() => go(null, keepB)}
          />
          <SlotView
            label="Player 2"
            slug={duplicate ? null : bSlug}
            side={effB}
            invalidMessage="The second player-season in that link isn't valid."
            blockedKey={keepA ?? undefined}
            placeholder="Search for the second player…"
            confirmLabel="Compare"
            onPick={(id, season) => go(keepA ?? aSlug, playerSeasonKey(id, season))}
            onClear={() => go(keepA, null)}
          />
          <p className="text-xs text-stone-light">
            Small-sample seasons are included and labelled. Tip: open any player&rsquo;s Similar Players list and click a card to jump straight into a comparison.
          </p>
        </div>
      </div>
    );
  }

  const sim = similarityIndex(a.vector, b.vector);
  const { similarities, differences } = explainMatch(a.player, a.vector, b.player, b.vector);

  function swap() {
    router.push(`/compare?a=${bSlug}&b=${aSlug}`);
  }

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-10 md:px-8">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-4xl text-ink">Compare Players</h1>
        <button onClick={swap} className="btn btn-secondary min-h-11 self-start px-4 py-2 text-sm sm:self-auto">Swap sides ⇄</button>
      </div>

      {/* Split header */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <PlayerHeader record={a} align="left" />
        <div className="flex flex-col items-center justify-center py-4">
          <span className="font-display text-2xl text-stone">VS</span>
          <div className="mt-3 rounded-full border border-court-orange/40 bg-court-orange/10 px-4 py-2 text-center">
            <div className="font-display text-3xl text-court-orange-bright tabular">{Math.round(sim)}</div>
            <div className="text-[10px] uppercase tracking-wide text-stone-light">Style Match</div>
          </div>
          <p className="mt-2 max-w-[180px] text-center text-[11px] text-stone-light">
            Higher scores mean the two players had more similar playing styles.
          </p>
        </div>
        <PlayerHeader record={b} align="right" />
      </div>

      {/* Court Prints */}
      <div className="mt-10 grid grid-cols-1 gap-6 border-t border-line pt-10 lg:grid-cols-2">
        <div className="flex justify-center"><CourtPrint traits={a.traits} posGroup={a.pos_group} archetype={a.archetype} size={200} showLegend /></div>
        <div className="flex justify-center"><CourtPrint traits={b.traits} posGroup={b.pos_group} archetype={b.archetype} size={200} showLegend /></div>
      </div>

      {/* Trait comparison bars */}
      <div className="mt-10 border-t border-line pt-10">
        <h2 className="font-display text-2xl text-ink mb-6">Trait Comparison</h2>
        <div className="flex flex-col gap-4">
          {TRAIT_DIMENSIONS.map((dim) => {
            const aRaw = a.traits[dim];
            const bRaw = b.traits[dim];
            const av = aRaw == null ? 0 : Math.max(0, Math.min(100, aRaw));
            const bv = bRaw == null ? 0 : Math.max(0, Math.min(100, bRaw));
            return (
              <div key={dim}>
                <div className="mb-1 flex items-center justify-between text-xs text-stone">
                  <span className="tabular">{aRaw == null ? "Unavailable" : Math.round(av)}</span>
                  <span>{DIMENSION_DISPLAY_LABEL[dim]}</span>
                  <span className="tabular">{bRaw == null ? "Unavailable" : Math.round(bv)}</span>
                </div>
                <div className="flex h-2.5 w-full gap-0.5">
                  <div className="flex flex-1 justify-end overflow-hidden rounded-l-full bg-arena-panel-strong">
                    <motion.div
                      className="h-full bg-guard-accent"
                      initial={{ width: 0 }}
                      animate={{ width: `${av}%` }}
                      transition={{ duration: 0.6 }}
                    />
                  </div>
                  <div className="flex-1 overflow-hidden rounded-r-full bg-arena-panel-strong">
                    <motion.div
                      className="h-full bg-big-accent"
                      initial={{ width: 0 }}
                      animate={{ width: `${bv}%` }}
                      transition={{ duration: 0.6 }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Shot DNA comparison */}
      <div className="mt-10 grid grid-cols-1 gap-8 border-t border-line pt-10 lg:grid-cols-2">
        <ShotDna data={a.shot_dna} season={a.season} playerId={a.player_id} />
        <ShotDna data={b.shot_dna} season={b.season} playerId={b.player_id} />
      </div>

      <LimitationsNote className="mt-6" />

      {/* Similarities / differences */}
      <div className="mt-10 grid grid-cols-1 gap-8 border-t border-line pt-10 sm:grid-cols-2">
        <div>
          <h3 className="font-display text-xl text-ink mb-3">Where they match</h3>
          <ul className="flex flex-col gap-2 text-sm text-ink-light">
            {similarities.map((s, i) => <li key={i} className="rounded-lg bg-arena-panel px-3 py-2">✓ {s}</li>)}
          </ul>
        </div>
        <div>
          <h3 className="font-display text-xl text-ink mb-3">Where they separate</h3>
          <ul className="flex flex-col gap-2 text-sm text-ink-light">
            {differences.map((d, i) => <li key={i} className="rounded-lg bg-arena-panel px-3 py-2">↔ {d}</li>)}
          </ul>
        </div>
      </div>

      {/* Raw stats table */}
      <div className="mt-10 border-t border-line pt-10">
        <h3 className="font-display text-xl text-ink mb-4">Basic Stats</h3>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div />
          <div className="text-center font-semibold text-ink-light">{a.player}</div>
          <div className="text-center font-semibold text-ink-light">{b.player}</div>
          {(["pts", "trb", "ast", "stl", "blk"] as const).map((k) => (
            <RowStat key={k} label={k.toUpperCase()} a={a.basic[k]} b={b.basic[k]} />
          ))}
        </div>
      </div>
    </div>
  );
}

function RowStat({ label, a, b }: { label: string; a: number | null; b: number | null }) {
  return (
    <>
      <div className="text-stone-light">{label}</div>
      <div className="tabular text-center text-ink-light">{fmt1(a)}</div>
      <div className="tabular text-center text-ink-light">{fmt1(b)}</div>
    </>
  );
}

function PlayerHeader({ record, align }: { record: PlayerSeasonRecord; align: "left" | "right" }) {
  // Centered when the grid is stacked to one column on mobile; only
  // actually left/right-aligned once the sm:+ three-column split layout
  // kicks in (see the grid className below) -- previously these stayed
  // left/right-aligned even while stacked, which read oddly on phones.
  const alignClasses =
    align === "right"
      ? "items-center text-center sm:items-end sm:text-right"
      : "items-center text-center sm:items-start sm:text-left";
  return (
    <div className={`flex flex-col ${alignClasses} gap-2`}>
      <PlayerPhoto playerId={record.player_id} name={record.player} posGroup={record.pos_group} size={88} />
      <h2 className="font-display text-3xl leading-none text-ink">{record.player}</h2>
      <p className="text-sm text-stone">{record.season_label} · {record.team} · {record.pos}</p>
      <p className="rounded-full border border-line-strong px-2.5 py-1 text-xs font-medium text-ink-light">{record.archetype}</p>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1400px] px-5 py-20 md:px-8 text-stone">Loading…</div>}>
      <ComparePageInner />
    </Suspense>
  );
}
