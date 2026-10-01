"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/", label: "Discover" },
  { href: "/galaxy", label: "Player Map" },
  { href: "/build-a-five", label: "Build a Lineup" },
  { href: "/methodology", label: "How It Works" },
  { href: "/credits", label: "Credits" },
];

export default function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-arena-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-5 py-3 md:px-8">
        <Link href="/" className="flex items-center gap-2 group" aria-label="COURT DNA home">
          <span className="font-display text-2xl tracking-wide text-ink group-hover:text-court-orange-bright transition-colors">
            COURT<span className="text-court-orange">DNA</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1" aria-label="Primary">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
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
          className="btn btn-secondary md:hidden px-3 py-2"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label="Toggle navigation menu"
        >
          <span aria-hidden="true">{open ? "✕" : "☰"}</span>
        </button>
      </div>

      {open && (
        <nav id="mobile-nav" className="md:hidden border-t border-line px-5 py-3 flex flex-col gap-1" aria-label="Primary mobile">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2.5 text-sm font-medium text-stone hover:bg-arena-panel hover:text-ink-light"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
