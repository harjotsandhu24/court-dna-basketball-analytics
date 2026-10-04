"use client";

import { useRouter } from "next/navigation";
import PlayerAutocomplete, { type PlayerAutocompleteSelection } from "./PlayerAutocomplete";

/** Homepage/global search -- a thin wrapper around the shared
 * PlayerAutocomplete (same hardened typing/Enter/phone-Search behavior as
 * the Player Map) that opens the selected player's profile. It searches
 * every player with a profile page; the Player Map uses its own
 * map-qualified scope. */
export default function SearchBar({ size = "md", autoFocus = false }: { size?: "md" | "lg"; autoFocus?: boolean }) {
  const router = useRouter();

  function handleSelect(sel: PlayerAutocompleteSelection) {
    router.push(`/player/${sel.id}/${sel.season}`);
  }

  return (
    <PlayerAutocomplete
      scope="all"
      onSelect={handleSelect}
      placeholder="Search any player, 2000–01 to 2025–26…"
      ariaLabel="Search players"
      size={size === "lg" ? "lg" : "sm"}
      autoFocus={autoFocus}
    />
  );
}
