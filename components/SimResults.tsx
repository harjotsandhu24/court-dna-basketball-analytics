"use client";

import { forwardRef, useId, useState } from "react";
import Link from "next/link";
import { UNSUPPORTED_MESSAGE } from "@/lib/sim/engine";
import type { BracketOut, SeasonOut, SeriesOut, SimResult, SupportInfo } from "@/lib/sim/engine";
import type { Assessment, Dimension } from "@/lib/sim/assess";
import { seasonLabel } from "@/lib/config";
import { estimatedRecord } from "@/lib/sim/record";

/**
 * Number-first results. The default view is: the main number, one short uncertainty note, up to three strengths and
 * up to two concerns (nothing is forced when the data doesn't support them). Everything else (model statistics,
 * exact contributions, usage adjustment, assumptions, source coverage, versions) is in ONE collapsed "How it works".
 * Presentation only: the support check still runs; calculations are unchanged.
 */

export const ROUGH_NOTE = "*Rough simulation—not a reliable prediction.";
/** Shown for a lineup the support check calls unsupported. */
export const UNLIKE_TESTED = "This lineup is unlike the teams used to test the model.";

const ROUND = ["First round", "Conference semifinals", "Conference finals", "NBA Finals"];
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const signed = (x: number, d = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}`;

/** A result is uncertain unless it is both validated and inside the tested range. Uncertain headlines carry the asterisk. */
export function isUncertain(label: string, s: SupportInfo): boolean {
  return label !== "validated" || s.level !== "supported";
}

function Experimental({ label }: { label: string }) {
  const experimental = label === "experimental";
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        experimental ? "border-court-orange/60 bg-court-orange/10 text-court-orange-bright" : "border-line-strong text-ink-light"
      }`}
    >
      {experimental ? "Experimental" : label === "validated" ? "Validated" : "Estimate"}
    </span>
  );
}

/** Compact assumption labels that stay visible; the full wording is under "How it works". */
function Chips({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Simulation assumptions">
      {items.map((c) => (
        <li key={c} className="rounded-full border border-line-strong px-2 py-0.5 text-[11px] text-stone">{c}</li>
      ))}
    </ul>
  );
}

/**
 * The headline number with its asterisk, and the note that explains the asterisk directly below it. The note is
 * ordinary visible text (no hover), is referenced by the number through aria-describedby so a screen reader hears it
 * with the result, and sits in the same block as the number at every width.
 */
function Headline({
  eyebrow,
  children,
  uncertain,
  support,
}: {
  eyebrow: string;
  children: React.ReactNode;
  uncertain: boolean;
  support: SupportInfo;
}) {
  const noteId = useId();
  return (
    <div className="mt-4" data-testid="sim-headline">
      <p className="text-eyebrow">{eyebrow}</p>
      <p className="font-display text-5xl text-ink" aria-describedby={uncertain ? noteId : undefined}>
        {children}
        {uncertain && <span aria-hidden="true" data-testid="headline-asterisk">*</span>}
      </p>
      {uncertain && (
        <div id={noteId} data-testid="uncertainty-note" className="mt-1 max-w-xl text-sm text-ink-light">
          <p>{ROUGH_NOTE}</p>
          {support.level === "unsupported" && <p className="mt-1" data-testid="support-unlike">{UNLIKE_TESTED}</p>}
        </div>
      )}
    </div>
  );
}

function TakeawayList({ title, items, note }: { title: string; items: { name: string; text: string }[]; note?: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="font-display text-xl text-ink">{title}</h3>
      {note && <p className="mt-1 text-xs text-stone-light">{note}</p>}
      <ul className="mt-2 space-y-2 text-sm">
        {items.map((d) => (
          <li key={d.name}><strong className="text-ink-light">{d.name}.</strong> <span className="text-stone">{d.text}</span></li>
        ))}
      </ul>
    </div>
  );
}

