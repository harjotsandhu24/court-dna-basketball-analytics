"""
Build the game, series-slot and playoff-appearance tables for 1996-97 .. 2025-26 from documented sources.

Sources (all fetched from raw.githubusercontent.com / GitHub release assets; every file is hashed and logged):
  A. shufinskiy/nba_data  nbastatsv3_{Y}.tar.xz and nbastatsv3_po_{Y}.tar.xz  (NBA play-by-play, season Y = start year)
       -> one row per game (teams, home/away, final score, overtime) and per-game player appearances in the playoffs.
  B. sportsdataverse-data release  espn_nba_schedules/nba_schedule_{S}.csv  (ESPN schedules, season S = end year, 2002+)
       -> independent cross-check of every score, plus dates and the neutral-site flag.

Outputs (raw/sim/, not shipped): games_v3.csv, po_appearances.csv, espn_games.csv; log: docs/model/source_log.json.
Run: cd analysis && python3 -m sim.games_build [--refresh]
"""
from __future__ import annotations
import argparse, hashlib, io, json, lzma, sys, tarfile, time, urllib.request
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "raw" / "sim"
DL = RAW / "download"
LOG = ROOT / "docs" / "model" / "source_log.json"

SHUF = "https://raw.githubusercontent.com/shufinskiy/nba_data/main/datasets"
ESPN = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_nba_schedules"
START_YEARS = list(range(1996, 2026))          # 1996 = the 1996-97 season; season_end = start + 1
USE = ["actionNumber", "period", "teamId", "teamTricode", "personId", "scoreHome", "scoreAway", "location", "gameId"]


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for ch in iter(lambda: f.read(1 << 20), b""):
            h.update(ch)
    return h.hexdigest()


def fetch(url: str, dest: Path, refresh=False, tries=4) -> dict:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if refresh or not dest.exists() or dest.stat().st_size == 0:
        for k in range(tries):
            try:
                with urllib.request.urlopen(url, timeout=300) as r, open(dest, "wb") as f:
                    f.write(r.read())
                break
            except Exception as e:  # noqa: BLE001
                if k == tries - 1:
                    raise
                time.sleep(2 * (k + 1))
        when = date.today().isoformat()
    else:
        when = date.fromtimestamp(dest.stat().st_mtime).isoformat()
    return {"url": url, "file": dest.name, "bytes": dest.stat().st_size, "sha256": sha256(dest), "retrieved": when}


def read_tar_csv(p: Path) -> pd.DataFrame:
    with tarfile.open(p, "r:xz") as t:
        m = [x for x in t.getmembers() if x.name.endswith(".csv")][0]
        return pd.read_csv(io.BytesIO(t.extractfile(m).read()), usecols=lambda c: c in USE, low_memory=False)


def summarize(df: pd.DataFrame, season_end: int, po: bool):
    df = df[df.gameId > 0]
    g = df.groupby("gameId").agg(hs=("scoreHome", "max"), as_=("scoreAway", "max"), periods=("period", "max"), events=("actionNumber", "size"))
    ev = df[df.teamTricode.notna() & (df.teamTricode != "") & df.location.isin(["h", "v"])]
    home = ev[ev.location == "h"].groupby("gameId").agg(home=("teamTricode", lambda s: s.mode().iat[0]), home_id=("teamId", "max"))
    away = ev[ev.location == "v"].groupby("gameId").agg(away=("teamTricode", lambda s: s.mode().iat[0]), away_id=("teamId", "max"))
    out = g.join(home).join(away).reset_index().rename(columns={"as_": "away_pts", "hs": "home_pts", "gameId": "game_id"})
    out["season"] = season_end
    out["playoffs"] = po
    if po:
        # NBA playoff game ids: 004 YY 00 R S G  -> round, series slot inside the round, game number
        s = out.game_id.astype(int).astype(str).str.zfill(10)
        out["round"] = s.str[7].astype(int)
        out["slot"] = s.str[8].astype(int)
        out["gnum"] = s.str[9].astype(int)
    app = None
    if po:
        pl = df[(df.personId > 0) & df.teamTricode.notna() & (df.teamTricode != "")]
        app = pl.groupby(["gameId", "teamTricode", "personId"]).size().reset_index(name="events")
        app["season"] = season_end
        app = app.rename(columns={"gameId": "game_id", "teamTricode": "team", "personId": "nba_id"})
    return out, app


