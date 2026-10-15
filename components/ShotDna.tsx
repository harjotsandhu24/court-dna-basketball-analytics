"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { ShotDna as ShotDnaData } from "@/lib/types";
import { loadShotBaselines, type ShotBaselines } from "@/lib/dataLoader";
import {
  DISTANCE_CAPTION,
  baselineLabel,
  computeBandStats,
  distributionStatus,
  fmtPct,
  toggleZone,
  type ShotZoneKey,
  DEEP_BAND,
  type BandStat,
  type SeasonBaseline,
} from "@/lib/shotZones";
import {
  decodeShots,
  loadPlayerShots,
  markerPath,
  markerState,
  zoneShooting,
  type LocationsSummary,
  type Shot,
  type ShotBaseline,
  type ShotFilter,
} from "@/lib/shotLocations";
import { isHoverPointer, placeTooltip, previewZone, tooltipContent, type CountBasis } from "@/lib/shotTooltip";
import { BASKET, COURT_H, COURT_W, DEEP_R, RADII, ZONE_ORDER, SHORT_LINE_LAST_SEASON, boundaryPathsFor, threeLineFor, threePointLinePath, zonePathsFor } from "@/lib/courtGeometry";

const COURT_BG = "#111820";
const LINE_COLOR = "#64748B";
const HOVER_COLOR = "#93C5FD";
const SELECT_COLOR = "#60A5FA";
const UNAVAILABLE = "Shot locations aren’t available for this season.";
const MADE_COLOR = "#5eead4";
const MISSED_COLOR = "#fb923c";
const DOT_R = 3.2;
const FILTERS: { key: ShotFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "made", label: "Made" },
  { key: "missed", label: "Missed" },
];
/** Where a keyboard-focused zone's tooltip is anchored (SVG units; the same points the labels use). */
const ANCHOR: Record<ShotZoneKey, { x: number; y: number }> = {
  x0_3: { x: 250, y: 52.5 }, x3_10: { x: 250, y: 117 }, x10_16: { x: 250, y: 182 }, x16_3p: { x: 250, y: 262 }, x3p: { x: 250, y: 325 }, x3d: { x: 250, y: 375 },
};

/** What every zone shows on the court, in the tooltip and in the details: one shape for exact and estimated data. */
interface ZoneView {
  key: ShotZoneKey;
  name: string;
  simple: string;
  short: string;
  share: number | null;
  pct: number | null;
  attempts: number | null;
  makes: number | null;
  none: boolean;
  small: boolean;
  basis: CountBasis;
  /** distance-band source stat; absent for deep threes (they exist only in located shots) */
  stat: BandStat | null;
}

