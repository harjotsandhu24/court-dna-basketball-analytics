"use client";

import { useEffect, useState } from "react";
import { loadMeta } from "@/lib/dataLoader";
import LimitationsNote from "@/components/LimitationsNote";
import type { DatasetMeta } from "@/lib/types";
import { FEATURE_GROUPS, GALAXY_MIN_MINUTES, GALAXY_MIN_GAMES, CAREER_DISPLAY_MIN_MINUTES, SIMILARITY_SCALE, SEASON_MAX, SEASON_MIN, seasonLabel } from "@/lib/config";

export default function MethodologyPage() {
  const [meta, setMeta] = useState<DatasetMeta | null>(null);
  useEffect(() => { loadMeta().then(setMeta); }, []);

  // The page above a #section link can grow once the dataset numbers arrive; scroll to the section again after that.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (meta && id) document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [meta]);

  return (
    <div className="mx-auto max-w-3xl px-5 py-14 md:px-8">
      <p className="text-eyebrow mb-2">How It Works</p>
      <h1 className="font-display text-5xl text-ink mb-8">How COURT DNA works</h1>

      <Section title="Data source">
        <p>
          Player-season statistics from Basketball-Reference.com, NBA regular seasons {meta?.season_range_label[0] ?? seasonLabel(SEASON_MIN)}
          {" "}through {meta?.season_range_label[1] ?? seasonLabel(SEASON_MAX)}. COURT DNA begins with the {seasonLabel(SEASON_MIN)} season, the
          starting point for the historical advanced-stat coverage used by this model; it is not an all-time NBA
          history. ABA/BAA-era leagues are excluded — they ceased to
          exist decades before this window, so no non-NBA rows appear in the dataset at all. Six primary tables are
          combined: Advanced, Per 100 Possessions, Player Shooting, Player Per Game, Player Season Info, and Player
          Career Info.
        </p>
      </Section>

      <Section title="Canonical player-season rule">
        <p>
          A player traded mid-season appears in the raw data as an aggregate row (team code &ldquo;2TM&rdquo;,
          &ldquo;3TM&rdquo;, etc.) plus one row per individual team. COURT DNA uses the aggregate row as that
          player&rsquo;s single canonical full-season statistical profile whenever one exists; the individual team
          rows are kept separately only to show which teams a player suited up for that season, never re-used in the
          statistical calculation. This produces exactly one profile per (player, season) — verified automatically
          for every one of {meta?.canonical_player_seasons_all_samples.toLocaleString() ?? "…"} canonical player-seasons.
        </p>
      </Section>

      <Section title="Qualification thresholds">
        <ul className="list-disc pl-5 space-y-1">
          <li>Comparison / Player Map pool: at least {GALAXY_MIN_MINUTES} minutes and {GALAXY_MIN_GAMES} games in the season.</li>
          <li>Player detail / career display: at least {CAREER_DISPLAY_MIN_MINUTES} minutes — below the comparison bar, a season still gets
            a detail page but is visibly flagged &ldquo;small sample&rdquo; and is never used as a candidate in someone
            else&rsquo;s closest matches.</li>
          <li>The same thresholds apply to every season, including the lockout-shortened 1998-99 season, which
            therefore has a smaller qualified pool.</li>
        </ul>
        {meta && (
          <p className="mt-3 text-sm text-stone-light">
            Currently: {meta.unique_players.toLocaleString()} players with a detail page,{" "}
            {meta.canonical_player_seasons.toLocaleString()} display-eligible player-seasons,{" "}
            {meta.qualified_comparison_player_seasons.toLocaleString()} qualified for the comparison/Player Map pool.
          </p>
        )}
      </Section>

      <Section title="Features and season-relative normalization">
        <p>
          League environments changed substantially between {seasonLabel(SEASON_MIN)} and {seasonLabel(SEASON_MAX)} — three-point rate alone roughly
          tripled. Every similarity feature is therefore winsorized at the 1st/99th percentile and standardized
          (z-scored) <em>within its own season</em>, against that season&rsquo;s qualified pool only — never against
          the full multi-season history. A player is only ever compared to how unusual their number was in their own
          league environment. This measures playing-style similarity, not equal quality, and raw values from different
          eras are not necessarily directly comparable — shot-distance levels in particular shift around 1999-00 /
          2000-01, which season-relative standardization is designed to absorb.
        </p>
      </Section>

      <Section title="Similarity formula">
        <p>Six feature groups, each divided evenly across its listed features:</p>
        <div className="relative mt-3 overflow-x-auto" role="region" aria-label="Similarity feature groups table, scrolls sideways on narrow screens" tabIndex={0}>
          <table className="w-full min-w-[480px] text-sm">
            <caption className="sr-only">Feature groups, their weights and the features in each</caption>
            <thead><tr className="border-b border-line text-left text-stone-light"><th scope="col" className="py-1.5">Group</th><th scope="col" className="py-1.5">Weight</th><th scope="col" className="py-1.5">Features</th></tr></thead>
            <tbody>
              {FEATURE_GROUPS.map((g) => (
                <tr key={g.name} className="border-b border-line/50">
                  <td className="py-1.5 pr-3 text-ink-light">{g.name}</td>
                  <td className="py-1.5 pr-3 tabular text-ink-light">{Math.round(g.weight * 100)}%</td>
                  <td className="py-1.5 text-stone">{g.features.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3">
          A weighted RMS distance is calculated between two players&rsquo; standardized vectors, then converted to a
          0–100 Similarity Index: <code className="rounded bg-arena-panel px-1.5 py-0.5">Similarity Index = max(0, 100 − {SIMILARITY_SCALE} × weighted_RMS_distance)</code>.
          A score of 91 means 91/100 on this project&rsquo;s statistical similarity index — <strong>not</strong> a
          91% probability that two players are alike. Awards, popularity, Hall of Fame status, draft position, names,
          and team reputation never factor into this calculation.
        </p>
      </Section>

      <Section title="Explain the match">
        <p>
          Every comparison&rsquo;s &ldquo;where they match&rdquo; and &ldquo;where they separate&rdquo; language comes
          from fixed templates selected by which features have the smallest or largest weighted gap between two
          players&rsquo; vectors — never from a language model or invented narrative. No causal explanation (coaching,
          injury, role change, effort) is ever generated; only what the numbers show.
        </p>
      </Section>

      <Section title="Traits and archetypes">
        <p>
          Seven percentile trait dimensions (Scoring, Efficiency, Playmaking, Rebounding, Defensive Activity, Rim
          Pressure, Perimeter Profile) are each a weighted average of standardized features, converted to a
          season-relative percentile. Archetypes are assigned by an ordered set of deterministic rules against those
          percentiles plus a coarse position group (Guard/Wing/Big) — never by text generation. A &ldquo;Balanced
          [Position]&rdquo; fallback applies when no specific rule matches.
        </p>
      </Section>

      <Section title="Court Print">
        <p>
          The signature graphic is a direct visualization of the seven trait percentiles above: seven spokes at fixed
          angles, each spoke&rsquo;s length equal to that dimension&rsquo;s percentile, connected by a smooth curve.
          Nothing about its shape is random or decorative.
        </p>
      </Section>

      <Section title="Shooting Profile">
        <p>
          A half-court of distance zones: 0&ndash;3 ft, 3&ndash;10 ft, 10&ndash;16 ft, 16 ft to the three-point line,
          three-pointers, and (where shot locations exist) deep threes, meaning three-point attempts 30 feet or more from the
          basket. Hover or focus a zone for its makes, attempts and shooting %; click to keep it selected. For every regular
          season from 1996&ndash;97 on, counts come from each recorded shot&rsquo;s location (a stats.nba.com shot-chart
          dataset matched to Basketball-Reference players); &ldquo;Show shots&rdquo; plots them. A season without shot
          locations falls back to Basketball-Reference&rsquo;s distance-range shares with estimated counts and no deep-three
          split. Shot locations do not affect any similarity score. Details: the &ldquo;About this data&rdquo; note under the court.
        </p>
      </Section>

      <Section title="Player Map and PCA">
        <p>
          The Player Map plots each season&rsquo;s qualified pool in 2D using deterministic PCA (fixed random state) on
          the same standardized features used everywhere else. This is for visualization only — proximity in the 2D
          projection is approximate, and the app&rsquo;s actual similarity rankings always use the full
          12-dimensional formula above, never 2D distance.
        </p>
      </Section>

      <Section id="lineup-scores" title="How lineup scores are calculated">
        <p>
          In Build a Lineup, each of the six scores is the plain average, across the selected players, of that stat for
          the season you chose. Five are trait percentiles from 0 to 100, each measured against the other qualified
          players in the same season: Passing &amp; Creation, Three-Point Shooting, Attacking the Basket, Rebounding
          and Defensive box-score signals (built from steals and blocks only, not defensive rebounds or complete defensive impact). &ldquo;How Much They Handle the Ball&rdquo; comes from the usage rate, standardized within its
          season and turned into a 0 to 100 value.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li>
            <strong>Positions don&rsquo;t affect scores.</strong> PG, SG, SF, PF and C only help you arrange the
            lineup. Moving or swapping the same player-seasons gives the same scores.
          </li>
          <li>
            <strong>Missing stats.</strong> If a selected player-season has no value for a stat, that score shows
            &ldquo;Unavailable&rdquo;. It is never counted as zero and never averaged without that player.
          </li>
          <li>
            <strong>Small samples.</strong> A season with fewer than {GALAXY_MIN_MINUTES} minutes or {GALAXY_MIN_GAMES} games
            (but at least {CAREER_DISPLAY_MIN_MINUTES} minutes) is labeled &ldquo;Small sample&rdquo;. It is averaged
            like any other season, but its stats come from limited playing time and may be less reliable. Its
            percentiles are measured against that season&rsquo;s qualified players, which it did not help set.
          </li>
          <li>
            <strong>Not a prediction.</strong> The scores describe combined playing style from past statistics. They
            aren&rsquo;t used to predict wins, and the observations are simple notes triggered by fixed thresholds on these stats.
            The Simulate panel uses a separate model (see below).
          </li>
        </ul>
      </Section>

      <Section title="Simulate and season honors">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>What it does.</strong> Simulate uses what players did over a <em>completed season</em> to estimate how a
            hypothetical team would have done: an 82-game season, a seven-game series, or a historical playoff bracket (1996&ndash;97
            to 2025&ndash;26). It is not a preseason forecast. It uses a separate model fitted to real team results, not the six scores above.
            In a bracket replay, series that really happened keep their real host; a new matchup is hosted by the team with the better
            regular-season record, then by the team that won an uneven season series, and otherwise by a labelled assumption you can
            change (default: better point differential, which is not an official NBA rule). Seeds are published seeds, shown for display only.
          </li>
          <li>
            <strong>Assumptions.</strong> Each starter plays standard minutes, the rest go to an average bench, coaching is
            average and everyone is healthy. Five players share one ball, so shot volume is scaled down. The schedule is a balanced
            hypothetical one. Positions never change a result.
          </li>
          <li>
            <strong>Support check.</strong> Before showing numbers, Simulate asks whether the lineup resembles real teams the model
            was fitted on. If it is too different, you see the assessment but no wins, series odds or title odds, with the message
            &ldquo;This lineup is too different from the teams used to test the model.&rdquo; Being inside the range of real teams
            doesn&rsquo;t prove a custom lineup is accurately estimated. Small samples and lineups that mix distant eras are flagged as limited.
          </li>
          <li>
            <strong>How reliable.</strong> On real teams the 82-game estimate beat last season&rsquo;s record. For a custom five plus an
            average bench it did not (RMSE 10.50 against 10.12 on the newest test seasons), so treat it as rough. Series and bracket
            results are always Experimental. Expected defensive rating isn&rsquo;t shown because testing found it too weak; the
            &ldquo;Defensive box-score signals&rdquo; are rebounds, steals and blocks, not measured defense.
          </li>
          <li>
            <strong>Two kinds of uncertainty.</strong> Game luck is what a season or series can swing by chance; more simulated runs
            settle it. Model uncertainty is how far the model can be off; more runs never remove it. No 80% claim is made for custom lineups.
          </li>
          <li>
            <strong>Season honors.</strong> Awards for the selected season only, from published winner lists, plus championship
            membership (&ldquo;appeared in a playoff game for the champion&rdquo;). Voting placements aren&rsquo;t wins. Finals MVP and the 2025&ndash;26
            awards are confirmed by more than one source; awards for earlier seasons come from one source. Full championship rosters
            aren&rsquo;t available, so only Finals MVP winners show &ldquo;On the championship roster&rdquo;. Honors are never used in
            similarity, scores or simulations.
          </li>
        </ul>
      </Section>

      <Section title="Limitations">
        <LimitationsNote className="mb-4" />
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Box-score and rate statistics cannot capture every part of basketball performance — screening, spacing gravity, communication, and other off-ball value are not measured here.</li>
          <li>Steals and blocks are the only defensive box-score signals available; they are an incomplete measure of defensive activity, not a complete one.</li>
          <li>Correlation in a statistical profile is not causation, and a high Similarity Index is not a claim that two players play alike in ways beyond what these specific features measure.</li>
          <li>Player photos are sourced only from Wikimedia Commons with verified license metadata; most players use a fallback graphic rather than a guessed or unverified image — see <a href="/credits" className="text-court-orange-bright hover:underline">Photo Credits</a>.</li>
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-10 scroll-mt-24">
      <h2 className="font-display text-2xl text-ink mb-3">{title}</h2>
      <div className="text-sm leading-relaxed text-stone-light [&_strong]:text-ink-light [&_em]:text-ink-light [&_code]:text-ink-light">
        {children}
      </div>
    </section>
  );
}
