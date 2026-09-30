"""
COURT DNA photo-resolution pipeline.

Resolves a Wikimedia Commons player photo for each player in the dataset,
records exact license/attribution metadata, and writes
public/data/photo_manifest.json. This is a DEVELOPMENT-TIME workflow, run
separately from the Next.js build -- the production app only ever reads the
committed manifest and never calls Wikimedia itself (Section 12 of the
build spec).

Process per player:
  1. Query Wikidata for an entity matching the player's name (basketball
     player instance-of / occupation check where possible).
  2. Read that entity's P18 (image) claim, if present.
  3. Query the Wikimedia Commons API for that file's metadata: author,
     license, license URL, and a reasonable thumbnail URL.
  4. Only mark an entry "usable" when identity and reuse metadata are
     BOTH clear. If either is ambiguous or missing, mark "unresolved" (no
     P18 found / no confident Wikidata match) or "ambiguous" (multiple
     plausible Wikidata matches for the name) -- never guess.

This script requires network access to www.wikidata.org and
commons.wikimedia.org, which the production build environment does not
have and does not need. Run it locally:

  pip install requests
  python3 scripts/resolve_photos.py --limit 50          # small test batch
  python3 scripts/resolve_photos.py --all                # every player in players_index.json

Existing entries in the manifest are preserved and only re-resolved with
--refresh.
"""
import argparse
import json
import os
import sys
import time

try:
    import requests
except ImportError:
    print("This script requires the 'requests' package: pip install requests", file=sys.stderr)
    sys.exit(1)

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "COURT-DNA-photo-resolver/1.0 (independent basketball analytics project)"

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MANIFEST_PATH = os.path.join(REPO_ROOT, "public", "data", "photo_manifest.json")
PLAYERS_INDEX_PATH = os.path.join(REPO_ROOT, "public", "data", "players_index.json")

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": USER_AGENT})


def wikidata_search(name: str):
    r = SESSION.get(WIKIDATA_API, params={
        "action": "wbsearchentities", "search": name, "language": "en",
        "format": "json", "type": "item", "limit": 5,
    }, timeout=15)
    r.raise_for_status()
    return r.json().get("search", [])


def wikidata_get_claims(qid: str):
    r = SESSION.get(WIKIDATA_API, params={
        "action": "wbgetentities", "ids": qid, "props": "claims|labels|descriptions",
        "format": "json",
    }, timeout=15)
    r.raise_for_status()
    return r.json().get("entities", {}).get(qid, {})


def is_basketball_player(entity: dict) -> bool:
    desc = entity.get("descriptions", {}).get("en", {}).get("value", "").lower()
    return "basketball" in desc


def get_p18_filename(entity: dict):
    claims = entity.get("claims", {})
    p18 = claims.get("P18")
    if not p18:
        return None
    try:
        return p18[0]["mainsnak"]["datavalue"]["value"]
    except (KeyError, IndexError):
        return None


def commons_file_info(filename: str):
    r = SESSION.get(COMMONS_API, params={
        "action": "query", "titles": f"File:{filename}", "prop": "imageinfo",
        "iiprop": "url|extmetadata|user", "iiurlwidth": 400, "format": "json",
    }, timeout=15)
    r.raise_for_status()
    pages = r.json().get("query", {}).get("pages", {})
    for _, page in pages.items():
        infos = page.get("imageinfo")
        if not infos:
            return None
        info = infos[0]
        meta = info.get("extmetadata", {})
        return {
            "thumbnail_url": info.get("thumburl") or info.get("url"),
            "source_page": f"https://commons.wikimedia.org/wiki/File:{filename.replace(' ', '_')}",
            "creator": strip_html(meta.get("Artist", {}).get("value")),
            "license_name": meta.get("LicenseShortName", {}).get("value"),
            "license_url": meta.get("LicenseUrl", {}).get("value"),
            "attribution_text": strip_html(meta.get("Attribution", {}).get("value")) or strip_html(meta.get("Artist", {}).get("value")),
        }
    return None


def strip_html(value):
    if not value:
        return None
    import re
    return re.sub("<[^<]+?>", "", value).strip() or None


def resolve_player(player_id: str, name: str) -> dict:
    base = {
        "player_id": player_id, "player_name": name, "wikidata_id": None,
        "commons_filename": None, "thumbnail_url": None, "source_page": None,
        "creator": None, "license_name": None, "license_url": None,
        "attribution_text": None, "verification_status": "unresolved",
    }
    try:
        results = wikidata_search(name)
    except requests.RequestException as e:
        print(f"  [{player_id}] Wikidata search failed: {e}", file=sys.stderr)
        return base

    candidates = []
    for r in results:
        qid = r["id"]
        try:
            entity = wikidata_get_claims(qid)
        except requests.RequestException:
            continue
        if is_basketball_player(entity):
            candidates.append((qid, entity))

    if len(candidates) == 0:
        return base  # unresolved: no confident identity match
    if len(candidates) > 1:
        base["verification_status"] = "ambiguous"
        base["wikidata_id"] = candidates[0][0]
        return base  # do not guess which one

    qid, entity = candidates[0]
    base["wikidata_id"] = qid
    filename = get_p18_filename(entity)
    if not filename:
        return base  # unresolved: identity confirmed but no photo claim

    try:
        info = commons_file_info(filename)
    except requests.RequestException as e:
        print(f"  [{player_id}] Commons lookup failed: {e}", file=sys.stderr)
        return base

    if not info or not info.get("license_name"):
        base["verification_status"] = "unresolved"  # reuse info unclear -- do not guess
        return base

    base.update(info)
    base["commons_filename"] = filename
    base["verification_status"] = "usable"
    return base


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=25)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--refresh", action="store_true", help="re-resolve players already in the manifest")
    args = ap.parse_args()

    with open(PLAYERS_INDEX_PATH) as f:
        players = json.load(f)

    manifest = {}
    if os.path.exists(MANIFEST_PATH):
        with open(MANIFEST_PATH) as f:
            manifest = json.load(f)

    to_process = list(players.items())
    if not args.refresh:
        to_process = [(pid, p) for pid, p in to_process if pid not in manifest]
    if not args.all:
        to_process = to_process[: args.limit]

    print(f"Resolving {len(to_process)} players...")
    for i, (player_id, p) in enumerate(to_process):
        name = p["name"]
        print(f"[{i+1}/{len(to_process)}] {name} ({player_id})")
        entry = resolve_player(player_id, name)
        manifest[player_id] = entry
        print(f"  -> {entry['verification_status']}")
        time.sleep(0.3)  # polite rate limit

    os.makedirs(os.path.dirname(MANIFEST_PATH), exist_ok=True)
    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2)

    usable = sum(1 for e in manifest.values() if e["verification_status"] == "usable")
    print(f"\nManifest now has {len(manifest)} entries, {usable} usable ({usable/max(len(manifest),1)*100:.1f}%)")
    print(f"Wrote {MANIFEST_PATH}")


if __name__ == "__main__":
    main()
