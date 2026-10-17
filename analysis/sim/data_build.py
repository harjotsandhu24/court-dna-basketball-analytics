"""
Build the tables the simulation model needs from files already in raw/ and data/
plus the one documented external game-results source.

Nothing here reads playoff outcomes into a model input: playoff games are only
used to rebuild each series' shape (who played whom, format, who hosted).
"""
from __future__ import annotations
from pathlib import Path
import numpy as np
import pandas as pd

from . import config as C

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "raw"
DATA = ROOT / "data"


# ---------------------------------------------------------------------------
# Players
# ---------------------------------------------------------------------------
def load_player_seasons() -> pd.DataFrame:
    """One row per app player-season (>=250 minutes, 1997-2026) with the model's raw features."""
    c = pd.read_csv(DATA / "canonical_player_seasons.csv")
    adv = pd.read_csv(RAW / "Advanced.csv")
    adv["multi"] = adv.team.str.endswith("TM")
    comb = (adv.sort_values("multi", ascending=False)
               .drop_duplicates(["player_id", "season"])[["player_id", "season", "x3p_ar"]])
    c = c.merge(comb, on=["player_id", "season"], how="left")
    c = c[(c.mp >= C.MIN_PLAYER_MINUTES) & c.season.between(C.SEASON_MIN, C.SEASON_MAX)].copy()
    keep = ["player_id", "season", "player", "team", "g", "gs", "mp"] + C.FEATURES + ["x3p_percent"]
    c = c[keep].reset_index(drop=True)
    c["qualified"] = (c.mp >= C.QUALIFIED_MINUTES) & (c.g >= C.QUALIFIED_GAMES)
    c["complete"] = c[C.FEATURES].notna().all(axis=1)
    return c


def season_pool_stats(players: pd.DataFrame) -> pd.DataFrame:
    """Mean / sd of each feature per season over the qualified pool (same pool the app uses)."""
    q = players[players.qualified & players.complete]
    g = q.groupby("season")[C.FEATURES]
    mean, sd = g.mean(), g.std(ddof=1)
    out = mean.add_suffix("__mean").join(sd.add_suffix("__sd"))
    out["n"] = q.groupby("season").size()
    return out


def add_z(players: pd.DataFrame, stats: pd.DataFrame) -> pd.DataFrame:
    p = players.copy()
    for f in C.FEATURES:
        p[f + "_z"] = (p[f] - p.season.map(stats[f + "__mean"])) / p.season.map(stats[f + "__sd"])
    return p


# ---------------------------------------------------------------------------
# Teams
# ---------------------------------------------------------------------------
def load_team_summaries() -> pd.DataFrame:
    ts = pd.read_csv(RAW / "Team Summaries.csv")
    ts = ts[(ts.lg == "NBA") & ts.season.between(C.SEASON_MIN, C.SEASON_MAX)].copy()
    return ts


def league_environment(ts: pd.DataFrame) -> pd.DataFrame:
    """League-average rows (offensive rating, pace) per season."""
    la = ts[ts.team == "League Average"][["season", "o_rtg", "pace", "ts_percent", "x3p_ar", "w", "l"]].copy()
    la = la.rename(columns={"o_rtg": "lg_ortg", "pace": "lg_pace", "ts_percent": "lg_ts", "x3p_ar": "lg_x3par"})
    return la.set_index("season")


def team_seasons(ts: pd.DataFrame) -> pd.DataFrame:
    t = ts[(ts.team != "League Average") & ts.abbreviation.notna()].copy()
    t["games"] = t.w + t.l
    t["wins82"] = t.w / t.games * C.FULL_GAMES
    return t.reset_index(drop=True)


def load_rosters() -> pd.DataFrame:
    """Team-stint rows: how many minutes each player played for each team that season."""
    pt = pd.read_csv(RAW / "Player Totals.csv")
    pt = pt[(pt.lg == "NBA") & pt.season.between(C.SEASON_MIN, C.SEASON_MAX) & ~pt.team.str.endswith("TM")]
    return pt[["player_id", "season", "team", "g", "gs", "mp"]].reset_index(drop=True)


# ---------------------------------------------------------------------------
# Games and series (play-by-play game table through 2025-26, see games_build.py)
# ---------------------------------------------------------------------------
def load_games() -> pd.DataFrame:
    """Every regular-season and playoff game 1996-97 to 2025-26 (raw/sim/games_final.csv)."""
    g = pd.read_csv(RAW / "sim" / "games_final.csv")
    g = g[g.season.between(C.SEASON_MIN, C.SEASON_MAX)].copy()
    g["playoffs"] = g.playoffs.astype(bool)
    g["neutral"] = g.neutral.astype(bool)
    g["home_win"] = g.home_pts > g.away_pts
    return g.reset_index(drop=True)


def rebuild_series(games: pd.DataFrame) -> pd.DataFrame:
    """One row per playoff series (round, teams, host, winner, games) from the game table, all seasons."""
    from . import bracket_build as BB
    rows = []
    for s in sorted(games[games.playoffs].season.unique()):
        df = BB.rebuild_series(games, int(s))
        df.insert(0, "season", int(s))
        rows.append(df)
    out = pd.concat(rows, ignore_index=True)
    out["wins_needed"] = out.need
    return out
