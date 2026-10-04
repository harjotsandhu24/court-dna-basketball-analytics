"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import PlayerPhoto from "@/components/PlayerPhoto";
import CourtPrint from "@/components/CourtPrint";
import { loadCareer } from "@/lib/dataLoader";
import type { PlayerSeasonRecord } from "@/lib/types";
import { fmt1 } from "@/lib/format";
import { TRAIT_DIMENSIONS, seasonLabel } from "@/lib/config";
import { useAsync } from "@/lib/useAsync";
import HScroll from "@/components/HScroll";
import { DIMENSION_DISPLAY_LABEL } from "@/lib/courtPrint";

const CALLOUT_THRESHOLD = 15; // percentile points

function generateCallouts(seasons: PlayerSeasonRecord[]): string[] {
  if (seasons.length < 2) return [];
  const first = seasons[0];
  const last = seasons[seasons.length - 1];
  const deltas = TRAIT_DIMENSIONS.map((dim) => {
    const a = first.traits[dim] ?? 0;
    const b = last.traits[dim] ?? 0;
    return { dim, delta: b - a };
  }).filter((d) => Math.abs(d.delta) >= CALLOUT_THRESHOLD);
  deltas.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  return deltas.slice(0, 4).map((d) => {
    const dir = d.delta > 0 ? "increased" : "decreased";
    return `${DIMENSION_DISPLAY_LABEL[d.dim]} ${dir} by ${Math.abs(Math.round(d.delta))} points from ${seasonLabel(first.season)} to ${seasonLabel(last.season)}`;
  });
}

