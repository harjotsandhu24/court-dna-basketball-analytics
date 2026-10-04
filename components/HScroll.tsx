"use client";

import { useEffect, useRef, useState } from "react";

/** Horizontally scrollable region with an obvious scroll affordance: edge
 * fades appear on whichever side has more content, plus a short hint line
 * whenever the content actually overflows. Focusable so keyboard users can
 * scroll it. */
export default function HScroll({
  children,
  label,
  hint = "Swipe sideways to see more →",
  className = "",
}: {
  children: React.ReactNode;
  label: string;
  hint?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update); // also fires once on observe
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  return (
    <div>
      <div className="relative">
        <div ref={ref} role="region" aria-label={label} tabIndex={0} className={`overflow-x-auto ${className}`}>
          {children}
        </div>
        {edges.left && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-arena-bg to-transparent" />
        )}
        {edges.right && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-arena-bg to-transparent" />
        )}
      </div>
      {(edges.left || edges.right) && <p className="mt-1 text-xs text-stone">{hint}</p>}
    </div>
  );
}
