"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import SearchBar from "@/components/SearchBar";
import CourtPrint from "@/components/CourtPrint";
import PlayerCard from "@/components/PlayerCard";
import { loadSeason, loadMeta } from "@/lib/dataLoader";
import type { PlayerSeasonRecord } from "@/lib/types";
import { normalizeSeasonText } from "@/lib/config";
import { useAsync } from "@/lib/useAsync";

const FEATURED: Array<{ id: string; season: number }> = [
  { id: "jamesle01", season: 2009 },
  { id: "curryst01", season: 2016 },
  { id: "duranke01", season: 2014 },
  { id: "antetgi01", season: 2020 },
];

const ENTRY_POINTS = [
  { href: "/galaxy", title: "Player Map", desc: "Explore players by playing style and see who appears close together." },
  { href: "/compare", title: "Compare Players", desc: "Put two players side by side, including two seasons of the same player." },
  { href: "/build-a-five", title: "Build a Lineup", desc: "Pick five players and see what their lineup looks like." },
  { href: "/methodology", title: "How It Works", desc: "A plain-language look at how players are compared." },
];

export default function HomePage() {
  // Independent, retryable loads: a failed featured-players request never
  // blocks the hero/search, and Retry genuinely refetches.
  const metaState = useAsync("home-meta", loadMeta);
  const featuredState = useAsync<PlayerSeasonRecord[]>("home-featured", async () => {
    const results = await Promise.all(
      FEATURED.map(async (f) => (await loadSeason(f.season)).find((r) => r.player_id === f.id)),
    );
    return results.filter((r): r is PlayerSeasonRecord => !!r);
  });
  const meta = metaState.status === "ready" ? metaState.data ?? null : null;
  const featured = featuredState.status === "ready" ? featuredState.data ?? [] : [];

  return (
    <div>
      {/* HERO */}
      <section className="court-lines-bg relative overflow-hidden border-b border-line">
        <div className="mx-auto max-w-[1400px] px-5 py-20 md:px-8 md:py-32">
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-eyebrow mb-4"
          >
            Basketball Player Style Explorer
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="font-display text-6xl leading-[0.95] text-ink sm:text-7xl md:text-8xl lg:text-[9rem]"
          >
            COURT<span className="text-court-orange">DNA</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="font-display mt-6 max-w-2xl text-3xl leading-tight text-ink sm:text-4xl"
          >
            Compare NBA players by how they play.
          </motion.p>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-4 max-w-xl text-lg text-stone md:text-xl"
          >
            Search a player to see their strengths, find similar players, compare careers, and
            build a lineup.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25 }}
            className="mt-10 max-w-xl"
          >
            <SearchBar size="lg" />
            <Link href="/galaxy" className="btn btn-primary mt-4 px-6 py-3">
              Explore Players
            </Link>
          </motion.div>

          {meta && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="mt-8 flex flex-wrap gap-x-8 gap-y-2 text-sm text-stone"
            >
              <span><span className="tabular font-semibold text-ink-light">{meta.unique_players.toLocaleString()}</span> players</span>
              <span><span className="tabular font-semibold text-ink-light">{meta.canonical_player_seasons.toLocaleString()}</span> player records</span>
              <span><span className="tabular font-semibold text-ink-light">{normalizeSeasonText(meta.season_range_label[0])}</span> to <span className="tabular font-semibold text-ink-light">{normalizeSeasonText(meta.season_range_label[1])}</span></span>
            </motion.div>
          )}
        </div>

        {/* decorative Court Print cluster, top-right, purely visual on this hero */}
        <div className="pointer-events-none absolute -right-16 top-10 hidden opacity-40 lg:block">
          <CourtPrint
            traits={{ Scoring: 92, Efficiency: 70, Playmaking: 55, Rebounding: 40, "Defensive Activity": 65, "Rim Pressure": 58, "Perimeter Profile": 80 }}
            posGroup="Wing"
            archetype="decorative"
            size={340}
            animate={true}
          />
        </div>
      </section>

      {/* FEATURED PLAYERS */}
      <section className="mx-auto max-w-[1400px] px-5 py-16 md:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4">
          <h2 className="font-display text-3xl text-ink">Featured Players</h2>
          <Link href="/galaxy" className="inline-flex min-h-11 items-center text-sm font-medium text-court-orange-bright hover:underline">
            Explore the Player Map →
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {featuredState.status === "ready"
            ? featured.map((r) => <PlayerCard key={`${r.player_id}-${r.season}`} record={r} />)
            : featuredState.status === "error"
              ? null
              : Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-64 animate-pulse rounded-xl bg-arena-panel" />
                ))}
        </div>
        {featuredState.status === "error" && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-line-strong bg-arena-panel px-4 py-3 text-sm text-stone">
            <span>Couldn&rsquo;t load the featured players.</span>
            <button type="button" onClick={featuredState.retry} className="btn btn-secondary min-h-11 px-4 py-2 text-sm">Retry</button>
          </div>
        )}
      </section>

      {/* ENTRY POINTS */}
      <section className="mx-auto max-w-[1400px] px-5 py-16 md:px-8">
        <h2 className="font-display text-3xl text-ink mb-6">Explore COURT DNA</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ENTRY_POINTS.map((e) => (
            <Link key={e.href} href={e.href} className="card-interactive group rounded-xl bg-arena-panel p-6">
              <h3 className="font-display text-xl text-ink group-hover:text-court-orange-bright">{e.title}</h3>
              <p className="mt-2 text-sm text-stone">{e.desc}</p>
              <span className="mt-4 inline-block text-sm font-medium text-court-orange-bright">Open →</span>
            </Link>
          ))}
        </div>
      </section>

      {/* WHAT THIS IS */}
      <section className="mx-auto max-w-[1400px] px-5 py-16 md:px-8">
        <div className="max-w-2xl">
          <h2 className="font-display text-3xl text-ink mb-4">What makes a player&rsquo;s game unique?</h2>
          <p className="text-stone leading-relaxed">
            COURT DNA uses more than 25 years of NBA data to compare how players score, shoot,
            pass, rebound, and defend. It turns those numbers into simple player profiles, finds
            similar playing styles, and shows where the similarities come from.
          </p>
          <Link href="/methodology" className="mt-4 inline-block text-sm font-medium text-court-orange-bright hover:underline">
            See how it works →
          </Link>
        </div>
      </section>
    </div>
  );
}
