"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import PlayerPhoto from "@/components/PlayerPhoto";
import CourtPrint from "@/components/CourtPrint";
import { loadCareer } from "@/lib/dataLoader";
import type { PlayerSeasonRecord } from "@/lib/types";
import { fmt1 } from "@/lib/format";
import { TRAIT_DIMENSIONS } from "@/lib/config";

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
    return `${d.dim} ${dir} ${Math.abs(Math.round(d.delta))} percentile points from ${first.season_label} to ${last.season_label}`;
  });
}

export default function CareerPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = use(params);
  const [seasons, setSeasons] = useState<PlayerSeasonRecord[] | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    loadCareer(playerId).then((s) => {
      setSeasons(s);
      setActiveIdx(s.length - 1);
    });
  }, [playerId]);

  if (!seasons) {
    return <div className="mx-auto max-w-[1400px] px-5 py-20 md:px-8 text-stone">Loading…</div>;
  }
  if (seasons.length === 0) {
    return <div className="mx-auto max-w-[1400px] px-5 py-20 md:px-8 text-stone">No career data found.</div>;
  }

  const active = seasons[activeIdx];
  const callouts = generateCallouts(seasons);

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-10 md:px-8">
      <div className="mb-8 flex items-center gap-4">
        <PlayerPhoto playerId={playerId} name={active.player} posGroup={active.pos_group} size={72} />
        <div>
          <h1 className="font-display text-4xl text-ink leading-none">{active.player}</h1>
          <p className="mt-1 text-sm text-stone">Career Evolution · {seasons[0].season_label} – {seasons[seasons.length - 1].season_label}</p>
        </div>
        <Link href={`/player/${playerId}/${active.season}`} className="btn btn-secondary ml-auto px-4 py-2 text-sm">
          Open {active.season_label} Player DNA →
        </Link>
      </div>

      {/* Timeline */}
      <div className="mb-8 overflow-x-auto">
        <div className="flex min-w-max gap-1.5 border-b border-line pb-3">
          {seasons.map((s, i) => (
            <button
              key={s.season}
              onClick={() => setActiveIdx(i)}
              className={`rounded-md px-3 py-2 text-xs font-medium tabular transition-colors ${
                i === activeIdx ? "bg-court-orange text-[#14100a]" : "bg-arena-panel text-stone hover:text-ink-light"
              } ${s.small_sample ? "opacity-60" : ""}`}
              title={s.small_sample ? "Small sample season" : undefined}
            >
              {s.season_label}
            </button>
          ))}
        </div>
      </div>

      {/* Objective callouts */}
      {callouts.length > 0 && (
        <div className="mb-10 rounded-xl bg-arena-panel p-5">
          <h2 className="font-display text-xl text-ink mb-3">What changed, statistically</h2>
          <ul className="flex flex-col gap-1.5 text-sm text-ink-light">
            {callouts.map((c, i) => <li key={i}>• {c}</li>)}
          </ul>
          <p className="mt-3 text-xs text-stone-light">
            Objective, numbers-only observations comparing {seasons[0].season_label} to {seasons[seasons.length - 1].season_label}.
            No cause (role change, injury, coaching, etc.) is claimed or implied — only what the statistics show.
          </p>
        </div>
      )}

      {/* Court Print evolution strip */}
      <div className="mb-10">
        <h2 className="font-display text-xl text-ink mb-4">Court Print Evolution</h2>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {seasons.map((s, i) => (
            <button key={s.season} onClick={() => setActiveIdx(i)} className="shrink-0 text-center">
              <CourtPrint traits={s.traits} posGroup={s.pos_group} archetype={s.archetype} size={i === activeIdx ? 130 : 90} animate={false} />
              <p className={`mt-1 text-xs tabular ${i === activeIdx ? "text-court-orange-bright font-semibold" : "text-stone-light"}`}>{s.season_label}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Active season detail */}
      <div className="grid grid-cols-1 gap-8 border-t border-line pt-10 lg:grid-cols-[220px_1fr]">
        <CourtPrint traits={active.traits} posGroup={active.pos_group} archetype={active.archetype} size={200} showLegend />
        <div>
          <p className="font-display text-2xl text-ink">{active.season_label}: {active.archetype}</p>
          <p className="mt-1 text-sm text-stone">{active.team} · {active.pos} · Age {active.age}</p>
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
      <div className="mt-10 border-t border-line pt-10 overflow-x-auto">
        <h2 className="font-display text-xl text-ink mb-4">Season-by-Season</h2>
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-stone-light">
              <th className="py-2 pr-4 font-medium">Season</th>
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
                <td className="py-2 pr-4 tabular text-ink-light">{s.season_label}</td>
                <td className="py-2 pr-4 text-stone">{s.team}</td>
                <td className="py-2 pr-4 text-stone">{s.archetype}</td>
                <td className="py-2 pr-4 text-right tabular text-ink-light">{fmt1(s.basic.pts)}</td>
                <td className="py-2 pr-4 text-right tabular text-ink-light">{fmt1(s.basic.trb)}</td>
                <td className="py-2 pr-4 text-right tabular text-ink-light">{fmt1(s.basic.ast)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
