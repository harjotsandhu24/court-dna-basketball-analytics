"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as d3 from "d3";
import { loadGalaxy, loadSimilarityPool } from "@/lib/dataLoader";
import { findClosestMatches } from "@/lib/similarity";
import { hueForPosGroup } from "@/lib/courtPrint";
import type { GalaxyPointFull, GalaxySeasonData } from "@/lib/types";
import { SEASON_MIN, SEASON_MAX, seasonLabel } from "@/lib/config";
import { useAsync } from "@/lib/useAsync";
import {
  buildMapQuery,
  estimateTextWidth,
  hitRadius,
  mapHeight,
  nearestScreenPoint,
  nextPointInDirection,
  parseMapParams,
  placeOverlay,
  recenterTransform,
  type Direction,
  type MapParams,
} from "@/lib/mapView";
import PlayerAutocomplete, { type PlayerAutocompleteSelection } from "@/components/PlayerAutocomplete";

const SELECT_CLASS =
  "min-h-11 w-full rounded-md border border-line-strong bg-arena-panel px-3 text-base text-ink-light outline-none focus:border-court-orange sm:w-auto sm:text-sm";
const SECONDARY_BTN = "btn btn-secondary min-h-11 px-3 py-2 text-sm";
const MAX_ZOOM = 8;
const MIN_ZOOM = 0.5;

interface Dot {
  id: string;
  p: GalaxyPointFull;
  x: number; // screen px (zoom/pan applied)
  y: number;
}

type SearchStatus =
  | { kind: "loading"; name: string; season: number }
  | { kind: "error"; pick: PlayerAutocompleteSelection }
  | { kind: "missing"; name: string; season: number }
  | { kind: "switched"; forId: string; text: string };

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readParams(): MapParams {
  const sp = new URLSearchParams(window.location.search);
  return parseMapParams((k) => sp.get(k), SEASON_MAX, SEASON_MIN, SEASON_MAX);
}

/** Writes map state into the URL. Next's router syncs native history
 * pushState/replaceState into useSearchParams, and Back/Forward fire
 * popstate, so the URL is the single source of truth for season, selected
 * player and filters. */
