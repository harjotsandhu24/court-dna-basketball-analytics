/**
 * Photo manifest access. The manifest itself (public/data/photo_manifest.json)
 * is generated offline by scripts/resolve_photos.py -- the production app
 * never calls Wikimedia directly and never depends on it being online. See
 * docs/photo-attribution.md for how entries are resolved and verified.
 */

export interface PhotoEntry {
  player_id: string;
  player_name: string;
  wikidata_id: string | null;
  commons_filename: string | null;
  thumbnail_url: string | null;
  source_page: string | null;
  creator: string | null;
  license_name: string | null;
  license_url: string | null;
  attribution_text: string | null;
  verification_status: "usable" | "unresolved" | "ambiguous";
}

type Manifest = Record<string, PhotoEntry>;

let manifestPromise: Promise<Manifest> | null = null;

function loadManifest(): Promise<Manifest> {
  if (!manifestPromise) {
    manifestPromise = fetch("/data/photo_manifest.json")
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return manifestPromise;
}

export async function getPhotoEntry(playerId: string): Promise<PhotoEntry | null> {
  const manifest = await loadManifest();
  return manifest[playerId] ?? null;
}

export async function getAllPhotoEntries(): Promise<Manifest> {
  return loadManifest();
}
