"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const LINKS = [
  { href: "/", label: "Discover" },
  { href: "/galaxy", label: "Player Map" },
  { href: "/compare", label: "Compare Players" },
  { href: "/build-a-five", label: "Build a Lineup" },
];

export default function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Close on outside tap/click and on Escape -- a simple inline panel
  // (not a full-screen overlay) so it never blocks the rest of the page,
  // but should still dismiss the same way any other open menu does.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        // focus goes back to the control that opened the menu, so keyboard users don't lose their place
        menuButtonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Close whenever the route actually changes (covers Back/Forward and
  // any navigation that isn't a direct click on a link inside the menu).
  useEffect(() => {
    // Legitimate synchronous reset tied directly to the route changing,
    // not a response to async data arriving.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
  }, [pathname]);

  return (
    <header ref={headerRef} className="sticky top-0 z-50 border-b border-line bg-arena-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-5 py-3 md:px-8">
        <Link href="/" className="flex min-h-11 items-center gap-2 group" aria-label="COURTDNA home">
          <span className="font-display text-2xl tracking-wide text-ink group-hover:text-court-orange-bright transition-colors">
            COURT<span className="text-court-orange">DNA</span>
          </span>
        </Link>

        <nav className="hidden lg:flex items-center gap-1" aria-label="Primary">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active ? "text-court-orange-bright" : "text-stone hover:bg-arena-panel hover:text-ink-light"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <button
          ref={menuButtonRef}
          type="button"
          className="btn btn-secondary lg:hidden! min-h-11 min-w-11 px-3 py-2"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label="Toggle navigation menu"
        >
          <span aria-hidden="true">{open ? "✕" : "☰"}</span>
        </button>
      </div>

      {open && (
        <nav id="mobile-nav" className="lg:hidden border-t border-line px-5 py-3 flex flex-col gap-1" aria-label="Primary mobile">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`tap-target-44 rounded-md px-3 py-2.5 text-sm font-medium ${
                  active ? "bg-court-orange/10 text-court-orange-bright" : "text-stone hover:bg-arena-panel hover:text-ink-light"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