const fromDims = (ds: Dimension[]) => ds.map((d) => ({ name: d.name, text: d.evidence }));

/** Up to three strengths and up to two concerns, each a measured sentence. Empty groups are simply left out. */
function Takeaways({ strengths, concerns, concernTitle, concernNote }: {
  strengths: { name: string; text: string }[];
  concerns: { name: string; text: string }[];
  concernTitle: string;
  concernNote?: string;
}) {
  if (strengths.length === 0 && concerns.length === 0) return null;
  return (
    <div className="mt-6 grid gap-6 sm:grid-cols-2" data-testid="takeaways">
      <TakeawayList title="Strengths" items={strengths.slice(0, 3)} />
      <TakeawayList title={concernTitle} items={concerns.slice(0, 2)} note={concernNote} />
    </div>
  );
}

function concernsFrom(a: Assessment) {
  const title = a.weakKind === "relative" ? "Relative weaknesses" : "Things to watch";
  const note = a.weakKind === "relative" ? "Every area is above average. These are only the weakest of them, not deficiencies." : undefined;
  return { concernTitle: title, concernNote: note, concerns: a.weakKind === "none" ? [] : fromDims(a.weaknesses) };
}

// ---------------------------------------------------------------- the one collapsed "How it works"
function HowItWorks({ children, r }: { children: React.ReactNode; r: SimResult }) {
  return (
    <details className="mt-5 rounded-lg border border-line px-4 py-3 text-sm" data-testid="how-it-works">
      <summary className="min-h-6 cursor-pointer font-medium text-ink-light">How it works</summary>
      <div className="mt-3 space-y-4 text-stone">
        {children}
        <section>
          <h4 className="font-medium text-ink-light">How well has this been tested?</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5">{r.evidence.map((x, i) => <li key={i}>{x}</li>)}</ul>
          <p className="mt-2 font-medium text-ink-light">Where the uncertainty comes from</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>{r.uncertainty.luck}</li>
            <li>{r.uncertainty.model}</li>
            <li>{r.uncertainty.evidence}</li>
            <li>{r.uncertainty.runs}</li>
          </ul>
          <p className="mt-2">{r.eraNote}</p>
        </section>
        <section>
          <h4 className="font-medium text-ink-light">Support check: {r.support.level === "supported" ? "Supported" : r.support.level === "limited" ? "Limited" : "Unsupported"}</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5">{r.support.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
          <p className="mt-2">{r.support.caveat}</p>
        </section>
        <section>
          <h4 className="font-medium text-ink-light">Assumptions</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5">{r.assumptions.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </section>
        <p className="text-xs text-stone-light">
          Seed {r.meta.seed} · model {r.meta.modelVersion} · data {r.meta.dataVersion}. The same players, settings and seed always give this same answer.{" "}
          <Link href="/methodology" className="font-medium text-court-orange-bright hover:underline">Read the methodology</Link>
        </p>
      </div>
    </details>
  );
}

function WinsChart({ dist, lo, hi }: { dist: number[]; lo: number; hi: number }) {
  const bins: { from: number; p: number }[] = [];
  for (let w = 0; w <= 82; w += 3) bins.push({ from: w, p: dist.slice(w, w + 3).reduce((s, v) => s + v, 0) });
  const max = Math.max(...bins.map((b) => b.p));
  return (
    <div role="img" aria-label={`Spread of simulated win totals. Eight in ten seasons landed between ${lo} and ${hi} wins.`} className="mt-3 max-w-md">
      <div className="flex h-24 items-end gap-px" aria-hidden="true">
        {bins.map((b) => {
          const inside = b.from + 2 >= lo && b.from <= hi;
          return <div key={b.from} className={`flex-1 rounded-t ${inside ? "bg-court-orange-bright" : "bg-line-strong"}`} style={{ height: `${Math.max(2, (b.p / max) * 100)}%` }} />;
        })}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-stone-light" aria-hidden="true"><span>0 wins</span><span>41</span><span>82 wins</span></div>
    </div>
  );
}

