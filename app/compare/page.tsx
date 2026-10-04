"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import PlayerPhoto from "@/components/PlayerPhoto";
import CourtPrint from "@/components/CourtPrint";
import ShotDna from "@/components/ShotDna";
import PlayerAutocomplete, { type PlayerAutocompleteSelection } from "@/components/PlayerAutocomplete";
import { comparableSeasons, findPlayerSeason, isComparisonQualified, loadPlayersIndex } from "@/lib/dataLoader";
import { similarityIndex } from "@/lib/similarity";
import { explainMatch } from "@/lib/explain";
import { TRAIT_DIMENSIONS, seasonLabel } from "@/lib/config";
import { DIMENSION_DISPLAY_LABEL } from "@/lib/courtPrint";
import type { PlayerSeasonRecord } from "@/lib/types";
import { fmt1 } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

const NOT_FOUND = "NOT_FOUND";

function parseSlug(slug: string | null): { id: string; season: number } | null {
  if (!slug) return null;
  const idx = slug.lastIndexOf("_");
  if (idx === -1) return null;
  const id = slug.slice(0, idx);
  const season = parseInt(slug.slice(idx + 1), 10);
  if (!id || Number.isNaN(season)) return null;
  return { id, season };
}

async function loadRecord(slug: { id: string; season: number }): Promise<PlayerSeasonRecord> {
  const rec = await findPlayerSeason(slug.id, slug.season);
  if (!rec) throw new Error(NOT_FOUND);
  return rec;
}

function PageShell({ children, narrow = false }: { children: React.ReactNode; narrow?: boolean }) {
  return (
    <div className={`mx-auto px-5 py-12 md:px-8 md:py-20 ${narrow ? "max-w-2xl" : "max-w-[1400px]"}`}>{children}</div>
  );
}

function ErrorBox({ message, onRetry, children }: { message: string; onRetry?: () => void; children?: React.ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-line-strong bg-arena-panel px-4 py-3 text-sm text-stone">
      <span>{message}</span>
      <div className="flex flex-wrap gap-2">
        {onRetry && (
          <button type="button" onClick={onRetry} className="btn btn-secondary min-h-11 px-4 py-2 text-sm">Retry</button>
        )}
        {children}
      </div>
    </div>
  );
}

const NOT_QUALIFIED_MESSAGE =
  "This season doesn’t meet the comparison threshold, so no Style Match can be calculated. Start over and pick a qualifying season.";

function SeasonSelect({ label, value, seasons, onChange }: { label: string; value: number; seasons: number[]; onChange: (s: number) => void }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value, 10))}
      className="min-h-11 rounded-md border border-line-strong bg-arena-panel px-3 text-base text-ink-light outline-none focus:border-court-orange sm:text-sm"
    >
      {seasons.map((s) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
    </select>
  );
}

function ComparePageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const aSlug = params.get("a");
  const bSlug = params.get("b");
  const pa = parseSlug(aSlug);
  const pb = parseSlug(bSlug);
  // Player 2 is held here (name + season, both editable) until the person
  // presses Compare, so the season is visible and changeable before opening.
  const [second, setSecond] = useState<{ id: string; name: string; season: number } | null>(null);
  const indexState = useAsync("players-index", loadPlayersIndex);
  const index = indexState.status === "ready" ? indexState.data : undefined;

  // Each side loads independently, keyed by its slug: a result is only ever
  // used for the slug it was loaded for, late responses are dropped, and a
  // failed load is genuinely retried (failures are never cached).
  const recA = useAsync(pa ? `a-${aSlug}` : null, () => loadRecord(pa!));
  const recB = useAsync(pb ? `b-${bSlug}` : null, () => loadRecord(pb!));

  function startOver() {
    setSecond(null);
    router.push("/compare");
  }

  // ---- COMPARING: both slots chosen (loading / error / ready) -----------
  if (pa && pb) {
    const failed = recA.status === "error" ? recA : recB.status === "error" ? recB : null;
    if (failed) {
      const missing = failed.error?.message === NOT_FOUND;
      return (
        <PageShell narrow>
          <h1 className="font-display mb-6 text-center text-4xl text-ink">Compare Players</h1>
          <ErrorBox
            message={
              missing
                ? "One of these player-seasons couldn’t be found. It may not have a profile for that season."
                : "Couldn’t load this comparison. Check your connection and try again."
            }
            onRetry={missing ? undefined : () => { if (recA.status === "error") recA.retry(); if (recB.status === "error") recB.retry(); }}
          >
            <button type="button" onClick={startOver} className="btn btn-secondary min-h-11 px-4 py-2 text-sm">Start over</button>
          </ErrorBox>
        </PageShell>
      );
    }
    if (recA.status !== "ready" || recB.status !== "ready" || !recA.data || !recB.data) {
      return (
        <PageShell>
          <h1 className="font-display text-4xl text-ink">Compare Players</h1>
          <p role="status" className="mt-2 text-stone">Loading comparison…</p>
          <div className="mt-8 grid animate-pulse grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="h-48 rounded-xl bg-arena-panel" />
            <div className="h-48 rounded-xl bg-arena-panel" />
          </div>
        </PageShell>
      );
    }
    if (!isComparisonQualified(recA.data) || !isComparisonQualified(recB.data)) {
      return (
        <PageShell narrow>
          <h1 className="font-display mb-6 text-center text-4xl text-ink">Compare Players</h1>
          <ErrorBox message={NOT_QUALIFIED_MESSAGE}>
            <button type="button" onClick={startOver} className="btn btn-secondary min-h-11 px-4 py-2 text-sm">Start over</button>
          </ErrorBox>
        </PageShell>
      );
    }
    return <CompareReady a={recA.data} b={recB.data} aSlug={aSlug!} bSlug={bSlug!} />;
  }

  // ---- SETUP: Player 1 -> Player 2 -> Compare ----------------------------
  const haveFirst = !!pa;

  if (pa && recA.status === "ready" && recA.data && !isComparisonQualified(recA.data)) {
    return (
      <PageShell narrow>
        <h1 className="font-display mb-6 text-center text-4xl text-ink">Compare Players</h1>
        <ErrorBox message={NOT_QUALIFIED_MESSAGE}>
          <button type="button" onClick={startOver} className="btn btn-secondary min-h-11 px-4 py-2 text-sm">Start over</button>
        </ErrorBox>
      </PageShell>
    );
  }

  function pickFirst(sel: PlayerAutocompleteSelection) {
    router.push(`/compare?a=${sel.id}_${sel.season}`);
  }
  function changeFirstSeason(season: number) {
    router.replace(`/compare?a=${pa!.id}_${season}`);
  }
  function pickSecond(sel: PlayerAutocompleteSelection) {
    setSecond({ id: sel.id, name: sel.name, season: sel.season });
  }
  const secondSlug = second ? `${second.id}_${second.season}` : null;
  const isDuplicate = secondSlug != null && secondSlug === aSlug;
  function openComparison() {
    if (!secondSlug || isDuplicate) return;
    router.push(`/compare?a=${aSlug}&b=${secondSlug}`);
  }

  return (
    <PageShell narrow>
      <h1 className="font-display mb-2 text-center text-4xl text-ink">Compare Players</h1>
      <p className="mb-8 text-center text-stone">Pick two players to compare side by side.</p>

      {(aSlug && !pa) || (bSlug && !pb) ? (
        <div className="mb-5"><ErrorBox message="That comparison link isn’t valid. Pick the players below." /></div>
      ) : null}

      <ol className="flex flex-col gap-5">
        <li>
          <p className="text-eyebrow mb-2">Step 1 · Player 1</p>
          {haveFirst ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-line-strong bg-arena-panel px-4 py-3">
              <span className="min-w-0 text-sm font-medium text-ink-light">
                {recA.status === "ready" && recA.data
                  ? recA.data.player
                  : recA.status === "error"
                    ? "Couldn’t load Player 1"
                    : "Loading Player 1…"}
              </span>
              <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                <SeasonSelect
                  label="Season for Player 1"
                  value={pa!.season}
                  seasons={comparableSeasons(index, pa!.id)}
                  onChange={changeFirstSeason}
                />
                {recA.status === "error" && (
                  <button type="button" onClick={recA.retry} className="min-h-11 px-3 text-sm text-court-orange-bright hover:underline">Retry</button>
                )}
                <button type="button" onClick={startOver} className="min-h-11 px-3 text-sm text-stone hover:text-court-orange-bright">
                  Change
                </button>
              </span>
            </div>
          ) : (
            <PlayerAutocomplete onSelect={pickFirst} scope="map" placeholder="Search for the first player…" ariaLabel="Search for Player 1" autoFocus />
          )}
        </li>

        <li>
          <p className="text-eyebrow mb-2">Step 2 · Player 2</p>
          {!haveFirst ? (
            <p className="rounded-md border border-line bg-arena-panel px-4 py-3 text-sm text-stone">Choose Player 1 first.</p>
          ) : second ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line-strong bg-arena-panel px-4 py-3">
              <span className="min-w-0 break-words text-sm font-medium text-ink-light">{second.name}</span>
              <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                <SeasonSelect
                  label="Season for Player 2"
                  value={second.season}
                  seasons={comparableSeasons(index, second.id)}
                  onChange={(season) => setSecond({ ...second, season })}
                />
                <button type="button" onClick={() => setSecond(null)} className="min-h-11 px-3 text-sm text-stone hover:text-court-orange-bright">
                  Change
                </button>
              </span>
            </div>
          ) : (
            <PlayerAutocomplete
              onSelect={pickSecond}
              scope="map"
              preferredSeason={pa!.season}
              placeholder="Search for the second player…"
              ariaLabel="Search for Player 2"
              autoFocus
            />
          )}
        </li>

        <li>
          <p className="text-eyebrow mb-2">Step 3 · Compare</p>
          <button
            type="button"
            onClick={openComparison}
            disabled={!second || isDuplicate}
            className="btn btn-primary min-h-11 px-5 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            Compare
          </button>
          {isDuplicate && (
            <p role="alert" className="mt-2 text-sm text-court-orange-bright">
              That&rsquo;s the same player and season as Player 1 ({second!.name}, {seasonLabel(second!.season)}). Pick a different season or player.
            </p>
          )}
          {!second && haveFirst && <p className="mt-2 text-sm text-stone">Choose Player 2 to compare.</p>}
        </li>
      </ol>

      <p className="mt-6 text-sm text-stone">
        Tip: to compare two seasons of the same player, pick the same player twice and change the season on either side.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm text-court-orange-bright hover:underline">Back to Discover</Link>
    </PageShell>
  );
}

