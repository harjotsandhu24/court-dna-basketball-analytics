# COURT DNA — Photo Attribution

## How resolution works

`scripts/resolve_photos.py` resolves player photos from Wikidata/Wikimedia
Commons:

1. Query Wikidata for an entity matching the player's name, confirmed by a
   "basketball" description match. Zero or multiple matches are left
   `unresolved`/`ambiguous`, never guessed.
2. Read the entity's Commons image claim, then query Commons for author,
   license, and thumbnail URL.
3. Only marked `usable` when identity and license are both unambiguous.

This is a development-time-only workflow — the production app
(`lib/photoManifest.ts`, `components/PlayerPhoto.tsx`) only reads the
committed `public/data/photo_manifest.json` and never calls Wikidata or
Commons at runtime. No Python or internet access is required to run the
deployed app.

## Coverage in this build

This build environment cannot reach Wikidata or Commons, so the resolver
could not be run at scale here. **5 players were resolved manually**
instead, using the same verification standard:

| Player | Source file | Photographer | License |
|---|---|---|---|
| LeBron James | `LeBron James - 51959723161.jpg` | Erik Drost | CC BY 2.0 |
| Stephen Curry | `Steph Curry.jpg` | Erik Drost | CC BY 2.0 |
| Kevin Durant | `Kevin Durant, Paris 2024 (cropped).jpg` | Clément Bardot | CC BY-SA 4.0 |
| Giannis Antetokounmpo | `Giannis Antetokounmpo (51915264514).jpg` | Erik Drost | CC BY 2.0 |
| Luka Dončić | `Luka Doncic.jpg` | Erik Drost | CC BY 2.0 |

**Coverage: 5 of 1,900 players (0.26%).** Every other player uses the
fallback graphic.

## Fallback behavior

`components/PlayerPhoto.tsx` never assumes a photo will load: no manifest
entry (or a non-`usable` status) renders the fallback directly, and a
`usable` entry whose image fails to load falls back via `onError`. The
fallback is a COURT DNA graphic (initials over a position-group gradient)
at the same fixed size as a real photo, so layout never shifts. An in-app
attribution toggle shows photographer, license, and source link — only on
real photos, never fabricated for a fallback.

## Running the resolver

```bash
pip install requests
python3 scripts/resolve_photos.py --all       # every player in players_index.json
python3 scripts/resolve_photos.py --all --refresh   # re-check existing entries
```

Requires real internet access to Wikidata and Commons. Existing entries
are preserved unless `--refresh` is passed.

## Credits page

Every `usable` entry is listed and searchable on the in-app
[Photo Credits](/credits) page, with license and source link — this stays
accurate automatically as more players are resolved.

## License notice

No blanket "Wikimedia images are free to use" claim is made. Each entry's
specific license (CC BY 2.0, CC BY-SA 4.0, etc.) is preserved individually.
