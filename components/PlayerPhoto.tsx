"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Photo-specific state belongs to one player: when playerId changes, drop
  // the old photo, its load-failure flag and any open credit popup so none
  // of it can carry over to the next player.
  const [statePlayerId, setStatePlayerId] = useState(playerId);
  if (statePlayerId !== playerId) {
    setStatePlayerId(playerId);
    setEntry(undefined);
    setImgFailed(false);
    setShowCredit(false);
  }

  // Keep the credit popup fully inside the viewport (320px and up): it is
  // fixed-positioned from the trigger's rect, clamped horizontally with an
  // 8px margin, and flipped above the trigger when there is no room below.
  useLayoutEffect(() => {
    if (!showCredit) return;
    function place() {
      const trigger = triggerRef.current;
      const popup = popupRef.current;
      if (!trigger || !popup) return;
      const margin = 8;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const width = Math.min(256, vw - margin * 2);
      popup.style.width = `${width}px`;
      const r = trigger.getBoundingClientRect();
      const height = popup.offsetHeight;
      const left = Math.max(margin, Math.min(r.right - width, vw - width - margin));
      let top = r.bottom + margin;
      if (top + height > vh - margin) top = Math.max(margin, r.top - height - margin);
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
      popup.style.visibility = "visible";
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [showCredit]);

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
            ref={triggerRef}
            type="button"
            onClick={() => setShowCredit((s) => !s)}
            aria-label={`Photo credit for ${name}`}
            aria-expanded={showCredit}
            className="absolute bottom-0 right-0 flex h-11 w-11 items-end justify-end p-0.5"
          >
            <span
              aria-hidden="true"
              className="flex h-6 w-6 items-center justify-center rounded-full border border-line-strong bg-arena-panel-strong text-xs text-stone hover:text-ink-light"
            >
              i
            </span>
          </button>
          {showCredit && (
            <div
              ref={popupRef}
              role="dialog"
              aria-label={`Photo credit for ${name}`}
              style={{ position: "fixed", left: 8, top: 8, visibility: "hidden" }}
              className="z-50 rounded-md border border-line bg-arena-panel-strong p-3 text-xs leading-relaxed text-stone shadow-xl"
            >
              <p className="text-ink-light font-medium mb-1 break-words">{entry!.attribution_text}</p>
              <p>License: {entry!.license_name}</p>
              <a href={entry!.source_page ?? undefined} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center text-court-orange-bright hover:underline">
                View source →
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
