"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams, usePathname } from "next/navigation";
import * as d3 from "d3";
import { loadGalaxy, loadPlayersIndex, loadSimilarityPool } from "@/lib/dataLoader";
import {
  COMPARE_WINDOWS,
  findClosestMatches,
  inSeasonWindow,
  parseCompareWindow,
  playerSeasonKey,
  windowBounds,
  windowToFilters,
  type CompareWindow,
  type SimilarityPoolEntry,
} from "@/lib/similarity";
import { computeSharedEmbedding } from "@/lib/embedding";
import { hueForPosGroup } from "@/lib/courtPrint";
import type { GalaxySeasonData, PlayersIndex } from "@/lib/types";
import { GALAXY_MIN_GAMES, GALAXY_MIN_MINUTES, SEASON_MIN, SEASON_MAX, seasonLabel } from "@/lib/config";
import PlayerAutocomplete, { type PlayerAutocompleteSelection } from "@/components/PlayerAutocomplete";

const ASPECT = 640 / 1000;
const MAX_HEIGHT = 640;
const PAD = 36;
const MATCH_COUNT = 6;
const LABELLED_MATCHES = 5;
// Background dot opacity: the reference season stays strongest; other seasons
// are quieter, and quietest in the full 2000-present cloud so thousands of
// points read as a distribution rather than competing objects.
const ALPHA_REFERENCE_SEASON = 0.88;
const ALPHA_OTHER_SEASON = 0.45;
const ALPHA_OTHER_SEASON_FULL_HISTORY = 0.28;
const HIT_RADIUS_MOUSE = 12;
const HIT_RADIUS_TOUCH = 24;

const WINDOW_LABELS: Record<CompareWindow, string> = {
  season: "Season",
  "5": "±5 years",
  "10": "±10 years",
  all: `${SEASON_MIN - 1}–present`,
};

interface MapView {
  season: number;
  window: CompareWindow;
  player: string | null;
  archetype: string | null;
  pos: string | null;
}

interface MapPoint {
  key: string;
  entry: SimilarityPoolEntry;
  x: number;
  y: number;
}

function clampSeason(n: number): number {
  return Math.max(SEASON_MIN, Math.min(SEASON_MAX, n));
}

/** The URL is the single source of truth for the map's shareable state, so
 * Back/Forward and old links (?season=&player=&archetype=&pos=) restore it.
 * `window` is new and optional; its absence means "Season". */
function parseView(params: URLSearchParams): MapView {
  const n = parseInt(params.get("season") ?? "", 10);
  return {
    season: Number.isFinite(n) ? clampSeason(n) : SEASON_MAX,
    window: parseCompareWindow(params.get("window")),
    player: params.get("player") || null,
    archetype: params.get("archetype") || null,
    pos: params.get("pos") || null,
  };
}

