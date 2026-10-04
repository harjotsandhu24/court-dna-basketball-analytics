"use client";

import { motion, useReducedMotion } from "framer-motion";
import { DIMENSION_DISPLAY_LABEL } from "@/lib/courtPrint";
import type { TraitDimension } from "@/lib/config";

interface TraitBarsProps {
  traits: Record<string, number | null | undefined>;
  compact?: boolean;
}

const ORDER: TraitDimension[] = ["Scoring", "Efficiency", "Playmaking", "Rebounding", "Defensive Activity", "Rim Pressure", "Perimeter Profile"];

export default function TraitBars({ traits, compact = false }: TraitBarsProps) {
  // Framer Motion animates via its own engine, not plain CSS transitions,
  // so the global `prefers-reduced-motion` CSS override doesn't reach it --
  // checked explicitly here instead.
  const reduceMotion = useReducedMotion();
  return (
    <div className="flex flex-col gap-2.5">
      {ORDER.map((dim, i) => {
        const val = Math.max(0, Math.min(100, traits[dim] ?? 0));
        return (
          <div key={dim}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-stone">{DIMENSION_DISPLAY_LABEL[dim]}</span>
              <span className="tabular font-semibold text-ink-light">{Math.round(val)}</span>
            </div>
            <div className={`w-full overflow-hidden rounded-full bg-arena-panel-strong ${compact ? "h-1.5" : "h-2"}`}>
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-court-orange-deep to-court-orange-bright"
                initial={reduceMotion ? false : { width: 0 }}
                animate={{ width: `${val}%` }}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.7, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
