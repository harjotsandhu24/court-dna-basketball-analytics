"use client";

import type { MutableRefObject } from "react";
import PlayerPhoto from "@/components/PlayerPhoto";
import { POSITIONS } from "@/lib/lineupBoard";
import { SMALL_SAMPLE_LABEL } from "@/lib/lineup";

export interface CourtSpot {
  playerId: string;
  name: string;
  seasonLabel: string;
  posGroup: string;
  smallSample: boolean;
  /** A new season for this player is still loading; the season shown is the previous one. */
  updating?: boolean;
}

interface LineupCourtProps {
  spots: (CourtSpot | null)[];
  /** Spot whose controls are open. */
  activeSlot: number | null;
  /** Spot whose player is being moved. */
  movingSlot: number | null;
  /** Spot waiting on an add/replace to load. */
  loadingSlot: number | null;
  /** While true, spots other than the loading one ignore clicks. */
  locked: boolean;
  controlsId: string;
  onSpotClick: (slot: number) => void;
  spotRefs: MutableRefObject<(HTMLButtonElement | null)[]>;
}

/** Simple half court with five clickable positions. Spots are real buttons, so
 * Enter/Space, Tab focus and touch all work without hovering or dragging. */
export default function LineupCourt({ spots, activeSlot, movingSlot, loadingSlot, locked, controlsId, onSpotClick, spotRefs }: LineupCourtProps) {
  const moving = movingSlot != null ? spots[movingSlot] : null;
  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-line bg-arena-panel" style={{ aspectRatio: "500 / 470" }}>
      <svg viewBox="0 0 500 470" className="absolute inset-0 h-full w-full" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="lineup-floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1c2130" />
            <stop offset="1" stopColor="#12151d" />
          </linearGradient>
        </defs>
        <rect width="500" height="470" fill="url(#lineup-floor)" />
        <g fill="none" stroke="#333b4f" strokeWidth="2.5" strokeLinecap="round">
          {/* paint */}
          <rect x="170" y="0" width="160" height="190" fill="rgba(255,106,26,0.07)" />
          {/* free-throw circle */}
          <path d="M190 190 a60 60 0 0 0 120 0" />
          <path d="M190 190 a60 60 0 0 1 120 0" strokeDasharray="7 7" />
          {/* restricted area, backboard, rim */}
          <path d="M210 52.5 a40 40 0 0 0 80 0" />
          <path d="M220 40 H280" strokeWidth="4" />
          <circle cx="250" cy="52.5" r="7.5" stroke="#ff8a3d" />
          {/* three-point line */}
          <path d="M30 0 V142 A237.5 237.5 0 0 0 470 142 V0" />
          {/* half-court line and circle */}
          <path d="M0 468 H500" />
          <path d="M190 468 a60 60 0 0 1 120 0" />
          {/* baseline */}
          <path d="M0 1.5 H500" strokeWidth="4" />
        </g>
      </svg>

      {POSITIONS.map((pos, i) => {
        const spot = spots[i];
        const isActive = activeSlot === i;
        const isMovingSource = movingSlot === i;
        const isTarget = movingSlot != null && !isMovingSource;
        const isLoading = loadingSlot === i;
        const blocked = locked && !isLoading;
        const label = spot
          ? isMovingSource
            ? `${pos.code}, ${pos.name}: ${spot.name}, ${spot.seasonLabel}, moving. Press to cancel the move.`
            : isTarget
              ? `${pos.code}, ${pos.name}: ${spot.name}, ${spot.seasonLabel}. Swap with ${moving?.name ?? "the moving player"}.`
              : `${pos.code}, ${pos.name}: ${spot.name}, ${spot.seasonLabel}${spot.updating ? ", updating" : ""}${isLoading ? ", loading" : ""}${spot.smallSample ? ", small sample" : ""}. Open options.`
          : isTarget
            ? `${pos.code}, ${pos.name}: empty. Move here: ${moving?.name ?? "the player"}.`
            : `${pos.code}, ${pos.name}: ${isLoading ? "loading" : "empty. Add player"}.`;
        const tone = isMovingSource
          ? "border-court-orange bg-court-orange/25 text-ink"
          : isActive
            ? "border-court-orange bg-court-orange/15 text-ink ring-2 ring-court-orange/60"
            : isTarget
              ? "border-dashed border-court-orange/70 bg-arena-panel-strong text-ink-light hover:bg-court-orange/20"
              : spot
                ? "border-line-strong bg-arena-panel-strong text-ink-light hover:border-court-orange hover:bg-court-orange/15"
                : "border-dashed border-line-strong bg-arena-panel/80 text-stone hover:border-court-orange hover:bg-court-orange/15 hover:text-ink";
        return (
          <button
            key={pos.code}
            ref={(el) => {
              spotRefs.current[i] = el;
            }}
            type="button"
            data-slot={pos.code}
            aria-label={label}
            aria-expanded={isActive}
            aria-controls={isActive ? controlsId : undefined}
            aria-busy={isLoading || undefined}
            aria-disabled={blocked || undefined}
            onClick={() => onSpotClick(i)}
            // Inline radius: the site-wide :focus-visible rule would otherwise square the corners.
            style={{ left: `${pos.x}%`, top: `${pos.y}%`, borderRadius: "0.75rem" }}
            className={`absolute flex w-[72px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 pb-1.5 pt-3 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-court-orange-bright min-[420px]:w-[84px] sm:w-[116px] sm:gap-1 sm:px-1.5 sm:pb-2 ${tone} ${blocked ? "opacity-60" : ""}`}
          >
            <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full border border-line-strong bg-arena-bg px-2 py-0.5 text-[10px] font-semibold leading-none tracking-wide text-stone">
              {pos.code}
            </span>
            {spot ? (
              <>
                <PlayerPhoto playerId={spot.playerId} name={spot.name} posGroup={spot.posGroup} size={36} decorative />
                <span className="line-clamp-2 break-words text-[10px] font-semibold leading-tight sm:text-[11px]">{spot.name}</span>
                {/* Same line, same height: the season text is swapped for a status while loading. */}
                <span className={`tabular text-[10px] leading-none ${spot.updating || isLoading ? "font-semibold text-court-orange-bright" : "text-stone-light"}`}>
                  {spot.updating ? "Updating\u2026" : isLoading ? "Loading\u2026" : spot.seasonLabel}
                </span>
                {spot.smallSample && (
                  <span className="whitespace-nowrap rounded-full border border-court-orange/50 bg-court-orange/10 px-1 py-0.5 text-[8px] font-medium leading-none text-court-orange-bright min-[420px]:px-1.5 min-[420px]:text-[9px]">
                    {SMALL_SAMPLE_LABEL}
                  </span>
                )}
                {/* Floating tags (like the position chip) so they never change the card's size. */}
                {(isMovingSource || isTarget) && (
                  <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-court-orange px-1.5 py-0.5 text-[9px] font-semibold leading-none text-[#14100a]">
                    {isMovingSource ? "Moving" : "Swap"}
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="font-display text-2xl leading-none" aria-hidden="true">{pos.code}</span>
                <span className="text-[10px] leading-none">{isTarget ? "Move here" : isLoading ? "Loading…" : <><span aria-hidden="true">+ </span>Add player</>}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
