"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import PlayerPhoto from "@/components/PlayerPhoto";
import CourtPrint from "@/components/CourtPrint";
import ShotDna from "@/components/ShotDna";
import LimitationsNote from "@/components/LimitationsNote";
import TraitBars from "@/components/TraitBars";
import ClosestMatches from "@/components/ClosestMatches";
import SeasonHonors from "@/components/SeasonHonors";
import StatusPanel from "@/components/StatusPanel";
import { loadCareer, findPlayerSeason, loadPlayersIndex } from "@/lib/dataLoader";
import { SEASON_MAX, SEASON_MIN, seasonLabel } from "@/lib/config";
import { traitTagLabel } from "@/lib/courtPrint";
import { parsePlayerRoute } from "@/lib/routes";
import { playerSeasonKey } from "@/lib/similarity";
import { useLoad } from "@/lib/useLoad";
import type { PlayerSeasonRecord, PlayersIndex } from "@/lib/types";
import { fmt1, fmtInt, heightLabel } from "@/lib/format";

const DISCOVER = <Link href="/" className="btn btn-secondary min-h-11 px-4 py-2 text-sm">Back to Discover</Link>;

export default function PlayerDnaPage({
  params,
}: {
  params: Promise<{ playerId: string; season: string }>;
}) {
  const { playerId: rawId, season: rawSeason } = use(params);
  // Both parts of the address are checked completely before anything is requested ("2005abc" is not 2005).
  const route = parsePlayerRoute(rawId, rawSeason);
  const playerId = route.kind === "ok" ? route.playerId : null;
  const season = route.kind === "ok" ? route.season : null;
  const router = useRouter();

  const [recState, retryRecord] = useLoad<PlayerSeasonRecord | null>(
    playerId && season ? `player/${playerId}/${season}` : null,
    () => findPlayerSeason(playerId!, season!),
  );
  const record = recState.status === "ready" ? recState.data : null;
  // The list of seasons is optional: if it fails, only the season menu is affected.
  const [careerState, retryCareer] = useLoad<PlayerSeasonRecord[]>(
    record ? `career/${record.player_id}` : null,
    () => loadCareer(record!.player_id),
  );
  // An unusable season on a real player offers that player's latest season.
  const [indexState] = useLoad<PlayersIndex>(
    route.kind === "invalid-season" || (recState.status === "ready" && recState.data === null) ? "index" : null,
    loadPlayersIndex,
  );

  if (route.kind === "invalid-player") {
    return <StatusPanel tone="invalid" testId="profile-invalid" title="That link isn't valid" message="The player in this address isn't recognised. Search for a player instead." actions={DISCOVER} />;
  }
  if (route.kind === "invalid-season" || (recState.status === "ready" && recState.data === null) || recState.status === "notfound") {
    const entry = indexState.status === "ready" ? indexState.data[route.kind === "ok" ? route.playerId : (route as { playerId: string }).playerId] : undefined;
    const latest = entry ? entry.seasons[entry.seasons.length - 1] : null;
    const pid = (route as { playerId: string }).playerId;
    const invalidSeason = route.kind === "invalid-season";
    return (
      <StatusPanel
        tone={invalidSeason ? "invalid" : "notfound"}
        testId={invalidSeason ? "profile-invalid-season" : "profile-unavailable"}
        title={invalidSeason ? "That season isn't valid" : "Player profile not found"}
        message={
          invalidSeason
            ? `Use a season from ${seasonLabel(SEASON_MIN)} to ${seasonLabel(SEASON_MAX)}.`
            : "This player doesn't have a profile for that season. Players need at least 250 minutes to be shown."
        }
        actions={
          <>
            {latest != null && entry && (
              <Link href={`/player/${pid}/${latest}`} className="btn btn-primary min-h-11 px-4 py-2 text-sm">
                Open {entry.name} · {seasonLabel(latest)}
              </Link>
            )}
            {DISCOVER}
          </>
        }
      />
    );
  }
  if (recState.status === "error") {
    return <StatusPanel tone="error" testId="profile-error" title="Couldn't load this profile" message="Check your connection and try again." onRetry={retryRecord} actions={DISCOVER} />;
  }
  if (!record) {
    return <div className="mx-auto max-w-[1400px] px-5 py-10 md:px-8"><LoadingSkeleton /></div>;
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

          <SeasonHonors key={`${record.player_id}-${record.season}`} playerId={record.player_id} season={record.season} />

          <p className="mt-4 inline-block rounded-full border border-line-strong px-3 py-1 text-sm font-medium text-ink-light">
            {record.archetype}
          </p>
          <span className="ml-2 text-sm text-stone-light">{record.trait_tags.map(traitTagLabel).join(" · ")}</span>

          <div className="mt-5 min-h-11" data-testid="season-picker">
            {careerState.status === "ready" && careerState.data.length > 1 && (
              <label className="flex flex-wrap items-center gap-2 text-sm text-stone-light">
                Season
                <select
                  value={record.season}
                  onChange={(e) => router.push(`/player/${record.player_id}/${e.target.value}`)}
                  className="min-h-11 rounded-md border border-line-strong bg-arena-panel px-3 py-2 text-base text-ink-light outline-none focus:border-court-orange sm:text-sm"
                >
                  {[...careerState.data].reverse().map((r) => (
                    <option key={r.season} value={r.season}>
                      {seasonLabel(r.season)}{r.small_sample ? " · small sample" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(careerState.status === "error" || careerState.status === "notfound") && (
              <StatusPanel inline tone="error" testId="seasons-error" title="Couldn't load the other seasons." onRetry={retryCareer} />
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link
              href={`/compare?a=${playerSeasonKey(record.player_id, record.season)}`}
              className="btn btn-secondary min-h-11 px-4 py-2 text-sm"
            >
              Compare this season
            </Link>
            <Link href={`/career/${record.player_id}`} className="inline-flex min-h-11 items-center text-sm font-medium text-court-orange-bright hover:underline">
              View career over time →
            </Link>
          </div>
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
          <ShotDna data={record.shot_dna} season={record.season} playerId={record.player_id} />
        </div>
      </div>

      <div className="border-b border-line py-6">
        <LimitationsNote />
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
            numbers above combine all of this player&apos;s teams ({record.team}) for the season, not any single
            team&apos;s stats.
          </p>
        )}
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

/** Same footprint as the loaded profile (hero, traits, similar players), so the page doesn't jump when data arrives. */
function LoadingSkeleton() {
  return (
    <div role="status" aria-label="Loading profile" data-testid="profile-loading">
      <div className="grid grid-cols-1 gap-8 border-b border-line pb-10 lg:grid-cols-[auto_1fr_auto] lg:items-center">
        <div className="h-[140px] w-[140px] animate-pulse rounded-full bg-arena-panel" />
        <div className="space-y-3">
          <div className="h-3 w-24 animate-pulse rounded bg-arena-panel" />
          <div className="h-14 w-full max-w-md animate-pulse rounded bg-arena-panel" />
          <div className="h-5 w-48 animate-pulse rounded bg-arena-panel" />
          <div className="h-12 w-full max-w-sm animate-pulse rounded bg-arena-panel" />
          <div className="h-24 w-full max-w-xl animate-pulse rounded bg-arena-panel" />
        </div>
        <div className="h-[260px] w-[260px] max-w-full animate-pulse rounded-full bg-arena-panel" />
      </div>
      <div className="grid grid-cols-1 gap-10 py-10 lg:grid-cols-2">
        <div className="h-[360px] animate-pulse rounded-xl bg-arena-panel" />
        <div className="h-[360px] animate-pulse rounded-xl bg-arena-panel" />
      </div>
      <span className="sr-only">Loading profile…</span>
    </div>
  );
}