// ---------------------------------------------------------------- 82-game season
function Season({ r }: { r: SeasonOut }) {
  const m = r.meta;
  const showRange = !r.support.shownAnyway;
  const uncertain = isUncertain(m.status.label, r.support);
  const c = concernsFrom(r.assessment);
  const rec = r.wins && r.net != null ? estimatedRecord(r.wins.mean) : null; // display only: round wins once, losses = 82 - wins
  return (
    <>
      <div className="flex flex-wrap items-center gap-2"><Experimental label={m.status.label} /></div>
      <Chips items={["Average bench", "Healthy players", `${seasonLabel(r.env)} league`]} />
      {r.wins && r.net != null && rec ? (
        <>
          <Headline eyebrow="Estimated record" uncertain={uncertain} support={r.support}>
            <span className="tabular" aria-hidden="true" data-testid="sim-record">{rec.text}</span>
            <span className="sr-only" data-testid="sim-record-spoken">{rec.spoken}</span>
          </Headline>
          {showRange && (
            <p className="mt-2 text-sm text-ink-light" data-testid="sim-range">
              Likely range: <strong className="tabular">{r.wins.lo}–{r.wins.hi}</strong> wins
            </p>
          )}
        </>
      ) : (
        <p role="alert" className="mt-4 text-sm text-court-orange-bright">The numbers for this lineup aren&rsquo;t available.</p>
      )}
      <Takeaways strengths={fromDims(r.assessment.strengths)} {...c} />
      <HowItWorks r={r}>
        {r.wins && r.net != null && rec && (
          <section>
            <h4 className="font-medium text-ink-light">Model statistics</h4>
            <dl className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-eyebrow">Expected net rating</dt>
                <dd className="tabular text-ink-light">{signed(r.net)} per 100 possessions{showRange && r.netRange ? <span className="text-xs text-stone-light"> (typical error ±{(r.netRange[1] - r.net).toFixed(1)})</span> : null}</dd>
              </div>
              {r.ortg != null && r.ortgRange && (
                <div>
                  <dt className="text-eyebrow">Expected offensive rating</dt>
                  <dd className="tabular text-ink-light">{r.ortg.toFixed(1)}{showRange ? <span className="text-xs text-stone-light"> (typical error ±{(r.ortgRange[1] - r.ortg).toFixed(1)}, {seasonLabel(r.env)} scale)</span> : null}</dd>
                </div>
              )}
            </dl>
            <p className="mt-1 text-xs text-stone-light">An expected defensive rating isn&rsquo;t shown. In testing on later seasons, box-score stats explained defense too weakly to report it as a number.</p>
            {showRange ? (
              <>
                <p className="mt-2">
                  80% range if the model is as accurate here as on real teams: <strong className="tabular">{r.wins.lo}–{r.wins.hi}</strong> wins. Game luck alone would give {r.wins.luck.lo}–{r.wins.luck.hi}; the rest of the width is the model&rsquo;s own error. Nothing has measured it for invented lineups, so it may be too narrow. More simulated seasons don&rsquo;t narrow it.
                </p>
                <WinsChart dist={r.wins.dist} lo={r.wins.lo} hi={r.wins.hi} />
              </>
            ) : (
              <p className="mt-2 text-xs text-stone-light">No range is shown: nothing supports one for a lineup like this.</p>
            )}
          </section>
        )}
        <section>
          <h4 className="font-medium text-ink-light">Contribution of each area</h4>
          <p className="mt-1 text-xs text-stone-light">Points of net rating per 100 possessions compared with an average lineup, from the fitted model. They are not scores out of 100.</p>
          <ul className="mt-1 space-y-1.5">
            {r.assessment.dimensions.map((d) => (
              <li key={d.name}><strong className="text-ink-light">{d.name}</strong> <span className="tabular text-stone-light">{signed(d.value)}</span><br /><span className="text-xs">{d.evidence}</span></li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-stone-light">{r.defenseNote}</p>
        </section>
        <section>
          <h4 className="font-medium text-ink-light">Sharing one ball</h4>
          <p className="mt-1">
            The starters&rsquo; shot volume was scaled to {pct(r.assessment.usage.scale)} of what they had on their own teams
            {r.usageScaleLimited ? " (the limit of what the model allows, so this lineup's usage doesn't reconcile well)" : ""}. Effect on the estimate: {signed(r.assessment.usage.effectNet, 2)}.
          </p>
        </section>
      </HowItWorks>
    </>
  );
}

// ---------------------------------------------------------------- seven-game series
function Series({ r }: { r: SeriesOut }) {
  const games = [4, 5, 6, 7];
  const hcText = r.homeCourt === "neutral" ? "Neutral court" : r.homeCourt === "you" ? "Your lineup hosts" : "Opponent hosts";
  const showRange = !r.support.shownAnyway;
  const uncertain = isUncertain(r.meta.status.label, r.support);
  const chips = [r.comparison === "equal" ? "Average bench" : "Opponent's real rotation", "Healthy players", hcText];
  const factors = r.factors ?? [];
  const mine = factors.filter((f) => f.diff > 0).map((f) => ({ name: f.name, text: `Your lineup: ${f.a} Opponent: ${f.b}` }));
  const theirs = factors.filter((f) => f.diff < 0).map((f) => ({ name: f.name, text: `Opponent: ${f.b} Your lineup: ${f.a}` }));
  return (
    <>
      <div className="flex flex-wrap items-center gap-2"><Experimental label={r.meta.status.label} /></div>
      <Chips items={chips} />
      {r.pA != null && r.lengthA && r.lengthB && r.pARange && r.pAExact != null && r.expectedGames != null ? (
        <>
          <Headline eyebrow="Chance to win the series" uncertain={uncertain} support={r.support}>
            <span className="tabular">{pct(r.pA)}</span>
          </Headline>
          <p className="mt-1 text-sm text-ink-light">{r.a.label} {pct(r.pA)} · {r.b.label} {pct(1 - r.pA)}</p>
          {showRange && (
            <p className="mt-1 text-sm text-ink-light" data-testid="sim-range">Likely range: <strong className="tabular">{pct(r.pARange[0])}–{pct(r.pARange[1])}</strong></p>
          )}
          <Takeaways strengths={mine} concerns={theirs} concernTitle="Things to watch" />
        </>
      ) : (
        <p role="alert" className="mt-4 text-sm text-court-orange-bright">The numbers for this matchup aren&rsquo;t available.</p>
      )}
      <HowItWorks r={r}>
        {r.pA != null && r.lengthA && r.lengthB && r.pARange && r.pAExact != null && r.expectedGames != null && (
          <>
            <section>
              <h4 className="font-medium text-ink-light">Model statistics</h4>
              <p className="mt-1">
                With the ratings exactly right (game luck only): {pct(r.pAExact)}.{" "}
                {showRange
                  ? <>If the model&rsquo;s strength estimates are off by a typical amount, your chance could run from {pct(r.pARange[0])} to {pct(r.pARange[1])}. That model error doesn&rsquo;t go away with more runs, and it hasn&rsquo;t been measured for invented lineups.</>
                  : <>No range is shown: nothing supports one for a lineup like this.</>}
              </p>
              <table className="mt-2 w-full max-w-md text-sm">
                <caption className="sr-only">Chance the series ends in 4, 5, 6 or 7 games, by winner</caption>
                <thead><tr className="text-left text-xs text-stone-light"><th scope="col" className="py-1 font-medium">Games</th><th scope="col" className="font-medium">You win</th><th scope="col" className="font-medium">Opponent wins</th></tr></thead>
                <tbody>
                  {games.map((g) => (
                    <tr key={g} className="border-t border-line"><th scope="row" className="py-1 text-left font-medium text-ink-light">{g}</th><td className="tabular">{pct(r.lengthA![g], 1)}</td><td className="tabular">{pct(r.lengthB![g], 1)}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-stone-light">Average series length: {r.expectedGames.toFixed(1)} games.</p>
            </section>
            {factors.length > 0 && (
              <section>
                <h4 className="font-medium text-ink-light">Three biggest differences</h4>
                <ul className="mt-1 space-y-2">
                  {factors.map((f) => (
                    <li key={f.name}>
                      <strong className="text-ink-light">{f.name}</strong>{" "}
                      <span className="tabular text-stone-light">{f.diff >= 0 ? `${signed(f.diff)} for you` : `${signed(-f.diff)} for the opponent`}</span>
                      <br /><span className="text-xs">You: {f.a}</span>
                      <br /><span className="text-xs">Opponent: {f.b}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-stone-light">Points of net rating per 100 possessions, from the fitted model. It measures how much each area adds; it does not say how a coach would use it. Steals, blocks &amp; defensive rebounds are associations with fitted net rating, not measured defensive impact.</p>
              </section>
            )}
            <section>
              <h4 className="font-medium text-ink-light">Example series</h4>
              <p className="text-xs text-stone-light">Eight random series from seed {r.meta.seed}, to show how much one series can vary.</p>
              <ul className="mt-1 flex flex-wrap gap-2 text-sm" aria-label="Example series results">
                {r.examples.map((e, i) => (
                  <li key={i} className={`tabular rounded-md border px-2 py-1 ${e.winsA > e.winsB ? "border-court-orange/50 text-court-orange-bright" : "border-line text-stone"}`}>You {e.winsA}–{e.winsB}</li>
                ))}
              </ul>
            </section>
          </>
        )}
        <p className="text-xs text-stone-light">{r.comparison === "equal" ? "Equal-bench comparison: both sides are five starters plus the same average bench." : "Not an equal comparison: the opponent keeps its real rotation and your lineup has an average bench."} {r.b.footingNote}</p>
      </HowItWorks>
    </>
  );
}

// ---------------------------------------------------------------- playoff bracket
function SeriesLine({ s, r }: { s: { hc: string; other: string; winner: string; winsHc: number; winsOther: number }; r: BracketOut }) {
  const name = (t: string) => (t === r.replaced ? `Your lineup (${t} slot)` : r.teamNames[t]);
  const seed = (t: string) => (r.seeds[t] != null ? ` (${r.seeds[t]})` : "");
  const row = (t: string, wins: number) => (
    <span className={`flex justify-between gap-2 ${t === s.winner ? "font-semibold text-ink" : "text-stone"}`}>
      <span className="min-w-0 truncate">{name(t)}{seed(t)}</span>
      <span className="tabular">{wins}</span>
    </span>
  );
  return (
    <li className={`rounded-lg border px-3 py-2 text-sm ${s.hc === r.replaced || s.other === r.replaced ? "border-court-orange/60 bg-court-orange/10" : "border-line"}`}>
      {row(s.hc, s.winsHc)}
      {row(s.other, s.winsOther)}
      <span className="sr-only">{name(s.winner)} won the series.</span>
    </li>
  );
}

/**
 * One simulated bracket, round by round. Wide screens show the four rounds side by side; on a phone the rounds
 * stack and a selector jumps to one, so nothing needs sideways scrolling.
 */
function SampleView({ r }: { r: BracketOut }) {
  const sample = r.sample!;
  const [round, setRound] = useState<number | "all">("all");
  const rid = useId();
  const mine = sample.series.filter((s) => s.hc === r.replaced || s.other === r.replaced);
  const last = mine[mine.length - 1];
  const youWon = sample.champion === r.replaced;
  const outcome = youWon
    ? "In this sample your lineup won the title."
    : last
      ? `In this sample your lineup lost in the ${ROUND[last.round - 1].toLowerCase()}.`
      : "";
  return (
    <section className="mt-6" aria-labelledby={`${rid}-h`} data-testid="bracket-sample">
      <h3 id={`${rid}-h`} className="font-display text-xl text-ink">Sample simulated bracket</h3>
      <p className="mt-1 max-w-xl text-xs text-stone-light">
        One simulated run, drawn at random. It is an example of how a bracket can go, not the most likely outcome. Advancement chances come from all {r.full?.n.toLocaleString()} runs and are in &ldquo;How it works&rdquo;.
      </p>
      {outcome && <p className="mt-2 text-sm font-medium text-ink-light" data-testid="sample-outcome">{outcome}</p>}
      <div className="mt-3">
        <label htmlFor={`${rid}-round`} className="text-xs text-stone-light">Show round </label>
        <select
          id={`${rid}-round`}
          value={String(round)}
          onChange={(e) => setRound(e.target.value === "all" ? "all" : Number(e.target.value))}
          className="min-h-11 rounded-md border border-line-strong bg-arena-panel px-2 py-1 text-base text-ink-light outline-none focus:border-court-orange sm:text-sm"
        >
          <option value="all">All rounds</option>
          {ROUND.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
        </select>
      </div>
      <div className="mt-3 grid gap-4 md:grid-cols-4">
        {ROUND.map((name, i) => {
          if (round !== "all" && round !== i + 1) return null;
          const list = sample.series.filter((s) => s.round === i + 1);
          return (
            <div key={name} className={round === "all" ? "" : "md:col-span-4"}>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-stone-light">{name}</h4>
              <ol className="space-y-2" aria-label={`${name}, sample bracket`}>
                {list.map((s) => <SeriesLine key={s.id} s={s} r={r} />)}
              </ol>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-stone-light">Champion in this sample: {sample.champion === r.replaced ? "your lineup" : r.teamNames[sample.champion]}. Numbers beside the names are series wins. Seeds are shown in brackets.</p>
    </section>
  );
}

function Bracket({ r }: { r: BracketOut }) {
  const f = r.full;
  const uncertain = isUncertain(r.meta.status.label, r.support);
  const rows = f ? [...f.teams].sort((a, b) => f.champion[b] - f.champion[a] || (a < b ? -1 : 1)) : [];
  const full = r.replay === "full";
  const chips = ["Average bench", "Healthy players", seasonLabel(r.season) + " playoffs"];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2"><Experimental label={r.meta.status.label} /></div>
      <h3 className="mt-2 font-display text-2xl text-ink">
        {full ? "Replay full bracket" : "Follow actual opponents"} · {seasonLabel(r.season)} playoffs
      </h3>
      <Chips items={chips} />
      {f && (
        <>
          <Headline eyebrow="Chance to win the title" uncertain={uncertain} support={r.support}>
            <span className="tabular">{pct(f.you.champion, 1)}</span>
          </Headline>
          <p className="mt-1 text-sm text-ink-light">Your lineup, in the {r.replaced} slot, in {f.n.toLocaleString()} full-bracket replays.</p>
          {r.sample && <SampleView r={r} />}
        </>
      )}
      {r.path && (
        <>
          <Headline eyebrow="Chance to win every series on this path" uncertain={uncertain} support={r.support}>
            <span className="tabular">{pct(r.path.pWinAll, 1)}</span>
          </Headline>
          <p className="mt-2 max-w-xl text-sm text-ink-light">
            A hypothetical: your lineup plays the <strong>actual</strong> opponents of the team it replaced, in order, until the point where that team really lost. This is not a bracket simulation, so there are no title odds.
            {r.history.replacedExit ? ` Historically the team lost in the ${ROUND[r.history.replacedExit.round - 1].toLowerCase()}.` : ""}
          </p>
          <ol className="mt-3 space-y-2 text-sm" aria-label="Series on the historical path">
            {r.path.steps.map((s) => (
              <li key={s.step.seriesId} className="rounded-lg border border-line px-3 py-2">
                <strong className="text-ink-light">{ROUND[s.step.round - 1]}</strong> vs {r.path!.opponents[s.step.opponent]}
                <span className="text-xs text-stone-light"> ({r.neutral ? "neutral court" : s.step.customHasHomeCourt ? "you host games 1, 2" : "opponent hosts games 1, 2"}, best of {s.step.need * 2 - 1})</span>
                <br />
                <span className="tabular text-stone">Reach this series {pct(s.pReach)} · win it if you get there {pct(s.pWinGivenReach)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      {!f && !r.path && <p role="alert" className="mt-4 text-sm text-court-orange-bright">The numbers for this bracket aren&rsquo;t available.</p>}
      <HowItWorks r={r}>
        {f && (
          <section>
            <h4 className="font-medium text-ink-light">Advancement probabilities</h4>
            <p className="mt-1 text-xs text-stone-light">Every number comes from the same {f.n.toLocaleString()} simulated brackets, so each team&rsquo;s title chance is consistent with the rounds before it.</p>
            <div className="relative mt-2 overflow-x-auto" role="region" aria-label="Advancement probabilities table, scrolls sideways on narrow screens" tabIndex={0}>
              <table className="w-full min-w-[460px] text-sm">
                <caption className="sr-only">Chance each team reaches each round and wins the title</caption>
                <thead><tr className="text-left text-xs text-stone-light">
                  <th scope="col" className="py-1 font-medium">Team</th><th scope="col" className="font-medium">{r.seedSource === "published" ? "Seed*" : "Reconstructed bracket position*"}</th>
                  <th scope="col" className="font-medium">Champion</th><th scope="col" className="font-medium">Finals</th>
                  <th scope="col" className="font-medium">Conf. finals</th><th scope="col" className="font-medium">Second round</th>
                </tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t} className={`border-t border-line ${t === r.replaced ? "bg-court-orange/10 font-semibold text-ink" : "text-ink-light"}`}>
                      <th scope="row" className="py-1 text-left font-medium">{r.teamNames[t]}</th>
                      <td className="tabular">{r.seeds[t]}</td>
                      <td className="tabular">{pct(f.champion[t], 1)}</td><td className="tabular">{pct(f.reach[t][3])}</td>
                      <td className="tabular">{pct(f.reach[t][2])}</td><td className="tabular">{pct(f.reach[t][1])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-stone-light">
              {r.seedSource === "published"
                ? "*Published playoff seed (from Wikipedia's tables, checked against the real bracket; not an NBA-issued table). A seed is not home court: the better regular-season record hosts."
                : "*Rebuilt from the bracket shape because no verified seed table was available. It shows position only; home court follows regular-season record."}
            </p>
          </section>
        )}
        <section>
          <h4 className="font-medium text-ink-light">Home court</h4>
          <p className="mt-1">{r.tieNote}</p>
        </section>
        <p className="text-xs text-stone-light">{r.footingNote}</p>
      </HowItWorks>
    </>
  );
}

const SimResults = forwardRef<HTMLDivElement, { result: SimResult }>(function SimResults({ result }, ref) {
  return (
    <div ref={ref} tabIndex={-1} aria-label="Simulation results" className="rounded-2xl border border-court-orange/30 bg-gradient-to-br from-arena-panel to-arena-panel-strong p-5 outline-none sm:p-8" data-testid="sim-results">
      {result.mode === "season" && <Season r={result} />}
      {result.mode === "series" && <Series r={result} />}
      {result.mode === "bracket" && <Bracket r={result} />}
    </div>
  );
});
export default SimResults;

// kept so the engine's wording and this view can't drift apart
export { UNSUPPORTED_MESSAGE };