export default function CareerPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = use(params);
  // Keyed by player so another player's career is never shown under this
  // route; Retry genuinely refetches (failures are never cached).
  const careerState = useAsync<PlayerSeasonRecord[]>(`career-${playerId}`, () => loadCareer(playerId));
  const seasons = careerState.status === "ready" ? careerState.data ?? [] : null;
  // The chosen season belongs to one player; a different player starts on
  // their latest season.
  const [choice, setChoice] = useState<{ playerId: string; season: number } | null>(null);
  const chosenSeason = choice && choice.playerId === playerId ? choice.season : null;
  const foundIdx = seasons ? seasons.findIndex((s) => s.season === chosenSeason) : -1;
  const activeIdx = seasons && seasons.length > 0 ? (foundIdx >= 0 ? foundIdx : seasons.length - 1) : 0;
  const activeSeasonYear = seasons && seasons.length > 0 ? seasons[activeIdx].season : null;

  // Keep the active season visible in the horizontal timeline.
  useEffect(() => {
    if (activeSeasonYear == null) return;
    document.getElementById(`career-tab-${activeSeasonYear}`)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [activeSeasonYear]);

  function setActiveIdx(i: number) {
    if (seasons) setChoice({ playerId, season: seasons[i].season });
  }

  if (careerState.status === "error") {
    return (
      <div className="mx-auto max-w-[1400px] px-5 py-20 text-center md:px-8">
        <p className="font-display text-3xl text-ink">Couldn&rsquo;t load this career</p>
        <p className="mt-2 text-stone">Check your connection and try again.</p>
        <button type="button" onClick={careerState.retry} className="btn btn-primary mt-6 min-h-11 px-5 py-2.5">Retry</button>
      </div>
    );
  }
  if (!seasons) {
    return <div role="status" className="mx-auto max-w-[1400px] px-5 py-20 text-stone md:px-8">Loading career…</div>;
  }
  if (seasons.length === 0) {
    return <div className="mx-auto max-w-[1400px] px-5 py-20 text-stone md:px-8">No career data found for this player.</div>;
  }

  const active = seasons[activeIdx];
  const callouts = generateCallouts(seasons);

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-10 md:px-8">
      <div className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-3">
        <PlayerPhoto playerId={playerId} name={active.player} posGroup={active.pos_group} size={72} />
        <div className="min-w-0">
          <p className="text-eyebrow text-court-orange-bright">Career Over Time</p>
          <h1 className="font-display break-words text-4xl leading-none text-ink">{active.player}</h1>
          <p className="mt-1 text-sm text-stone">{seasonLabel(seasons[0].season)} to {seasonLabel(seasons[seasons.length - 1].season)}</p>
          <p className="mt-1 text-sm text-stone">See how the player&rsquo;s role and style changed from season to season.</p>
        </div>
        <Link href={`/player/${playerId}/${active.season}`} className="btn btn-secondary min-h-11 px-4 py-2 text-sm sm:ml-auto">
          View {seasonLabel(active.season)} Player Profile →
        </Link>
      </div>

      {/* Timeline */}
      <div className="mb-8">
        <HScroll label="Seasons" hint="Swipe sideways for more seasons →">
          <div className="flex min-w-max gap-1.5 border-b border-line pb-3">
            {seasons.map((s, i) => (
              <button
                key={s.season}
                id={`career-tab-${s.season}`}
                type="button"
                onClick={() => setActiveIdx(i)}
                aria-pressed={i === activeIdx}
                className={`min-h-11 rounded-md px-3.5 text-sm font-medium tabular transition-colors ${
                  i === activeIdx ? "bg-court-orange text-[#14100a]" : "bg-arena-panel text-stone hover:text-ink-light"
                }`}
              >
                {seasonLabel(s.season)}
                {s.small_sample && <span className="ml-1 text-xs font-normal">· small sample</span>}
              </button>
            ))}
          </div>
        </HScroll>
      </div>

      {/* Objective callouts */}
      {callouts.length > 0 && (
        <div className="mb-10 rounded-xl bg-arena-panel p-5">
          <h2 className="font-display text-xl text-ink mb-3">What changed</h2>
          <ul className="flex flex-col gap-1.5 text-sm text-ink-light">
            {callouts.map((c, i) => <li key={i}>• {c}</li>)}
          </ul>
          <p className="mt-3 text-sm text-stone">
            These changes come directly from the player&rsquo;s statistics. They show what changed, not why it
            changed.
          </p>
        </div>
      )}

      {/* Court Print evolution strip */}
      <div className="mb-10">
        <h2 className="font-display text-xl text-ink mb-4">Playing Style Over Time</h2>
        <HScroll label="Playing style by season" hint="Swipe sideways for more seasons →">
          <div className="flex gap-4 pb-2">
            {seasons.map((s, i) => (
              <button
                key={s.season}
                type="button"
                onClick={() => setActiveIdx(i)}
                aria-pressed={i === activeIdx}
                aria-label={`${seasonLabel(s.season)}, ${s.archetype}`}
                className="flex min-h-11 shrink-0 flex-col items-center rounded-md px-1 text-center"
              >
                <CourtPrint traits={s.traits} posGroup={s.pos_group} archetype={s.archetype} size={i === activeIdx ? 130 : 90} animate={false} />
                <span className={`mt-1 text-sm tabular ${i === activeIdx ? "font-semibold text-court-orange-bright" : "text-stone"}`}>{seasonLabel(s.season)}</span>
              </button>
            ))}
          </div>
        </HScroll>
      </div>

      {/* Active season detail */}
      <div className="grid grid-cols-1 gap-8 border-t border-line pt-10 lg:grid-cols-[220px_1fr]">
        <CourtPrint traits={active.traits} posGroup={active.pos_group} archetype={active.archetype} size={200} showLegend />
        <div>
          <p className="font-display text-2xl text-ink">{seasonLabel(active.season)}: {active.archetype}</p>
          <p className="mt-1 text-sm text-stone">{active.team} · {active.pos} · Age {active.age ?? "—"}</p>
          <div className="mt-4 grid grid-cols-3 gap-4 sm:grid-cols-6">
            <Stat label="PPG" value={fmt1(active.basic.pts)} />
            <Stat label="RPG" value={fmt1(active.basic.trb)} />
            <Stat label="APG" value={fmt1(active.basic.ast)} />
            <Stat label="SPG" value={fmt1(active.basic.stl)} />
            <Stat label="BPG" value={fmt1(active.basic.blk)} />
            <Stat label="Min" value={active.mp?.toString() ?? "—"} />
          </div>
        </div>
      </div>

      {/* Season-by-season table */}
      <div className="mt-10 border-t border-line pt-10">
        <h2 className="font-display text-xl text-ink mb-4">Season-by-Season</h2>
        <HScroll label="Season-by-season table" hint="Swipe sideways for more columns →">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-stone-light">
                {/* Season stays sticky to the left edge while the rest of
                    the row scrolls, so the row you're looking at never
                    loses its own identifying label off-screen. */}
                <th className="sticky left-0 z-10 bg-arena-bg py-2 pr-4 font-medium">Season</th>
                <th className="py-2 pr-4 font-medium">Team</th>
                <th className="py-2 pr-4 font-medium">Archetype</th>
                <th className="py-2 pr-4 font-medium text-right">PTS</th>
                <th className="py-2 pr-4 font-medium text-right">REB</th>
                <th className="py-2 pr-4 font-medium text-right">AST</th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((s, i) => (
                <tr key={s.season} className={`border-b border-line/50 ${i === activeIdx ? "bg-arena-panel" : ""}`}>
                  <td className={`sticky left-0 z-10 py-2 pr-4 tabular text-ink-light ${i === activeIdx ? "bg-arena-panel" : "bg-arena-bg"}`}>{seasonLabel(s.season)}</td>
                  <td className="py-2 pr-4 text-stone">{s.team}</td>
                  <td className="py-2 pr-4 text-stone">{s.archetype}</td>
                  <td className="py-2 pr-4 text-right tabular text-ink-light">{fmt1(s.basic.pts)}</td>
                  <td className="py-2 pr-4 text-right tabular text-ink-light">{fmt1(s.basic.trb)}</td>
                  <td className="py-2 pr-4 text-right tabular text-ink-light">{fmt1(s.basic.ast)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScroll>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-eyebrow">{label}</p>
      <p className="tabular font-display text-xl text-ink-light">{value}</p>
    </div>
  );
}
