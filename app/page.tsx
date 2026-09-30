"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import SearchBar from "@/components/SearchBar";
import CourtPrint from "@/components/CourtPrint";
import PlayerCard from "@/components/PlayerCard";
import { loadSeason, loadMeta } from "@/lib/dataLoader";
import type { PlayerSeasonRecord, DatasetMeta } from "@/lib/types";

const FEATURED: Array<{ id: string; season: number }> = [
  { id: "jamesle01", season: 2009 },
  { id: "curryst01", season: 2016 },
  { id: "duranke01", season: 2014 },
  { id: "antetgi01", season: 2020 },
];

const ENTRY_POINTS = [
  { href: "/galaxy", title: "Player Galaxy", desc: "Every qualified season plotted as a constellation." },
  { href: "/build-a-five", title: "Build a Five", desc: "Assemble a lineup and read its statistical identity." },
  { href: "/methodology", title: "Methodology", desc: "How the fingerprint, similarity, and archetypes actually work." },
];

export default function HomePage() {
  const [featured, setFeatured] = useState<PlayerSeasonRecord[]>([]);
  const [meta, setMeta] = useState<DatasetMeta | null>(null);

  useEffect(() => {
    loadMeta().then(setMeta);
    Promise.all(
      FEATURED.map(async (f) => {
        const season = await loadSeason(f.season);
        return season.find((r) => r.player_id === f.id);
      }),
    ).then((results) => setFeatured(results.filter((r): r is PlayerSeasonRecord => !!r)));
  }, []);

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
            className="mt-6 max-w-xl text-lg text-stone md:text-xl"
          >
            Explore how basketball players score, create, defend, and evolve — from the
            2000-01 season through 2025-26.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25 }}
            className="mt-10 max-w-xl"
          >
            <SearchBar size="lg" />
          </motion.div>

          {meta && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="mt-8 flex flex-wrap gap-x-8 gap-y-2 text-sm text-stone-light"
            >
              <span><span className="tabular font-semibold text-ink-light">{meta.unique_players.toLocaleString()}</span> players</span>
              <span><span className="tabular font-semibold text-ink-light">{meta.canonical_player_seasons.toLocaleString()}</span> player-seasons</span>
              <span><span className="tabular font-semibold text-ink-light">{meta.season_range_label[0]}</span> – <span className="tabular font-semibold text-ink-light">{meta.season_range_label[1]}</span></span>
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

      {/* FEATURED PLAYER-SEASONS */}
      <section className="mx-auto max-w-[1400px] px-5 py-16 md:px-8">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="font-display text-3xl text-ink">Featured Player-Seasons</h2>
          <Link href="/galaxy" className="text-sm font-medium text-court-orange-bright hover:underline">
            Explore the full Galaxy →
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {featured.length === 0
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-64 animate-pulse rounded-xl bg-arena-panel" />
              ))
            : featured.map((r) => <PlayerCard key={`${r.player_id}-${r.season}`} record={r} />)}
        </div>
      </section>

      {/* ENTRY POINTS */}
      <section className="mx-auto max-w-[1400px] px-5 py-16 md:px-8">
        <h2 className="font-display text-3xl text-ink mb-6">Explore COURT DNA</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {ENTRY_POINTS.map((e) => (
            <Link key={e.href} href={e.href} className="card-interactive rounded-xl bg-arena-panel p-6">
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
            COURT DNA builds a transparent statistical fingerprint for every qualifying NBA
            player-season since 2000-01 — scoring load, efficiency, shot profile, playmaking,
            rebounding, and defensive activity, all calculated relative to that season&rsquo;s
            league environment. A documented, weighted formula (not a black-box model) finds
            who actually resembles whom, and explains exactly where the comparison comes from.
          </p>
          <Link href="/methodology" className="mt-4 inline-block text-sm font-medium text-court-orange-bright hover:underline">
            Read the full methodology →
          </Link>
        </div>
      </section>
    </div>
  );
}
