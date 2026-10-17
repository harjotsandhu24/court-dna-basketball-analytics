"""Download documented external sources and record provenance (URL, date, size, checksum)."""
from __future__ import annotations
import hashlib, json, sys, urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "raw"
LOG = ROOT / "docs" / "model" / "source_log.json"
GAMES = RAW / "external_nbaallelo.csv"
URL = "https://raw.githubusercontent.com/fivethirtyeight/data/master/nba-elo/nbaallelo.csv"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch_games(force: bool = False) -> Path:
    if GAMES.exists() and not force:
        return GAMES
    GAMES.parent.mkdir(exist_ok=True)
    with urllib.request.urlopen(URL, timeout=120) as r, open(GAMES, "wb") as f:
        f.write(r.read())
    return GAMES


def write_log(extra: dict | None = None) -> dict:
    import pandas as pd
    g = pd.read_csv(GAMES)
    log = {
        "retrieved": date.today().isoformat(),
        "sources": [
            {
                "id": "fivethirtyeight_elo",
                "url": URL,
                "file": "raw/external_nbaallelo.csv (not committed; re-download with analysis/sim/sources.py)",
                "sha256": sha256(GAMES),
                "rows": int(len(g)),
                "coverage": f"games {int(g.year_id.min())}-{int(g.year_id.max())}; used 1997-2015 regular season and playoffs",
                "transformations": [
                    "keep one row per game (_iscopy == 0)",
                    "restrict to seasons 1997-2015",
                    "regular-season games used to fit and test the game model",
                    "playoff games used to rebuild series (winner, games played, who hosted each game); scores and winners are never model inputs",
                ],
            }
        ],
    }
    if extra:
        log.update(extra)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text(json.dumps(log, indent=2))
    return log


if __name__ == "__main__":
    p = fetch_games(force="--force" in sys.argv)
    print(p, sha256(p))
    write_log()
