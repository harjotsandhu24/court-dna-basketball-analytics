"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import PlayerPhoto from "@/components/PlayerPhoto";
import CourtPrint from "@/components/CourtPrint";
import ShotDna from "@/components/ShotDna";
import PlayerAutocomplete, { type PlayerAutocompleteSelection } from "@/components/PlayerAutocomplete";
import { findPlayerSeason } from "@/lib/dataLoader";
import { similarityIndex } from "@/lib/similarity";
import { explainMatch } from "@/lib/explain";
import { TRAIT_DIMENSIONS } from "@/lib/config";
import { DIMENSION_DISPLAY_LABEL } from "@/lib/courtPrint";
import type { PlayerSeasonRecord } from "@/lib/types";
import { fmt1 } from "@/lib/format";

function parseSlug(slug: string | null): { id: string; season: number } | null {
  if (!slug) return null;
  const idx = slug.lastIndexOf("_");
  if (idx === -1) return null;
  const id = slug.slice(0, idx);
  const season = parseInt(slug.slice(idx + 1), 10);
  if (!id || Number.isNaN(season)) return null;
  return { id, season };
}

function ComparePageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const aSlug = params.get("a");
  const bSlug = params.get("b");

  const [a, setA] = useState<PlayerSeasonRecord | null>(null);
  const [b, setB] = useState<PlayerSeasonRecord | null>(null);

  useEffect(() => {
    const pa = parseSlug(aSlug);
    if (pa) {
      findPlayerSeason(pa.id, pa.season).then(setA);
    } else {
      // synchronous reset when the URL has no valid slug (not a stale
      // fetch response) -- intentional, not a data race
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setA(null);
    }
  }, [aSlug]);

  useEffect(() => {
    const pb = parseSlug(bSlug);
    if (pb) {
      findPlayerSeason(pb.id, pb.season).then(setB);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setB(null);
    }
  }, [bSlug]);

  if (!a || !b) {
    // An explicit Player 1 -> Player 2 -> Compare flow -- the previous
    // empty state used the generic site search here, which navigated
    // straight to a Player Profile page on selection (a real, misleading
    // bug: "comparing" someone just took you to their solo profile with
    // no second slot filled). aSlug present but `a` not yet resolved just
    // means the fetch for it is in flight; both of those only count as
    // "already have a first pick" once the slug itself is set.
    const haveFirst = !!aSlug;
    const pickedFirstId = haveFirst ? parseSlug(aSlug)?.id : null;

    function pickFirst(sel: PlayerAutocompleteSelection) {
      router.push(`/compare?a=${sel.id}_${sel.season}`);
    }
    function pickSecond(sel: PlayerAutocompleteSelection) {
      router.push(`/compare?a=${aSlug}&b=${sel.id}_${sel.season}`);
    }

    return (
      <div className="mx-auto max-w-2xl px-5 py-20 md:px-8">
        <h1 className="font-display text-4xl text-ink mb-2 text-center">Compare Players</h1>
        <p className="mb-8 text-center text-stone">Pick two players to compare side by side.</p>

        <div className="flex flex-col gap-5">
          <div>
            <p className="text-eyebrow mb-2">
              {haveFirst ? "Player 1" : "Player 1 — search to choose"}
            </p>
            {haveFirst ? (
              <div className="flex items-center justify-between rounded-md border border-line-strong bg-arena-panel px-4 py-3">
                <span className="text-sm font-medium text-ink-light">
                  {a ? `${a.player} · ${a.season_label}` : pickedFirstId ?? "Loading…"}
                </span>
                <button
                  type="button"
                  onClick={() => router.push("/compare")}
                  className="tap-target-44 text-xs text-stone-light hover:text-court-orange-bright"
                >
                  Change
                </button>
              </div>
            ) : (
              <PlayerAutocomplete onSelect={pickFirst} placeholder="Search for the first player…" autoFocus />
            )}
          </div>

          {haveFirst && (
            <div>
              <p className="text-eyebrow mb-2">Player 2 — search to choose</p>
              <PlayerAutocomplete onSelect={pickSecond} placeholder="Search for the second player…" autoFocus />
            </div>
          )}

          <p className="text-xs text-stone-light">
            Tip: open any player&rsquo;s Similar Players list and click a card to jump straight into a comparison.
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
        <button onClick={swap} className="btn btn-secondary self-start px-4 py-2 text-sm sm:self-auto">Swap sides ⇄</button>
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
            const av = Math.max(0, Math.min(100, a.traits[dim] ?? 0));
            const bv = Math.max(0, Math.min(100, b.traits[dim] ?? 0));
            return (
              <div key={dim}>
                <div className="mb-1 flex items-center justify-between text-xs text-stone">
                  <span className="tabular">{Math.round(av)}</span>
                  <span>{DIMENSION_DISPLAY_LABEL[dim]}</span>
                  <span className="tabular">{Math.round(bv)}</span>
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
        <ShotDna data={a.shot_dna} />
        <ShotDna data={b.shot_dna} />
      </div>

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
