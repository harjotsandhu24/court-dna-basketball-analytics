"use client";

import { use } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import PlayerPhoto from "@/components/PlayerPhoto";
import CourtPrint from "@/components/CourtPrint";
import ShotDna from "@/components/ShotDna";
import TraitBars from "@/components/TraitBars";
import ClosestMatches from "@/components/ClosestMatches";
import { loadCareer, findPlayerSeason } from "@/lib/dataLoader";
import { seasonLabel } from "@/lib/config";
import { useAsync } from "@/lib/useAsync";
import type { PlayerSeasonRecord } from "@/lib/types";
import { fmt1, fmtInt, heightLabel } from "@/lib/format";

export default function PlayerDnaPage({
  params,
}: {
  params: Promise<{ playerId: string; season: string }>;
}) {
  const { playerId, season: seasonStr } = use(params);
  const season = parseInt(seasonStr, 10);

  // Keyed by player + season: navigating to another player/season shows the
  // loading state immediately and can never leave the previous player's data
  // on screen; late responses are dropped; Retry genuinely refetches.
  const validSeason = Number.isFinite(season);
  const recordState = useAsync<PlayerSeasonRecord | null>(
    validSeason ? `${playerId}-${season}` : null,
    () => findPlayerSeason(playerId, season),
  );
  const careerState = useAsync<PlayerSeasonRecord[]>(`career-${playerId}`, () => loadCareer(playerId));
  const record = recordState.status === "ready" ? recordState.data : undefined;
  const allSeasons = careerState.status === "ready" ? (careerState.data ?? []).map((r) => r.season) : [];

  if (!validSeason) {
    return <NotFound />;
  }
  if (recordState.status === "error") {
    return (
      <div className="mx-auto max-w-[1400px] px-5 py-20 text-center md:px-8">
        <p className="font-display text-3xl text-ink">Couldn&rsquo;t load this player</p>
        <p className="mt-2 text-stone">Check your connection and try again.</p>
        <button type="button" onClick={recordState.retry} className="btn btn-primary mt-6 min-h-11 px-5 py-2.5">Retry</button>
      </div>
    );
  }
  if (record === undefined) {
    return <div className="mx-auto max-w-[1400px] px-5 py-20 md:px-8"><LoadingSkeleton /></div>;
  }
  if (record === null) {
    return <NotFound />;
  }

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-10 md:px-8">
      {/* HERO */}
      <div className="grid grid-cols-1 gap-8 border-b border-line pb-10 lg:grid-cols-[auto_1fr_auto] lg:items-center">
        <PlayerPhoto playerId={record.player_id} name={record.player} posGroup={record.pos_group} size={140} showAttribution priority />

        <div>
          <p className="text-eyebrow text-court-orange-bright">Player DNA</p>
          <p className="mb-2 text-sm text-stone-light">See a player&rsquo;s strengths and playing style.</p>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-eyebrow">
              {record.team_stints.length > 1 ? record.team_stints.join(" · ") : record.team} · {record.pos}
            </p>
            {record.small_sample && (
              <span className="rounded-full border border-court-orange/50 bg-court-orange/10 px-2 py-0.5 text-xs font-medium text-court-orange-bright">
                Small sample ({fmtInt(record.mp)} min)
              </span>
            )}
          </div>
          <h1 className="font-display break-words text-4xl leading-none text-ink sm:text-6xl">{record.player}</h1>
          <p className="mt-2 text-lg text-stone">{seasonLabel(record.season)} season · Age {fmtInt(record.age)}</p>

          <div className="mt-5 grid grid-cols-3 gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-8">
            <Stat label="PPG" value={fmt1(record.basic.pts)} />
            <Stat label="RPG" value={fmt1(record.basic.trb)} />
            <Stat label="APG" value={fmt1(record.basic.ast)} />
            <Stat label="FG%" value={record.basic.fg_percent != null ? `${(record.basic.fg_percent * 100).toFixed(1)}%` : "—"} />
            <Stat label="3P%" value={record.basic.x3p_percent != null ? `${(record.basic.x3p_percent * 100).toFixed(1)}%` : "—"} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <p className="rounded-full border border-line-strong px-3 py-1 text-sm font-medium text-ink-light">
              {record.archetype}
            </p>
            {record.trait_tags.map((t) => (
              <span key={t} className="rounded-full bg-arena-panel px-3 py-1 text-sm text-stone">{t}</span>
            ))}
          </div>

          {allSeasons.length > 1 && (
            <div className="mt-5 flex flex-col gap-2 text-sm sm:flex-row sm:items-center">
              <span className="text-stone">Season:</span>
              <div className="flex flex-wrap gap-1.5">
                {allSeasons.map((s) => (
                  <Link
                    key={s}
                    href={`/player/${playerId}/${s}`}
                    aria-current={s === season ? "page" : undefined}
                    className={`flex min-h-11 items-center rounded-md px-3 tabular ${s === season ? "bg-court-orange text-[#14100a] font-semibold" : "bg-arena-panel/60 text-stone hover:bg-arena-panel"}`}
                  >
                    {seasonLabel(s)}
                  </Link>
                ))}
              </div>
            </div>
          )}
          {careerState.status === "error" && (
            <div role="alert" className="mt-5 flex flex-wrap items-center gap-3 text-sm text-stone">
              <span>Couldn&rsquo;t load the season list.</span>
              <button type="button" onClick={careerState.retry} className="btn btn-secondary min-h-11 px-4 py-2 text-sm">Retry</button>
            </div>
          )}
          <Link href={`/career/${playerId}`} className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-court-orange-bright hover:underline">
            View career over time →
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
          <p className="mb-4 text-xs text-stone-light">Compared with other players from the same season.</p>
          <TraitBars traits={record.traits} />
        </div>
        <div>
          <ShotDna data={record.shot_dna} />
        </div>
      </div>

      {/* CLOSEST MATCHES */}
      <div className="border-b border-line py-10">
        <h2 className="font-display text-2xl text-ink mb-1">Similar Players</h2>
        <p className="mb-5 text-sm text-stone-light">
          These players had the most similar overall playing styles. Scored by Style Match — not a
          probability. See{" "}
          <Link href="/methodology" className="text-court-orange-bright hover:underline">how it works</Link>.
        </p>
        <ClosestMatches
          query={{
            player_id: record.player_id,
            player: record.player,
            season: record.season,
            season_label: seasonLabel(record.season),
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
          <Stat label="Career span" value={record.career.from_year && record.career.to_year ? `${seasonLabel(record.career.from_year)} to ${seasonLabel(record.career.to_year)}` : "—"} />
          <Stat label="Hall of Fame" value={record.career.hof ? "Yes" : "—"} />
        </div>
        {record.team_stints.length > 1 && (
          <p className="mt-4 text-sm text-stone">
            Played for multiple teams this season ({record.team_stints.join(", ")}, order not meaningful). The
            numbers above combine all of this player&apos;s teams ({record.team}) for the season, not any single
            team&apos;s stats.
          </p>
        )}
        <p className="mt-6 text-xs text-stone-light max-w-2xl">
          Awards, All-Star selections, and accolades are background information only — they never affect the
          playing-style score, the player&rsquo;s style label, or any of the numbers above.
        </p>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-[1400px] px-5 py-20 text-center md:px-8">
      <p className="font-display text-3xl text-ink">Player profile not found</p>
      <p className="mt-2 text-stone">This player may not have reached the 250-minute display threshold that season.</p>
      <Link href="/" className="btn btn-primary mt-6 inline-flex min-h-11 px-5 py-2.5">Back to Discover</Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-eyebrow">{label}</p>
      <p className="tabular font-display break-words text-2xl text-ink-light">{value}</p>
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