def build(refresh=False):
    log = {"retrieved": date.today().isoformat(), "sources": []}
    games, apps = [], []
    for y in START_YEARS:
        se = y + 1
        for po in (False, True):
            name = f"nbastatsv3_{'po_' if po else ''}{y}.tar.xz"
            ent = fetch(f"{SHUF}/{name}", DL / name, refresh)
            df = read_tar_csv(DL / name)
            g, a = summarize(df, se, po)
            ent.update({"season": se, "playoffs": po, "games": int(len(g)), "events": int(len(df))})
            log["sources"].append(ent)
            games.append(g)
            if a is not None:
                apps.append(a)
        print(se, "ok", flush=True)
    G = pd.concat(games, ignore_index=True)
    G.to_csv(RAW / "games_v3.csv", index=False)
    pd.concat(apps, ignore_index=True).to_csv(RAW / "po_appearances.csv", index=False)
    # ESPN cross-check (2002-2026)
    esp = []
    for se in range(2002, 2027):
        name = f"nba_schedule_{se}.csv"
        ent = fetch(f"{ESPN}/{name}", DL / name, refresh)
        d = pd.read_csv(DL / name, low_memory=False,
                        usecols=["game_id", "date", "neutral_site", "notes_headline", "season", "season_type", "status_type_name",
                                 "home_abbreviation", "away_abbreviation", "home_score", "away_score", "home_id", "away_id"])
        ent.update({"season": se, "rows": int(len(d))})
        log["sources"].append(ent)
        esp.append(d)
    E = pd.concat(esp, ignore_index=True)
    E.to_csv(RAW / "espn_games.csv", index=False)
    return G, E, log


# ---------------------------------------------------------------------------------------------------------------
# Reconcile the two sources and write the final game table
# ---------------------------------------------------------------------------------------------------------------
ESPN_TO_NBA = {"SA": "SAS", "GS": "GSW", "UTAH": "UTA", "WSH": "WAS", "NY": "NYK", "NJ": "NJN"}


def to_bbr(tri: str, season: int) -> str:
    """NBA tricode -> the Basketball-Reference abbreviation used everywhere else in COURT DNA."""
    if tri == "BKN":
        return "BRK"
    if tri == "PHX":
        return "PHO"
    if tri == "CHA" and season >= 2015:
        return "CHO"
    if tri == "WAS" and season <= 1997:
        return "WSB"                               # Washington Bullets, renamed Wizards in 1997-98
    return tri


