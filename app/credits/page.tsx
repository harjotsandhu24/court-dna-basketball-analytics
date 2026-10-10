"use client";

import { useEffect, useMemo, useState } from "react";
import { getAllPhotoEntries, type PhotoEntry } from "@/lib/photoManifest";

export default function CreditsPage() {
  const [entries, setEntries] = useState<PhotoEntry[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    getAllPhotoEntries().then((m) => setEntries(Object.values(m).filter((e) => e.verification_status === "usable")));
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return entries;
    return entries.filter((e) => e.player_name.toLowerCase().includes(q));
  }, [entries, query]);

  return (
    <div className="mx-auto max-w-3xl px-5 py-14 md:px-8">
      <p className="text-eyebrow mb-2">Photo Credits</p>
      <h1 className="font-display text-5xl text-ink mb-4">Attribution</h1>
      <p className="mb-8 max-w-xl text-sm text-stone-light">
        Every real player photo in COURT DNA is sourced from Wikimedia Commons with verified license and attribution
        metadata, resolved via <code className="rounded bg-arena-panel px-1.5 py-0.5 text-ink-light">scripts/resolve_photos.py</code>.
        Players without a confidently-resolved photo use a fallback silhouette graphic instead of a guessed image —
        this is not a claim that Wikimedia hosts a photo for every player in the dataset.
      </p>

      <input
        type="search"
        placeholder="Search credited players…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-6 w-full max-w-md rounded-lg border border-line-strong bg-arena-panel px-4 py-2.5 text-ink placeholder:text-stone-light outline-none focus:border-court-orange"
      />

      <p className="mb-4 text-xs text-stone-light">{filtered.length} credited photo{filtered.length === 1 ? "" : "s"}</p>

      <ul className="flex flex-col divide-y divide-line">
        {filtered.map((e) => (
          <li key={e.player_id} className="py-4">
            <p className="font-semibold text-ink-light">{e.player_name}</p>
            <p className="mt-0.5 text-sm text-stone">{e.attribution_text}</p>
            <p className="mt-0.5 text-xs text-stone-light">
              License: {e.license_name}
              {e.license_url && (
                <> · <a href={e.license_url} target="_blank" rel="noreferrer noopener" className="text-court-orange-bright hover:underline">view license</a></>
              )}
              {e.source_page && (
                <> · <a href={e.source_page} target="_blank" rel="noreferrer noopener" className="text-court-orange-bright hover:underline">source</a></>
              )}
            </p>
          </li>
        ))}
        {filtered.length === 0 && <li className="py-8 text-center text-sm text-stone-light">No matching credits.</li>}
      </ul>
    </div>
  );
}
