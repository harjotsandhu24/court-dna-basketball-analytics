"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Framer Motion animates through its own engine, not plain CSS
 * transitions/animations -- the global `prefers-reduced-motion` rule in
 * globals.css (which forces `animation-duration`/`transition-duration` to
 * ~0 via `*`) does not reach it. `reducedMotion="user"` makes every
 * `motion.*` component in the tree automatically honor the OS-level
 * reduced-motion preference (effectively disabling transform/opacity
 * animation while still applying the final state instantly), without
 * needing a `useReducedMotion()` check in every individual component.
 */
export default function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
