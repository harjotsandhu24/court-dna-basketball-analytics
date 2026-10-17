"""
Rebuild every 1997-2026 NBA postseason from game results and the NBA's own bracket structure.

* Series are rebuilt from the game table (pairs of teams, order of games). NBA playoff game ids (004YYRSGG, 2002+) carry
  round / slot / game number; they are used only to cross-check the rebuilt rounds.
* Seeds: no official seed table was reachable, so seeds are reconstructed. In each conference the bracket tree fixes the
  four first-round pairings (1v8, 4v5, 3v6, 2v7) and which pairs meet in round two. Of the eight ways to place the
  seeds that obey the tree, the one closest to regular-season record order is used. Seeds are labelled reconstructed and
  are used only to show bracket positions: they never decide home court.
* Home court: in all 30 postseasons the team with the better regular-season record hosted game 1 of every series
  (rounds 1-4); the few tied records are tested against head-to-head (see `homeRule`). The 2020 restart was played at
  one site: neutral.
"""
from __future__ import annotations
import itertools
import numpy as np
import pandas as pd

EAST = {"ATL", "BOS", "BRK", "NJN", "CHI", "CLE", "DET", "IND", "MIA", "MIL", "NYK", "ORL", "PHI", "TOR", "WAS", "WSB", "CHH", "CHA", "CHO"}


def series_pattern(season: int, rnd: int, need: int) -> str:
    """Home pattern for the team with home court. 2-2-1 best-of-5 (1997-2002 round 1), 2-3-2 Finals through 2013."""
    if need == 3:
        return "HHAAH"
    if rnd == 4 and season <= 2013:
        return "HHAAAHH"
    return "HHAAHAH"


def rebuild_series(F: pd.DataFrame, season: int) -> pd.DataFrame:
    g = F[F.playoffs & (F.season == season)].copy()
    g["order"] = g.game_id.fillna(0).astype(float)
    rows = {}
    for r in g.itertuples():
        rows.setdefault(frozenset((r.home, r.away)), []).append(r)
    info = []
    for key, rs in rows.items():
        rs = sorted(rs, key=lambda r: (r.order, str(r.date)))
        a, b = sorted(key)
        host = rs[0].home
        other = b if host == a else a
        wins = {a: 0, b: 0}
        pat = ""
        for r in rs:
            wins[r.home if r.home_pts > r.away_pts else r.away] += 1
            pat += "H" if r.home == host else "A"
        winner = max(wins, key=wins.get)
        info.append({"hc": host, "other": other, "winner": winner, "wins_hc": wins[host], "wins_other": wins[other], "games": len(rs),
                     "need": wins[winner], "first": rs[0].order, "neutral": bool(all(r.neutral for r in rs)),
                     "pattern_seen": pat, "id_round": int(rs[0].round) if pd.notna(rs[0].round) else None})
    df = pd.DataFrame(info).sort_values("first").reset_index(drop=True)
    count, rr = {}, []
    for r in df.itertuples():
        ra, rb = count.get(r.hc, 0) + 1, count.get(r.other, 0) + 1
        rr.append(max(ra, rb))
        count[r.hc], count[r.other] = ra, rb
    df["round"] = rr
    return df


def _components(s: pd.DataFrame):
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for r in s[s["round"] <= 3].itertuples():
        parent[find(r.hc)] = find(r.other)
    comps = {}
    for t in set(s.hc) | set(s.other):
        comps.setdefault(find(t), set()).add(t)
    return list(comps.values())


