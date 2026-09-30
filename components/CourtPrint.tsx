"use client";

import { useId, useMemo } from "react";
import { computeSpokes, smoothClosedPath, hueForPosGroup, DIMENSION_ORDER } from "@/lib/courtPrint";

interface CourtPrintProps {
  traits: Record<string, number | null | undefined>;
  posGroup: string;
  archetype: string;
  size?: number;
  showLegend?: boolean;
  label?: string;
  animate?: boolean;
}

const DIMENSION_ABBREV: Record<string, string> = {
  Scoring: "SCR",
  "Perimeter Profile": "3PT",
  Playmaking: "PLM",
  "Defensive Activity": "DEF",
  Rebounding: "REB",
  "Rim Pressure": "RIM",
  Efficiency: "EFF",
};

/**
 * COURT DNA's signature visual fingerprint. Every element traces to a real
 * percentile value -- see lib/courtPrint.ts and docs/methodology.md. Not
 * decorative: the shape IS the data.
 */
export default function CourtPrint({
  traits,
  posGroup,
  archetype,
  size = 220,
  showLegend = false,
  label,
  animate = true,
}: CourtPrintProps) {
  const uid = useId().replace(/:/g, "");
  const center = size / 2;
  const maxRadius = size * 0.38;
  const minRadius = size * 0.08;

  const spokes = useMemo(() => computeSpokes(traits, center, maxRadius, minRadius), [traits, center, maxRadius, minRadius]);
  const path = useMemo(() => smoothClosedPath(spokes), [spokes]);
  const hue = hueForPosGroup(posGroup);

  const ringRadii = [0.25, 0.5, 0.75, 1.0].map((f) => minRadius + (maxRadius - minRadius) * f);

  return (
    <div className="inline-flex flex-col items-center gap-3">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={
          label ??
          `Court Print: ${archetype}. ${DIMENSION_ORDER.map((d) => `${d} ${Math.round(traits[d] ?? 0)}th percentile`).join(", ")}.`
        }
        className="overflow-visible"
      >
        <defs>
          <radialGradient id={`cp-fill-${uid}`} cx="50%" cy="50%" r="65%">
            <stop offset="0%" stopColor={`hsl(${hue} 95% 62% / 0.85)`} />
            <stop offset="100%" stopColor={`hsl(${hue} 90% 48% / 0.35)`} />
          </radialGradient>
          <filter id={`cp-glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
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
          fill={`url(#cp-fill-${uid})`}
          stroke={`hsl(${hue} 95% 65%)`}
          strokeWidth={2}
          filter={`url(#cp-glow-${uid})`}
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

      {showLegend && (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] leading-tight text-stone-light w-full max-w-[260px]">
          {spokes.map((s) => (
            <li key={s.dimension} className="flex items-center justify-between gap-2">
              <span>
                <span className="font-semibold text-ink-light mr-1">{DIMENSION_ABBREV[s.dimension]}</span>
                {s.dimension}
              </span>
              <span className="tabular font-medium text-ink-light">{Math.round(s.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
