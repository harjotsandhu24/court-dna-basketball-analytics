"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import OpponentBuilder, { type OppPick } from "@/components/OpponentBuilder";
import SimResults from "@/components/SimResults";
import StatusPanel from "@/components/StatusPanel";
import { useLoad } from "@/lib/useLoad";
import { seasonLabel } from "@/lib/config";
import { JobController } from "@/lib/sim/jobs";
import { describeError, simRunner } from "@/lib/sim/client";
import { browserSource } from "@/lib/sim/dataSource";
import { defaultSeed, requestKey, type SimRequest, type SimResult } from "@/lib/sim/engine";
import {
  DEFAULT_SETTINGS, SEASON_RANGE, loadSettings, saveSettings, type SimSettings,
} from "@/lib/simStorage";

export interface SimLineupPick { id: string; name: string; season: number }

const MODES: { value: SimSettings["mode"]; label: string; hint: string }[] = [
  { value: "season", label: "82-game season", hint: "Estimate season wins." },
  { value: "series", label: "Seven-game series", hint: "Play another lineup or team." },
  { value: "bracket", label: "Playoff bracket", hint: "Enter a historical playoff bracket." },
];
const CACHE_MAX = 8;
const field = "min-h-11 w-full rounded-lg border border-line bg-arena-panel px-3 py-2 text-sm text-ink-light";

