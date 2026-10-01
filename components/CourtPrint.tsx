"use client";

import { useId, useMemo } from "react";
import {
  computeSpokes,
  smoothClosedPath,
  hueForPosGroup,
  DIMENSION_ORDER,
  DIMENSION_DISPLAY_LABEL,
  DIMENSION_LABEL_LINES,
  computeSpokeLabelPositions,
} from "@/lib/courtPrint";

// Compact geometry for the below-sm labeled layout -- deliberately
// independent of the `size` prop (which can be 200-260px, too large to
// fit seven multi-word labels around on a 360-430px viewport without
// overflow). Fixed viewBox units, proven at 360/390/430px.
const MOBILE_CHART = 170;
const MOBILE_VB = 280;
const MOBILE_OFFSET = (MOBILE_VB - MOBILE_CHART) / 2;
const MOBILE_CENTER = MOBILE_CHART / 2;
const MOBILE_MAX_R = MOBILE_CHART * 0.34;
const MOBILE_MIN_R = MOBILE_CHART * 0.08;
const MOBILE_LABEL_RADIUS = MOBILE_MAX_R + 22;

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

  // Mobile (below sm) geometry -- separate fixed-size spoke computation
  // and label positions, independent of the `size` prop. Same underlying
  // computeSpokes/smoothClosedPath calculation, just at mobile-safe scale.
  const mobileSpokes = useMemo(
    () => computeSpokes(traits, MOBILE_OFFSET + MOBILE_CENTER, MOBILE_MAX_R, MOBILE_MIN_R),
    [traits],
  );
  const mobilePath = useMemo(() => smoothClosedPath(mobileSpokes), [mobileSpokes]);
  const mobileRingRadii = [0.25, 0.5, 0.75, 1.0].map((f) => MOBILE_MIN_R + (MOBILE_MAX_R - MOBILE_MIN_R) * f);
  const mobileLabelPositions = useMemo(
    () => computeSpokeLabelPositions(MOBILE_LABEL_RADIUS, MOBILE_VB),
    [],
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

          {/* below sm: compact chart with labels directly around the
              spokes, at mobile-safe scale -- no separate list. */}
          <div className="relative mx-auto sm:hidden" style={{ width: 280, height: 280, maxWidth: "100%" }}>
            <svg
              viewBox={`0 0 ${MOBILE_VB} ${MOBILE_VB}`}
              width="100%"
              height="100%"
              role="img"
              aria-label={ariaLabel}
              className="overflow-visible"
            >
              <defs>
                <radialGradient id={`cp-fill-${uid}-mb`} cx="50%" cy="50%" r="65%">
                  <stop offset="0%" stopColor={`hsl(${hue} 95% 62% / 0.85)`} />
                  <stop offset="100%" stopColor={`hsl(${hue} 90% 48% / 0.35)`} />
                </radialGradient>
              </defs>
              <g opacity={0.35} stroke="var(--cp-grid, #4b4f5c)" strokeWidth={1} fill="none">
                {mobileRingRadii.map((r) => (
                  <circle key={r} cx={MOBILE_OFFSET + MOBILE_CENTER} cy={MOBILE_OFFSET + MOBILE_CENTER} r={r} />
                ))}
                {DIMENSION_ORDER.map((_, i) => {
                  const a = (-90 + (360 / DIMENSION_ORDER.length) * i) * (Math.PI / 180);
                  return (
                    <line
                      key={i}
                      x1={MOBILE_OFFSET + MOBILE_CENTER}
                      y1={MOBILE_OFFSET + MOBILE_CENTER}
                      x2={MOBILE_OFFSET + MOBILE_CENTER + MOBILE_MAX_R * Math.cos(a)}
                      y2={MOBILE_OFFSET + MOBILE_CENTER + MOBILE_MAX_R * Math.sin(a)}
                    />
                  );
                })}
              </g>
              <path d={mobilePath} fill={`url(#cp-fill-${uid}-mb)`} stroke={`hsl(${hue} 95% 65%)`} strokeWidth={2} />
              {mobileSpokes.map((s) => (
                <circle key={s.dimension} cx={s.x} cy={s.y} r={2.5 + (s.value / 100) * 2} fill={`hsl(${hue} 95% 78%)`} />
              ))}
              <circle cx={MOBILE_OFFSET + MOBILE_CENTER} cy={MOBILE_OFFSET + MOBILE_CENTER} r={2.5} fill="var(--cp-center, #e8e6df)" />
            </svg>

            {mobileLabelPositions.map((lp) => {
              const spoke = mobileSpokes.find((s) => s.dimension === lp.dimension)!;
              const lines = DIMENSION_LABEL_LINES[lp.dimension];
              const lastIdx = lines.length - 1;
              const textAlign = lp.align === "center" ? "center" : lp.align === "left" ? "left" : "right";
              const translateX = lp.align === "center" ? "-50%" : lp.align === "left" ? "0%" : "-100%";
              return (
                <div
                  key={lp.dimension}
                  aria-hidden="true"
                  className="pointer-events-none absolute w-max max-w-[88px] text-[9px] leading-tight"
                  style={{
                    left: `${lp.leftPct}%`,
                    top: `${lp.topPct}%`,
                    transform: `translate(${translateX}, -50%)`,
                    textAlign,
                  }}
                >
                  {lines.map((line, i) =>
                    i === lastIdx ? (
                      <div key={i} className="whitespace-nowrap font-semibold" style={{ color: `hsl(${hue} 85% 68%)` }}>
                        {line} {Math.round(spoke.value)}
                      </div>
                    ) : (
                      <div key={i} className="whitespace-nowrap text-stone-light">
                        {line}
                      </div>
                    ),
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
