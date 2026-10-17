"""
Optional honors, roster, seed and champion data you can supply yourself. Nothing here is ever guessed.

Put CSV files in raw/honors_import/ (copy blanks from raw/honors_import_templates/) and run, from the analysis folder:

    py -m sim.honors_import --check       validate everything, change nothing (macOS/Linux: python3)
    py -m sim.honors_import --templates   write blank templates (never overwrites an existing file)
    py -m sim.export_data                 validate, then replace the app files atomically (nothing is written on any error)

An import is cross-checked against the shipped sources: a matching fact becomes "verified", a conflicting one stops the export.
See docs/model/honors_import.md for the exact source links and what is still missing.

Files (UTF-8 CSV with a header row; ids are Basketball-Reference player ids; season = the year the season ends, 2025-26 -> 2026):
  finals_mvp.csv                  season,player_id,player[,team]
  awards_extra.csv                season,award,player_id,player      award = mvp | dpoy | roy | smoy | mip (winners only; ties = 2 rows)
  end_of_season_teams_extra.csv   season,type,number_tm,player_id,player
  champion_roster.csv             season,player_id,player[,team]     one row per player on the championship roster (ring recipients)
  seeds_extra.csv                 season,conference,seed,team        official seeds (E/W, 1-8, Basketball-Reference team abbreviation)
  champions_extra.csv             season,champion[,finals]           independent champion record
"""
from __future__ import annotations
import sys
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
IMPORT_DIR = ROOT / "raw" / "honors_import"
AWARDS = {"mvp", "dpoy", "roy", "smoy", "mip"}
EOS = {"All-NBA": (15, {"1st", "2nd", "3rd"}), "All-Defense": (10, {"1st", "2nd"}), "All-Rookie": (10, {"1st", "2nd"})}


class ImportError_(ValueError):
    pass


def _read(path: Path, cols: list[str]) -> pd.DataFrame | None:
    if not path.exists():
        return None
    df = pd.read_csv(path, dtype=str).fillna("")
    miss = [c for c in cols if c not in df.columns]
    if miss:
        raise ImportError_(f"{path.name}: missing column(s) {', '.join(miss)}. Required: {', '.join(cols)}")
    df["season"] = pd.to_numeric(df["season"], errors="coerce")
    if df.season.isna().any() or ((df.season % 1) != 0).any():
        raise ImportError_(f"{path.name}: season must be a whole number (the year the season ends)")
    df["season"] = df.season.astype(int)
    for c in cols:
        if (df[c].astype(str).str.strip() == "").any() and c != "player":
            raise ImportError_(f"{path.name}: empty value in '{c}'")
    return df


def load_extra(known_player_seasons: set[tuple[str, int]], champion_players: dict[int, set[str]] | None = None, directory: Path = IMPORT_DIR) -> dict:
    """Validated extra honors. Returns {'finalsmvp': [...], 'awards': [...], 'eos': [...], 'coverage': {...}, 'messages': [...]}"""
    out = {"finalsmvp": [], "awards": [], "eos": [], "coverage": {}, "messages": []}
    known_ids = {p for p, _ in known_player_seasons}
    fm = _read(directory / "finals_mvp.csv", ["season", "player_id"])
    if fm is not None:
        if fm.season.duplicated().any():
            raise ImportError_("finals_mvp.csv: more than one row for a season (Finals MVP is never shared)")
        seasons = sorted(fm.season)
        if seasons != list(range(seasons[0], seasons[-1] + 1)):
            raise ImportError_("finals_mvp.csv: seasons must be contiguous (no gaps)")
        for r in fm.itertuples():
            if (r.player_id, r.season) not in known_player_seasons:
                raise ImportError_(f"finals_mvp.csv: {r.player_id} has no {r.season} season in the player data")
            if champion_players and r.season in champion_players and r.player_id not in champion_players[r.season]:
                out["messages"].append(f"finals_mvp.csv: {r.player_id} {r.season} did not appear for the champion in the game data; check the id")
            out["finalsmvp"].append((r.player_id, r.season))
        out["coverage"]["finalsmvp"] = {"from": seasons[0], "to": seasons[-1], "introduced": 1969}
    aw = _read(directory / "awards_extra.csv", ["season", "award", "player_id"])
    if aw is not None:
        bad = set(aw.award) - AWARDS
        if bad:
            raise ImportError_(f"awards_extra.csv: unknown award {sorted(bad)}; use {sorted(AWARDS)}")
        for r in aw.itertuples():
            if r.player_id not in known_ids:
                raise ImportError_(f"awards_extra.csv: unknown player_id {r.player_id}")
            out["awards"].append((r.player_id, r.season, r.award))
        for a, g in aw.groupby("award"):
            out["coverage"][a] = {"to": int(g.season.max())}
    eo = _read(directory / "end_of_season_teams_extra.csv", ["season", "type", "number_tm", "player_id"])
    if eo is not None:
        for (typ, season), g in eo.groupby(["type", "season"]):
            if typ not in EOS:
                raise ImportError_(f"end_of_season_teams_extra.csv: unknown type {typ}; use {sorted(EOS)}")
            n, tiers = EOS[typ]
            if not set(g.number_tm) <= tiers:
                raise ImportError_(f"end_of_season_teams_extra.csv: bad number_tm for {typ} {season}: {sorted(set(g.number_tm) - tiers)}")
            if len(g) < n:
                raise ImportError_(f"end_of_season_teams_extra.csv: {typ} {season} has {len(g)} rows; at least {n} are required (incomplete season)")
        for r in eo.itertuples():
            if r.player_id not in known_ids:
                raise ImportError_(f"end_of_season_teams_extra.csv: unknown player_id {r.player_id}")
            out["eos"].append((r.player_id, r.season, r.type, r.number_tm))
        for typ, g in eo.groupby("type"):
            out["coverage"][{"All-NBA": "allnba", "All-Defense": "alldef", "All-Rookie": "allrookie"}[typ]] = {"to": int(g.season.max())}
    return out


TEMPLATES = {
    "finals_mvp.csv": "season,player_id,player,team\n",
    "awards_extra.csv": "season,award,player_id,player\n",
    "end_of_season_teams_extra.csv": "season,type,number_tm,player_id,player\n",
    "champion_roster.csv": "season,player_id,player,team\n",
    "seeds_extra.csv": "season,conference,seed,team\n",
    "champions_extra.csv": "season,champion,finals\n",
}


def write_templates(directory: Path = ROOT / "raw" / "honors_import_templates") -> list[str]:
    """Header-only blanks. An existing file is never overwritten, so this is safe to rerun."""
    directory.mkdir(parents=True, exist_ok=True)
    made = []
    for name, header in TEMPLATES.items():
        p = directory / name
        if not p.exists():
            p.write_text(header, encoding="utf-8", newline="")
            made.append(name)
    return made


if __name__ == "__main__":
    if "--templates" in sys.argv:
        print("written:", write_templates() or "nothing (all templates already exist)")
    elif "--check" in sys.argv:
        from . import export_data
        sys.exit(export_data.main(dry_run=True))
    else:
        print(__doc__)
