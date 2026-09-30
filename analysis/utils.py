"""Shared helpers for the COURT DNA analysis pipeline."""
import hashlib
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
import config  # noqa: E402


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def raw_path(filename: str) -> str:
    return os.path.join(repo_root(), config.RAW_DIR, filename)


def data_path(filename: str) -> str:
    return os.path.join(repo_root(), config.DATA_DIR, filename)


def public_data_path(*parts: str) -> str:
    return os.path.join(repo_root(), config.PUBLIC_DATA_DIR, *parts)


def load_raw(filename: str) -> pd.DataFrame:
    return pd.read_csv(raw_path(filename), low_memory=False)


def sha256_of_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def filter_nba_seasons(df: pd.DataFrame) -> pd.DataFrame:
    """Restrict to NBA rows within the configured season range. Never mutates
    the caller's frame in place."""
    out = df[
        (df["lg"] == config.LEAGUE)
        & (df["season"] >= config.SEASON_MIN)
        & (df["season"] <= config.SEASON_MAX)
    ].copy()
    return out


def is_aggregate_team_row(team_value: str) -> bool:
    """True for '2TM', '3TM', '4TM', '5TM' style aggregate rows."""
    if not isinstance(team_value, str):
        return False
    return len(team_value) >= 3 and team_value[0].isdigit() and team_value.endswith("TM")
