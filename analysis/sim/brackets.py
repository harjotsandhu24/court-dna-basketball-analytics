"""
Rebuild each 1997-2015 postseason bracket from game results and derive seeds from regular-season records.

Official seeds are not in any accessible source. Seeds here are derived: within each conference (found from
who met whom before the Finals), teams are ranked by regular-season wins, then regular-season point
differential. The derived higher seed is compared with the team that actually hosted game 1 of every
first-round series so the user can see how often the derivation agrees with history.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

from . import config as C


def series_pattern(season: int, rnd: int, need: int) -> str:
    """Home pattern for the home-court team. Matches every observed series 1997-2015 (see validation report)."""
    if need == 3:
        return "HHAAH"
    if rnd == 4 and season <= 2013:
        return "HHAAAHH"
    return "HHAAHAH"


def build_bracket(season: int, ser: pd.DataFrame, teams: pd.DataFrame) -> dict:
    s = ser[ser.season == season].copy().sort_values(["round_hc", "start"]).reset_index(drop=True)
    s["id"] = [f"R{r}S{i}" for r, i in zip(s.round_hc, s.groupby("round_hc").cumcount() + 1)]
    # conference components from rounds 1-3
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for r in s[s.round_hc <= 3].itertuples():
        parent[find(r.hc)] = find(r.other)
    comps = {}
    for t in set(s.hc) | set(s.other):
        comps.setdefault(find(t), []).append(t)
    assert len(comps) == 2, (season, comps)
    conf = {}
    for i, (_, members) in enumerate(sorted(comps.items(), key=lambda kv: sorted(kv[1])[0])):
        for t in members:
            conf[t] = i
    tt = teams[teams.season == season].set_index("abbreviation")
    order = {}
    for ci in (0, 1):
        members = [t for t in conf if conf[t] == ci]
        members.sort(key=lambda t: (-tt.loc[t, "w"], -tt.loc[t, "mov"], t))
        for rank, t in enumerate(members, start=1):
            order[t] = rank
    # feeders: a later-round series is fed by each participant's previous series
    prev = {}
    out = []
    for r in s.itertuples():
        feeders = [prev.get(r.hc), prev.get(r.other)] if r.round_hc > 1 else None
        prev[r.hc] = r.id
        prev[r.other] = r.id
        out.append({
            "id": r.id, "round": int(r.round_hc), "need": int(r.wins_needed),
            "pattern": series_pattern(season, int(r.round_hc), int(r.wins_needed)),
            "hc": r.hc, "other": r.other, "feeders": feeders,
            "history": {"winner": r.winner, "games": int(r.games), "wins_hc": int(r.wins_hc), "wins_other": int(r.wins_other)},
        })
    final = out[-1]
    return {
        "season": season,
        "champion": final["history"]["winner"],
        "teams": {t: {"conf": int(conf[t]), "seed": int(order[t]), "w": int(tt.loc[t, "w"]), "l": int(tt.loc[t, "l"]),
                      "mov": float(tt.loc[t, "mov"]), "name": tt.loc[t, "team"]} for t in conf},
        "series": out,
    }


def seed_agreement(brackets: list[dict]) -> dict:
    """How often the derived higher seed hosted game 1 of the historical first-round series."""
    n = ok = 0
    mismatch = []
    for b in brackets:
        for s in b["series"]:
            if s["round"] != 1:
                continue
            n += 1
            sh, so = b["teams"][s["hc"]]["seed"], b["teams"][s["other"]]["seed"]
            if sh < so:
                ok += 1
            else:
                mismatch.append((b["season"], s["hc"], sh, s["other"], so))
    return {"series": n, "agree": ok, "mismatch": mismatch}
