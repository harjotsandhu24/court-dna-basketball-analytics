"""
Reference (numpy) implementation of the game, series and season simulators.
Used for validation. The browser engine (lib/sim) implements the same model and
is checked against this one.
"""
from __future__ import annotations
import numpy as np
from scipy.stats import norm


def series_sim(r_hc, r_ot, tau_hc, tau_ot, pattern: str, need: int, beta: float, h: float,
               n: int = 20000, seed: int = 1) -> dict:
    """Simulate a series. pattern: per-game 'H' (HC team home), 'A' (away), 'N' (neutral). need: wins needed.
    Returns P(HC team wins) and the distribution of games played."""
    rng = np.random.default_rng(seed)
    eps = rng.normal(0, tau_hc, n) - rng.normal(0, tau_ot, n)
    delta = (r_hc - r_ot) + eps
    wh = np.zeros(n, int)
    wo = np.zeros(n, int)
    games = np.zeros(n, int)
    alive = np.ones(n, bool)
    for ch in pattern:
        hh = h if ch == "H" else (-h if ch == "A" else 0.0)
        p = norm.cdf(beta * delta + hh)
        win = rng.random(n) < p
        wh += alive & win
        wo += alive & ~win
        games += alive
        alive = alive & (wh < need) & (wo < need)
        if not alive.any():
            break
    hc_win = wh >= need
    dist = {int(g): float((games == g).mean()) for g in range(need, 2 * need)}
    return {"p_hc": float(hc_win.mean()), "length": dist}


def season_sim(r_team, tau_team, opp_r, tau_opp, beta, h, n=4000, seed=1, games=82, home_games=41) -> dict:
    """82-game season against the given opponents: each opponent twice (once home, once away) plus random extras
    (half home, half away). Team and opponent rating errors are drawn once per simulated season."""
    rng = np.random.default_rng(seed)
    opp_r = np.asarray(opp_r, float)
    m = len(opp_r)
    extra = games - 2 * m
    idx_fixed = np.concatenate([np.arange(m), np.arange(m)])
    home_fixed = np.concatenate([np.ones(m), np.zeros(m)])
    eps_t = rng.normal(0, tau_team, n)
    eps_o = rng.normal(0, tau_opp, (n, m))
    opp_eff = opp_r[None, :] + eps_o                                    # (n, m)
    idx = np.tile(idx_fixed, (n, 1))
    home = np.tile(home_fixed, (n, 1))
    if extra > 0:
        idx = np.concatenate([idx, rng.integers(0, m, (n, extra))], axis=1)
        home = np.concatenate([home, np.tile((np.arange(extra) % 2 == 0).astype(float), (n, 1))], axis=1)
    d = (r_team + eps_t)[:, None] - np.take_along_axis(opp_eff, idx, axis=1)
    p = norm.cdf(beta * d + np.where(home > 0, h, -h))
    wins = (rng.random(p.shape) < p).sum(axis=1)
    q = 0.1
    return {"mean": float(wins.mean()), "lo": float(np.quantile(wins, q)), "hi": float(np.quantile(wins, 1 - q)),
            "sd": float(wins.std())}


def home_matrix(bracket: dict, teams: list[str], pct, mov, tie: str = "net", mine: str | None = None):
    """hosts[i, j] is True when team i hosts game 1 against team j. Order of rules: a real earlier meeting keeps its real host;
    the better regular-season record; equal records between two real teams: the season series if it is uneven; otherwise a
    labelled assumption (tie = "net": better point differential, "mine": the custom lineup, "theirs": its opponent)."""
    T = len(teams)
    hist = {frozenset((s["hc"], s["other"])): s["hc"] for s in bracket["series"]}
    tie_h2h = bracket.get("tieH2H", {})
    hosts = np.zeros((T, T), bool)
    for i, ti in enumerate(teams):
        for j, tj in enumerate(teams):
            if i == j:
                continue
            real = hist.get(frozenset((ti, tj)))
            if real is not None:
                hosts[i, j] = real == ti
            elif pct[i] != pct[j]:
                hosts[i, j] = pct[i] > pct[j]
            else:
                lo, hi = sorted((ti, tj))
                hh = tie_h2h.get(f"{lo}|{hi}")
                if ti != mine and tj != mine and hh and hh[0] != hh[1]:
                    hosts[i, j] = (lo if hh[0] > hh[1] else hi) == ti
                elif mine in (ti, tj) and tie == "mine":
                    hosts[i, j] = ti == mine
                elif mine in (ti, tj) and tie == "theirs":
                    hosts[i, j] = tj == mine
                else:
                    hosts[i, j] = mov[i] >= mov[j]
    return hosts


def bracket_sim(bracket: dict, ratings: dict, taus: dict, beta: float, h: float, n: int = 5000, seed: int = 1,
                tie: str = "net", mine: str | None = None) -> dict:
    """Replay one bracket n times. ratings/taus: team abbreviation -> net rating / model sd.
    Home court: teams that really met keep their real host; otherwise the better regular-season record hosts; with equal records
    the season series decides between two real teams when it is uneven; otherwise a labelled assumption: tie = "net" (better
    point differential), "mine" (the custom lineup `mine`) or "theirs". Seeds never decide home court. Neutral-site
    postseasons (2020) have no home advantage."""
    teams = sorted(bracket["teams"])
    ix = {t: i for i, t in enumerate(teams)}
    T = len(teams)
    rng = np.random.default_rng(seed)
    tau = np.array([taus[t] for t in teams])
    eff = np.array([ratings[t] for t in teams])[None, :] + rng.normal(0, 1, (n, T)) * tau[None, :]
    pct = np.array([bracket["teams"][t]["w"] / (bracket["teams"][t]["w"] + bracket["teams"][t]["l"]) for t in teams], float)
    mov = np.array([bracket["teams"][t]["mov"] for t in teams], float)
    hosts = home_matrix(bracket, teams, pct, mov, tie, mine)
    winners: dict[str, np.ndarray] = {}
    reach = np.zeros((T, 4))
    champion = np.zeros(T)
    rows = np.arange(n)
    for s in bracket["series"]:
        if s["feeders"]:
            a, b = winners[s["feeders"][0]], winners[s["feeders"][1]]
        else:
            a, b = np.full(n, ix[s["hc"]]), np.full(n, ix[s["other"]])
        for arr in (a, b):
            np.add.at(reach[:, s["round"] - 1], arr, 1)
        a_hc = hosts[a, b]
        hc = np.where(a_hc, a, b)
        ot = np.where(a_hc, b, a)
        delta = eff[rows, hc] - eff[rows, ot]
        wh = np.zeros(n, int)
        wo = np.zeros(n, int)
        alive = np.ones(n, bool)
        neutral = bool(bracket.get("neutral")) or bool(s.get("neutral"))
        for ch in s["pattern"]:
            hh = 0.0 if neutral else (h if ch == "H" else (-h if ch == "A" else 0.0))
            win = rng.random(n) < norm.cdf(beta * delta + hh)
            wh += alive & win
            wo += alive & ~win
            alive &= (wh < s["need"]) & (wo < s["need"])
        winners[s["id"]] = np.where(wh >= s["need"], hc, ot)
    final = bracket["series"][-1]["id"]
    np.add.at(champion, winners[final], 1)
    return {"teams": teams, "reach": (reach / n).tolist(), "champion": dict(zip(teams, (champion / n).tolist()))}
