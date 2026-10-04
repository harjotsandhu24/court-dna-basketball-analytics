/**
 * Photo manifest access. The manifest itself (public/data/photo_manifest.json)
 * is generated offline by scripts/resolve_photos.py -- the production app
 * never calls Wikimedia directly and never depends on it being online. See
 * docs/photo-attribution.md for how entries are resolved and verified.
 *
 * A failed manifest request is never cached: the next call refetches, so a
 * temporary failure heals without a browser refresh.
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

/** Rejects on failure (and evicts itself) so callers that need to show an
 * error/retry state (Credits) can. */
export function loadPhotoManifest(): Promise<Manifest> {
  if (!manifestPromise) {
    const p = fetch("/data/photo_manifest.json")
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load photo manifest: ${r.status}`);
        return r.json() as Promise<Manifest>;
      })
      .catch((err) => {
        if (manifestPromise === p) manifestPromise = null;
        throw err instanceof Error ? err : new Error("Failed to load photo manifest");
      });
    manifestPromise = p;
  }
  return manifestPromise;
}

/** Photos are decorative: a failed manifest just means initials for now,
 * and the next PlayerPhoto to mount retries the request. */
export async function getPhotoEntry(playerId: string): Promise<PhotoEntry | null> {
  try {
    const manifest = await loadPhotoManifest();
    return manifest[playerId] ?? null;
  } catch {
    return null;
  }
}

export async function getAllPhotoEntries(): Promise<Manifest> {
  return loadPhotoManifest();
}
