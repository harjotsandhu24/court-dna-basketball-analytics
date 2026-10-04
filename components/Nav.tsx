"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

const LINKS = [
  { href: "/", label: "Discover" },
  { href: "/galaxy", label: "Player Map" },
  { href: "/compare", label: "Compare Players" },
  { href: "/build-a-five", label: "Build a Lineup" },
  { href: "/methodology", label: "How It Works" },
  { href: "/credits", label: "Credits" },
];

export default function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

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
        // Focus returns to the control that opened the menu.
        toggleRef.current?.focus();
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
        <Link href="/" className="flex items-center gap-2 group" aria-label="COURT DNA home">
          <span className="font-display text-2xl tracking-wide text-ink group-hover:text-court-orange-bright transition-colors">
            COURT<span className="text-court-orange">DNA</span>
          </span>
        </Link>

        <nav className="hidden lg:flex items-center gap-1" aria-label="Primary">
          {LINKS.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors ${
                  active ? "text-court-orange-bright" : "text-stone hover:text-ink-light"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <button
          ref={toggleRef}
          type="button"
          className="btn btn-secondary h-11 min-w-11 px-3 lg:hidden"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={open ? "mobile-nav" : undefined}
          aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        >
          <span aria-hidden="true" className="text-xl leading-none">{open ? "✕" : "☰"}</span>
        </button>
      </div>

      {open && (
        <nav id="mobile-nav" className="lg:hidden border-t border-line px-5 py-3 flex flex-col gap-1" aria-label="Primary mobile">
          {LINKS.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-12 items-center justify-between rounded-md px-3 text-base font-medium ${
                  active ? "bg-court-orange/10 text-court-orange-bright" : "text-stone hover:bg-arena-panel hover:text-ink-light"
                }`}
              >
                <span>{l.label}</span>
                {active && <span className="text-sm" aria-hidden="true">● Current page</span>}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
