"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as d3 from "d3";
import { loadGalaxy, loadSimilarityPool } from "@/lib/dataLoader";
import { findClosestMatches, type SimilarityPoolEntry } from "@/lib/similarity";
import { hueForPosGroup } from "@/lib/courtPrint";
import type { GalaxySeasonData, GalaxyPointFull } from "@/lib/types";
import { SEASON_MIN, SEASON_MAX, seasonLabel } from "@/lib/config";

const WIDTH = 1000;
const HEIGHT = 640;

export default function GalaxyPage() {
  const [season, setSeason] = useState(2024);
  const [data, setData] = useState<GalaxySeasonData | null>(null);
  const [pool, setPool] = useState<SimilarityPoolEntry[]>([]);
  const [selected, setSelected] = useState<GalaxyPointFull | null>(null);
  const [hovered, setHovered] = useState<GalaxyPointFull | null>(null);
  const [query, setQuery] = useState("");
  const [archetypeFilter, setArchetypeFilter] = useState<string | null>(null);
  const [posFilter, setPosFilter] = useState<string | null>(null);
  const [transform, setTransform] = useState(d3.zoomIdentity);

  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);

  useEffect(() => {
    // intentional synchronous reset when the season changes, so a stale
    // "selected" player from the previous season is never shown
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(null);
    loadGalaxy(season).then(setData);
  }, [season]);

  useEffect(() => {
    loadSimilarityPool().then(setPool);
  }, []);

  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;
    const svg = d3.select(svgRef.current);
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 8])
      .on("zoom", (event) => {
        setTransform(event.transform);
      });
    svg.call(zoom);
    return () => {
      svg.on(".zoom", null);
    };
  }, [data]);

  const xExtent = useMemo(() => (data ? d3.extent(data.points, (p) => p.x) as [number, number] : [-1, 1]), [data]);
  const yExtent = useMemo(() => (data ? d3.extent(data.points, (p) => p.y) as [number, number] : [-1, 1]), [data]);
  const xScale = useMemo(() => d3.scaleLinear().domain(xExtent).range([60, WIDTH - 60]), [xExtent]);
  const yScale = useMemo(() => d3.scaleLinear().domain(yExtent).range([HEIGHT - 60, 60]), [yExtent]);

  const archetypes = useMemo(() => (data ? Array.from(new Set(data.points.map((p) => p.archetype))).sort() : []), [data]);

  const visiblePoints = useMemo(() => {
    if (!data) return [];
    return data.points.filter((p) => {
      if (archetypeFilter && p.archetype !== archetypeFilter) return false;
      if (posFilter && p.pos_group !== posFilter) return false;
      return true;
    });
  }, [data, archetypeFilter, posFilter]);

  const matchedIds = useMemo(() => {
    if (query.trim().length < 2) return new Set<string>();
    const q = query.toLowerCase();
    return new Set(visiblePoints.filter((p) => p.player.toLowerCase().includes(q)).map((p) => p.player_id));
  }, [query, visiblePoints]);

  const neighbors = useMemo(() => {
    if (!selected || pool.length === 0) return [];
    const queryEntry = pool.find((p) => p.player_id === selected.player_id && p.season === season);
    if (!queryEntry) return [];
    return findClosestMatches(queryEntry, pool, { seasonMode: "same_season" }, 6);
  }, [selected, pool, season]);

  const neighborIds = new Set(neighbors.map((n) => n.player_id));

  function resetView() {
    if (!svgRef.current) return;
    d3.select(svgRef.current).transition().duration(400).call(
      d3.zoom<SVGSVGElement, unknown>().transform as never,
      d3.zoomIdentity,
    );
    setTransform(d3.zoomIdentity);
  }

  const seasons = Array.from({ length: SEASON_MAX - SEASON_MIN + 1 }, (_, i) => SEASON_MIN + i).reverse();

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-10 md:px-8">
      <h1 className="font-display text-4xl text-ink mb-1">Player Map</h1>
      <p className="mb-6 max-w-2xl text-sm text-stone-light">
        Each dot represents a player from the {data ? seasonLabel(season) : ""} season. Players who appear closer
        together had more similar playing styles. See{" "}
        <Link href="/methodology" className="text-court-orange-bright hover:underline">how it works</Link>.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={season}
          onChange={(e) => setSeason(parseInt(e.target.value, 10))}
          className="rounded-md border border-line-strong bg-arena-panel px-3 py-2 text-sm text-ink-light outline-none focus:border-court-orange"
        >
          {seasons.map((s) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
        </select>

        <input
          type="search"
          placeholder="Search this season…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="rounded-md border border-line-strong bg-arena-panel px-3 py-2 text-sm text-ink placeholder:text-stone-light outline-none focus:border-court-orange"
        />

        <select
          value={archetypeFilter ?? "any"}
          onChange={(e) => setArchetypeFilter(e.target.value === "any" ? null : e.target.value)}
          className="rounded-md border border-line-strong bg-arena-panel px-3 py-2 text-sm text-ink-light outline-none focus:border-court-orange"
        >
          <option value="any">All playing styles</option>
          {archetypes.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>

        <select
          value={posFilter ?? "any"}
          onChange={(e) => setPosFilter(e.target.value === "any" ? null : e.target.value)}
          className="rounded-md border border-line-strong bg-arena-panel px-3 py-2 text-sm text-ink-light outline-none focus:border-court-orange"
        >
          <option value="any">All positions</option>
          <option value="Guard">Guards</option>
          <option value="Wing">Wings</option>
          <option value="Big">Bigs</option>
        </select>

        <button onClick={resetView} className="btn btn-secondary px-3 py-2 text-sm">Reset view</button>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-line bg-arena-bg-raised">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          width="100%"
          height={HEIGHT}
          role="img"
          aria-label={`Player Map for the ${data ? seasonLabel(season) : ""} season, showing ${visiblePoints.length} players as points positioned by playing-style similarity.`}
          className="touch-none"
        >
          <g ref={gRef} transform={transform.toString()}>
            {/* connecting lines to nearest neighbors */}
            {selected && neighbors.map((n) => {
              const np = visiblePoints.find((p) => p.player_id === n.player_id);
              if (!np) return null;
              return (
                <line
                  key={n.player_id}
                  x1={xScale(selected.x)} y1={yScale(selected.y)}
                  x2={xScale(np.x)} y2={yScale(np.y)}
                  stroke="var(--court-orange)" strokeWidth={1} strokeOpacity={0.5}
                />
              );
            })}

            {/* soft halo behind the selected point, so it stays visible
                against nearby dots without changing any unselected dot's
                color */}
            {selected && visiblePoints.some((p) => p.player_id === selected.player_id) && (
              <circle
                cx={xScale(selected.x)}
                cy={yScale(selected.y)}
                r={15}
                fill="#fff"
                fillOpacity={0.16}
              />
            )}

            {visiblePoints.map((p) => {
              const isSelected = selected?.player_id === p.player_id;
              const isNeighbor = neighborIds.has(p.player_id);
              const isMatched = matchedIds.has(p.player_id);
              const hue = hueForPosGroup(p.pos_group);
              const r = isSelected ? 9 : isNeighbor ? 5.5 : isMatched ? 5.5 : 3.2;
              const opacity = query.trim().length >= 2 && !isMatched && !isSelected ? 0.18 : 0.88;
              return (
                <circle
                  key={`${p.player_id}`}
                  cx={xScale(p.x)}
                  cy={yScale(p.y)}
                  r={r}
                  fill={isSelected ? "#ffffff" : `hsl(${hue} 90% ${isMatched ? 70 : 58}%)`}
                  fillOpacity={isSelected ? 1 : opacity}
                  stroke={isSelected ? `hsl(${hue} 90% 60%)` : "none"}
                  strokeWidth={isSelected ? 2 : 0}
                  className="cursor-pointer transition-[r] duration-150"
                  onClick={() => setSelected(p)}
                  onMouseEnter={() => setHovered(p)}
                  onMouseLeave={() => setHovered(null)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${p.player}, ${p.archetype}${isSelected ? " (selected)" : ""}`}
                  onKeyDown={(e) => e.key === "Enter" && setSelected(p)}
                />
              );
            })}
            {/* persistent selected-player label -- stays visible without
                hover. Rendered as a foreignObject inside the same <g>
                transform as the dots (not a separately-positioned HTML
                overlay), so it shares their exact coordinate space and
                stays correctly aligned with the dot at any container
                width or zoom/pan state, with no separate scale math that
                could drift out of sync. Flips to the left side near the
                map's right edge so it never runs off the map. */}
            {selected && visiblePoints.some((p) => p.player_id === selected.player_id) && (() => {
              const px = xScale(selected.x);
              const py = yScale(selected.y);
              // Sized generously for the <640px tier (see className below):
              // this foreignObject box is a positioning estimate only
              // (content uses overflow-visible and is inline-block, so it
              // never gets clipped by it) -- a conservative size here just
              // keeps the flip/clamp math sensible at every scale.
              const labelW = 230;
              const labelH = 90;
              const flipLeft = px > WIDTH - 60 - labelW;
              const fx = flipLeft ? px - labelW - 12 : px + 12;
              const fy = Math.max(4, Math.min(HEIGHT - labelH - 4, py - labelH / 2));
              return (
                <foreignObject x={fx} y={fy} width={labelW} height={labelH} className="pointer-events-none overflow-visible">
                  {/* Content inside a <foreignObject> renders at whatever
                      scale the SVG itself is currently drawn at -- on a
                      360-430px phone the map draws at roughly a third of
                      its viewBox size, so a plain text-xs here would
                      shrink to ~4px and become unreadable. These sizes are
                      deliberately larger at the base (<640px) tier and
                      step back down as the map's actual rendered scale
                      grows, so the label reads at a consistent, readable
                      size (verified ~11-15px rendered) across phone,
                      tablet, and desktop alike -- not simply "whatever
                      12px looks like once shrunk." */}
                  <div className="inline-block rounded-lg border border-line-strong bg-arena-panel-strong px-3 py-2 text-[34px] leading-tight shadow-xl md:text-[16px] lg:text-xs">
                    <p className="font-semibold text-ink-light">{selected.player}</p>
                    <p className="tabular text-stone-light">{seasonLabel(season)}</p>
                  </div>
                </foreignObject>
              );
            })()}
          </g>
        </svg>

        {hovered && (
          <div
            className="pointer-events-none absolute rounded-lg border border-line-strong bg-arena-panel-strong px-3 py-2 text-xs shadow-xl"
            style={{
              left: Math.min(WIDTH - 160, xScale(hovered.x) * transform.k + transform.x),
              top: Math.max(0, yScale(hovered.y) * transform.k + transform.y - 60),
            }}
          >
            <p className="font-semibold text-ink-light">{hovered.player}</p>
            <p className="text-stone-light">{hovered.archetype}</p>
          </div>
        )}
      </div>

      {selected && (
        <div className="mt-6 rounded-xl bg-arena-panel p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-display text-2xl text-ink">{selected.player}</p>
              <p className="text-sm text-stone">{selected.archetype} · {selected.pos_group}</p>
            </div>
            <Link href={`/player/${selected.player_id}/${season}`} className="btn btn-primary px-4 py-2 text-sm">
              View Player Profile →
            </Link>
          </div>
          <p className="mt-3 text-xs text-stone-light">Most similar players (same season):</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {neighbors.map((n) => (
              <Link
                key={n.player_id}
                href={`/compare?a=${selected.player_id}_${season}&b=${n.player_id}_${season}`}
                className="rounded-full border border-line-strong px-3 py-1 text-xs text-ink-light hover:border-court-orange hover:text-court-orange-bright"
              >
                {n.player} ({Math.round(n.similarity)})
              </Link>
            ))}
          </div>
        </div>
      )}

      <p className="mt-6 text-xs text-stone-light">
        {visiblePoints.length.toLocaleString()} players shown. Scroll or pinch to zoom, drag to pan.
      </p>
    </div>
  );
}