export default function SimulatePanel({ lineup, busyNote }: { lineup: SimLineupPick[]; busyNote: string | null }) {
  const uid = useId().replace(/:/g, "");
  const [settings, setSettings] = useState<SimSettings>(DEFAULT_SETTINGS);
  const [settingsReset, setSettingsReset] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [opp, setOpp] = useState<OppPick[]>([]);
  const [oppKind, setOppKind] = useState<"lineup" | "team">("lineup");
  const [teamSeason, setTeamSeason] = useState<number>(2005);
  const [teamPick, setTeamAbbr] = useState<string>("");
  const [replacedPick, setReplaced] = useState("");
  const [seasonReplace, setSeasonReplace] = useState("");
  const [cached, setCached] = useState<{ key: string; result: SimResult } | null>(null);
  const cache = useRef(new Map<string, SimResult>());
  const resultsRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<HTMLButtonElement>(null);
  const wasRunning = useRef(false);

  const ctrl = useMemo(() => new JobController<SimRequest, SimResult>(simRunner, requestKey, describeError), []);
  const job = useSyncExternalStore(ctrl.subscribe.bind(ctrl), () => ctrl.state, () => ctrl.state);

  // Saved settings are read after mount (never during render), and only valid values are used.
  useEffect(() => {
    const { settings: s, reset } = loadSettings();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser storage after mount (not available during server render)
    setSettings(s);
    setSettingsReset(reset);
    setReady(true);
  }, []);
  useEffect(() => { if (ready) saveSettings(settings); }, [settings, ready]);

  const update = useCallback((patch: Partial<SimSettings>) => setSettings((s) => ({ ...s, ...patch })), []);

  // Real-team and bracket lists load only when needed. Each can fail and be retried without reloading the page.
  const [teamsState, retryTeams] = useLoad(
    settings.mode === "series" && oppKind === "team" ? `teams/${teamSeason}` : null,
    () => browserSource().teams(teamSeason),
  );
  const [bracketsState, retryBrackets] = useLoad(settings.mode === "bracket" ? "brackets" : null, () => browserSource().brackets());
  const brackets = bracketsState.status === "ready" ? bracketsState.data : null;
  const bracketsFailed = bracketsState.status === "error" || bracketsState.status === "notfound";

  const envSeason: number | null = settings.env === "auto" ? (lineup.length ? Math.max(...lineup.map((p) => p.season)) : null) : settings.env;
  const [envState, retryEnv] = useLoad(
    settings.mode === "season" && settings.leagueMode === "replace" && envSeason != null ? `teams/${envSeason}` : null,
    () => browserSource().teams(envSeason as number),
  );
  const envData = envState.status === "ready" ? envState.data : null;
  const envFailed = envState.status === "error" || envState.status === "notfound";
  const envOk = useMemo(() => (envData ? envData.teams.filter((t) => t.ok) : []), [envData]);
  const seasonReplaceAbbr = envOk.some((t) => t.abbr === seasonReplace) ? seasonReplace : "";

  const teams = teamsState.status === "ready" ? teamsState.data : null;
  const teamsError = teamsState.status === "error" || teamsState.status === "notfound";
  const okTeams = useMemo(() => (teams ? teams.teams.filter((t) => t.ok) : []), [teams]);
  const teamAbbr = okTeams.some((t) => t.abbr === teamPick) ? teamPick : okTeams[0]?.abbr ?? "";

  const supportedSeasons = useMemo(
    () => (brackets ? Object.entries(brackets.status).map(([s, v]) => ({ season: Number(s), ...v })).sort((a, b) => b.season - a.season) : []),
    [brackets],
  );
  const bracketSeason = settings.bracketSeason != null && brackets?.status[String(settings.bracketSeason)]?.supported ? settings.bracketSeason : null;
  const bracket = bracketSeason != null ? brackets?.brackets[String(bracketSeason)] ?? null : null;
  const bracketTeams = useMemo(
    () => (bracket ? Object.entries(bracket.teams).sort((a, b) => a[1].conf - b[1].conf || a[1].seed - b[1].seed) : []),
    [bracket],
  );
  const replaced = bracketTeams.some(([a]) => a === replacedPick) ? replacedPick : "";

  // ---- what could run right now, and why not
  const picks = useMemo(() => lineup.map((p) => ({ id: p.id, season: p.season })), [lineup]);
  const problem: string | null = (() => {
    if (lineup.length < 5) return "Add five players to simulate your lineup.";
    if (new Set(lineup.map((p) => p.id)).size < 5) return "The same player can't be in the lineup twice.";
    const early = lineup.find((p) => p.season < SEASON_RANGE[0]);
    if (early) return `${early.name}'s ${seasonLabel(early.season)} season is before ${seasonLabel(SEASON_RANGE[0])}, which the simulator doesn't cover. Choose a later season for that player.`;
    if (busyNote) return "Wait for the lineup to finish updating.";
    if (settings.mode === "season" && settings.leagueMode === "replace" && !seasonReplaceAbbr) {
      return envFailed ? "Couldn't load that league's teams. Retry, or add your lineup to the league instead." : "Choose which team your lineup replaces, or add it to the league instead.";
    }
    if (settings.mode === "series" && oppKind === "lineup") {
      if (opp.length < 5) return `Build the opponent first: ${5 - opp.length} more ${5 - opp.length === 1 ? "player" : "players"} needed.`;
      const early2 = opp.find((p) => p.season < SEASON_RANGE[0]);
      if (early2) return `${early2.name}'s ${seasonLabel(early2.season)} season isn't covered. Choose a later season.`;
    }
    if (settings.mode === "series" && oppKind === "team" && !teamAbbr) return teamsError ? "Couldn't load that season's teams. Retry below." : "Choose a team.";
    if (settings.mode === "bracket") {
      if (bracketSeason == null) return bracketsFailed ? "Couldn't load the playoff data. Retry below." : "Choose a supported postseason.";
      if (!replaced) return "Choose which team your lineup replaces.";
    }
    return null;
  })();

  const baseRequest: SimRequest | null = useMemo(() => {
    if (problem) return null;
    const seeded = <T extends Omit<SimRequest, "seed">>(r: T): SimRequest =>
      ({ ...r, seed: settings.seed ?? defaultSeed(r) }) as unknown as SimRequest;
    if (settings.mode === "season") return seeded({ mode: "season", lineup: picks, env: settings.env, replace: settings.leagueMode === "replace" ? seasonReplaceAbbr : null });
    if (settings.mode === "series") {
      const opponent = oppKind === "lineup"
        ? { kind: "lineup" as const, lineup: opp.map((p) => ({ id: p.id, season: p.season })) }
        : { kind: "team" as const, season: teamSeason, team: teamAbbr };
      return seeded({ mode: "series", lineup: picks, opponent, homeCourt: settings.homeCourt, footing: settings.footing });
    }
    return seeded({ mode: "bracket", lineup: picks, season: bracketSeason!, replaced, replay: settings.replay, footing: settings.footing, tie: settings.tieHome });
  }, [problem, picks, settings, opp, oppKind, teamSeason, teamAbbr, bracketSeason, replaced, seasonReplaceAbbr]);
  // The computed numbers are always shown (presentation, not calculation: the support check still runs and is
  // part of the result). `reveal` is therefore always on and is part of the request key.
  const request: SimRequest | null = useMemo(
    () => (baseRequest ? ({ ...baseRequest, reveal: true } as SimRequest) : null),
    [baseRequest],
  );

  const curKey = request ? requestKey(request) : null;

  // Anything that changes the request invalidates old results and any running job at once.
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastKey.current !== curKey) {
      lastKey.current = curKey;
      ctrl.invalidate();
    }
  }, [curKey, ctrl]);

  // Remember finished results (small LRU) and move focus to them for keyboard and screen-reader users.
  useEffect(() => {
    if (job.status === "done") {
      cache.current.delete(job.key);
      cache.current.set(job.key, job.result);
      while (cache.current.size > CACHE_MAX) cache.current.delete(cache.current.keys().next().value as string);
    }
  }, [job]);
  useEffect(() => {
    if (wasRunning.current && job.status === "done") resultsRef.current?.focus();
    if (wasRunning.current && (job.status === "cancelled" || job.status === "error")) runRef.current?.focus();
    wasRunning.current = job.status === "running";
  }, [job.status]);

  const shown: SimResult | null = (() => {
    if (!curKey) return null;
    if (job.status === "done" && job.key === curKey) return job.result;
    if (cached && cached.key === curKey) return cached.result;
    return null;
  })();

  function run() {
    if (!request || !curKey || ctrl.running) return;
    const hit = cache.current.get(curKey);
    if (hit) { setCached({ key: curKey, result: hit }); return; }
    setCached(null);
    ctrl.start(request);
  }

  const running = job.status === "running" && job.key === curKey;
  const mode = settings.mode;
  const seasonsAll = Array.from({ length: SEASON_RANGE[1] - SEASON_RANGE[0] + 1 }, (_, i) => SEASON_RANGE[1] - i);

  // Until five players are chosen, nothing else is offered: one short instruction, no controls.
  if (lineup.length < 5) {
    return (
      <section aria-labelledby={`${uid}-h`} className="mt-8 rounded-2xl border border-line bg-arena-panel p-6 sm:p-8" data-testid="sim-panel">
        <p className="text-eyebrow mb-1">Simulate</p>
        <h2 id={`${uid}-h`} className="font-display text-3xl text-ink">What would this five do?</h2>
        <p className="mt-2 text-sm text-stone" role="status" data-testid="sim-need-five">Add five players to simulate your lineup.</p>
      </section>
    );
  }

  // Missing-data errors name players, not ids.
  const nameOf = new Map([...lineup, ...opp].map((p) => [p.id, p.name]));
  const friendly = (msg: string) => msg.replace(/\b[a-z]{2,12}\d{2}\b/g, (id) => nameOf.get(id) ?? id);

  return (
    <section aria-labelledby={`${uid}-h`} className="mt-8 rounded-2xl border border-line bg-arena-panel p-6 sm:p-8" data-testid="sim-panel">
      <p className="text-eyebrow mb-1">Simulate</p>
      <h2 id={`${uid}-h`} className="font-display text-3xl text-ink">What would this five do?</h2>
      <p className="mt-2 max-w-2xl text-sm text-stone-light">
        Estimates how this lineup would have done, using a separate model fitted to real team results. Not a preseason forecast.
      </p>
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Lineup being simulated" data-testid="sim-lineup-summary">
        {lineup.map((p) => (
          <li key={p.id} className="rounded-full border border-line-strong px-2.5 py-1 text-xs text-ink-light">{p.name} · {seasonLabel(p.season)}</li>
        ))}
      </ul>

      <fieldset className="mt-5">
        <legend className="sr-only">What to simulate</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <label key={m.value} className={`flex min-h-11 cursor-pointer flex-col rounded-xl border px-4 py-3 text-sm focus-within:ring-2 focus-within:ring-court-orange-bright ${mode === m.value ? "border-court-orange bg-court-orange/10" : "border-line"}`}>
              <span className="flex items-center gap-2 font-semibold text-ink-light">
                <input type="radio" name={`${uid}-mode`} value={m.value} checked={mode === m.value} onChange={() => update({ mode: m.value })} className="accent-orange-500" />
                {m.label}
              </span>
              <span className="mt-1 text-xs text-stone-light">{m.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {settingsReset.length > 0 && (
        <p role="status" className="mt-3 text-xs text-stone-light">Some saved settings were not valid, so they were reset to the defaults.</p>
      )}

      {mode === "season" && (
        <div className="mt-5 space-y-3">
          <fieldset>
            <legend className="text-sm font-medium text-ink-light">Where your lineup plays</legend>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-ink-light">
              <label className="flex min-h-11 items-center gap-2"><input type="radio" name={`${uid}-league`} checked={settings.leagueMode === "add"} onChange={() => update({ leagueMode: "add" })} className="accent-orange-500" />Added to the league as an extra team</label>
              <label className="flex min-h-11 items-center gap-2"><input type="radio" name={`${uid}-league`} checked={settings.leagueMode === "replace"} onChange={() => update({ leagueMode: "replace" })} className="accent-orange-500" />Taking a real team&rsquo;s place</label>
            </div>
          </fieldset>
          {settings.leagueMode === "replace" && (
            <div>
              <label className="block text-sm text-stone sm:max-w-sm">Team to replace{envSeason != null ? ` (${seasonLabel(envSeason)})` : ""}
                <select className={field} value={seasonReplaceAbbr} onChange={(e) => setSeasonReplace(e.target.value)} disabled={!envData}>
                  <option value="">{envData ? "Choose a team…" : envFailed ? "Couldn’t load teams" : "Loading teams…"}</option>
                  {envOk.map((t) => <option key={t.abbr} value={t.abbr}>{t.name} ({t.w}–{t.l})</option>)}
                </select>
              </label>
              {envFailed && <div className="mt-2"><StatusPanel inline tone="error" title="Couldn't load that league's teams." onRetry={retryEnv} testId="env-teams-error" /></div>}
            </div>
          )}
          <p className="text-xs text-stone-light">The schedule is a balanced hypothetical one, not the real schedule. No real team is counted twice or kept when it is replaced.</p>
        </div>
      )}

      {mode === "series" && (
        <div className="mt-5 space-y-4">
          <fieldset>
            <legend className="text-sm font-medium text-ink-light">Opponent</legend>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-ink-light">
              <label className="flex min-h-11 items-center gap-2"><input type="radio" name={`${uid}-opp`} checked={oppKind === "lineup"} onChange={() => setOppKind("lineup")} className="accent-orange-500" />Another five I build</label>
              <label className="flex min-h-11 items-center gap-2"><input type="radio" name={`${uid}-opp`} checked={oppKind === "team"} onChange={() => setOppKind("team")} className="accent-orange-500" />A real team</label>
            </div>
          </fieldset>
          {oppKind === "lineup" ? (
            <OpponentBuilder value={opp} onChange={setOpp} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-stone">Season
                <select className={field} value={teamSeason} onChange={(e) => setTeamSeason(Number(e.target.value))}>
                  {seasonsAll.map((s) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
                </select>
              </label>
              <label className="text-sm text-stone">Team
                <select className={field} value={teamAbbr} onChange={(e) => setTeamAbbr(e.target.value)} disabled={!teams}>
                  {!teams && <option>{teamsError ? "Couldn’t load teams" : "Loading teams…"}</option>}
                  {okTeams.map((t) => <option key={t.abbr} value={t.abbr}>{t.name} ({t.w}–{t.l})</option>)}
                </select>
              </label>
              {teamsError && <div className="sm:col-span-2"><StatusPanel inline tone="error" title="Couldn't load that season's teams." onRetry={retryTeams} testId="teams-error" /></div>}
              {teams && teams.teams.some((t) => !t.ok) && (
                <p className="text-xs text-stone-light sm:col-span-2">Teams missing player data for this season are not listed.</p>
              )}
            </div>
          )}
          <fieldset>
            <legend className="text-sm font-medium text-ink-light">Home court</legend>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-ink-light">
              {([["you", "Your lineup"], ["opponent", "Opponent"], ["neutral", "Neutral court"]] as const).map(([v, l]) => (
                <label key={v} className="flex min-h-11 items-center gap-2"><input type="radio" name={`${uid}-hc`} checked={settings.homeCourt === v} onChange={() => update({ homeCourt: v })} className="accent-orange-500" />{l}</label>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      {mode === "bracket" && (
        <div className="mt-5 space-y-4">
          {bracketsFailed && <StatusPanel inline tone="error" title="Couldn't load the playoff data." message="Check your connection and retry." onRetry={retryBrackets} testId="brackets-error" />}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-stone">Postseason
              <select className={field} value={bracketSeason ?? ""} disabled={!brackets} onChange={(e) => { setReplaced(""); update({ bracketSeason: e.target.value ? Number(e.target.value) : null }); }}>
                <option value="">{brackets ? "Choose a postseason…" : bracketsFailed ? "Couldn’t load" : "Loading…"}</option>
                {supportedSeasons.map((s) => (
                  <option key={s.season} value={s.season} disabled={!s.supported}>
                    {seasonLabel(s.season)}{s.supported ? "" : " — not available"}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-stone">Team to replace
              <select className={field} value={replaced} onChange={(e) => setReplaced(e.target.value)} disabled={!bracket}>
                <option value="">{bracket ? "Choose a team…" : "Pick a postseason first"}</option>
                {bracketTeams.map(([abbr, t]) => <option key={abbr} value={abbr}>{t.name} ({bracket?.seedSource === "published" ? "seed" : "bracket position"} {t.seed}, {t.conf === 0 ? "East" : "West"})</option>)}
              </select>
            </label>
          </div>
          {supportedSeasons.some((s) => !s.supported) && (
            <p className="text-xs text-stone-light">
              Later postseasons are greyed out: {supportedSeasons.find((s) => !s.supported)?.reason ?? "the data needed is not available."}
            </p>
          )}
          <fieldset>
            <legend className="text-sm font-medium text-ink-light">How to replay</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {([["full", "Replay full bracket", "Simulate every round."], ["path", "Follow actual opponents", "Face the replaced team’s historical opponents."]] as const).map(([v, l, h]) => (
                <label key={v} className={`flex min-h-11 cursor-pointer flex-col rounded-xl border px-4 py-3 text-sm focus-within:ring-2 focus-within:ring-court-orange-bright ${settings.replay === v ? "border-court-orange bg-court-orange/10" : "border-line"}`}>
                  <span className="flex items-center gap-2 font-semibold text-ink-light"><input type="radio" name={`${uid}-replay`} checked={settings.replay === v} onChange={() => update({ replay: v })} className="accent-orange-500" />{l}</span>
                  <span className="mt-1 text-xs text-stone-light">{h}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      <details className="mt-5 rounded-lg border border-line px-4 py-3 text-sm">
        <summary className="min-h-6 cursor-pointer font-medium text-ink-light">Settings</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {mode === "season" && (
            <label className="text-sm text-stone">League to play in
              <select className={field} value={String(settings.env)} onChange={(e) => update({ env: e.target.value === "auto" ? "auto" : Number(e.target.value) })}>
                <option value="auto">Automatic (the season most of your players are from)</option>
                {seasonsAll.map((s) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
              </select>
            </label>
          )}
          {mode !== "season" && (
            <label className="text-sm text-stone">Benches and minutes
              <select className={field} value={settings.footing} onChange={(e) => update({ footing: e.target.value as "equal" | "real" })}>
                <option value="equal">Equal footing: top five plus an average bench for both</option>
                <option value="real">Real rotation for real teams (not like-for-like)</option>
              </select>
            </label>
          )}
          {mode === "bracket" && (
            <label className="text-sm text-stone">Home court when tied
              <select className={field} value={settings.tieHome} onChange={(e) => update({ tieHome: e.target.value as "net" | "mine" | "theirs" })}>
                <option value="net">Better point differential hosts (assumption)</option>
                <option value="mine">Your lineup hosts (assumption)</option>
                <option value="theirs">Opponent hosts (assumption)</option>
              </select>
              <span className="mt-1 block text-xs text-stone-light">Only used when records are equal and the real teams&rsquo; season series doesn&rsquo;t settle it. This is a simulation assumption, not an official tiebreak.</span>
            </label>
          )}
          <label className="text-sm text-stone">Random seed (optional)
            <input className={field} inputMode="numeric" placeholder="Automatic" value={settings.seed ?? ""}
              onChange={(e) => {
                const v = e.target.value.trim();
                if (v === "") return update({ seed: null });
                const n = Number(v);
                if (Number.isInteger(n) && n >= 0 && n < 2 ** 32) update({ seed: n });
              }} />
          </label>
        </div>
        <p className="mt-3 text-xs text-stone-light">
          Your choices here are remembered in this browser only. Saved lineups also stay in this browser: they are not sent anywhere and won&rsquo;t appear on other devices.
        </p>
        <button type="button" className="btn btn-secondary mt-3 min-h-11 px-3 py-2 text-sm" onClick={() => setSettings({ ...DEFAULT_SETTINGS, mode: settings.mode })}>Reset settings</button>
      </details>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button ref={runRef} type="button" onClick={run} disabled={!!problem || running}
          aria-describedby={problem ? `${uid}-why` : undefined}
          className="btn btn-primary min-h-11 px-5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">
          {running ? "Simulating…" : "Simulate"}
        </button>
        {running && (
          <button type="button" onClick={() => ctrl.cancel()} className="btn btn-secondary min-h-11 px-4 py-2 text-sm">Cancel</button>
        )}
      </div>
      <p id={`${uid}-why`} className="mt-2 min-h-5 text-xs text-stone-light" role="status">
        {problem}
      </p>

      <div aria-live="polite" className="mt-3">
        {running && job.status === "running" && (
          <div>
            <div role="progressbar" aria-label="Simulation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)} className="h-2.5 w-full max-w-md overflow-hidden rounded-full bg-arena-panel-strong">
              <div className="h-full rounded-full bg-court-orange-bright transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${Math.max(3, job.progress * 100)}%` }} />
            </div>
            <p className="mt-1 text-xs text-stone-light">{job.label ?? "Working…"} {Math.round(job.progress * 100)}%</p>
          </div>
        )}
        {job.status === "cancelled" && !shown && <p className="text-sm text-stone">Cancelled. Nothing was changed.</p>}
        {job.status === "error" && job.key === curKey && (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-court-orange-bright" data-testid="sim-error">
            <span>{friendly(job.message)}</span>
            <button type="button" onClick={run} className="btn btn-secondary min-h-11 px-4 py-2 text-sm">Retry</button>
          </div>
        )}
      </div>

      {shown && <div className="mt-5"><SimResults ref={resultsRef} result={shown} /></div>}
    </section>
  );
}
