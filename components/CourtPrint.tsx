"use client";

import { useId, useMemo } from "react";
import {
  computeSpokes,
  smoothClosedPath,
  hueForPosGroup,
  DIMENSION_ORDER,
  DIMENSION_DISPLAY_LABEL,
  computeSpokeLabelPositions,
} from "@/lib/courtPrint";

interface CourtPrintProps {
  traits: Record<string, number | null | undefined>;
  posGroup: string;
  archetype: string;
  size?: number;
  showLegend?: boolean;
  label?: string;
  animate?: boolean;
  /** Shows the "Playing Style" heading and one-line explanation above the
   * chart. Only meaningful alongside showLegend -- defaults to matching it,
   * since a heading with no legend (e.g. a small card thumbnail) would be
   * noise. */
  showHeading?: boolean;
}

/**
 * COURT DNA's signature visual fingerprint. Every element traces to a real
 * percentile value -- see lib/courtPrint.ts and docs/methodology.md. Not
 * decorative: the shape IS the data.
 *
 * Two label layouts, shown responsively (plain CSS breakpoints, not JS
 * viewport detection -- no layout shift or hydration flicker):
 *   - sm and up: the seven labels sit directly around their spokes, so a
 *     reader can visually connect each label to its direction at a glance.
 *   - below sm: there usually isn't clean room for seven multi-word labels
 *     around a small chart, so it falls back to the full-label list below
 *     the chart instead. Never abbreviated either way.
 * Both paths render the exact same chart geometry/calculations -- only the
 * label presentation differs.
 */