function navigate(patch: Partial<MapParams>, mode: "push" | "replace" = "push") {
  const next = { ...readParams(), ...patch };
  const url = `${window.location.pathname}?${buildMapQuery(next)}`;
  if (url === `${window.location.pathname}${window.location.search}`) return;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

function GalaxyPageInner() {
  const searchParams = useSearchParams();
  const params = useMemo(
    () => parseMapParams((k) => searchParams.get(k), SEASON_MAX, SEASON_MIN, SEASON_MAX),
    [searchParams],
  );
  const { season, player: selectedId, archetype: archetypeFilter, pos: posFilter } = params;

  const galaxy = useAsync<GalaxySeasonData>(`galaxy-${season}`, () => loadGalaxy(season));
  const poolState = useAsync("similarity-pool", loadSimilarityPool);
  // Data is only ever the *requested* season's -- while a season loads (or
  // fails) `data` is null, so old points are never drawn under a new label.
  const data = galaxy.status === "ready" ? galaxy.data ?? null : null;
  const poolData = poolState.status === "ready" ? poolState.data : undefined;
  const pool = useMemo(() => poolData ?? [], [poolData]);

  const [transform, setTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [searchStatus, setSearchStatus] = useState<SearchStatus | null>(null);
  const [size, setSize] = useState({ w: 0, vh: 0 });
  // Bumped when a search re-selects the already-selected player (no URL
  // change, so nothing else would trigger the recenter).
  const [recenterTick, setRecenterTick] = useState(0);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const pendingRecenterRef = useRef<string | null>(null);
  const selectTicketRef = useRef(0);
  const pointersRef = useRef(new Set<number>());
  const tapRef = useRef<{ id: number; x: number; y: number; t: number; valid: boolean } | null>(null);

  // Hover belongs to the season being viewed.
  const [hoverSeason, setHoverSeason] = useState(season);
  if (hoverSeason !== season) {
    setHoverSeason(season);
    setHoveredId(null);
  }

  // Measure the real rendered width and viewport height. The map is drawn
  // in CSS pixels at exactly this size, so there is no viewBox scaling and
  // therefore no SVG-unit / CSS-pixel drift in any overlay.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setSize({ w: Math.floor(el.getBoundingClientRect().width), vh: window.innerHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("orientationchange", measure);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  const w = size.w;
  const h = w > 0 ? mapHeight(w, size.vh) : 280;
  const pad = w < 480 ? 20 : 40;

  // One zoom behavior for the life of the page.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
      // Ordinary mouse-wheel scrolling over the map scrolls the page.
      // Zoom stays available via the buttons, touch pinch, trackpad pinch
      // (ctrl+wheel), drag/pan and the keyboard. (d3's default filter,
      // minus plain wheel events.)
      .filter((event: Event) => {
        const e = event as MouseEvent & { button?: number };
        if (event.type === "wheel") return e.ctrlKey;
        return !e.button;
      })
      .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        transformRef.current = event.transform;
        setTransform(event.transform);
      });
    zoomRef.current = zoom;
    const sel = d3.select(svg);
    sel.call(zoom);
    sel.on("dblclick.zoom", null); // double-tap is not a zoom gesture here; taps select
    return () => {
      sel.on(".zoom", null);
      zoomRef.current = null;
    };
  }, []);

  const applyTransform = useCallback((t: d3.ZoomTransform, animate: boolean) => {
    const svg = svgRef.current;
    const zoom = zoomRef.current;
    if (!svg || !zoom) return;
    const sel = d3.select(svg);
    if (animate && !prefersReducedMotion()) {
      sel.transition().duration(400).call(zoom.transform as never, t as never);
    } else {
      sel.call(zoom.transform, t);
    }
  }, []);

  // New season: stale pan/zoom no longer applies.
  useEffect(() => {
    applyTransform(d3.zoomIdentity, false);
  }, [season, applyTransform]);

  const xScale = useMemo(() => {
    const ext = data ? (d3.extent(data.points, (p) => p.x) as [number, number]) : [-1, 1];
    return d3.scaleLinear().domain(ext).range([pad, Math.max(pad + 1, w - pad)]);
  }, [data, w, pad]);
  const yScale = useMemo(() => {
    const ext = data ? (d3.extent(data.points, (p) => p.y) as [number, number]) : [-1, 1];
    return d3.scaleLinear().domain(ext).range([Math.max(pad + 1, h - pad), pad]);
  }, [data, h, pad]);

  const selectedPoint = useMemo(
    () => (data && selectedId ? data.points.find((p) => p.player_id === selectedId) ?? null : null),
    [data, selectedId],
  );

  const archetypes = useMemo(() => {
    const set = new Set(data ? data.points.map((p) => p.archetype) : []);
    if (archetypeFilter) set.add(archetypeFilter);
    return Array.from(set).sort();
  }, [data, archetypeFilter]);

  // A filter that doesn't exist in the loaded season (e.g. a playing style
  // that wasn't used that year) would produce an unexplained empty map, so
  // clear just the invalid one(s). Runs only once the season's data is in.
  useEffect(() => {
    if (!data) return;
    const patch: Partial<MapParams> = {};
    if (archetypeFilter && !data.points.some((p) => p.archetype === archetypeFilter)) patch.archetype = null;
    if (posFilter && !data.points.some((p) => p.pos_group === posFilter)) patch.pos = null;
    if (Object.keys(patch).length > 0) navigate(patch, "replace");
  }, [data, archetypeFilter, posFilter]);

  const visiblePoints = useMemo(() => {
    if (!data) return [];
    return data.points.filter(
      (p) => (!archetypeFilter || p.archetype === archetypeFilter) && (!posFilter || p.pos_group === posFilter),
    );
  }, [data, archetypeFilter, posFilter]);

  // Similar players for the selection (same season).
  const neighbors = useMemo(() => {
    if (!selectedPoint || pool.length === 0) return null;
    const entry = pool.find((e) => e.player_id === selectedPoint.player_id && e.season === season);
    if (!entry) return [];
    return findClosestMatches(entry, pool, { seasonMode: "same_season" }, 6);
  }, [selectedPoint, pool, season]);
  const neighborIds = useMemo(() => new Set((neighbors ?? []).map((n) => n.player_id)), [neighbors]);

  // The selected player is always drawn, even if a filter would hide them.
  const dots: Dot[] = useMemo(() => {
    const list = selectedPoint && !visiblePoints.includes(selectedPoint) ? [...visiblePoints, selectedPoint] : visiblePoints;
    const { k, x: tx, y: ty } = transform;
    return list.map((p) => ({ id: p.player_id, p, x: xScale(p.x) * k + tx, y: yScale(p.y) * k + ty }));
  }, [visiblePoints, selectedPoint, transform, xScale, yScale]);
  const dotById = useMemo(() => new Map(dots.map((d) => [d.id, d])), [dots]);
  const selectedDot = selectedPoint ? dotById.get(selectedPoint.player_id) ?? null : null;
  const hoveredDot = hoveredId && hoveredId !== selectedId ? dotById.get(hoveredId) ?? null : null;

  // Recenter on a just-searched player once their real point exists in the
  // rendered season (covers the cross-season case, where data arrives after
  // the URL changes).
  useEffect(() => {
    if (!selectedPoint || pendingRecenterRef.current !== selectedPoint.player_id || w === 0) return;
    pendingRecenterRef.current = null;
    const k = Math.max(transformRef.current.k, 2);
    const t = recenterTransform(xScale(selectedPoint.x), yScale(selectedPoint.y), w, h, k);
    applyTransform(d3.zoomIdentity.translate(t.x, t.y).scale(t.k), true);
  }, [selectedPoint, xScale, yScale, w, h, applyTransform, recenterTick]);

  // ---- actions ----------------------------------------------------------
  const changeSeason = useCallback((next: number) => {
    selectTicketRef.current++;
    pendingRecenterRef.current = null;
    setSearchStatus(null);
    navigate({ season: next, player: null });
  }, []);

  const clearSelection = useCallback(() => {
    selectTicketRef.current++;
    pendingRecenterRef.current = null;
    setSearchStatus(null);
    navigate({ player: null });
  }, []);

  const selectFromSearch = useCallback(async (picked: PlayerAutocompleteSelection) => {
    const ticket = ++selectTicketRef.current;
    setSearchStatus({ kind: "loading", name: picked.name, season: picked.season });
    try {
      // Load the target season first so the real PCA point exists before
      // anything is selected; a newer search/season change supersedes this.
      const d = await loadGalaxy(picked.season);
      if (ticket !== selectTicketRef.current) return;
      const point = d.points.find((p) => p.player_id === picked.id);
      if (!point) {
        setSearchStatus({ kind: "missing", name: picked.name, season: picked.season });
        return;
      }
      const cur = readParams();
      pendingRecenterRef.current = picked.id;
      setSearchStatus(
        picked.seasonChanged
          ? {
              kind: "switched",
              forId: picked.id,
              text: `${picked.name} isn’t on the ${seasonLabel(cur.season)} map, so this shows ${seasonLabel(picked.season)}, the closest season on the map.`,
            }
          : null,
      );
      navigate({
        season: picked.season,
        player: picked.id,
        // Clear only the filters that would hide this player.
        archetype: cur.archetype && cur.archetype !== point.archetype ? null : cur.archetype,
        pos: cur.pos && cur.pos !== point.pos_group ? null : cur.pos,
      });
      setRecenterTick((t) => t + 1);
    } catch {
      if (ticket === selectTicketRef.current) setSearchStatus({ kind: "error", pick: picked });
    }
  }, []);

  const selectDot = useCallback((id: string, mode: "push" | "replace" = "push") => {
    selectTicketRef.current++;
    setSearchStatus(null);
    navigate({ player: id }, mode);
  }, []);

  function resetMapPosition() {
    applyTransform(d3.zoomIdentity, true);
  }

  function zoomBy(factor: number) {
    const svg = svgRef.current;
    const zoom = zoomRef.current;
    if (!svg || !zoom) return;
    const sel = d3.select(svg);
    if (prefersReducedMotion()) sel.call(zoom.scaleBy, factor);
    else sel.transition().duration(200).call(zoom.scaleBy as never, factor as never);
  }

  function clearFilters() {
    navigate({ archetype: null, pos: null });
  }

  // ---- pointer handling (screen-space hit testing) ----------------------
  function relPos(e: React.PointerEvent) {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    pointersRef.current.add(e.pointerId);
    if (pointersRef.current.size > 1) {
      if (tapRef.current) tapRef.current.valid = false; // pinch, not a tap
      return;
    }
    const pos = relPos(e);
    tapRef.current = { id: e.pointerId, ...pos, t: performance.now(), valid: true };
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const tap = tapRef.current;
    if (tap && tap.id === e.pointerId) {
      const pos = relPos(e);
      if (Math.hypot(pos.x - tap.x, pos.y - tap.y) > 10) tap.valid = false; // a drag, not a tap
    }
    if (e.pointerType === "mouse" && e.buttons === 0) {
      const pos = relPos(e);
      const hit = nearestScreenPoint(dots, pos.x, pos.y, hitRadius("mouse"));
      setHoveredId((cur) => (cur === (hit?.id ?? null) ? cur : hit?.id ?? null));
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    pointersRef.current.delete(e.pointerId);
    const tap = tapRef.current;
    if (tap && tap.id === e.pointerId && tap.valid && performance.now() - tap.t < 700) {
      const hit = nearestScreenPoint(dots, tap.x, tap.y, hitRadius(e.pointerType));
      if (hit) selectDot(hit.id);
    }
    if (pointersRef.current.size === 0) tapRef.current = null;
  }

  function onPointerCancel(e: React.PointerEvent<SVGSVGElement>) {
    pointersRef.current.delete(e.pointerId);
    tapRef.current = null;
  }

  // ---- keyboard (the map is one tab stop, not hundreds) -----------------
  function onMapKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const dir: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
    if (dir[e.key]) {
      e.preventDefault();
      if (dots.length === 0) return;
      const from = selectedDot ?? { x: w / 2, y: h / 2 };
      const next = selectedDot
        ? nextPointInDirection(dots, from, dir[e.key])
        : nearestScreenPoint(dots, from.x, from.y, Infinity);
      if (next) {
        const offscreen = next.x < 8 || next.y < 8 || next.x > w - 8 || next.y > h - 8;
        if (offscreen) pendingRecenterRef.current = next.id;
        selectDot(next.id, "replace");
      }
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomBy(1.5);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomBy(1 / 1.5);
    } else if (e.key === "0") {
      e.preventDefault();
      resetMapPosition();
    } else if (e.key === "Escape" && selectedId) {
      e.preventDefault();
      clearSelection();
    }
  }

  const seasons = useMemo(
    () => Array.from({ length: SEASON_MAX - SEASON_MIN + 1 }, (_, i) => SEASON_MAX - i),
    [],
  );
  const filtersActive = archetypeFilter != null || posFilter != null;
  const zoomed = transform.k > 1.05;
  const mapLabel = `${seasonLabel(season)} Player Map`;

  // Overlay placement, clamped inside the map and constant-size at any zoom.
  const labelBox = selectedPoint
    ? { w: Math.min(Math.max(estimateTextWidth(selectedPoint.player, 14) + 26, 120), 240), h: 50 }
    : null;
  const labelPos =
    selectedDot && labelBox
      ? placeOverlay(
          { x: Math.max(0, Math.min(w, selectedDot.x)), y: Math.max(0, Math.min(h, selectedDot.y)) },
          labelBox,
          { w, h },
          16,
        )
      : null;
  const tipBox = hoveredDot ? { w: Math.min(Math.max(estimateTextWidth(hoveredDot.p.archetype, 12) + 26, estimateTextWidth(hoveredDot.p.player, 14) + 26, 120), 240), h: 50 } : null;
  const tipPos = hoveredDot && tipBox ? placeOverlay({ x: hoveredDot.x, y: hoveredDot.y }, tipBox, { w, h }, 14) : null;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-5 md:px-8 md:py-10">
      <h1 className="font-display mb-1 text-4xl text-ink">Player Map</h1>
      <p className="mb-5 max-w-2xl text-sm text-stone">
        Each dot represents a player from the {seasonLabel(season)} season. Players who appear closer together had
        more similar playing styles. See{" "}
        <Link href="/methodology" className="text-court-orange-bright hover:underline">how it works</Link>.
      </p>

      <div className="mb-4 flex min-w-0 flex-col gap-3">
        <div className="w-full sm:max-w-md">
          <PlayerAutocomplete
            scope="map"
            preferredSeason={season}
            onSelect={(p) => void selectFromSearch(p)}
            selectedName={selectedPoint?.player ?? null}
            onClear={clearSelection}
            clearOnSelect={false}
            placeholder="Search any player, any season…"
            ariaLabel="Search players on the Player Map"
          />
          {searchStatus && (
            <div role="status" className="mt-2 text-sm text-stone">
              {searchStatus.kind === "loading" && (
                <span>Loading {searchStatus.name}, {seasonLabel(searchStatus.season)}…</span>
              )}
              {searchStatus.kind === "missing" && (
                <span>{searchStatus.name} isn&rsquo;t on the {seasonLabel(searchStatus.season)} map.</span>
              )}
              {searchStatus.kind === "error" && (
                <span className="flex flex-wrap items-center gap-2">
                  <span>Couldn&rsquo;t load {searchStatus.pick.name}.</span>
                  <button
                    type="button"
                    onClick={() => void selectFromSearch(searchStatus.pick)}
                    className="min-h-11 rounded-md border border-line-strong px-3 text-sm font-medium text-ink-light hover:border-court-orange"
                  >
                    Retry
                  </button>
                </span>
              )}
              {searchStatus.kind === "switched" && searchStatus.forId === selectedId && <span>{searchStatus.text}</span>}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <select
            aria-label="Season"
            value={season}
            onChange={(e) => changeSeason(parseInt(e.target.value, 10))}
            className={SELECT_CLASS}
          >
            {seasons.map((s) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
          </select>

          <select
            aria-label="Position"
            value={posFilter ?? "any"}
            onChange={(e) => navigate({ pos: e.target.value === "any" ? null : e.target.value })}
            className={SELECT_CLASS}
          >
            <option value="any">All positions</option>
            <option value="Guard">Guards</option>
            <option value="Wing">Wings</option>
            <option value="Big">Bigs</option>
          </select>

          <select
            aria-label="Playing style"
            value={archetypeFilter ?? "any"}
            onChange={(e) => navigate({ archetype: e.target.value === "any" ? null : e.target.value })}
            className={`${SELECT_CLASS} col-span-2`}
          >
            <option value="any">All playing styles</option>
            {archetypes.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>

          <button type="button" onClick={resetMapPosition} className={SECONDARY_BTN}>Reset map position</button>
          {filtersActive && (
            <button type="button" onClick={clearFilters} className={`${SECONDARY_BTN} text-court-orange-bright`}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        role="group"
        aria-roledescription="interactive map"
        aria-label={`${mapLabel}. ${data ? `${visiblePoints.length} players shown.` : ""} Use arrow keys to move between players, plus and minus to zoom, 0 to reset the map position.`}
        tabIndex={0}
        onKeyDown={onMapKeyDown}
        style={{ height: h }}
        className="relative w-full overflow-hidden rounded-2xl border border-line bg-arena-bg-raised"
      >
        {w > 0 && (
          <svg
            ref={svgRef}
            width={w}
            height={h}
            viewBox={`0 0 ${w} ${h}`}
            aria-hidden="true"
            className="block select-none"
            // One-finger drags scroll the page until the map is zoomed in;
            // zoomed in, drags pan the map (and the page stays scrollable
            // from everywhere outside the map).
            style={{ touchAction: zoomed ? "none" : "pan-y" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onPointerLeave={() => setHoveredId(null)}
          >
            {selectedDot && neighbors &&
              neighbors.map((n) => {
                const nd = dotById.get(n.player_id);
                if (!nd) return null;
                return (
                  <line
                    key={n.player_id}
                    x1={selectedDot.x} y1={selectedDot.y} x2={nd.x} y2={nd.y}
                    stroke="var(--court-orange)" strokeWidth={1} strokeOpacity={0.5}
                  />
                );
              })}

            {selectedDot && <circle cx={selectedDot.x} cy={selectedDot.y} r={15} fill="#fff" fillOpacity={0.16} />}

            {dots.map((d) => {
              const isSelected = d.id === selectedId;
              const isNeighbor = neighborIds.has(d.id);
              const isHovered = d.id === hoveredId;
              const hue = hueForPosGroup(d.p.pos_group);
              return (
                <circle
                  key={d.id}
                  cx={d.x}
                  cy={d.y}
                  r={isSelected ? 9 : isNeighbor || isHovered ? 5.5 : 3.4}
                  fill={isSelected ? "#ffffff" : `hsl(${hue} 90% 58%)`}
                  fillOpacity={isSelected ? 1 : 0.88}
                  stroke={isSelected ? `hsl(${hue} 90% 60%)` : "none"}
                  strokeWidth={isSelected ? 2 : 0}
                />
              );
            })}
          </svg>
        )}

        {/* Persistent selected-player label: plain HTML in screen space, so
            its text is the same readable size at every container width,
            zoom and pan, and it is clamped inside the map. */}
        {selectedPoint && labelPos && labelBox && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute rounded-lg border border-line-strong bg-arena-panel-strong px-3 py-1.5 shadow-xl"
            style={{ left: labelPos.left, top: labelPos.top, width: labelBox.w, height: labelBox.h }}
          >
            <p className="truncate text-sm font-semibold leading-snug text-ink-light">{selectedPoint.player}</p>
            <p className="tabular text-xs leading-snug text-stone">{seasonLabel(season)}</p>
          </div>
        )}

        {hoveredDot && tipPos && tipBox && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute rounded-lg border border-line-strong bg-arena-panel-strong px-3 py-1.5 shadow-xl"
            style={{ left: tipPos.left, top: tipPos.top, width: tipBox.w, height: tipBox.h }}
          >
            <p className="truncate text-sm font-semibold leading-snug text-ink-light">{hoveredDot.p.player}</p>
            <p className="truncate text-xs leading-snug text-stone">{hoveredDot.p.archetype}</p>
          </div>
        )}

        {data && (
          <div className="absolute right-2 top-2 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => zoomBy(1.5)}
              aria-label="Zoom in"
              className="btn btn-secondary h-11 w-11 text-xl leading-none"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => zoomBy(1 / 1.5)}
              aria-label="Zoom out"
              className="btn btn-secondary h-11 w-11 text-xl leading-none"
            >
              −
            </button>
          </div>
        )}

        {galaxy.status === "loading" && (
          <div role="status" className="absolute inset-0 flex items-center justify-center text-sm text-stone">
            Loading the {seasonLabel(season)} map…
          </div>
        )}
        {galaxy.status === "error" && (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-sm text-stone">
            <span>Couldn&rsquo;t load the {seasonLabel(season)} map.</span>
            <button type="button" onClick={galaxy.retry} className={SECONDARY_BTN}>Retry</button>
          </div>
        )}
      </div>

      <p className="mt-3 text-sm text-stone">
        {data ? `${visiblePoints.length.toLocaleString()} players shown. ` : ""}
        Tap or click a dot to select it. Use the zoom buttons or pinch to zoom, and drag to move the map
        {zoomed ? "" : " (once zoomed in)"}.
      </p>

      <p className="sr-only" role="status" aria-live="polite">
        {selectedPoint ? `Selected ${selectedPoint.player}, ${seasonLabel(season)}, ${selectedPoint.archetype}.` : ""}
      </p>

      {selectedPoint && (
        <div className="mt-6 rounded-xl bg-arena-panel p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-display break-words text-2xl text-ink">{selectedPoint.player}</p>
              <p className="text-sm text-stone">
                {seasonLabel(season)} · {selectedPoint.archetype} · {selectedPoint.pos_group}
              </p>
            </div>
            <Link
              href={`/player/${selectedPoint.player_id}/${season}`}
              className="btn btn-primary min-h-11 px-4 py-2 text-center text-sm"
            >
              View Player Profile →
            </Link>
          </div>

          <p className="mt-4 text-sm text-stone">Most similar players in {seasonLabel(season)}:</p>
          {poolState.status === "loading" && <p className="mt-2 text-sm text-stone" role="status">Loading similar players…</p>}
          {poolState.status === "error" && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-stone" role="alert">
              <span>Couldn&rsquo;t load similar players.</span>
              <button type="button" onClick={poolState.retry} className={SECONDARY_BTN}>Retry</button>
            </div>
          )}
          {poolState.status === "ready" && neighbors && neighbors.length === 0 && (
            <p className="mt-2 text-sm text-stone">Similar players aren&rsquo;t available for this season.</p>
          )}
          {neighbors && neighbors.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {neighbors.map((n) => (
                <li key={n.player_id}>
                  <Link
                    href={`/compare?a=${selectedPoint.player_id}_${season}&b=${n.player_id}_${season}`}
                    className="flex min-h-11 items-center rounded-full border border-line-strong px-4 text-sm text-ink-light hover:border-court-orange hover:text-court-orange-bright"
                  >
                    {n.player} ({Math.round(n.similarity)})
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function GalaxyPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1400px] px-5 py-10 text-sm text-stone md:px-8">Loading…</div>}>
      <GalaxyPageInner />
    </Suspense>
  );
}
