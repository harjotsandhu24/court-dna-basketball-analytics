"use client";

import { useState } from "react";
import type { ShotDna as ShotDnaData } from "@/lib/types";

interface Zone {
  key: keyof ShotDnaData;
  fgKey: keyof ShotDnaData;
  label: string;
  short: string;
}

const ZONES: Zone[] = [
  { key: "percent_fga_from_x0_3_range", fgKey: "fg_percent_from_x0_3_range", label: "0-3 ft (rim)", short: "0-3" },
  { key: "percent_fga_from_x3_10_range", fgKey: "fg_percent_from_x3_10_range", label: "3-10 ft", short: "3-10" },
  { key: "percent_fga_from_x10_16_range", fgKey: "fg_percent_from_x10_16_range", label: "10-16 ft", short: "10-16" },
  { key: "percent_fga_from_x16_3p_range", fgKey: "fg_percent_from_x16_3p_range", label: "16 ft-3PT", short: "16-3PT" },
  { key: "percent_fga_from_x3p_range", fgKey: "fg_percent_from_x3p_range", label: "3-point", short: "3PT" },
];

function pct(v: number | null | undefined, digits = 0): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

/**
 * Shot DNA / Shot Range Profile.
 *
 * IMPORTANT: this is explicitly NOT a location-based shot chart -- the
 * source data has no x/y shot coordinates, only attempt-share and FG% by
 * distance range. Each segment's WIDTH is the share of field-goal attempts
 * taken from that range this season; each segment's fill intensity is that
 * range's FG% (darker/brighter = more efficient). Both numbers are shown
 * directly on hover/focus and in the legend below, never implied only by
 * color.
 */
export default function ShotDna({ data, compact = false }: { data: ShotDnaData; compact?: boolean }) {
  const maxFg = 0.75; // normalize color intensity against a realistic FG% ceiling
  // Tooltip visibility is tracked in React state rather than CSS
  // group-hover/group-focus: the colored bar needs its own overflow-hidden
  // (to keep each segment's color clipped to the bar's rounded corners),
  // and a tooltip positioned bottom-full *inside* that same overflow-hidden
  // element gets silently clipped -- it never had anywhere to actually
  // render. State lets the tooltip live as a sibling, outside the clipped
  // bar, instead.
  const [activeZone, setActiveZone] = useState<string | null>(null);

  // Cumulative left-edge position (as a 0-1 fraction) for each zone, from
  // the same share values driving each segment's flex-grow width -- used
  // only to place the now-external tooltip roughly above its zone; being
  // off by a few px from the flex-grow rendering's own minimum-width
  // rounding doesn't matter for this.
  const shares = ZONES.map((z) => Math.max((data[z.key] as number | null) ?? 0, 0.01));
  const totalShare = shares.reduce((a, b) => a + b, 0) || 1;
  let cumulative = 0;
  const zoneGeometry = ZONES.map((z, i) => {
    const widthFrac = shares[i] / totalShare;
    const leftFrac = cumulative / totalShare;
    cumulative += shares[i];
    return { key: z.key, leftFrac, widthFrac };
  });

  return (
    <div className="w-full">
      <div className="mb-1.5">
        <span className="text-eyebrow">Shooting Profile</span>
        {!compact && (
          <p className="mt-0.5 text-xs text-stone-light">
            See where the player took their shots and how often they made them.
          </p>
        )}
      </div>

      <div className="relative w-full pt-8">
        {/* Tooltip layer -- a sibling of the clipped bar below, so it's
            never cut off by the bar's own overflow-hidden. Anchored by
            each zone's approximate center, with left/right alignment
            flipped near the two edges so it can't run outside the
            viewport on the first or last zone. */}
        {activeZone && (() => {
          const g = zoneGeometry.find((z) => z.key === activeZone);
          const z = ZONES.find((zz) => zz.key === activeZone);
          if (!g || !z) return null;
          const share = (data[z.key] as number | null) ?? 0;
          const fg = (data[z.fgKey] as number | null) ?? 0;
          const centerPct = (g.leftFrac + g.widthFrac / 2) * 100;
          const isLeftEdge = centerPct < 12;
          const isRightEdge = centerPct > 88;
          const align = isLeftEdge ? "left" : isRightEdge ? "right" : "center";
          return (
            <div
              role="tooltip"
              className="pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-md border border-line bg-arena-panel px-2 py-1 text-[11px] text-ink-light shadow-lg"
              style={{
                left: align === "right" ? "auto" : `${align === "left" ? 0 : centerPct}%`,
                right: align === "right" ? 0 : "auto",
                transform: align === "center" ? "translateX(-50%)" : undefined,
              }}
            >
              {z.label}: {pct(share)} of attempts · {pct(fg)} FG
            </div>
          );
        })()}

        <div className="flex h-9 w-full overflow-hidden rounded-md border border-line" role="img" aria-label={shotDnaAltText(data)}>
          {ZONES.map((z) => {
            const share = (data[z.key] as number | null) ?? 0;
            const fg = (data[z.fgKey] as number | null) ?? 0;
            const intensity = Math.max(0.18, Math.min(1, fg / maxFg));
            return (
              <div
                key={z.key}
                className="relative flex items-center justify-center text-[10px] font-semibold text-white transition-[flex-grow] duration-500"
                style={{
                  flexGrow: Math.max(share, 0.01),
                  flexBasis: 0,
                  backgroundColor: `hsl(24 90% 45% / ${intensity})`,
                }}
                tabIndex={0}
                onMouseEnter={() => setActiveZone(z.key)}
                onMouseLeave={() => setActiveZone((cur) => (cur === z.key ? null : cur))}
                onFocus={() => setActiveZone(z.key)}
                onBlur={() => setActiveZone((cur) => (cur === z.key ? null : cur))}
                onTouchStart={() => setActiveZone(z.key)}
              >
                {share > 0.06 && <span className="drop-shadow">{z.short}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {!compact && (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-5">
            {ZONES.map((z) => (
              <div key={z.key} className="rounded-md bg-arena-panel/60 px-1.5 py-1.5">
                <div className="text-[10px] text-stone-light">{z.short}</div>
                <div className="tabular text-xs font-semibold text-ink-light">{pct(data[z.key] as number)}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <StatChip label="Avg. shot distance" value={data.avg_dist_fga != null ? `${data.avg_dist_fga.toFixed(1)} ft` : "—"} />
            <StatChip label="Assisted 2PT" value={pct(data.percent_assisted_x2p_fg)} />
            <StatChip label="Assisted 3PT" value={pct(data.percent_assisted_x3p_fg)} />
            <StatChip label="Corner-3 rate" value={pct(data.percent_corner_3s_of_3pa)} />
            <StatChip label="Dunk rate" value={pct(data.percent_dunks_of_fga)} />
          </div>
        </>
      )}
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full border border-line bg-arena-panel/50 px-2.5 py-1 text-ink-light">
      <span className="text-stone-light">{label}:</span> <span className="tabular font-semibold">{value}</span>
    </span>
  );
}

function shotDnaAltText(data: ShotDnaData): string {
  return ZONES.map((z) => `${z.label}: ${pct(data[z.key] as number)} of shots at ${pct(data[z.fgKey] as number)}`).join("; ");
}