interface Ui {
  data: ShotDnaData;
  zone: ShotZoneKey | null;
  filter: ShotFilter;
  hover: ShotZoneKey | null;
  focus: ShotZoneKey | null;
  dismissed: boolean;
}
const fresh = (data: ShotDnaData): Ui => ({ data, zone: null, filter: "all", hover: null, focus: null, dismissed: false });
/** Touch-first devices (no hover) get the tap instruction. */
const COARSE = "(hover: none)";
const coarseNow = () => typeof window !== "undefined" && window.matchMedia(COARSE).matches;
const subscribeCoarse = (cb: () => void) => {
  const m = window.matchMedia(COARSE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const fmtN = (n: number) => n.toLocaleString("en-US");

export default function ShotDna({
  data,
  season,
  playerId,
  compact = false,
}: {
  data: ShotDnaData;
  season?: number;
  playerId?: string;
  compact?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const clipId = `shotdna-clip-${uid}`;
  const descId = `shotdna-note-${uid}`;
  const tipId = `shotdna-tip-${uid}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  // Selection, filter and tooltip state belong to one player-season: a different record clears all of it.
  const [uiState, setUi] = useState<Ui>(() => fresh(data));
  const ui = uiState.data === data ? uiState : fresh(data);
  if (uiState.data !== data) setUi(ui);
  const { zone, filter } = ui;
  const [baselines, setBaselines] = useState<ShotBaselines | null>(null);
  const [wantDots, setWantDots] = useState(false);
  const [retry, setRetry] = useState(0);
  const [shotState, setShotState] = useState<{ key: string; retry: number; status: "ok" | "error"; shots?: Shot[] } | null>(null);

  const touch = useSyncExternalStore(subscribeCoarse, coarseNow, () => false);
  const loc = data.locations ?? null;
  const available = loc != null && !!playerId && season != null;
  const key = `${season}/${playerId}`;

  useEffect(() => {
    let live = true;
    loadShotBaselines().then((b) => live && setBaselines(b)).catch(() => live && setBaselines(null));
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!wantDots || !available) return;
    let live = true;
    loadPlayerShots(playerId as string, season as number)
      .then((f) => live && setShotState({ key, retry, status: "ok", shots: decodeShots(f) }))
      .catch(() => live && setShotState({ key, retry, status: "error" }));
    return () => { live = false; };
  }, [wantDots, available, key, retry, playerId, season]);

  const current = shotState && shotState.key === key && shotState.retry === retry ? shotState : null;
  const loading = wantDots && available && current == null;
  const dots = wantDots && available && current?.status === "ok" ? current.shots ?? null : null;
  const dotsOn = dots != null;

  const baseline = season != null ? baselines?.seasons[String(season)] ?? null : null;
  // the located-shot baseline (zones split at 30 ft) only pairs with located shots, never with the combined distance-band fallback
  const shotBaseline = loc && baseline?.shots && baseline.shots.exact_counts ? baseline.shots : null;
  const exact = loc != null;
  const recordedOnly = loc != null && loc.status !== "exact";
  const stats = computeBandStats(data, baseline);
  const paths = zonePathsFor(season, loc != null);
  const zones = loc ? ZONE_ORDER : ZONE_ORDER.filter((k) => k !== "x3d");
  const boundaries = boundaryPathsFor(season);

  const views = useMemo(() => {
    const out = {} as Record<ShotZoneKey, ZoneView>;
    if (loc) {
      // located shots: the three-point total is split at 30 ft (x3p = under 30 ft, x3d = 30+ ft); the two-point bands are unchanged
      const meta = [...stats.map((s) => ({ ...s, stat: s as BandStat | null })), { ...DEEP_BAND, stat: null as BandStat | null }];
      for (const m of meta) {
        const z = zoneShooting(loc, m.key);
        out[m.key] = { key: m.key, name: m.name, simple: m.key === "x3p" ? "Three-pointers · beyond the line, under 30 ft" : m.simple, short: m.short, share: z.share, pct: z.pct, attempts: z.attempts, makes: z.makes,
          none: z.attempts === 0, small: z.attempts > 0 && z.attempts < 20, basis: loc.status === "exact" ? "exact" : "recorded", stat: m.stat };
      }
    }
    if (!loc) {
      for (const s of stats) {
        out[s.key] = { key: s.key, name: s.name, simple: s.simple, short: s.short, share: s.share, pct: s.fgPct, attempts: s.attempts, makes: s.makes,
          none: s.state === "source_none", small: s.smallSample, basis: "estimated", stat: s };
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loc, baseline]);

  const selected = zone ? views[zone] : null;
  const preview = previewZone(ui.hover, ui.focus, ui.dismissed);
  const previewKind: "hover" | "focus" = !ui.dismissed && ui.hover ? "hover" : "focus";
  const emphasis = preview ?? zone;
  const choose = (k: ShotZoneKey) => setUi((u) => (u.data !== data ? u : { ...u, zone: toggleZone(u.zone, k) }));
  const status = data.distribution_status ?? distributionStatus(data.shares_total);

  const shapes = useMemo(() => {
    if (!dots) return null;
    const groups = { made: { normal: [] as Shot[], emphasis: [] as Shot[], dim: [] as Shot[] }, missed: { normal: [] as Shot[], emphasis: [] as Shot[], dim: [] as Shot[] } };
    for (const s of dots) {
      const st = markerState(s, filter, emphasis);
      if (st === "hidden") continue;
      groups[s.made ? "made" : "missed"][st].push(s);
    }
    const build = (kind: "made" | "missed") =>
      (["normal", "emphasis", "dim"] as const).map((st) => ({ kind, st, d: markerPath(groups[kind][st], kind, DOT_R) }));
    return [...build("missed"), ...build("made")].filter((p) => p.d);
  }, [dots, filter, emphasis]);

  // ---- temporary tooltip: pointer hover (mouse/pen only) and keyboard focus ----
  const tipZone = preview;
  const place = () => {
    const el = tipRef.current;
    const at = pointer.current;
    if (!el || !at) return;
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const p = placeTooltip(at, { w: r.width, h: r.height }, { w: vw, h: vh });
    el.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`;
    el.style.visibility = "visible";
  };
  useLayoutEffect(place, [tipZone, ui.data]);
  useEffect(() => {
    if (!tipZone) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setUi((u) => ({ ...u, dismissed: true })); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tipZone]);

  const zoneFrom = (t: EventTarget | null): ShotZoneKey | null => {
    const el = (t as Element | null)?.closest?.("[data-zone]");
    return (el?.getAttribute("data-zone") as ShotZoneKey | null) ?? null;
  };
  const setHover = (k: ShotZoneKey | null) =>
    setUi((u) => (u.data !== data ? u : u.hover === k ? u : { ...u, hover: k, dismissed: k != null ? false : u.dismissed }));
  const setFocus = (k: ShotZoneKey | null) =>
    setUi((u) => (u.data !== data ? u : u.focus === k ? u : { ...u, focus: k, dismissed: k != null ? false : u.dismissed }));

  const targetProps = (k: ShotZoneKey) => {
    const v = views[k];
    const isSel = zone === k;
    const detail = v.none ? "no attempts" : `${fmtPct(v.share)} of shots, ${fmtPct(v.pct)} shooting`;
    return {
      role: "button" as const,
      tabIndex: 0,
      "aria-pressed": isSel,
      "aria-label": `${v.simple}: ${detail}. ${isSel ? "Selected. Activate to clear." : "Activate to select."}`,
      "aria-describedby": tipZone === k ? tipId : undefined,
      "data-zone": k,
      onClick: () => choose(k),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(k); }
      },
      onFocus: (e: React.FocusEvent<SVGPathElement>) => {
        if (!e.currentTarget.matches(":focus-visible")) return;
        const svg = svgRef.current;
        const m = svg?.getScreenCTM();
        if (svg && m) {
          const p = svg.createSVGPoint();
          p.x = ANCHOR[k].x;
          p.y = ANCHOR[k].y;
          const c = p.matrixTransform(m);
          pointer.current = { x: c.x, y: c.y };
        }
        setFocus(k);
      },
      onBlur: () => setUi((u) => (u.focus === k ? { ...u, focus: null } : u)),
      className: "cursor-pointer outline-none",
      style: { WebkitTapHighlightColor: "transparent" },
    };
  };

  const tip = tipZone ? tooltipContent({ name: tipZone === "x3p" ? "Three-pointers" : tipZone === "x3d" ? DEEP_BAND.simple : views[tipZone].short, attempts: views[tipZone].attempts, makes: views[tipZone].makes, pct: views[tipZone].pct, none: views[tipZone].none, basis: views[tipZone].basis }) : null;
  const toggleNote = !available ? UNAVAILABLE : null;

  return (
    <div className="w-full">
      <div className="mb-1.5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <span className="text-eyebrow">Shooting Profile</span>
          <p className="mt-0.5 text-xs text-stone-light" data-testid="shot-instruction">{touch ? "Tap a zone to see shooting stats." : "Hover for stats. Click to keep a zone selected."}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={wantDots && available}
          disabled={!available}
          aria-describedby={toggleNote ? descId : undefined}
          onClick={() => setWantDots((v) => !v)}
          data-testid="show-shots"
          className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs text-ink-light disabled:cursor-not-allowed disabled:opacity-50 aria-checked:border-[#ffb27a] aria-checked:text-ink"
        >
          <span className={`inline-block h-3.5 w-6 rounded-full border border-line p-px transition-colors motion-reduce:transition-none ${wantDots && available ? "bg-[#ffb27a]/70" : "bg-transparent"}`} aria-hidden="true">
            <span className={`block h-2.5 w-2.5 rounded-full bg-ink transition-transform motion-reduce:transition-none ${wantDots && available ? "translate-x-2.5" : ""}`} />
          </span>
          Show shots
        </button>
      </div>
      {toggleNote && <p id={descId} className="mb-1.5 text-[11px] text-stone-light" data-testid="shots-unavailable">{toggleNote}</p>}
      {loading && <p className="mb-1.5 text-[11px] text-stone-light" role="status">Loading shots…</p>}
      {wantDots && available && current?.status === "error" && (
        <p className="mb-1.5 text-[11px] text-stone-light" role="alert">
          Couldn’t load shot locations.{" "}
          <button type="button" className="underline" onClick={() => setRetry((n) => n + 1)}>Try again</button>
        </p>
      )}

      {dotsOn && (
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2" data-testid="dot-controls">
          <div role="group" aria-label="Which shots to show" className="inline-flex overflow-hidden rounded-full border border-line text-xs">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setUi((u) => (u.data !== data ? u : { ...u, filter: f.key }))}
                className={`px-3 py-1 ${filter === f.key ? "bg-[#ffb27a]/25 text-ink" : "text-ink-light"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <span className="inline-flex items-center gap-3 text-[11px] text-stone-light" aria-label="Legend: made and missed shots" data-testid="dot-legend">
            <span className="inline-flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill={MADE_COLOR} /></svg>Made
            </span>
            <span className="inline-flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke={MISSED_COLOR} strokeWidth="2" strokeLinecap="round" /></svg>Missed
            </span>
          </span>
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${COURT_W} ${COURT_H}`}
        className="mx-auto block w-full max-w-[520px] rounded-md border border-line"
        style={{ background: COURT_BG }}
        role="group"
        aria-label="Shooting profile half-court by zone"
        onPointerMove={(e) => {
          if (!isHoverPointer(e.pointerType)) { setHover(null); return; }
          pointer.current = { x: e.clientX, y: e.clientY };
          const z = zoneFrom(e.target);
          if (z === ui.hover) place();   // same zone: just follow the cursor, no re-render
          else setHover(z);
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id={clipId}><rect x="0" y="0" width={COURT_W} height={COURT_H} /></clipPath>
        </defs>
        <rect x="0" y="0" width={COURT_W} height={COURT_H} fill={COURT_BG} pointerEvents="none" />

        {/* invisible zone areas: the whole band is the hover/click target; they never change appearance */}
        <g clipPath={`url(#${clipId})`}>
          {zones.map((k) => (
            <path key={k} d={paths[k]} fillRule="evenodd" fill="transparent" stroke="none" {...targetProps(k)} />
          ))}
        </g>

        <g fill="none" pointerEvents="none" clipPath={`url(#${clipId})`}>
          {/* supplementary distance guides (3, 10, 16 ft): subdued and dashed */}
          <g stroke={LINE_COLOR} strokeWidth="1.25" strokeDasharray="3 5" opacity="0.55" data-testid="distance-guides">
            {(loc ? [RADII.rim, RADII.close, RADII.mid, DEEP_R] : [RADII.rim, RADII.close, RADII.mid]).map((r) => (
              <circle key={r} cx={BASKET.x} cy={BASKET.y} r={r} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
          {/* official markings: solid */}
          <g stroke={LINE_COLOR} strokeWidth="1.75" data-testid="court-markings">
            <path d={threePointLinePath(threeLineFor(season))} vectorEffect="non-scaling-stroke" data-testid="three-point-line" />
            <rect x="170" y="0" width="160" height="190" vectorEffect="non-scaling-stroke" />
            <path d="M190 190 A60 60 0 0 0 310 190" vectorEffect="non-scaling-stroke" />
            <line x1="220" y1="40" x2="280" y2="40" vectorEffect="non-scaling-stroke" />
            <circle cx={BASKET.x} cy={BASKET.y} r="7.5" vectorEffect="non-scaling-stroke" />
          </g>
          {/* boundary highlights only: clicked = solid blue; hover/focus preview = brighter, focus is dashed */}
          {zone && (
            <path d={boundaries[zone]} stroke={SELECT_COLOR} strokeWidth={3} strokeLinecap="round" vectorEffect="non-scaling-stroke" data-selected-zone={zone} />
          )}
          {preview && (preview !== zone || previewKind === "focus") && (
            <path d={boundaries[preview]} stroke={HOVER_COLOR} strokeWidth={previewKind === "focus" ? 2.5 : 3} strokeLinecap="round"
              strokeDasharray={previewKind === "focus" ? "7 5" : undefined} vectorEffect="non-scaling-stroke"
              data-preview-zone={preview} data-preview-kind={previewKind} />
          )}
        </g>

        {/* real shot markers: one per recorded attempt, never intercept pointer events */}
        {shapes && (
          <g pointerEvents="none" data-testid="shot-dots" clipPath={`url(#${clipId})`}>
            {shapes.map((p) => (
              <path
                key={`${p.kind}-${p.st}`}
                d={p.d}
                data-kind={p.kind}
                data-state={p.st}
                fill={p.kind === "made" ? MADE_COLOR : "none"}
                stroke={p.kind === "made" ? COURT_BG : MISSED_COLOR}
                strokeWidth={p.kind === "made" ? 0.6 : 1.4}
                strokeLinecap="round"
                opacity={p.st === "dim" ? 0.12 : p.st === "emphasis" ? 1 : 0.8}
              />
            ))}
          </g>
        )}
      </svg>

      {tip && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            data-testid="zone-tooltip"
            data-zone={tipZone ?? undefined}
            style={{ position: "fixed", left: 0, top: 0, pointerEvents: "none", visibility: "hidden", zIndex: 60, maxWidth: "min(18rem, calc(100vw - 16px))" }}
            className="rounded-md border border-line-strong bg-arena-panel-strong px-3 py-2 text-xs leading-snug text-ink-light shadow-lg"
          >
            <div className="font-semibold text-ink">{tip.title}</div>
            <div className="tabular">{tip.counts}</div>
            {tip.shooting && <div className="tabular">{tip.shooting}</div>}
          </div>,
          document.body,
        )}

      {!exact && <p className="mt-1 text-center text-[11px] text-stone-light" data-testid="fallback-caption">{DISTANCE_CAPTION} Deep-three detail isn’t available for this season, so all three-pointers are combined.</p>}
      {dotsOn && loc && loc.undrawn > 0 && (
        <p className="mt-1 text-center text-[11px] text-stone-light" data-testid="undrawn-note">
          {loc.undrawn} long shot{loc.undrawn === 1 ? "" : "s"} beyond the drawn court {loc.undrawn === 1 ? "is" : "are"} counted but not shown.
        </p>
      )}

      {/* essential warnings stay visible */}
      {recordedOnly && loc && (
        <p className="mt-2 rounded-md border border-line bg-arena-panel/50 px-3 py-2 text-[11px] text-stone-light" data-testid="coverage-note">
          {loc.status === "partial" ? (
            <>
              <strong className="text-ink-light">Incomplete shot coverage.</strong> Recorded shots: {fmtN(loc.attempts)} of {fmtN(loc.trusted_fga)} season attempts
              {loc.coverage != null ? ` (${(loc.coverage * 100).toFixed(1)}%)` : ""}. Numbers below cover recorded shots only.
            </>
          ) : (
            <>
              <strong className="text-ink-light">Recorded shots differ from the season totals.</strong> {fmtN(loc.attempts)} attempts / {fmtN(loc.makes)} makes recorded; the season totals are{" "}
              {fmtN(loc.trusted_fga)} / {fmtN(loc.trusted_fgm)}. Numbers below use the recorded shots.
            </>
          )}
        </p>
      )}
      {!exact && status !== "ok" && <DistributionNote status={status} total={data.shares_total ?? null} />}

      <div className="mt-3 min-h-[5.5rem] rounded-md border border-line bg-arena-panel/50 p-3 text-xs text-ink-light" aria-live="polite" data-testid="shot-details">
        {selected ? (
          <ZoneDetails v={selected} loc={loc} filter={dotsOn ? filter : "all"}
            avg={shotBaseline ? shotBaseline.zones[selected.key]?.fg_pct ?? null : selected.stat?.baseline?.fg_pct ?? null} avgEstimated={!shotBaseline} />
        ) : (
          <Overall data={data} loc={loc} />
        )}
      </div>

      <details className="mt-2 text-[11px] text-stone-light" data-testid="about-data">
        <summary className="cursor-pointer text-ink-light">About this data</summary>
        <AboutData data={data} loc={loc} baseline={baseline} baselines={baselines} shotBaseline={shotBaseline} season={season} compact={compact} />
      </details>
    </div>
  );
}

function DistributionNote({ status, total }: { status: string; total: number | null }) {
  const t = total != null ? `${(total * 100).toFixed(1)}%` : "an unknown total";
  return (
    <p className="mt-2 rounded-md border border-line bg-arena-panel/50 px-3 py-2 text-[11px] text-stone-light" data-testid="distribution-note">
      <strong className="text-ink-light">{status === "incomplete" ? "Incomplete shot distribution." : "Inconsistent shot distribution."}</strong>{" "}
      The source’s zone shares total {t}
      {status === "incomplete" ? ", so some attempts were not assigned to a zone." : ", which is more than 100%."} Shares are shown as reported.
    </p>
  );
}

function Overall({ data, loc }: { data: ShotDnaData; loc: LocationsSummary | null }) {
  return (
    <div>
      <div className="font-semibold text-ink">All zones</div>
      {loc ? (
        <p className="mt-1 tabular" data-testid="overall-counts">
          {loc.status !== "exact" ? "Recorded shots: " : ""}{fmtN(loc.makes)} made / {fmtN(loc.attempts)} attempts · {loc.attempts ? fmtPct(loc.makes / loc.attempts, 1) : "—"} shooting
        </p>
      ) : (
        <p className="mt-1">
          {data.fga != null ? <>{fmtN(data.fga)} attempts · {fmtPct(data.fga && data.fg != null ? data.fg / data.fga : null, 1)} shooting</> : "Season attempt total unavailable"}
        </p>
      )}
    </div>
  );
}

function ZoneDetails({ v, loc, filter, avg, avgEstimated }: { v: ZoneView; loc: LocationsSummary | null; filter: ShotFilter; avg: number | null; avgEstimated: boolean }) {
  const diff = v.pct != null && avg != null ? (v.pct - avg) * 100 : null;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{v.simple}</span>
        {v.small && !v.none && (
          <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-stone-light">Small sample — use caution</span>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2">
        <Metric label="Share of shots" value={v.share == null ? "—" : fmtPct(v.share, 1)} />
        <Metric label="Shooting %" value={v.none ? "—" : fmtPct(v.pct, 1)} />
      </dl>
      <p className="mt-2 tabular" data-testid="zone-counts">
        {v.none && !loc
          ? "No attempts"
          : loc
            ? <>{v.basis === "recorded" ? "Recorded shots: " : ""}{v.makes} made / {v.attempts} attempts</>
            : v.attempts != null && v.makes != null
              ? <>≈{v.makes} made / ≈{v.attempts} attempts <span className="rounded border border-line px-1 py-px text-[10px] uppercase tracking-wide">estimated</span></>
              : "Counts unavailable"}
      </p>
      {filter !== "all" && (
        <p className="mt-1 text-[11px] text-stone-light" data-testid="filter-scope-note">
          Counts and shooting % include all attempts in this zone, not just the {filter} shots shown.
        </p>
      )}
      {!v.none && (
        <p className="mt-1" data-testid="season-average">
          {avg != null ? <>Season average: {fmtPct(avg, 1)}{avgEstimated ? " (estimated)" : ""}{diff != null && <span className="text-stone-light"> · this player {diff >= 0 ? "+" : ""}{diff.toFixed(1)} pts</span>}</> : "Season average unavailable"}
        </p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] text-stone-light">{label}</dt>
      <dd className="tabular text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

function AboutData({ data, loc, baseline, baselines, shotBaseline, season, compact }: {
  data: ShotDnaData; loc: LocationsSummary | null; baseline: SeasonBaseline | null; baselines: ShotBaselines | null;
  shotBaseline: ShotBaseline | null; season?: number; compact: boolean;
}) {
  void compact;
  const label = season != null ? `${season - 1}–${String(season).slice(2)}` : "this season";
  const short = season != null && season <= SHORT_LINE_LAST_SEASON;
  return (
    <div className="mt-2 space-y-2">
      {loc ? (
        <>
          <p>
            <strong className="text-ink-light">Exact shot locations, {label} regular season.</strong> Zone counts, shares and shooting % are counted directly from each recorded shot
            (distance from the hoop; three-pointers by shot type, heaves included). Playoffs are not included.
            {loc.status === "exact"
              ? <> Recorded attempts and makes match the season totals ({fmtN(loc.attempts)} / {fmtN(loc.makes)}).</>
              : <> This player-season’s recorded shots do not match the season totals ({fmtN(loc.attempts)} vs {fmtN(loc.trusted_fga)} attempts), so values are labelled “Recorded shots”.</>}
          </p>
          <p>
            Season average: {shotBaseline
              ? <>every recorded regular-season shot for {label} in the same source and zones ({fmtN(shotBaseline.players)} players
                {shotBaseline.coverage != null ? `, ${(shotBaseline.coverage * 100).toFixed(2)}% of the league’s attempts` : ""}).</>
              : "unavailable for this season."}
          </p>
          <p>
            {loc.at_hoop_centre > 0 && <>{fmtN(loc.at_hoop_centre)} of this player’s shots are recorded at exactly the hoop centre (the source snaps many rim attempts there); they are drawn stacked there and never moved. </>}
            {loc.undrawn > 0 && <>{loc.undrawn} shot{loc.undrawn === 1 ? "" : "s"} beyond the drawn court {loc.undrawn === 1 ? "is" : "are"} counted but not drawn. </>}
            {short && <>The three-point line was 22 feet all the way around this season, and the court is drawn that way. </>}
            A shot’s zone follows its recorded shot type, so a few three-point dots can sit just inside the drawn line.
          </p>
          <p data-testid="about-deep-threes">
            <strong className="text-ink-light">Deep threes</strong> are recorded three-point attempts 30 feet or more from the basket (measured from the recorded coordinates); “Three-pointers” are those under 30 feet, and the two add up to every three-point attempt. Deep threes include end-of-period heaves, so they are not all intentional deep shooting. Shots beyond the drawn court are counted in their zone and never moved.
          </p>
          <p>
            Source: stats.nba.com shot-chart detail, read from a Parquet mirror (Hugging Face cdechoch/nba-data-archive, collected by Vladislav Shufinskiy; the mirror states an Apache-2.0 licence).
            The mirror’s licence does not settle NBA.com’s own terms. Players were matched to Basketball-Reference by team, attempts, makes and games, never by name alone.
          </p>
        </>
      ) : (
        <>
          <p>
            <strong className="text-ink-light">Simplified distance zones.</strong> Basketball-Reference reports each player’s share of attempts and FG% by distance band. Counts are estimates:
            rounded share × season attempts. Shares are shown as reported and are not adjusted. Real shot locations are not available for this player-season, so deep threes (30+ ft) cannot be separated and all three-pointers are combined.
          </p>
          <p>
            Season average: {baseline && baselines ? baselineLabel(baseline, baselines.min_minutes ?? 0) : "unavailable for this season."}
          </p>
        </>
      )}
      <p>
        Average shot distance {data.avg_dist_fga != null ? `${data.avg_dist_fga.toFixed(1)} ft` : "—"} · assisted 2PT {fmtPct(data.percent_assisted_x2p_fg)} · assisted 3PT {fmtPct(data.percent_assisted_x3p_fg)} (Basketball-Reference).
      </p>
    </div>
  );
}