def build_bracket(F: pd.DataFrame, season: int, teams: pd.DataFrame) -> dict:
    s = rebuild_series(F, season)
    s["id"] = [f"R{r}S{i}" for r, i in zip(s["round"], s.groupby("round").cumcount() + 1)]
    comps = _components(s)
    assert len(comps) == 2, (season, comps)
    comps.sort(key=lambda c: -len(c & EAST))        # East first
    conf = {t: i for i, c in enumerate(comps) for t in c}
    tt = teams[teams.season == season].set_index("abbreviation")
    rec = {t: (tt.loc[t, "w"] / (tt.loc[t, "w"] + tt.loc[t, "l"]), tt.loc[t, "mov"]) for t in conf}
    # feeders
    prev, feeders = {}, {}
    for r in s.itertuples():
        feeders[r.id] = [prev.get(r.hc), prev.get(r.other)] if r.round > 1 else None
        prev[r.hc] = prev[r.other] = r.id
    byid = {r.id: r for r in s.itertuples()}
    seeds, ambiguous = {}, False
    for ci in (0, 1):
        members = [t for t in conf if conf[t] == ci]
        r1 = [r for r in s.itertuples() if r.round == 1 and r.hc in members]
        r2 = [r for r in s.itertuples() if r.round == 2 and r.hc in members]
        r3 = [r for r in s.itertuples() if r.round == 3 and r.hc in members]
        assert len(r1) == 4 and len(r2) == 2 and len(r3) == 1, (season, ci, len(r1), len(r2), len(r3))
        groups = [[x for x in r1 if x.id in feeders[g.id]] for g in r2]
        cands = []
        for a_group in (0, 1):
            for swap0, swap1 in itertools.product((0, 1), repeat=2):
                gA, gB = groups[a_group], groups[1 - a_group]
                tops = [gA[swap0], gB[swap1]]             # series whose host is seed 1 / seed 2
                lows = [gA[1 - swap0], gB[1 - swap1]]     # series whose host is seed 4 / seed 3
                m = {}
                for x, (hs, os_) in zip(tops + lows, [(1, 8), (2, 7), (4, 5), (3, 6)]):
                    m[x.hc], m[x.other] = hs, os_
                cands.append(m)
        def inversions(m):
            order = sorted(members, key=lambda t: (-rec[t][0], -rec[t][1], t))
            rank = {t: i + 1 for i, t in enumerate(order)}
            return sum(abs(rank[t] - m[t]) for t in members)
        scores = sorted((inversions(m), tuple(sorted(m.items()))) for m in cands)
        best = dict(scores[0][1])
        if len([x for x in scores if x[0] == scores[0][0]]) > 1:
            ambiguous = True
        seeds.update(best)
    # home-court rule: the team with the better regular-season record hosts game 1 (tested on every series below)
    def h2h(a, b):
        g = F[(F.season == season) & (~F.playoffs) & (((F.home == a) & (F.away == b)) | ((F.home == b) & (F.away == a)))]
        wa = int(((g.home == a) & g.home_win).sum() + ((g.away == a) & ~g.home_win).sum())
        return wa, len(g) - wa
    rule = {"series": 0, "host_better_record": 0, "host_worse_record": 0, "tied_record": 0, "tied_host_better_h2h": 0,
            "tied_host_worse_h2h": 0, "tied_h2h_even": 0, "tied_host_better_mov": 0, "tied_host_worse_mov": 0}
    out = []
    for r in s.itertuples():
        rule["series"] += 1
        if rec[r.hc][0] > rec[r.other][0]:
            rule["host_better_record"] += 1
        elif rec[r.hc][0] < rec[r.other][0]:
            rule["host_worse_record"] += 1
        else:
            rule["tied_record"] += 1
            x, y = h2h(r.hc, r.other)
            rule["tied_host_better_h2h" if x > y else "tied_host_worse_h2h" if x < y else "tied_h2h_even"] += 1
            rule["tied_host_better_mov" if rec[r.hc][1] > rec[r.other][1] else "tied_host_worse_mov"] += 1
        out.append({
            "id": r.id, "round": int(r.round), "need": int(r.need),
            "pattern": series_pattern(season, int(r.round), int(r.need)),
            "hc": r.hc, "other": r.other, "feeders": feeders[r.id], "neutral": bool(r.neutral),
            "history": {"winner": r.winner, "games": int(r.games), "wins_hc": int(r.wins_hc), "wins_other": int(r.wins_other)},
        })
    final = out[-1]
    # season series between playoff teams with identical regular-season records: the only tiebreak that can be computed from game results
    tie_h2h = {}
    ts = sorted(conf)
    for i, a in enumerate(ts):
        for b in ts[i + 1:]:
            if rec[a][0] == rec[b][0]:
                x, y = h2h(a, b)
                if x + y:
                    tie_h2h[f"{a}|{b}"] = [x, y]
    return {
        "season": season, "champion": final["history"]["winner"], "neutral": bool(s.neutral.all()),
        "seedSource": "reconstructed", "tieH2H": tie_h2h, "ambiguousSeeds": bool(ambiguous),
        "teams": {t: {"conf": int(conf[t]), "seed": int(seeds[t]), "w": int(tt.loc[t, "w"]), "l": int(tt.loc[t, "l"]),
                      "mov": float(tt.loc[t, "mov"]), "name": tt.loc[t, "team"]} for t in conf},
        "series": out, "homeRule": rule,
    }
