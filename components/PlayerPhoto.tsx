"use client";

import { useEffect, useRef, useState } from "react";
import { hueForPosGroup } from "@/lib/courtPrint";
import { getPhotoEntry, type PhotoEntry } from "@/lib/photoManifest";

interface PlayerPhotoProps {
  playerId: string;
  name: string;
  posGroup?: string;
  size?: number;
  rounded?: "full" | "lg";
  showAttribution?: boolean;
  priority?: boolean;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Renders a real, licensed player photo when the photo manifest has a
 * verified, usable entry -- otherwise (and always, if the image URL ever
 * fails to load, e.g. Wikimedia being offline) falls back to a polished
 * COURT DNA silhouette/initials graphic. The layout never breaks either
 * way: both states render at the same fixed size.
 */
export default function PlayerPhoto({
  playerId,
  name,
  posGroup = "Wing",
  size = 96,
  rounded = "full",
  showAttribution = false,
  priority = false,
}: PlayerPhotoProps) {
  const [entry, setEntry] = useState<PhotoEntry | null | undefined>(undefined);
  const [imgFailed, setImgFailed] = useState(false);
  const [showCredit, setShowCredit] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showCredit) return;
    function handlePointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setShowCredit(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowCredit(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showCredit]);

  useEffect(() => {
    let cancelled = false;
    getPhotoEntry(playerId).then((e) => {
      if (!cancelled) setEntry(e);
    });
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  const radiusClass = rounded === "full" ? "rounded-full" : "rounded-xl";
  const hue = hueForPosGroup(posGroup);
  const hasUsablePhoto = entry && entry.verification_status === "usable" && entry.thumbnail_url && !imgFailed;

  return (
    <div ref={rootRef} className="relative inline-block" style={{ width: size, height: size }}>
      {hasUsablePhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry!.thumbnail_url ?? undefined}
          alt={`Photo of ${name}`}
          width={size}
          height={size}
          loading={priority ? "eager" : "lazy"}
          onError={() => setImgFailed(true)}
          className={`${radiusClass} object-cover border border-line-strong`}
          style={{ width: size, height: size }}
        />
      ) : (
        <div
          className={`${radiusClass} flex items-center justify-center border border-line-strong font-display select-none`}
          style={{
            width: size,
            height: size,
            fontSize: size * 0.32,
            background: `linear-gradient(160deg, hsl(${hue} 60% 18%), hsl(${hue} 70% 10%))`,
            color: `hsl(${hue} 90% 72%)`,
          }}
          role="img"
          aria-label={`No photo available for ${name}`}
        >
          {initials(name)}
        </div>
      )}

      {showAttribution && hasUsablePhoto && (
        <>
          <button
            type="button"
            onClick={() => setShowCredit((s) => !s)}
            aria-label={`Photo credit for ${name}`}
            aria-expanded={showCredit}
            className="tap-target-44 absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded-full border border-line-strong bg-arena-panel-strong text-[10px] text-stone-light hover:text-ink-light"
          >
            i
          </button>
          {showCredit && (
            <div
              className="absolute right-0 top-full z-20 mt-2 w-56 max-w-[calc(100vw-2.5rem)] rounded-md border border-line bg-arena-panel-strong p-3 text-[11px] leading-relaxed text-stone-light shadow-xl"
            >
              <p className="text-ink-light font-medium mb-1">{entry!.attribution_text}</p>
              <p>License: {entry!.license_name}</p>
              <a href={entry!.source_page ?? undefined} target="_blank" rel="noreferrer noopener" className="text-court-orange-bright hover:underline">
                View source →
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
