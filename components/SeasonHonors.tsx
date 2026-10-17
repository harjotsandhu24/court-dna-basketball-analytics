"use client";

import { CHAMPION_NOTE, honorsFor, loadHonors, POSTSEASON_NOTE, seasonLabel, sourceNote } from "@/lib/honors";
import type { HonorsState } from "@/lib/honors";
import { useLoad } from "@/lib/useLoad";
import StatusPanel from "@/components/StatusPanel";

/**
 * Compact "Season honors" block: short badges, with the source, coverage and distinctions under "About these honors".
 * Descriptive only: nothing here feeds any score, match or simulation. A season award, playing in the playoffs for the
 * champion, verified roster membership and receiving a ring are four different facts and keep four different labels.
 * A missing record is never presented as "none" where coverage is incomplete (that wording comes from lib/honors).
 */
export default function SeasonHonors({ playerId, season }: { playerId: string; season: number }) {
  const [load, retry] = useLoad<{ state: HonorsState; source: string | null }>(`honors/${playerId}/${season}`, async () => {
    const f = await loadHonors();
    return { state: honorsFor(f, playerId, season), source: sourceNote(f, season) };
  });
  const state = load.status === "ready" ? load.data.state : null;
  const source = load.status === "ready" ? load.data.source : null;
  const hasRoster = state?.state === "honors" && state.items.some((i) => i.key === "champion" || i.key === "ring");

  return (
    <section aria-labelledby="honors-h" className="mt-5 max-w-xl" data-testid="season-honors">
      <h2 id="honors-h" className="text-eyebrow">Season honors · {seasonLabel(season)}</h2>
      {load.status === "loading" && <p className="mt-1 text-sm text-stone-light" role="status">Loading honors…</p>}
      {(load.status === "error" || load.status === "notfound") && (
        <div className="mt-2"><StatusPanel inline tone="error" title="Honors couldn't be loaded." message="The rest of the profile is unaffected." onRetry={retry} testId="honors-error" /></div>
      )}
      {state?.state === "honors" && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Honors for this season">
          {state.items.map((h) => (
            <li key={h.key} className="rounded-full border border-court-orange/50 bg-court-orange/10 px-3 py-1 text-sm font-medium text-court-orange-bright" data-honor={h.key}>
              {h.label}
            </li>
          ))}
        </ul>
      )}
      {state?.state === "none" && <p className="mt-1 text-sm text-stone">{state.message}</p>}
      {state?.state === "partial" && <p className="mt-1 text-sm text-stone">{state.message}</p>}
      {state?.state === "unavailable" && <p className="mt-1 text-sm text-stone" role="status">{state.message}</p>}
      {state && state.state !== "unavailable" && (
        <details className="mt-2 text-xs text-stone-light" data-testid="about-honors">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-ink-light">About these honors</summary>
          <div className="space-y-2 pb-1">
            {state.state === "honors" && state.items.some((h) => h.detail) && (
              <ul className="list-disc space-y-0.5 pl-5">
                {state.items.filter((h) => h.detail).map((h) => <li key={h.key}><strong className="text-ink-light">{h.label}:</strong> {h.detail}</li>)}
              </ul>
            )}
            {state.state === "honors" && state.partialNote && <p>{state.partialNote}</p>}
            {hasRoster && <p>{CHAMPION_NOTE}</p>}
            <p>{POSTSEASON_NOTE}{source ? <> {source}</> : null}</p>
            <p>Awards, All-Star selections and accolades are background information only. They never affect the playing-style score, the player&rsquo;s style label or any number on this page.</p>
          </div>
        </details>
      )}
    </section>
  );
}
