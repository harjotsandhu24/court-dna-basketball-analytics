# Deployment guide (Phase 7 package)

Nothing has been committed, pushed or deployed. This page is the exact procedure for when you decide to.

## 1. Assemble the project (two ZIPs → one folder)

The shot files are 11,635 small JSON files (56 MB on disk, 21 MB zipped), so the package is two ZIPs. **Both** contain the single top-level folder `court-dna-basketball-analytics/`; extracting both into the same parent directory merges them:

| ZIP | Contents |
|---|---|
| `court-dna-phase7-app.zip` | app, analysis code, tests, docs, screenshots, all other production data in `public/data/` (season, career, galaxy, `shot_baselines.json`, similarity pool) |
| `court-dna-phase7-shot-data.zip` | `court-dna-basketball-analytics/public/data/shots/` (per-player-season shot files + `manifest.json`) |

```bash
mkdir ~/work && cd ~/work
unzip /path/to/court-dna-phase7-app.zip
unzip /path/to/court-dna-phase7-shot-data.zip      # same folder; adds public/data/shots/
cd court-dna-basketball-analytics
npm ci
npm run verify:data                                # expects: 11635 player-season files ... Shot data OK
```

The shot files did not change in Phase 7 (they are byte-identical to the Phase 5 shot-data ZIP), so an existing extracted `public/data/shots/` folder can simply be kept. Windows: extract both ZIPs into the same folder with "Extract here" (merge/replace when asked) and run the same npm commands in PowerShell.

Excluded from the ZIPs on purpose: `node_modules/`, `.next/`, raw datasets (`raw/`, including the 64 MB Parquet), intermediate `data/*.csv|json` (git-ignored; the app only reads `public/data/`), caches, virtualenvs.

## 2. Local preview

```bash
npm run build          # production build (no environment variables needed)
npm run start          # http://localhost:3000   (or: npx next start -p 3100)
```

Open `/player/bryanko01/2009`, switch on **Show shots**, hover the court. Deep threes: `/player/doncilu01/2026`. Compare: `/compare?a=bryanko01_2009&b=doncilu01_2026`.

Checks before shipping (all were run for this package; see `docs/qa.md`):

```bash
python3 -m pytest tests -q            # needs: pip install -r requirements.txt
npx tsc --noEmit && npx eslint . && npx vitest run
python3 analysis/shot_band_validation.py
python3 docs/qa/shot_ui_qa.py         # Chromium browser checks; needs `pip install playwright`, a running `npm run start -- -p 3100`
```

## 3. Deploy (when you are ready)

The live site is a Vercel project fed from GitHub (`harjotsandhu24/court-dna-basketball-analytics`). From the assembled folder, on a new branch:

```bash
git checkout -b phase7-shot-locations
git add -A
git status                  # review: public/data/shots/ (~11.6k files) should be new/changed; raw/ and data/ must NOT appear
git commit -m "Shot locations for 1996-97 to 2025-26, deep threes, court refinement"
git push -u origin phase7-shot-locations      # Vercel builds a preview deployment of the branch
# inspect the preview, then merge to the production branch
```

Facts to check on the Vercel side (not verifiable from here):
- **Use the Git integration, not `vercel deploy` from the folder.** Vercel's documented CLI limits are 15,000 source files and 100 MB (Hobby) / 1 GB (Pro); this project is about 13,900 files and about 120 MB of source before `node_modules`, so a Hobby CLI upload is expected to fail on size and sits close to the file-count limit. Git-based builds are not subject to those CLI upload limits, but no preview build has been run for this package.
- No environment variables, databases or serverless functions are needed; everything is static JSON fetched at runtime. A player page loads the season file (about 0.9 MB for 2025-26) and, only after **Show shots** is switched on, one shot file (about 7 KB).
- Node 20 or newer (built and tested on Node 22).

## 4. Rolling back or shipping without shot locations

- Roll back: revert/redeploy the previous production deployment in Vercel.
- Ship without shot locations (for example if the redistribution question below is answered "no"): move `data/shot_location_summary.json` out of the way, rerun `python3 analysis/step6_export_frontend_data.py` (this removes every `locations` field and the located-shot baselines; verified), and delete `public/data/shots/`. The court then falls back to the five distance zones with estimated counts, and deep threes disappear. The similarity model is unaffected either way.

## 5. Unresolved blockers and open risks

1. **Data redistribution (unresolved; tests do not resolve it).** The shot data are stats.nba.com shot-chart records (collected by shufinskiy/nba_data) read from the Hugging Face mirror `cdechoch/nba-data-archive`, whose card states Apache-2.0 and argues statistics are not copyrightable. A mirror's repository licence does not settle NBA.com's terms of use or redistribution rights for serving these coordinates publicly from `public/data/shots/`. Someone with authority to decide must read and accept (or reject) those terms before the public deployment. Until then this package is deploy-**ready**, not deploy-**cleared**.
2. **Vercel plan limits** (above) were not tested with a real build.
3. Known data gaps carried forward (see `docs/limitations.md`): 2008-09 to 2016-17 have 23–186 shots missing league-wide (up to 114 players per season labelled "Recorded shots"); one identity (Vincent Edwards 2019) is unmapped; playoffs are not integrated; about a quarter of shots in many seasons sit exactly at the hoop centre (a source artifact).
4. Browser coverage: Chromium only. No Firefox/WebKit, real-device touch or screen-reader testing.
5. The 331 reviewed distribution exceptions were reviewed by the assistant and still need human sign-off (`analysis/reviewed_distribution_exceptions.json`).