function serializeView(v: MapView): string {
  const p = new URLSearchParams();
  p.set("season", String(v.season));
  if (v.window !== "season") p.set("window", v.window);
  if (v.player) p.set("player", v.player);
  if (v.archetype) p.set("archetype", v.archetype);
  if (v.pos) p.set("pos", v.pos);
  return p.toString();
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounds of the selected-player name card for a dot at (sx, sy): above the
 * dot (below near the top edge), clamped inside the map. The rendered card and
 * the canvas label placement both use this, so they cannot disagree. */
function selectedCardRect(sx: number, sy: number, mapW: number, mapH: number): Rect {
  const w = Math.min(190, Math.round(mapW * 0.5));
  const h = 56;
  const above = sy - h - 20 >= 4;
  return {
    x: Math.max(4, Math.min(mapW - w - 4, sx - w / 2)),
    y: above ? sy - h - 20 : Math.min(mapH - h - 4, sy + 20),
    w,
    h,
  };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function GalaxyPageInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // One state object is the single source of truth for the map's shareable
  // settings. It is mirrored into the URL with the History API (instant, no
  // route fetch) so links, reloads and Back from a profile restore it. A URL
  // that changes from outside (a nav link, Back/Forward) is parsed back in.
  const search = searchParams.toString();
  const [seenSearch, setSeenSearch] = useState(search);
  const [view, setView] = useState<MapView>(() => parseView(new URLSearchParams(search)));
  if (search !== seenSearch) {
    setSeenSearch(search);
    const fromUrl = parseView(new URLSearchParams(search));
    if (serializeView(fromUrl) !== serializeView(view)) setView(fromUrl);
  }

  const latestRef = useRef(view);
  useEffect(() => {
    latestRef.current = view;
  }, [view]);
  const update = useCallback(
    (patch: Partial<MapView> | ((cur: MapView) => Partial<MapView>)) => {
      const cur = latestRef.current;
      const next = { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) };
      latestRef.current = next;
      setView(next);
      window.history.replaceState(window.history.state, "", `${pathname}?${serializeView(next)}`);
    },
    [pathname],
  );

  useEffect(() => {
    const onPop = () => setView(parseView(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // ---- data -------------------------------------------------------------
  const [pool, setPool] = useState<SimilarityPoolEntry[]>([]);
  const [poolError, setPoolError] = useState(false);
  const [poolAttempt, setPoolAttempt] = useState(0);
  const [galaxy, setGalaxy] = useState<GalaxySeasonData | null>(null);
  const [galaxyError, setGalaxyError] = useState(false);
  const [galaxyAttempt, setGalaxyAttempt] = useState(0);
  const [index, setIndex] = useState<PlayersIndex | null>(null);

  useEffect(() => {
    let live = true;
    loadSimilarityPool()
      .then((p) => {
        if (!live) return;
        setPool(p);
        setPoolError(false);
      })
      .catch(() => {
        if (live) setPoolError(true);
      });
    return () => {
      live = false;
    };
  }, [poolAttempt]);

  const needsGalaxy = view.window === "season";
  useEffect(() => {
    if (!needsGalaxy) return;
    let live = true; // a newer season request makes this one's result irrelevant
    loadGalaxy(view.season)
      .then((d) => {
        if (!live) return;
        setGalaxy(d);
        setGalaxyError(false);
      })
      .catch(() => {
        if (live) setGalaxyError(true);
      });
    return () => {
      live = false;
    };
  }, [needsGalaxy, view.season, galaxyAttempt]);

  useEffect(() => {
    if (!view.player || index) return;
    let live = true;
    loadPlayersIndex()
      .then((i) => {
        if (live) setIndex(i);
      })
      .catch(() => {
        /* the season picker simply stays hidden; the map is unaffected */
      });
    return () => {
      live = false;
    };
  }, [view.player, index]);

  // Never show a previous season's points under the new season's label.
  const galaxyForSeason = galaxy && galaxy.season === view.season ? galaxy : null;
  const galaxyFailed = needsGalaxy && galaxyError && !galaxyForSeason;

  const poolByKey = useMemo(() => {
    const m = new Map<string, SimilarityPoolEntry>();
    for (const e of pool) m.set(playerSeasonKey(e.player_id, e.season), e);
    return m;
  }, [pool]);

  // ---- candidate pool for the map --------------------------------------
  // One pool of qualified player-seasons (analysis/config: >=500 MP, >=20 G),
  // narrowed by the same season-window predicate the similarity search uses.
  // "Season" keeps the existing per-season PCA layout; wider windows share a
  // single layout (lib/embedding) so points stay put as the window changes.
  const windowFilters = useMemo(() => windowToFilters(view.window), [view.window]);
  const embedding = useMemo(() => (needsGalaxy ? null : computeSharedEmbedding(pool)), [needsGalaxy, pool]);

  const basePoints = useMemo<MapPoint[]>(() => {
    const out: MapPoint[] = [];
    if (pool.length === 0) return out;
    let seasonCoords: Map<string, { x: number; y: number }> | null = null;
    if (needsGalaxy) {
      if (!galaxyForSeason) return out;
      seasonCoords = new Map(galaxyForSeason.points.map((p) => [p.player_id, { x: p.x, y: p.y }]));
    }
    for (const entry of pool) {
      if (!inSeasonWindow(entry.season, view.season, windowFilters)) continue;
      const key = playerSeasonKey(entry.player_id, entry.season);
      const c = seasonCoords ? seasonCoords.get(entry.player_id) : embedding?.get(key);
      if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue; // skip malformed observations
      out.push({ key, entry, x: c.x, y: c.y });
    }
    return out;
  }, [pool, needsGalaxy, galaxyForSeason, embedding, view.season, windowFilters]);

  const selectedEntry = view.player ? poolByKey.get(playerSeasonKey(view.player, view.season)) ?? null : null;
  const selectedKey = selectedEntry ? playerSeasonKey(selectedEntry.player_id, selectedEntry.season) : null;

  const archetypes = useMemo(() => {
    const set = new Set(basePoints.map((p) => p.entry.archetype));
    if (view.archetype) set.add(view.archetype);
    return Array.from(set).sort();
  }, [basePoints, view.archetype]);

  // Filters thin the background; the selected reference is pinned and can
  // never be filtered away.
  const visiblePoints = useMemo(
    () =>
      basePoints.filter(
        (p) =>
          p.key === selectedKey ||
          ((!view.archetype || p.entry.archetype === view.archetype) && (!view.pos || p.entry.pos_group === view.pos)),
      ),
    [basePoints, view.archetype, view.pos, selectedKey],
  );

  const neighbors = useMemo(() => {
    if (!selectedEntry || pool.length === 0) return [];
    return findClosestMatches(selectedEntry, pool, { ...windowFilters, onePerPlayer: true }, MATCH_COUNT);
  }, [selectedEntry, pool, windowFilters]);

  // ---- canvas map -------------------------------------------------------
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const [size, setSize] = useState({ w: 1000, h: MAX_HEIGHT });
  const [transform, setTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = (w: number) => {
      if (w > 0) setSize({ w, h: Math.round(Math.min(MAX_HEIGHT, w * ASPECT)) });
    };
    const ro = new ResizeObserver((entries) => measure(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.5, 12])
      .on("zoom", (event: d3.D3ZoomEvent<HTMLCanvasElement, unknown>) => setTransform(event.transform));
    zoomRef.current = zoom;
    d3.select(canvas).call(zoom);
    return () => {
      d3.select(canvas).on(".zoom", null);
    };
  }, []);

  const scales = useMemo(() => {
    const xe = d3.extent(basePoints, (p) => p.x) as [number | undefined, number | undefined];
    const ye = d3.extent(basePoints, (p) => p.y) as [number | undefined, number | undefined];
    return {
      x: d3.scaleLinear().domain([xe[0] ?? -1, xe[1] ?? 1]).range([PAD, size.w - PAD]),
      y: d3.scaleLinear().domain([ye[0] ?? -1, ye[1] ?? 1]).range([size.h - PAD, PAD]),
    };
  }, [basePoints, size]);

  const screenOf = useCallback(
    (p: MapPoint): [number, number] => [transform.applyX(scales.x(p.x)), transform.applyY(scales.y(p.y))],
    [transform, scales],
  );

  const pointByKey = useMemo(() => new Map(visiblePoints.map((p) => [p.key, p])), [visiblePoints]);
  const matchRank = useMemo(() => new Map(neighbors.map((n, i) => [playerSeasonKey(n.player_id, n.season), i])), [neighbors]);
  const selectedPoint = selectedKey ? pointByKey.get(selectedKey) ?? null : null;
  const hoveredPoint = hoveredKey ? pointByKey.get(hoveredKey) ?? null : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const dotR = visiblePoints.length > 2500 ? 2 : 3;
    const refSeason = view.season;
    // Batch the background dots by (hue, same-season) -> a handful of paths.
    const batches = new Map<string, { hue: number; alpha: number; pts: [number, number][] }>();
    for (const p of visiblePoints) {
      if (p.key === selectedKey || matchRank.has(p.key)) continue;
      const [sx, sy] = screenOf(p);
      if (sx < -4 || sy < -4 || sx > size.w + 4 || sy > size.h + 4) continue;
      const hue = hueForPosGroup(p.entry.pos_group);
      const alpha =
        p.entry.season === refSeason
          ? ALPHA_REFERENCE_SEASON
          : view.window === "all"
            ? ALPHA_OTHER_SEASON_FULL_HISTORY
            : ALPHA_OTHER_SEASON;
      const bk = `${hue}-${alpha}`;
      let b = batches.get(bk);
      if (!b) batches.set(bk, (b = { hue, alpha, pts: [] }));
      b.pts.push([sx, sy]);
    }
    for (const b of batches.values()) {
      ctx.fillStyle = `hsl(${b.hue} 90% 58% / ${b.alpha})`;
      ctx.beginPath();
      for (const [sx, sy] of b.pts) {
        ctx.moveTo(sx + dotR, sy);
        ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    if (selectedPoint) {
      const [rx, ry] = screenOf(selectedPoint);
      ctx.strokeStyle = "rgba(255,106,26,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const n of neighbors) {
        const np = pointByKey.get(playerSeasonKey(n.player_id, n.season));
        if (!np) continue;
        const [nx, ny] = screenOf(np);
        ctx.moveTo(rx, ry);
        ctx.lineTo(nx, ny);
      }
      ctx.stroke();

      // Top matches: larger dots plus a name label for the first few,
      // skipping any label that would collide with one already placed.
      ctx.font = "600 12px Inter Variable, ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      // The selected-player card is reserved space, like an already-placed label.
      const placed: Rect[] = [selectedCardRect(rx, ry, size.w, size.h)];
      neighbors.forEach((n, i) => {
        const np = pointByKey.get(playerSeasonKey(n.player_id, n.season));
        if (!np) return;
        const [nx, ny] = screenOf(np);
        ctx.fillStyle = `hsl(${hueForPosGroup(n.pos_group)} 90% 58%)`;
        ctx.beginPath();
        ctx.arc(nx, ny, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#0b0d12";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (i >= (size.w < 560 ? 2 : LABELLED_MATCHES)) return; // fewer labels on a narrow map
        const tw = ctx.measureText(n.player).width;
        // Right of the dot first, then the opposite side; otherwise no label.
        const candidates: Rect[] = [
          { x: nx + 9, y: ny - 8, w: tw + 6, h: 16 },
          { x: nx - 9 - (tw + 6), y: ny - 8, w: tw + 6, h: 16 },
        ];
        const box = candidates.find(
          (c) =>
            c.x >= 2 && c.x + c.w <= size.w - 2 && c.y >= 2 && c.y + c.h <= size.h - 2 &&
            !placed.some((o) => rectsOverlap(c, o)),
        );
        if (!box) return;
        placed.push(box);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(11,13,18,0.9)";
        ctx.strokeText(n.player, box.x + 3, ny);
        ctx.fillStyle = "#e7e4da";
        ctx.fillText(n.player, box.x + 3, ny);
      });

      // Reference player-season: halo + white dot.
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.beginPath();
      ctx.arc(rx, ry, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = `hsl(${hueForPosGroup(selectedPoint.entry.pos_group)} 90% 60%)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(rx, ry, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (hoveredPoint && hoveredPoint.key !== selectedKey) {
      const [hx, hy] = screenOf(hoveredPoint);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hx, hy, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [visiblePoints, size, screenOf, selectedKey, selectedPoint, hoveredPoint, matchRank, neighbors, pointByKey, view.season, view.window]);

  /** Nearest visible dot in rendered pixels, so a tap is forgiving without
   * enlarging any dot and zoom level never changes the target size. */
  const nearestPoint = useCallback(
    (clientX: number, clientY: number, radius: number): MapPoint | null => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      let best: MapPoint | null = null;
      let bestD = radius * radius;
      for (const p of visiblePoints) {
        const [sx, sy] = screenOf(p);
        const d = (sx - px) ** 2 + (sy - py) ** 2;
        if (d < bestD || (d === bestD && best && p.key < best.key)) {
          best = p;
          bestD = d;
        }
      }
      return best;
    },
    [visiblePoints, screenOf],
  );

  const hoverFrameRef = useRef(0);
  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType !== "mouse") return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(hoverFrameRef.current);
    hoverFrameRef.current = requestAnimationFrame(() => {
      setHoveredKey(nearestPoint(clientX, clientY, HIT_RADIUS_MOUSE)?.key ?? null);
    });
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const native = e.nativeEvent as PointerEvent;
    const radius = native.pointerType && native.pointerType !== "mouse" ? HIT_RADIUS_TOUCH : HIT_RADIUS_MOUSE;
    const hit = nearestPoint(e.clientX, e.clientY, radius);
    if (hit) update({ season: hit.entry.season, player: hit.entry.player_id });
  }

  function resetMapPosition() {
    const canvas = canvasRef.current;
    const zoom = zoomRef.current;
    if (!canvas || !zoom) return;
    const sel = d3.select(canvas);
    if (prefersReducedMotion()) sel.call(zoom.transform, d3.zoomIdentity);
    else sel.transition().duration(400).call(zoom.transform, d3.zoomIdentity);
  }

  // ---- controls ---------------------------------------------------------
  function handleSeasonChange(season: number) {
    // The reference stays selected when that player also qualified in the new season.
    update((cur) => ({
      season,
      player: cur.player && poolByKey.has(playerSeasonKey(cur.player, season)) ? cur.player : null,
    }));
  }

  // One search pick does the whole flow: switch to the player's real season,
  // select the real point, and drop only the filters that would hide them.
  const handleAutocompleteSelect = useCallback(
    (picked: PlayerAutocompleteSelection) => {
      const entry = poolByKey.get(playerSeasonKey(picked.id, picked.season));
      update((cur) => ({
        season: picked.season,
        player: picked.id,
        archetype: entry && cur.archetype && cur.archetype !== entry.archetype ? null : cur.archetype,
        pos: entry && cur.pos && cur.pos !== entry.pos_group ? null : cur.pos,
      }));
      setTransform(d3.zoomIdentity);
      const canvas = canvasRef.current;
      if (canvas && zoomRef.current) d3.select(canvas).call(zoomRef.current.transform, d3.zoomIdentity);
    },
    [poolByKey, update],
  );

  const seasons = Array.from({ length: SEASON_MAX - SEASON_MIN + 1 }, (_, i) => SEASON_MIN + i).reverse();
  const filtersActive = view.archetype != null || view.pos != null;
  const [lo, hi] = windowBounds(view.window, view.season, SEASON_MIN, SEASON_MAX);
  const rangeLabel =
    view.window === "season"
      ? `${seasonLabel(view.season)} only`
      : view.window === "all"
        ? WINDOW_LABELS.all
        : `${seasonLabel(lo)} to ${seasonLabel(hi)}`;

  const loadFailed = poolError || galaxyFailed;
  const loading = !loadFailed && (pool.length === 0 || (needsGalaxy && !galaxyForSeason));
  const playerSeasons = view.player && index?.[view.player]?.qualified_seasons;

  const selectClass =
    "rounded-md border border-line-strong bg-arena-panel px-3 py-2 text-base text-ink-light outline-none focus:border-court-orange sm:text-sm";

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-10 md:px-8">
      <h1 className="font-display text-4xl text-ink mb-1">Player Map</h1>
      <p className="mb-6 max-w-2xl text-sm text-stone-light">
        {view.window === "season"
          ? `Each dot represents a player from the ${seasonLabel(view.season)} season.`
          : `Each dot is a qualified player-season from ${rangeLabel}.`}{" "}
        Players who appear closer together had more similar playing styles, measured against their own season. See{" "}
        <Link href="/methodology" className="text-court-orange-bright hover:underline">how it works</Link>.
      </p>

      <div className="mb-4 flex flex-col gap-3">
        <PlayerAutocomplete
          placeholder="Search any player, any season…"
          preferredSeason={view.season}
          onSelect={handleAutocompleteSelect}
          className="w-full sm:max-w-sm"
        />

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <select
            aria-label="Season"
            value={view.season}
            onChange={(e) => handleSeasonChange(clampSeason(parseInt(e.target.value, 10)))}
            className={selectClass}
          >
            {seasons.map((s) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
          </select>

          <select
            aria-label="Playing style"
            value={view.archetype ?? "any"}
            onChange={(e) => update({ archetype: e.target.value === "any" ? null : e.target.value })}
            className={selectClass}
          >
            <option value="any">All playing styles</option>
            {archetypes.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>

          <select
            aria-label="Position"
            value={view.pos ?? "any"}
            onChange={(e) => update({ pos: e.target.value === "any" ? null : e.target.value })}
            className={selectClass}
          >
            <option value="any">All positions</option>
            <option value="Guard">Guards</option>
            <option value="Wing">Wings</option>
            <option value="Big">Bigs</option>
          </select>

          <button onClick={resetMapPosition} className="btn btn-secondary min-h-11 px-3 py-2 text-sm">Reset map position</button>

          {filtersActive && (
            <button onClick={() => update({ archetype: null, pos: null })} className="btn btn-secondary min-h-11 px-3 py-2 text-sm text-court-orange-bright">
              Clear filters
            </button>
          )}
        </div>

        <div role="group" aria-label="Compare across" className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm text-stone-light">Compare across</span>
          {COMPARE_WINDOWS.map((w) => {
            const active = view.window === w;
            return (
              <button
                key={w}
                type="button"
                aria-pressed={active}
                onClick={() => update({ window: w })}
                className={`min-h-11 rounded-md border px-3 py-2 text-sm transition-colors ${
                  active
                    ? "border-court-orange bg-court-orange/15 font-medium text-ink"
                    : "border-line-strong text-ink-light hover:border-court-orange"
                }`}
              >
                {WINDOW_LABELS[w]}
              </button>
            );
          })}
        </div>
      </div>

      {loadFailed && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-line-strong bg-arena-panel px-4 py-3 text-sm text-stone-light">
          <span>{poolError ? "Couldn't load the player data." : "Couldn't load this season's data."}</span>
          <button
            onClick={() => {
              if (poolError) setPoolAttempt((n) => n + 1);
              if (galaxyFailed) setGalaxyAttempt((n) => n + 1);
              setPoolError(false);
              setGalaxyError(false);
            }}
            className="shrink-0 rounded-md border border-line-strong px-3 py-2 text-sm font-medium text-ink-light hover:border-court-orange"
          >
            Retry
          </button>
        </div>
      )}

      <div ref={containerRef} className="relative overflow-hidden rounded-2xl border border-line bg-arena-bg-raised" style={{ height: size.h }}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Player Map showing ${visiblePoints.length.toLocaleString()} qualified player-seasons (${rangeLabel}) positioned by playing-style similarity. Closest matches for the selected player are listed below the map.`}
          style={{ width: size.w, height: size.h }}
          className="block touch-pan-y cursor-pointer"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => {
            cancelAnimationFrame(hoverFrameRef.current);
            setHoveredKey(null);
          }}
          onClick={handleCanvasClick}
        />

        {selectedPoint && (() => {
          // Positioned from the dot's rendered pixel position (not inside the
          // zoomed layer), so it stays one readable size and inside the map.
          const [sx, sy] = screenOf(selectedPoint);
          const card = selectedCardRect(sx, sy, size.w, size.h);
          return (
            <div
              className="pointer-events-none absolute rounded-lg border border-line-strong bg-arena-panel-strong px-3 py-2 text-sm leading-tight shadow-xl"
              style={{ left: card.x, top: card.y, width: card.w }}
            >
              <p className="truncate font-semibold text-ink-light">{selectedPoint.entry.player}</p>
              <p className="tabular text-stone-light">{seasonLabel(selectedPoint.entry.season)}</p>
            </div>
          );
        })()}

        {hoveredPoint && hoveredPoint.key !== selectedKey && (() => {
          const [hx, hy] = screenOf(hoveredPoint);
          const tipW = 190;
          const tipH = 56;
          const left = Math.max(4, Math.min(size.w - tipW - 4, hx - tipW / 2));
          const above = hy - tipH - 12 >= 4;
          const top = above ? hy - tipH - 12 : Math.min(size.h - tipH - 4, hy + 14);
          return (
            <div
              className="pointer-events-none absolute rounded-lg border border-line-strong bg-arena-panel-strong px-3 py-2 text-sm leading-tight shadow-xl"
              style={{ left, top, width: tipW }}
            >
              <p className="truncate font-semibold text-ink-light">{hoveredPoint.entry.player}</p>
              <p className="tabular truncate text-stone-light">
                {seasonLabel(hoveredPoint.entry.season)} · {hoveredPoint.entry.archetype}
              </p>
            </div>
          );
        })()}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-stone-light">Loading…</div>
        )}
        {!loading && !loadFailed && visiblePoints.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-stone-light">
            No qualified player-seasons match these filters.
          </div>
        )}
      </div>

      {view.player && pool.length > 0 && !selectedEntry && (
        <p className="mt-6 rounded-xl bg-arena-panel p-5 text-sm text-stone-light">
          That player isn&rsquo;t on the map for {seasonLabel(view.season)}. Pick a season or search for another player.
        </p>
      )}

      {selectedEntry && (
        <div className="mt-6 rounded-xl bg-arena-panel p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-display text-2xl text-ink">{selectedEntry.player}</p>
              <p className="text-sm text-stone">{selectedEntry.archetype} · {selectedEntry.pos_group}</p>
              {playerSeasons && playerSeasons.length > 1 ? (
                <select
                  aria-label={`Season for ${selectedEntry.player}`}
                  value={view.season}
                  onChange={(e) => update({ season: clampSeason(parseInt(e.target.value, 10)) })}
                  className={`mt-2 ${selectClass}`}
                >
                  {[...playerSeasons].reverse().map((s) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
                </select>
              ) : (
                <p className="tabular mt-1 text-sm text-stone">{seasonLabel(selectedEntry.season)}</p>
              )}
            </div>
            <Link href={`/player/${selectedEntry.player_id}/${selectedEntry.season}`} className="btn btn-primary min-h-11 px-4 py-2 text-sm text-center">
              View Player Profile →
            </Link>
          </div>

          <h2 className="mt-5 text-sm font-semibold text-ink-light">Closest playing styles</h2>
          <p className="text-sm text-stone-light">Across {rangeLabel}</p>
          {neighbors.length === 0 ? (
            <p className="mt-2 text-sm text-stone-light">No other qualified player-seasons to compare in this range.</p>
          ) : (
            <ol className="mt-2 flex flex-wrap gap-2">
              {neighbors.map((n) => (
                <li key={playerSeasonKey(n.player_id, n.season)}>
                  <Link
                    href={`/compare?a=${playerSeasonKey(selectedEntry.player_id, selectedEntry.season)}&b=${playerSeasonKey(n.player_id, n.season)}`}
                    aria-label={`Compare ${selectedEntry.player} with ${n.player}, ${seasonLabel(n.season)}`}
                    className="flex min-h-11 items-center rounded-full border border-line-strong px-4 py-2 text-sm text-ink-light hover:border-court-orange hover:text-court-orange-bright"
                  >
                    {n.player} — {seasonLabel(n.season)} ({Math.round(n.similarity)})
                  </Link>
                </li>
              ))}
            </ol>
          )}
          {neighbors.length > 0 && <p className="mt-2 text-sm text-stone-light">Select a match to compare players.</p>}
        </div>
      )}

      <p className="mt-6 text-sm text-stone-light" aria-live="polite">
        {visiblePoints.length.toLocaleString()} player-seasons shown. Qualified player-seasons only ({GALAXY_MIN_MINUTES}+ minutes, {GALAXY_MIN_GAMES}+ games). Scroll or pinch to zoom, drag to pan.
      </p>
    </div>
  );
}

export default function GalaxyPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1400px] px-5 py-10 md:px-8 text-sm text-stone-light">Loading…</div>}>
      <GalaxyPageInner />
    </Suspense>
  );
}
