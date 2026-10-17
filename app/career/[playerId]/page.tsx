"use client";

import { use, useState } from "react";
import Link from "next/link";
import PlayerPhoto from "@/components/PlayerPhoto";
import CourtPrint from "@/components/CourtPrint";
import StatusPanel from "@/components/StatusPanel";
import { loadCareer } from "@/lib/dataLoader";
import { careerCallouts, CALLOUT_NOTE } from "@/lib/careerCallouts";
import { parseCareerRoute } from "@/lib/routes";
import { useLoad } from "@/lib/useLoad";
import type { PlayerSeasonRecord } from "@/lib/types";
import { fmt1 } from "@/lib/format";

const BACK = (
  <Link href="/" className="btn btn-secondary min-h-11 px-4 py-2 text-sm">Back to Discover</Link>
);

export default function CareerPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId: rawId } = use(params);
  const route = parseCareerRoute(rawId);
  const playerId = route.kind === "ok" ? route.playerId : null;
  const [state, retry] = useLoad<PlayerSeasonRecord[]>(playerId ? `career/${playerId}` : null, () => loadCareer(playerId!));
  // The chosen season belongs to one player: another player's page starts from their latest season.
  const [choice, setChoice] = useState<{ id: string; season: number } | null>(null);

  if (route.kind === "invalid-player") {
    return <StatusPanel tone="invalid" testId="career-invalid" title="That link isn't valid" message="The player in this address isn't recognised." actions={BACK} />;
  }
  if (state.status === "loading" || state.status === "idle") return <CareerSkeleton />;
  if (state.status === "notfound") {
    return <StatusPanel tone="notfound" testId="career-notfound" title="No career found" message="There is no career data for this player." actions={BACK} />;
  }
  if (state.status === "error") {
    return <StatusPanel tone="error" testId="career-error" title="Couldn't load this career" message="Check your connection and try again." onRetry={retry} actions={BACK} />;
  }
  const seasons = state.data;
  if (seasons.length === 0) {
    return <StatusPanel tone="notfound" testId="career-notfound" title="No career found" message="There is no career data for this player." actions={BACK} />;
  }

  const chosen = choice && choice.id === playerId ? seasons.findIndex((s) => s.season === choice.season) : -1;
  const activeIdx = chosen >= 0 ? chosen : seasons.length - 1;
  const active = seasons[activeIdx];
  const callouts = careerCallouts(seasons);
  const pick = (i: number) => setChoice({ id: playerId!, season: seasons[i].season });

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-10 md:px-8">
      <div className="mb-8 flex flex-wrap items-center gap-4">
        <PlayerPhoto playerId={playerId!} name={active.player} posGroup={active.pos_group} size={72} />
        <div>
          <p className="text-eyebrow text-court-orange-bright">Career Over Time</p>
          <h1 className="font-display text-4xl text-ink leading-none">{active.player}</h1>
          <p className="mt-1 text-sm text-stone">{seasons[0].season_label} – {seasons[seasons.length - 1].season_label}</p>
        </div>
        <Link href={`/player/${playerId}/${active.season}`} className="btn btn-secondary min-h-11 sm:ml-auto px-4 py-2 text-sm">
          View {active.season_label} Player Profile →
        </Link>
      </div>

      {/* Timeline */}
      <div className="relative mb-8 overflow-x-auto" role="group" aria-label="Choose a season">
        <div className="flex min-w-max gap-1.5 border-b border-line pb-3">
          {seasons.map((s, i) => (
            <button
              key={s.season}
              type="button"
              onClick={() => pick(i)}
              aria-pressed={i === activeIdx}
              className={`min-h-11 rounded-md px-3 py-2 text-xs font-medium tabular transition-colors ${
                i === activeIdx ? "bg-court-orange text-[#14100a]" : "bg-arena-panel text-stone hover:text-ink-light"
              }`}
            >
              {s.season_label}
              {s.small_sample ? <span className="sr-only"> (small sample)</span> : null}
              {s.small_sample ? <span aria-hidden="true" className="ml-1 text-[10px] opacity-70">·small</span> : null}
            </button>
          ))}
        </div>
      </div>

      {callouts.length > 0 && (
        <div className="mb-10 rounded-xl bg-arena-panel p-5">
          <h2 className="font-display text-xl text-ink mb-3">What changed</h2>
          <ul className="flex flex-col gap-1.5 text-sm text-ink-light">
            {callouts.map((c, i) => <li key={i}>• {c}</li>)}
          </ul>
          <p className="mt-3 text-xs text-stone-light">{CALLOUT_NOTE}</p>
        </div>
      )}

      {/* Court Print evolution strip */}
      <div className="mb-10">
        <h2 className="font-display text-xl text-ink mb-4">Playing Style Over Time</h2>
        <div className="relative flex gap-4 overflow-x-auto pb-2" role="group" aria-label="Playing style by season">
          {seasons.map((s, i) => (
            <button key={s.season} type="button" onClick={() => pick(i)} aria-pressed={i === activeIdx} aria-label={`${s.season_label}: ${s.archetype}`} className="shrink-0 text-center">
              <CourtPrint traits={s.traits} posGroup={s.pos_group} archetype={s.archetype} size={i === activeIdx ? 130 : 90} animate={false} />
              <p aria-hidden="true" className={`mt-1 text-xs tabular ${i === activeIdx ? "text-court-orange-bright font-semibold" : "text-stone-light"}`}>{s.season_label}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Active season detail */}
      <div className="grid grid-cols-1 gap-8 border-t border-line pt-10 lg:grid-cols-[220px_1fr]">
        <CourtPrint traits={active.traits} posGroup={active.pos_group} archetype={active.archetype} size={200} showLegend />
        <div>
          <p className="font-display text-2xl text-ink">{active.season_label}: {active.archetype}</p>
          <p className="mt-1 text-sm text-stone">{active.team} · {active.pos}{active.age != null ? ` · Age ${active.age}` : ""}</p>
          <div className="mt-4 grid grid-cols-3 gap-4 sm:grid-cols-6">
            <Stat label="PPG" value={fmt1(active.basic.pts)} />
            <Stat label="RPG" value={fmt1(active.basic.trb)} />
            <Stat label="APG" value={fmt1(active.basic.ast)} />
            <Stat label="SPG" value={fmt1(active.basic.stl)} />
            <Stat label="BPG" value={fmt1(active.basic.blk)} />
            <Stat label="Min" value={active.mp != null ? String(active.mp) : "—"} />
          </div>
        </div>
      </div>

      {/* Season-by-season table */}
      <div className="mt-10 border-t border-line pt-10">
        <h2 id="career-table-h" className="font-display text-xl text-ink mb-4">Season-by-Season</h2>
        <div className="relative overflow-x-auto" role="region" aria-labelledby="career-table-h" tabIndex={0}>
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Team, playing style, points, rebounds and assists for each season. Scroll sideways for more columns.</caption>
            <thead>
              <tr className="border-b border-line text-left text-stone-light">
                <th scope="col" className="sticky left-0 z-10 bg-arena-bg py-2 pr-4 font-medium">Season</th>
                <th scope="col" className="py-2 pr-4 font-medium">Team</th>
                <th scope="col" className="py-2 pr-4 font-medium">Archetype</th>
                <th scope="col" className="py-2 pr-4 font-medium text-right">PTS</th>
                <th scope="col" className="py-2 pr-4 font-medium text-right">REB</th>
                <th scope="col" className="py-2 pr-4 font-medium text-right">AST</th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((s, i) => (
                <tr key={s.season} className={`border-b border-line/50 ${i === activeIdx ? "bg-arena-panel" : ""}`}>
                  <th scope="row" className={`sticky left-0 z-10 py-2 pr-4 text-left font-normal tabular text-ink-light ${i === activeIdx ? "bg-arena-panel" : "bg-arena-bg"}`}>{s.season_label}</th>
                  <td className="py-2 pr-4 text-stone">{s.team}</td>
                  <td className="py-2 pr-4 text-stone">{s.archetype}</td>
                  <Num v={s.basic.pts} />
                  <Num v={s.basic.trb} />
                  <Num v={s.basic.ast} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Num({ v }: { v: number | null }) {
  return (
    <td className="py-2 pr-4 text-right tabular text-ink-light">
      {v == null ? <><span aria-hidden="true">—</span><span className="sr-only">Unavailable</span></> : fmt1(v)}
    </td>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-eyebrow">{label}</p>
      <p className="tabular font-display text-xl text-ink-light">{value === "—" ? <><span aria-hidden="true">—</span><span className="sr-only">Unavailable</span></> : value}</p>
    </div>
  );
}

/** Same footprint as the loaded page, so nothing jumps when the data arrives. */
function CareerSkeleton() {
  return (
    <div className="mx-auto max-w-[1400px] px-5 py-10 md:px-8" role="status" aria-label="Loading career" data-testid="career-loading">
      <div className="mb-8 flex items-center gap-4">
        <div className="h-[72px] w-[72px] shrink-0 animate-pulse rounded-full bg-arena-panel" />
        <div className="space-y-2"><div className="h-3 w-32 animate-pulse rounded bg-arena-panel" /><div className="h-9 w-64 animate-pulse rounded bg-arena-panel" /><div className="h-4 w-40 animate-pulse rounded bg-arena-panel" /></div>
      </div>
      <div className="mb-8 h-[60px] animate-pulse rounded bg-arena-panel" />
      <div className="mb-10 h-[170px] animate-pulse rounded-xl bg-arena-panel" />
      <div className="mb-10 h-[170px] animate-pulse rounded-xl bg-arena-panel" />
      <div className="h-[260px] animate-pulse rounded-xl bg-arena-panel" />
      <span className="sr-only">Loading career…</span>
    </div>
  );
}
