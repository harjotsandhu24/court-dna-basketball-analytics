"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
 * range's FG% (darker/brighter = more efficient). Both numbers are shown in
 * the zone tooltip and in the legend below, never implied only by color.
 *
 * Tooltips: each zone is a real <button>. The tooltip is a sibling of the
 * clipped bar (so it is never cut off), is described-by the focused zone,
 * and is clamped inside the component's own width. It opens on mouse hover,
 * keyboard focus, and touch tap (tap again, tap elsewhere, or Escape to
 * close).
 */
export default function ShotDna({ data, compact = false }: { data: ShotDnaData; compact?: boolean }) {
  const maxFg = 0.75; // normalize color intensity against a realistic FG% ceiling
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const pointerTypeRef = useRef<string>("keyboard");
  const tipId = `${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-tip`;

  // Approximate left edge / width of each zone as fractions of the bar,
  // from the same share values driving each segment's flex-grow width.
  const shares = ZONES.map((z) => Math.max((data[z.key] as number | null) ?? 0, 0.01));
  const totalShare = shares.reduce((a, b) => a + b, 0) || 1;
  const zoneGeometry = ZONES.map((z, i) => {
    const before = shares.slice(0, i).reduce((a, b) => a + b, 0);
    return { key: z.key, leftFrac: before / totalShare, widthFrac: shares[i] / totalShare };
  });

  // Position the tooltip above its zone, then clamp it fully inside the bar
  // container's width (measured, not guessed). Direct DOM style writes: no
  // extra render, and it can wrap onto two lines at phone widths.
  useLayoutEffect(() => {
    if (!activeZone) return;
    const bar = barRef.current;
    const tip = tipRef.current;
    const g = zoneGeometry.find((z) => z.key === activeZone);
    if (!bar || !tip || !g) return;
    const barW = bar.clientWidth;
    tip.style.maxWidth = `${barW}px`;
    const tipW = tip.offsetWidth;
    const center = (g.leftFrac + g.widthFrac / 2) * barW;
    tip.style.left = `${Math.max(0, Math.min(barW - tipW, center - tipW / 2))}px`;
  });

  // Touch: tapping elsewhere (or Escape) closes the tooltip.
  useEffect(() => {
    if (!activeZone) return;
    function onPointerDown(e: PointerEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setActiveZone(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setActiveZone(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activeZone]);

  const activeDef = activeZone ? ZONES.find((z) => z.key === activeZone) : null;

  return (
    <div className="w-full">
      <div className="mb-1.5">
        <span className="text-eyebrow">Shooting Profile</span>
        {!compact && (
          <p className="mt-0.5 text-sm text-stone">
            See where the player took their shots and how often they made them. Tap or hover a segment for details.
          </p>
        )}
      </div>

      <div className="pt-14 sm:pt-10">
        <div ref={barRef} className="relative w-full">
          {activeDef && (
            <div
              ref={tipRef}
              id={tipId}
              role="tooltip"
              className="pointer-events-none absolute bottom-full z-10 mb-1.5 w-max rounded-md border border-line-strong bg-arena-panel-strong px-2.5 py-1.5 text-xs leading-snug text-ink-light shadow-lg"
              style={{ left: 0 }}
            >
              {activeDef.label}: {pct((data[activeDef.key] as number | null) ?? 0)} of attempts ·{" "}
              {pct((data[activeDef.fgKey] as number | null) ?? 0)} FG
            </div>
          )}

          <div role="group" aria-label="Shot distance zones" className="flex h-11 w-full overflow-hidden rounded-md border border-line">
            {ZONES.map((z) => {
              const share = (data[z.key] as number | null) ?? 0;
              const fg = (data[z.fgKey] as number | null) ?? 0;
              const intensity = Math.max(0.18, Math.min(1, fg / maxFg));
              const isActive = activeZone === z.key;
              return (
                <button
                  key={z.key}
                  type="button"
                  aria-label={`${z.label}: ${pct(share)} of shots, ${pct(fg)} field goal percentage`}
                  aria-describedby={isActive ? tipId : undefined}
                  className="relative flex min-w-0 items-center justify-center overflow-hidden text-xs font-semibold text-white transition-[flex-grow] duration-500 focus-visible:[outline-offset:-3px]"
                  style={{
                    flexGrow: Math.max(share, 0.01),
                    flexBasis: 0,
                    backgroundColor: `hsl(24 90% 45% / ${intensity})`,
                  }}
                  onPointerDown={(e) => { pointerTypeRef.current = e.pointerType; }}
                  onKeyDown={() => { pointerTypeRef.current = "keyboard"; }}
                  onPointerEnter={(e) => { if (e.pointerType === "mouse") setActiveZone(z.key); }}
                  onPointerLeave={(e) => { if (e.pointerType === "mouse") setActiveZone((cur) => (cur === z.key ? null : cur)); }}
                  onFocus={() => {
                    // Touch focus is handled by the tap (click) below.
                    if (pointerTypeRef.current !== "touch" && pointerTypeRef.current !== "pen") setActiveZone(z.key);
                  }}
                  onBlur={() => setActiveZone((cur) => (cur === z.key ? null : cur))}
                  onClick={() => {
                    if (pointerTypeRef.current === "touch" || pointerTypeRef.current === "pen") {
                      setActiveZone((cur) => (cur === z.key ? null : z.key));
                    }
                  }}
                >
                  {share > 0.1 && <span className="drop-shadow">{z.short}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {!compact && (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-5">
            {ZONES.map((z) => (
              <div key={z.key} className="rounded-md bg-arena-panel/60 px-1.5 py-1.5">
                <div className="text-xs text-stone">{z.short}</div>
                <div className="tabular text-sm font-semibold text-ink-light">{pct(data[z.key] as number)}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-sm">
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