function CompareReady({ a, b, aSlug, bSlug }: { a: PlayerSeasonRecord; b: PlayerSeasonRecord; aSlug: string; bSlug: string }) {
  const router = useRouter();
  const sim = similarityIndex(a.vector, b.vector);
  const { similarities, differences } = explainMatch(a.player, a.vector, b.player, b.vector);

  function swap() {
    router.push(`/compare?a=${bSlug}&b=${aSlug}`);
  }
  const identical = aSlug === bSlug;

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-10 md:px-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-4xl text-ink">Compare Players</h1>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={swap} className="btn btn-secondary min-h-11 px-4 py-2 text-sm">Swap sides ⇄</button>
          <Link href="/compare" className="btn btn-secondary flex min-h-11 items-center px-4 py-2 text-sm">New comparison</Link>
        </div>
      </div>
      {identical && (
        <p role="status" className="mb-6 rounded-lg border border-line-strong bg-arena-panel px-4 py-3 text-sm text-stone">
          Both sides are the same player and season, so the match is 100. Change one side to see a real comparison.
        </p>
      )}

      {/* Split header */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <PlayerHeader record={a} align="left" />
        <div className="flex flex-col items-center justify-center py-4">
          <span className="font-display text-2xl text-stone">VS</span>
          <div className="mt-3 rounded-full border border-court-orange/40 bg-court-orange/10 px-4 py-2 text-center">
            <div className="font-display text-3xl text-court-orange-bright tabular">{Math.round(sim)}</div>
            <div className="text-xs uppercase tracking-wide text-stone">Style Match</div>
          </div>
          <p className="mt-2 max-w-[220px] text-center text-sm text-stone">
            Higher scores mean the two players had more similar playing styles.
          </p>
        </div>
        <PlayerHeader record={b} align="right" />
      </div>

      {/* Court Prints */}
      <div className="mt-10 grid grid-cols-1 gap-6 border-t border-line pt-10 lg:grid-cols-2">
        <div className="flex justify-center"><CourtPrint traits={a.traits} posGroup={a.pos_group} archetype={a.archetype} size={200} showLegend /></div>
        <div className="flex justify-center"><CourtPrint traits={b.traits} posGroup={b.pos_group} archetype={b.archetype} size={200} showLegend /></div>
      </div>

      {/* Trait comparison bars */}
      <div className="mt-10 border-t border-line pt-10">
        <h2 className="font-display text-2xl text-ink mb-6">Trait Comparison</h2>
        <div className="flex flex-col gap-4">
          {TRAIT_DIMENSIONS.map((dim) => {
            const av = Math.max(0, Math.min(100, a.traits[dim] ?? 0));
            const bv = Math.max(0, Math.min(100, b.traits[dim] ?? 0));
            return (
              <div key={dim}>
                <div className="mb-1 flex items-center justify-between text-xs text-stone">
                  <span className="tabular">{Math.round(av)}</span>
                  <span>{DIMENSION_DISPLAY_LABEL[dim]}</span>
                  <span className="tabular">{Math.round(bv)}</span>
                </div>
                <div className="flex h-2.5 w-full gap-0.5">
                  <div className="flex flex-1 justify-end overflow-hidden rounded-l-full bg-arena-panel-strong">
                    <motion.div
                      className="h-full bg-guard-accent"
                      initial={{ width: 0 }}
                      animate={{ width: `${av}%` }}
                      transition={{ duration: 0.6 }}
                    />
                  </div>
                  <div className="flex-1 overflow-hidden rounded-r-full bg-arena-panel-strong">
                    <motion.div
                      className="h-full bg-big-accent"
                      initial={{ width: 0 }}
                      animate={{ width: `${bv}%` }}
                      transition={{ duration: 0.6 }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Shot DNA comparison */}
      <div className="mt-10 grid grid-cols-1 gap-8 border-t border-line pt-10 lg:grid-cols-2">
        <ShotDna data={a.shot_dna} />
        <ShotDna data={b.shot_dna} />
      </div>

      {/* Similarities / differences */}
      <div className="mt-10 grid grid-cols-1 gap-8 border-t border-line pt-10 sm:grid-cols-2">
        <div>
          <h3 className="font-display text-xl text-ink mb-3">Where they match</h3>
          <ul className="flex flex-col gap-2 text-sm text-ink-light">
            {similarities.map((s, i) => <li key={i} className="rounded-lg bg-arena-panel px-3 py-2">✓ {s}</li>)}
          </ul>
        </div>
        <div>
          <h3 className="font-display text-xl text-ink mb-3">Where they separate</h3>
          <ul className="flex flex-col gap-2 text-sm text-ink-light">
            {differences.map((d, i) => <li key={i} className="rounded-lg bg-arena-panel px-3 py-2">↔ {d}</li>)}
          </ul>
        </div>
      </div>

      {/* Raw stats table */}
      <div className="mt-10 border-t border-line pt-10">
        <h3 className="font-display text-xl text-ink mb-4">Basic Stats</h3>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div />
          <div className="break-words text-center font-semibold text-ink-light">{a.player}<span className="block text-xs font-normal text-stone">{seasonLabel(a.season)}</span></div>
          <div className="break-words text-center font-semibold text-ink-light">{b.player}<span className="block text-xs font-normal text-stone">{seasonLabel(b.season)}</span></div>
          {(["pts", "trb", "ast", "stl", "blk"] as const).map((k) => (
            <RowStat key={k} label={k.toUpperCase()} a={a.basic[k]} b={b.basic[k]} />
          ))}
        </div>
      </div>
    </div>
  );
}

function RowStat({ label, a, b }: { label: string; a: number | null; b: number | null }) {
  return (
    <>
      <div className="text-stone-light">{label}</div>
      <div className="tabular text-center text-ink-light">{fmt1(a)}</div>
      <div className="tabular text-center text-ink-light">{fmt1(b)}</div>
    </>
  );
}

function PlayerHeader({ record, align }: { record: PlayerSeasonRecord; align: "left" | "right" }) {
  // Centered when the grid is stacked to one column on mobile; only
  // actually left/right-aligned once the sm:+ three-column split layout
  // kicks in (see the grid className below) -- previously these stayed
  // left/right-aligned even while stacked, which read oddly on phones.
  const alignClasses =
    align === "right"
      ? "items-center text-center sm:items-end sm:text-right"
      : "items-center text-center sm:items-start sm:text-left";
  return (
    <div className={`flex flex-col ${alignClasses} gap-2`}>
      <PlayerPhoto playerId={record.player_id} name={record.player} posGroup={record.pos_group} size={88} />
      <h2 className="font-display break-words text-3xl leading-none text-ink">{record.player}</h2>
      <p className="text-sm text-stone">{seasonLabel(record.season)} · {record.team} · {record.pos}</p>
      <p className="rounded-full border border-line-strong px-2.5 py-1 text-xs font-medium text-ink-light">{record.archetype}</p>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1400px] px-5 py-20 md:px-8 text-stone">Loading…</div>}>
      <ComparePageInner />
    </Suspense>
  );
}
