"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SEASON_MAX, SEASON_MIN, seasonLabel } from "@/lib/config";

const FOOTER_LINKS = [
  { href: "/methodology", label: "How It Works" },
  { href: "/credits", label: "Credits" },
];

/** Small site-wide footer. How It Works and Credits live here (not in the top menu). */
export default function Footer() {
  const pathname = usePathname();
  const linkClass = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-md px-2 py-1.5 transition-colors hover:bg-arena-panel hover:text-ink-light ${active ? "text-court-orange-bright" : "text-stone"}`;
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto max-w-[1400px] px-5 py-6 md:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="font-display text-base text-ink">
              COURT<span className="text-court-orange">DNA</span>
            </span>
            <p className="mt-1 max-w-md text-xs text-stone-light">
              Independent basketball analytics project. Not affiliated with or endorsed by the NBA or any NBA team.
            </p>
          </div>
          <nav className="-mx-2 flex flex-wrap gap-x-2 gap-y-1 text-sm" aria-label="Footer">
            {FOOTER_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className={linkClass(pathname === l.href)} aria-current={pathname === l.href ? "page" : undefined}>
                {l.label}
              </Link>
            ))}
            <a
              href="https://github.com/harjotsandhu24/court-dna-basketball-analytics"
              className={linkClass(false)}
              target="_blank"
              rel="noreferrer noopener"
            >
              GitHub
            </a>
          </nav>
        </div>
        <p className="mt-3 text-xs text-stone-light">
          Data: Basketball-Reference.com player statistics, {seasonLabel(SEASON_MIN)} through {seasonLabel(SEASON_MAX)} regular seasons. © 2026
        </p>
      </div>
    </footer>
  );
}
