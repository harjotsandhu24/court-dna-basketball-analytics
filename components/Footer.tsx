import Link from "next/link";

export default function Footer() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto max-w-[1400px] px-5 py-10 md:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="font-display text-lg text-ink">
              COURT<span className="text-court-orange">DNA</span>
            </span>
            <p className="mt-1 max-w-md text-xs text-stone-light">
              Independent basketball analytics project. Not affiliated with or endorsed by the
              NBA or any NBA team.
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone" aria-label="Footer">
            <Link href="/methodology" className="hover:text-ink-light">Methodology</Link>
            <Link href="/credits" className="hover:text-ink-light">Photo Credits</Link>
            <a href="https://github.com/harjotsandhu24/court-dna-basketball-analytics" className="hover:text-ink-light" target="_blank" rel="noreferrer noopener">
              GitHub
            </a>
          </nav>
        </div>
        <p className="mt-6 text-xs text-stone-light">
          Data: Basketball-Reference.com player statistics, 2000-01 through 2025-26 regular seasons. © 2026
        </p>
      </div>
    </footer>
  );
}
