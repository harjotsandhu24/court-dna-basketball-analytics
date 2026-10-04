"use client";

import { loadMeta } from "@/lib/dataLoader";
import { useAsync } from "@/lib/useAsync";
import { normalizeSeasonText, FEATURE_GROUPS, GALAXY_MIN_MINUTES, GALAXY_MIN_GAMES, CAREER_DISPLAY_MIN_MINUTES, SIMILARITY_SCALE } from "@/lib/config";

export default function MethodologyPage() {
  const metaState = useAsync("methodology-meta", loadMeta);
  const meta = metaState.status === "ready" ? metaState.data ?? null : null;

  return (
    <div className="mx-auto max-w-3xl px-5 py-14 md:px-8">
      <p className="text-eyebrow mb-2">How It Works</p>
      <h1 className="font-display text-4xl text-ink mb-8 sm:text-5xl">How COURT DNA works</h1>

      {metaState.status === "error" && (
        <div role="alert" className="mb-8 flex flex-wrap items-center gap-3 rounded-lg border border-line-strong bg-arena-panel px-4 py-3 text-sm text-stone">
          <span>Live dataset counts couldn&rsquo;t load. The explanation below still applies.</span>
          <button type="button" onClick={metaState.retry} className="btn btn-secondary min-h-11 px-4 py-2 text-sm">Retry</button>
        </div>
      )}

      <Section title="Data source">
        <p>
          Player-season statistics from Basketball-Reference.com, NBA regular seasons {normalizeSeasonText(meta?.season_range_label[0] ?? "2000-01")}
          {" "}through {normalizeSeasonText(meta?.season_range_label[1] ?? "2025-26")}. ABA/BAA-era leagues are excluded — they ceased to
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
          League environments changed substantially between 2000-01 and 2025-26 — three-point rate alone roughly
          tripled. Every similarity feature is therefore winsorized at the 1st/99th percentile and standardized
          (z-scored) <em>within its own season</em>, against that season&rsquo;s qualified pool only — never against
          the full 26-season history. A player is only ever compared to how unusual their number was in their own
          league environment.
        </p>
      </Section>

      <Section title="Similarity formula">
        <p>Six feature groups, each divided evenly across its listed features:</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead><tr className="border-b border-line text-left text-stone-light"><th className="py-1.5">Group</th><th className="py-1.5">Weight</th><th className="py-1.5">Features</th></tr></thead>
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
          Built from Basketball-Reference&rsquo;s shot-range breakdown (0-3 ft, 3-10 ft, 10-16 ft, 16 ft-3PT,
          3-point). This is <strong>not</strong> a location-based shot chart — the source data has no x/y shot
          coordinates, only attempt-share and field-goal percentage per distance range. Segment width shows share of
          attempts; color intensity shows efficiency in that range.
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

      <Section title="Limitations">
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="font-display text-2xl text-ink mb-3">{title}</h2>
      <div className="text-sm leading-relaxed text-stone-light [&_strong]:text-ink-light [&_em]:text-ink-light [&_code]:text-ink-light">
        {children}
      </div>
    </section>
  );
}
