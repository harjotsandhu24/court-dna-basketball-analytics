# COURT DNA — Photo Pipeline & Attribution

## How it works

`scripts/resolve_photos.py` is the real, complete resolution pipeline:

1. Query the Wikidata API for entities matching a player's name.
2. Confirm identity by checking the entity's description contains
   "basketball" — if zero or multiple candidates match, the player is left
   `unresolved` or `ambiguous` respectively. **The script never guesses.**
3. Read the confirmed entity's `P18` (image) claim, if one exists.
4. Query the Wikimedia Commons API for that specific file's metadata:
   author, license name, license URL, and a thumbnail URL.
5. Only mark an entry `usable` when both identity and reuse license
   information are unambiguous. Otherwise: `unresolved` (no confident
   identity match, or no photo claim) or `ambiguous` (multiple plausible
   Wikidata matches) — surfaced honestly, not silently defaulted to a guess.

This is a **development-time-only** workflow. The production app
(`lib/photoManifest.ts`, `components/PlayerPhoto.tsx`) only ever reads the
committed `public/data/photo_manifest.json` and never calls Wikidata or
Commons at runtime — the Vercel build has no Python, no internet access
requirement, and no dependency on Wikimedia being online.

## Honest status of this build

**This sandboxed build environment cannot reach `www.wikidata.org` or
`commons.wikimedia.org`** — the same network egress restriction that blocks
Firefox/WebKit downloads for Playwright (see `docs/qa.md`). Running
`scripts/resolve_photos.py` here returns connection errors, not real
resolutions. Faking successful resolution to make coverage look better was
explicitly avoided.

Instead, **5 real players were resolved manually**, using a separate
research tool with broader internet access than this sandbox, following the
exact same verification standard the script enforces (confirmed identity,
confirmed license, confirmed author) — not guessed or inserted without
attribution:

| Player | Source file | Photographer | License |
|---|---|---|---|
| LeBron James | `LeBron James - 51959723161.jpg` | Erik Drost | CC BY 2.0 |
| Stephen Curry | `Steph Curry.jpg` | Erik Drost | CC BY 2.0 |
| Kevin Durant | `Kevin Durant, Paris 2024 (cropped).jpg` | Clément Bardot | CC BY-SA 4.0 |
| Giannis Antetokounmpo | `Giannis Antetokounmpo (51915264514).jpg` | Erik Drost | CC BY 2.0 |
| Luka Dončić | `Luka Doncic.jpg` | Erik Drost | CC BY 2.0 |

Thumbnail URLs were constructed via Wikimedia's documented, deterministic
MD5-hash thumbnail path scheme, computed programmatically (not hand-typed —
an earlier hand-typed version had 4 of 5 hash prefixes wrong, caught by
recomputing and diffing before shipping). Because this sandbox also cannot
reach `upload.wikimedia.org`, these 5 URLs could not be visually confirmed
to load an actual image from this environment — they return the same `403`
as every other Wikimedia request here. The URL construction pattern itself
is standard and widely used across the web, but that is not the same as a
verified live load, and this document says so directly rather than implying
otherwise.

**Coverage: 5 of 1,900 players with a detail page (0.26%).** Every other
player uses the fallback graphic described below. This is a real, honest
number — not a placeholder and not rounded up.

## Fallback behavior (guaranteed, production-safe)

`components/PlayerPhoto.tsx` never assumes a photo will load:

- If a manifest entry doesn't exist, or its `verification_status` isn't
  `"usable"`, the fallback renders directly — no fetch attempt for a photo
  that isn't there.
- If a `usable` entry's image URL fails to load for any reason (including
  Wikimedia being offline), an `onError` handler swaps to the same fallback,
  confirmed by screenshot in this exact build (Section `docs/qa.md`, "Photo
  fallback under real failure conditions").
- The fallback is a polished COURT DNA graphic — player initials over a
  gradient colored by position group (Guard/Wing/Big), rendered at the exact
  same fixed size as a real photo would be, so layout never shifts or
  breaks either way.
- An in-app attribution toggle ("i" button) appears only on real, `usable`
  photos and shows the photographer, license, and a link to the source —
  never fabricated for a fallback image.

## Running the resolver yourself

```bash
pip install requests
python3 scripts/resolve_photos.py --limit 50      # small test batch
python3 scripts/resolve_photos.py --all            # every player in players_index.json
python3 scripts/resolve_photos.py --all --refresh   # re-check existing entries too
```

Requires real internet access to `www.wikidata.org` and
`commons.wikimedia.org`. Existing manifest entries are preserved unless
`--refresh` is passed. The script rate-limits itself (0.3s between requests)
as a courtesy to Wikimedia's API.

## Credits page

Every `usable` manifest entry is listed, searchable, on the in-app
[Photo Credits](/credits) page, with its license and a link to the Commons
source page — not just the 5 shown above, so the page stays accurate
automatically as more players are resolved by re-running the script with
real network access.

## No blanket legal claim

This document and the app never claim "all Wikimedia images are free to
use" as a blanket statement. Each entry's specific license
(CC BY 2.0, CC BY-SA 4.0, etc.) is preserved individually, because different
Commons files carry different license terms even when all are broadly
Creative-Commons-licensed.