export default function CourtPrint({
  traits,
  posGroup,
  archetype,
  size = 220,
  showLegend = false,
  label,
  animate = true,
  showHeading = showLegend,
}: CourtPrintProps) {
  const uid = useId().replace(/:/g, "");
  const center = size / 2;
  const maxRadius = size * 0.38;
  const minRadius = size * 0.08;

  const spokes = useMemo(() => computeSpokes(traits, center, maxRadius, minRadius), [traits, center, maxRadius, minRadius]);
  const path = useMemo(() => smoothClosedPath(spokes), [spokes]);
  const hue = hueForPosGroup(posGroup);
  const ringRadii = [0.25, 0.5, 0.75, 1.0].map((f) => minRadius + (maxRadius - minRadius) * f);

  // Extra room around the SVG so the sm+ on-chart labels (placed just
  // outside the outer ring) have space to sit without being clipped.
  const outerBoxSize = size * 2.0;
  // Label anchor sits past the chart's own outer radius (maxRadius, where
  // a spoke at value=100 actually reaches) by a fixed clearance, so a
  // maxed-out spoke never runs into its own label.
  const labelRadiusPx = maxRadius + 40;
  const labelPositions = useMemo(
    () => computeSpokeLabelPositions(labelRadiusPx, outerBoxSize),
    [labelRadiusPx, outerBoxSize],
  );

  const ariaLabel =
    label ??
    `Playing Style chart: ${archetype}. ${DIMENSION_ORDER.map((d) => `${DIMENSION_DISPLAY_LABEL[d]} ${Math.round(traits[d] ?? 0)} out of 100`).join(", ")}.`;

  // A function rather than a precomputed element: when both the sm+ and
  // below-sm layouts are mounted at once (CSS hidden, not unmounted), each
  // needs its own gradient/filter ids -- reusing one element twice would
  // put two <svg> in the DOM referencing the same id, which is invalid.
  // Only one copy is announced to assistive tech either way, since the
  // hidden one is excluded from the accessibility tree.
  function renderChart(idSuffix: string) {
    const fillId = `cp-fill-${uid}-${idSuffix}`;
    const glowId = `cp-glow-${uid}-${idSuffix}`;
    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={ariaLabel}
        className="overflow-visible"
      >
      <defs>
        <radialGradient id={fillId} cx="50%" cy="50%" r="65%">
          <stop offset="0%" stopColor={`hsl(${hue} 95% 62% / 0.85)`} />
          <stop offset="100%" stopColor={`hsl(${hue} 90% 48% / 0.35)`} />
        </radialGradient>
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* background court geometry: concentric rings (percentile grid) +
          a faint arc motif evoking a three-point line, never an actual
          copied court diagram or logo */}
      <g opacity={0.35} stroke="var(--cp-grid, #4b4f5c)" strokeWidth={1} fill="none">
        {ringRadii.map((r) => (
          <circle key={r} cx={center} cy={center} r={r} />
        ))}
        {DIMENSION_ORDER.map((_, i) => {
          const a = (-90 + (360 / DIMENSION_ORDER.length) * i) * (Math.PI / 180);
          return (
            <line
              key={i}
              x1={center}
              y1={center}
              x2={center + maxRadius * Math.cos(a)}
              y2={center + maxRadius * Math.sin(a)}
            />
          );
        })}
        <path
          d={`M ${center - maxRadius * 1.05} ${center + maxRadius * 0.3} A ${maxRadius * 1.05} ${maxRadius * 1.05} 0 0 1 ${center + maxRadius * 1.05} ${center + maxRadius * 0.3}`}
          opacity={0.5}
        />
      </g>

      {/* the data shape itself */}
      <path
        d={path}
        fill={`url(#${fillId})`}
        stroke={`hsl(${hue} 95% 65%)`}
        strokeWidth={2}
        filter={`url(#${glowId})`}
        className={animate ? "cp-reveal" : undefined}
      />

      {spokes.map((s) => (
        <circle
          key={s.dimension}
          cx={s.x}
          cy={s.y}
          r={2.5 + (s.value / 100) * 2}
          fill={`hsl(${hue} 95% 78%)`}
        />
      ))}

        {/* center mark */}
        <circle cx={center} cy={center} r={3} fill="var(--cp-center, #e8e6df)" />
      </svg>
    );
  }

  return (
    <div className="inline-flex w-full flex-col items-center gap-3">
      {showHeading && (
        <div className="w-full max-w-[320px] text-center">
          <p className="font-display text-lg tracking-wide text-ink">Playing Style</p>
          <p className="mt-0.5 text-xs text-stone-light">
            See where this player stands across seven parts of the game.
          </p>
        </div>
      )}

      {!showLegend ? (
        // Small/decorative uses (cards, thumbnails): just the chart, at
        // its natural tight footprint, no labels either way.
        renderChart("solo")
      ) : (
        <>
          {/* sm and up: chart with labels positioned directly around their
              spokes. */}
          <div className="relative hidden sm:block" style={{ width: outerBoxSize, height: outerBoxSize }}>
            <div className="absolute" style={{ left: (outerBoxSize - size) / 2, top: (outerBoxSize - size) / 2 }}>
              {renderChart("desktop")}
            </div>
            {labelPositions.map((lp) => {
              const spoke = spokes.find((s) => s.dimension === lp.dimension)!;
              const textAlign = lp.align === "center" ? "center" : lp.align === "left" ? "left" : "right";
              const translateX = lp.align === "center" ? "-50%" : lp.align === "left" ? "0%" : "-100%";
              return (
                <div
                  key={lp.dimension}
                  className="pointer-events-none absolute w-[108px] text-xs leading-tight"
                  style={{
                    left: `${lp.leftPct}%`,
                    top: `${lp.topPct}%`,
                    transform: `translate(${translateX}, -50%)`,
                    textAlign,
                  }}
                >
                  <span className="font-medium text-ink-light">{DIMENSION_DISPLAY_LABEL[lp.dimension]}</span>{" "}
                  <span className="tabular font-semibold" style={{ color: `hsl(${hue} 85% 68%)` }}>
                    {Math.round(spoke.value)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* below sm: chart at its natural size, full-label list underneath. */}
          <div className="flex flex-col items-center gap-3 sm:hidden">
            {renderChart("mobile")}
            <ul className="grid w-full max-w-[360px] grid-cols-1 gap-x-5 gap-y-1.5 text-sm text-stone-light">
              {spokes.map((s) => (
                <li key={s.dimension} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: `hsl(${hue} 90% 60%)` }}
                      aria-hidden="true"
                    />
                    <span className="truncate text-ink-light">{DIMENSION_DISPLAY_LABEL[s.dimension]}</span>
                  </span>
                  <span className="tabular shrink-0 font-semibold text-ink-light">{Math.round(s.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