def finalize(G: pd.DataFrame, E: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """
    One row per game, regular season and playoffs, BBR abbreviations.
      * NBA play-by-play (A) is the primary record.
      * Games ESPN lists that A lacks (2012-13: 17 games) are added and marked source='espn'.
      * Dates and neutral-site flags come from ESPN (2002+); 2020 restart games are neutral by rule (see notes).
    """
    G = G.copy()
    G["source"] = "nba_pbp"
    E = E[(E.status_type_name == "STATUS_FINAL") & E.season_type.isin([2, 3])].copy()
    E["playoffs"] = E.season_type == 3
    def espn_tri(a, season):
        if a == "NO":                              # ESPN uses one code for every New Orleans name
            return "NOP" if season >= 2014 else ("NOK" if season in (2006, 2007) else "NOH")
        return ESPN_TO_NBA.get(a, a)
    E["h"] = [espn_tri(a, s) for a, s in zip(E.home_abbreviation, E.season)]
    E["a"] = [espn_tri(a, s) for a, s in zip(E.away_abbreviation, E.season)]
    E["date"] = pd.to_datetime(E.date.str.replace("Z", "", regex=False), utc=True).dt.tz_localize(None)
    E["date"] = (E.date - pd.Timedelta(hours=5)).dt.normalize()     # UTC start -> US calendar date (good to a day)
    rep = {}
    # --- match ESPN rows to A rows by (season, playoffs, home points, away points, home team family)
    def fam(t):                                   # franchise family so NO/NOH/NOK and CHA/CHH match
        return {"NOH": "NO", "NOK": "NO", "NOP": "NO", "CHH": "CHA", "NJN": "BKN"}.get(t, t)
    G["fh"], G["fa"] = G.home.map(fam), G.away.map(fam)
    E["fh"], E["fa"] = E.h.map(fam), E.a.map(fam)
    G["k"] = list(zip(G.season, G.playoffs, G.fh, G.fa, G.home_pts, G.away_pts))
    E["k"] = list(zip(E.season, E.playoffs, E.fh, E.fa, E.home_score.astype(int), E.away_score.astype(int)))
    Ek = E.drop_duplicates("k").set_index("k")
    G["date"] = G.k.map(Ek["date"])
    G["espn_id"] = G.k.map(Ek["game_id"])
    G["neutral"] = False
    matched = set(G.k)
    # --- ESPN-only games (2002+) that belong to the regular season / playoffs of the NBA proper
    extra = E[~E.k.isin(matched)].copy()
    # drop all-star games and exhibition-like rows (team codes that are not franchises)
    franchise = set(G.fh) | set(G.fa)
    extra = extra[extra.fh.isin(franchise) & extra.fa.isin(franchise)]
    # a match on scores alone is not enough in 2002-04 where the two sources differ by a point or two: an ESPN row whose
    # two teams already have an A game on that date is the same game with a different score, not a new game.
    have = set(zip(G.season, G.playoffs, G.date, G.fh, G.fa))
    extra = extra[[(s, p, d, h, a) not in have for s, p, d, h, a in zip(extra.season, extra.playoffs, extra.date, extra.fh, extra.fa)]]
    # for seasons where A's regular season is complete the rest are exhibition / cup finals / makeups: keep only if season is short in A
    short = {}
    for s in range(2002, 2027):
        n_a = int(((G.season == s) & (~G.playoffs)).sum())
        short[s] = n_a
    exp = {2013: 1230}
    add = []
    for s, n in exp.items():
        ex = extra[(extra.season == s) & (~extra.playoffs)]
        add.append(ex)
        rep[f"espn_added_{s}"] = int(len(ex))
    A = pd.concat(add, ignore_index=True) if add else pd.DataFrame()
    rows = pd.DataFrame({
        "game_id": np.nan, "home_pts": A.home_score.astype(int), "away_pts": A.away_score.astype(int), "periods": np.nan,
        "home": A.h, "away": A.a, "season": A.season, "playoffs": A.playoffs, "source": "espn", "date": A.date,
        "espn_id": A.game_id, "neutral": False,
    }) if len(A) else pd.DataFrame()
    F = pd.concat([G.drop(columns=["events", "home_id", "away_id", "fh", "fa", "k"]), rows], ignore_index=True)
    # --- neutral sites: the 2020 restart (every playoff game and every regular-season game from 30 July 2020)
    F.loc[(F.season == 2020) & F.playoffs, "neutral"] = True
    F.loc[(F.season == 2020) & ~F.playoffs & (F.date >= "2020-07-30"), "neutral"] = True
    F["home"] = [to_bbr(t, s) for t, s in zip(F.home, F.season)]
    F["away"] = [to_bbr(t, s) for t, s in zip(F.away, F.season)]
    F["home_win"] = F.home_pts > F.away_pts
    rep["rows"] = int(len(F))
    rep["undated_2002plus"] = int(F[(F.season >= 2002)].date.isna().sum())
    return F, rep


def check_against_team_summaries(F: pd.DataFrame) -> dict:
    """Every team-season's regular-season W-L from the game table must equal Basketball-Reference's."""
    T = pd.read_csv(ROOT / "raw" / "Team Summaries.csv")
    T = T[(T.lg == "NBA") & (T.team != "League Average") & T.season.between(1997, 2026)]
    r = F[~F.playoffs]
    w = pd.concat([
        pd.DataFrame({"season": r.season, "team": r.home, "w": r.home_win.astype(int), "l": (~r.home_win).astype(int)}),
        pd.DataFrame({"season": r.season, "team": r.away, "w": (~r.home_win).astype(int), "l": r.home_win.astype(int)}),
    ]).groupby(["season", "team"]).sum().reset_index()
    m = w.merge(T[["season", "abbreviation", "w", "l"]], left_on=["season", "team"], right_on=["season", "abbreviation"], how="outer", suffixes=("_g", "_t"))
    bad = m[(m.w_g != m.w_t) | (m.l_g != m.l_t)]
    return {"team_seasons": int(len(m)), "mismatches": int(len(bad)), "detail": bad[["season", "team", "abbreviation", "w_g", "w_t", "l_g", "l_t"]].astype(object).where(bad.notna(), None).values.tolist()}


def write_source_log(F, rep, chk, log):
    """docs/model/source_log.json: every external file used for games, with URL, date, checksum, coverage, transformations."""
    srcs = log["sources"]
    obj = {
        "retrieved": log["retrieved"],
        "sources": srcs,
        "coverage": {
            "regular_season_games": int((~F.playoffs).sum()), "playoff_games": int(F.playoffs.sum()),
            "seasons": [int(F.season.min()), int(F.season.max())],
            "dated_games_2002_plus": int(F[F.season >= 2002].date.notna().sum()),
            "neutral_site_games": int(F.neutral.sum()),
        },
        "reconciliation": {"espn_vs_pbp": rep, "regular_season_record_vs_basketball_reference": {k: chk[k] for k in ("team_seasons", "mismatches")}},
        "transformations": [
            "NBA play-by-play v3 events reduced to one row per game (final home/away points, periods) by taking each game's last score.",
            "ESPN schedule rows matched to play-by-play games by season, playoffs flag, franchise family and both final scores; ESPN supplies dates and flags.",
            "Games that ESPN lists and play-by-play lacks are added only where the regular-season record then equals Basketball-Reference (2012-13: see espn_vs_pbp).",
            "Team codes mapped to Basketball-Reference abbreviations (BKN->BRK, PHX->PHO, CHA->CHO from 2015, WAS->WSB in 1997).",
            "2020 restart: every playoff game and every regular-season game from 2020-07-30 is marked neutral-site.",
            "Playoff appearances (player in a playoff game for a team) taken from play-by-play person IDs and mapped through analysis/crosswalk/nba_to_bbr.csv.",
        ],
        "not_available": {
            "official_playoff_seeds": "No official seed table was reachable. Seeds are reconstructed from the bracket and shown for position only.",
            "finals_mvp": "Not in any reachable source. See docs/model/honors_import.md.",
            "awards_2025_26": "MVP, DPOY, ROY, 6MOY, MIP, All-NBA, All-Defense, All-Rookie for 2025-26 are not in any reachable source. See docs/model/honors_import.md.",
        },
    }
    LOG.write_text(json.dumps(obj, indent=1, default=str))
    return obj


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    a = ap.parse_args()
    G, E, log = build(a.refresh)
    (RAW / "games_log.json").write_text(json.dumps(log, indent=1))
    F, rep = finalize(G, E)
    chk = check_against_team_summaries(F)
    if chk["mismatches"]:
        raise SystemExit(f"regular-season records disagree with Basketball-Reference: {chk['detail'][:5]}")
    F.to_csv(RAW / "games_final.csv", index=False)
    write_source_log(F, rep, chk, log)
    print(len(F), "games;", chk["team_seasons"], "team-seasons match Basketball-Reference")
