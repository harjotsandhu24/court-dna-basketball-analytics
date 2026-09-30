"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import PlayerPhoto from "@/components/PlayerPhoto";
import CourtPrint from "@/components/CourtPrint";
import ShotDna from "@/components/ShotDna";
import TraitBars from "@/components/TraitBars";
import ClosestMatches from "@/components/ClosestMatches";
import { loadCareer, findPlayerSeason } from "@/lib/dataLoader";
import type { PlayerSeasonRecord } from "@/lib/types";
import { fmt1, fmtInt, heightLabel } from "@/lib/format";

export default function PlayerDnaPage({
  params,
}: {
  params: Promise<{ playerId: string; season: string }>;
}) {
  const { playerId, season: seasonStr } = use(params);
  const season = parseInt(seasonStr, 10);

  const [record, setRecord] = useState<PlayerSeasonRecord | null | undefined>(undefined);
  const [allSeasons, setAllSeasons] = useState<number[]>([]);

  useEffect(() => {
    // intentional synchronous reset to a loading state when navigating to a
    // different player/season, so the previous player is never shown
    // mid-fetch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecord(undefined);
    findPlayerSeason(playerId, season).then(setRecord);
    loadCareer(playerId).then((c) => setAllSeasons(c.map((r) => r.season)));
  }, [playerId, season]);

  if (record === undefined) {
    return <div className="mx-auto max-w-[1400px] px-5 py-20 md:px-8"><LoadingSkeleton /></div>;
  }
  if (record === null) {
    return (
      <div className="mx-auto max-w-[1400px] px-5 py-20 text-center md:px-8">
        <p className="font-display text-3xl text-ink">Player-season not found</p>
        <p className="mt-2 text-stone">This player may not have reached the 250-minute display threshold that season.</p>
        <Link href="/" className="mt-6 inline-block btn btn-primary px-5 py-2.5">Back to Discover</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-10 md:px-8">
      {/* HERO */}
      <div className="grid grid-cols-1 gap-8 border-b border-line pb-10 lg:grid-cols-[auto_1fr_auto] lg:items-center">
        <PlayerPhoto playerId={record.player_id} name={record.player} posGroup={record.pos_group} size={140} showAttribution priority />

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-eyebrow">
              {record.team_stints.length > 1 ? record.team_stints.join(" · ") : record.team} · {record.pos}
            </p>
            {record.small_sample && (
              <span className="rounded-full border border-court-orange/50 bg-court-orange/10 px-2 py-0.5 text-[11px] font-medium text-court-orange-bright">
                Small sample ({fmtInt(record.mp)} min)
              </span>
            )}
          </div>
          <h1 className="font-display text-5xl leading-none text-ink sm:text-6xl">{record.player}</h1>
          <p className="mt-2 text-lg text-stone">{record.season_label} season · Age {fmtInt(record.age)}</p>

          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2">
            <Stat label="PPG" value={fmt1(record.basic.pts)} />
            <Stat label="RPG" value={fmt1(record.basic.trb)} />
            <Stat label="APG" value={fmt1(record.basic.ast)} />
            <Stat label="FG%" value={record.basic.fg_percent != null ? `${(record.basic.fg_percent * 100).toFixed(1)}%` : "—"} />
            <Stat label="3P%" value={record.basic.x3p_percent != null ? `${(record.basic.x3p_percent * 100).toFixed(1)}%` : "—"} />
          </div>

          <p className="mt-4 inline-block rounded-full border border-line-strong px-3 py-1 text-sm font-medium text-ink-light">
            {record.archetype}
          </p>
          <span className="ml-2 text-sm text-stone-light">{record.trait_tags.join(" · ")}</span>

          {allSeasons.length > 1 && (
            <div className="mt-5 flex items-center gap-2 text-sm">
              <span className="text-stone-light">Season:</span>
              <div className="flex flex-wrap gap-1">
                {allSeasons.map((s) => (
                  <Link
                    key={s}
                    href={`/player/${playerId}/${s}`}
                    className={`rounded-md px-2 py-1 tabular ${s === season ? "bg-court-orange text-[#14100a] font-semibold" : "text-stone hover:bg-arena-panel"}`}
                  >
                    {s}
                  </Link>
                ))}
              </div>
            </div>
          )}
          <Link href={`/career/${playerId}`} className="mt-3 inline-block text-sm font-medium text-court-orange-bright hover:underline">
            View full career evolution →
          </Link>
        </div>

        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}>
          <CourtPrint traits={record.traits} posGroup={record.pos_group} archetype={record.archetype} size={260} showLegend />
        </motion.div>
      </div>

      {/* TRAITS + SHOT DNA */}
      <div className="grid grid-cols-1 gap-10 border-b border-line py-10 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-2xl text-ink mb-4">Percentile Traits</h2>
          <p className="mb-4 text-xs text-stone-light">Relative to the {record.season_label} qualified player pool.</p>
          <TraitBars traits={record.traits} />
        </div>
        <div>
          <ShotDna data={record.shot_dna} />
        </div>
      </div>

      {/* CLOSEST MATCHES */}
      <div className="border-b border-line py-10">
        <h2 className="font-display text-2xl text-ink mb-1">Closest Statistical Matches</h2>
        <p className="mb-5 text-sm text-stone-light">
          Ranked by the COURT DNA Similarity Index — a statistical distance score, not a probability. See{" "}
          <Link href="/methodology" className="text-court-orange-bright hover:underline">methodology</Link>.
        </p>
        <ClosestMatches
          query={{
            player_id: record.player_id,
            player: record.player,
            season: record.season,
            season_label: record.season_label,
            pos_group: record.pos_group,
            archetype: record.archetype,
            vector: record.vector,
          }}
          queryName={record.player}
        />
      </div>

      {/* CAREER CONTEXT (secondary) */}
      <div className="py-10">
        <h2 className="font-display text-2xl text-ink mb-4">Player Info</h2>
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Stat label="Height" value={heightLabel(record.career.ht_in_in)} />
          <Stat label="Weight" value={record.career.wt ? `${fmtInt(record.career.wt)} lb` : "—"} />
          <Stat label="Career span" value={record.career.from_year && record.career.to_year ? `${record.career.from_year}–${record.career.to_year}` : "—"} />
          <Stat label="Hall of Fame" value={record.career.hof ? "Yes" : "—"} />
        </div>
        {record.team_stints.length > 1 && (
          <p className="mt-4 text-sm text-stone">
            Played for multiple teams this season ({record.team_stints.join(", ")}, order not meaningful). The
            statistical profile above uses the combined-team ({record.team}) totals, not any single team&apos;s stats.
          </p>
        )}
        <p className="mt-6 text-xs text-stone-light max-w-2xl">
          Awards, All-Star selections, and accolades are contextual background only — they never factor into the
          similarity calculation, archetype assignment, or any trait percentile above.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-eyebrow">{label}</p>
      <p className="tabular font-display text-2xl text-ink-light">{value}</p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-40 w-40 rounded-full bg-arena-panel" />
      <div className="h-10 w-80 rounded bg-arena-panel" />
      <div className="h-64 w-full rounded bg-arena-panel" />
    </div>
  );
}
