"use client";

import { useRouter } from "next/navigation";
import PlayerAutocomplete, { type PlayerAutocompleteSelection } from "./PlayerAutocomplete";

/** Homepage/global search -- a thin wrapper around the shared
 * PlayerAutocomplete that navigates straight to the selected player's
 * profile. Kept as its own component (rather than inlining
 * PlayerAutocomplete everywhere) so this call site's one job --
 * "search, then go to that player's real profile page" -- stays obvious,
 * while all the actual search/keyboard/accessibility/reliability
 * behavior lives in one hardened shared implementation. */
export default function SearchBar({ size = "md", autoFocus = false }: { size?: "md" | "lg"; autoFocus?: boolean }) {
  const router = useRouter();

  function handleSelect(sel: PlayerAutocompleteSelection) {
    router.push(`/player/${sel.id}/${sel.season}`);
  }

  return (
    <PlayerAutocomplete
      onSelect={handleSelect}
      placeholder="Search any player, 2000-01 to 2025-26…"
      size={size === "lg" ? "lg" : "sm"}
      autoFocus={autoFocus}
    />
  );
}
