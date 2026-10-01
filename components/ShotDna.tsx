"use client";

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

      <div className="flex h-9 w-full overflow-hidden rounded-md border border-line" role="img" aria-label={shotDnaAltText(data)}>
        {ZONES.map((z) => {
          const share = (data[z.key] as number | null) ?? 0;
          const fg = (data[z.fgKey] as number | null) ?? 0;
          const intensity = Math.max(0.18, Math.min(1, fg / maxFg));
          return (
            <div
              key={z.key}
              className="group relative flex items-center justify-center text-[10px] font-semibold text-white transition-[flex-grow] duration-500"
              style={{
                flexGrow: Math.max(share, 0.01),
                flexBasis: 0,
                backgroundColor: `hsl(24 90% 45% / ${intensity})`,
              }}
              tabIndex={0}
            >
              {share > 0.06 && <span className="drop-shadow">{z.short}</span>}
              <div
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-arena-panel px-2 py-1 text-[11px] text-ink-light shadow-lg group-hover:block group-focus:block"
              >
                {z.label}: {pct(share)} of attempts · {pct(fg)} FG
              </div>
            </div>
          );
        })}
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
