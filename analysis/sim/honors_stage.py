"""
Staged validation of season honors, champions and playoff seeds.

Nothing here writes app files. `validate()` reads the source tables, cross-checks them, and returns
  * facts       every honor that may be exported, each with its source references and a verification status
  * errors      problems that must stop the export (conflicting winners, duplicate identities, invalid seasons,
                broken joins, inconsistent bracket progression, a champion that two sources disagree on)
  * quarantine  records that could not be resolved (no id, ambiguous name, only one source for something that
                needs two). They are listed in the report and never exported, and no source is silently preferred.
  * seeds       published seeds per season that passed every check
  * report      the per-season, per-category status table

Statuses are kept distinct:
  verified        two or more independent sources agree
  single-source   one source, all checks passed
  derived         computed from the game results
  conflict        sources disagree (an error)
  quarantined     unresolved
  missing         no data for that season and category

A missing fact is never "no award": coverage and status are reported per season and category.
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
SRC_DIR = ROOT / "raw" / "honors_sources"
IMPORT_DIR = ROOT / "raw" / "honors_import"

SEASON_MIN, SEASON_MAX = 1997, 2026
AWARDS = ("mvp", "dpoy", "roy", "smoy", "mip")
TEAM_AWARDS = {"allnba": (3, 5), "alldef": (2, 5), "allrookie": (2, 5)}   # tiers, players per tier
CATEGORIES = list(AWARDS) + list(TEAM_AWARDS) + ["allstar", "finalsmvp", "champion_team", "champion_appeared", "champion_roster", "seeds"]
SINGLE = "single-source"

SUFFIX = re.compile(r"\b(jr|sr|ii|iii|iv)\b")


def norm(name: str) -> str:
    s = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z ]", " ", s.replace("'", ""))
    s = SUFFIX.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


def norm_team(name: str) -> str:
    s = norm(name).replace("los angeles", "la")
    return s


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


class Problem(dict):
    pass


def _prob(kind: str, season, category: str, detail: str, **extra) -> Problem:
    return Problem(kind=kind, season=season, category=category, detail=detail, **extra)


# ---------------------------------------------------------------------------------------------------------------------
# inputs
# ---------------------------------------------------------------------------------------------------------------------
def read_csv_dir(directory: Path, names: list[str], required: dict[str, list[str]]) -> tuple[dict[str, pd.DataFrame], list[Problem]]:
    out, errs = {}, []
    for n in names:
        p = directory / n
        if not p.exists():
            continue
        try:
            df = pd.read_csv(p, dtype=str).fillna("")
        except Exception as e:  # unreadable or malformed file
            errs.append(_prob("bad_file", None, n, f"{n} could not be read: {e}"))
            continue
        miss = [c for c in required[n] if c not in df.columns]
        if miss:
            errs.append(_prob("bad_file", None, n, f"{n}: missing column(s) {', '.join(miss)}. Required: {', '.join(required[n])}"))
            continue
        out[n] = df
    return out, errs


REQUIRED = {
    "finals_mvp.csv": ["source", "season", "player", "player_id", "team"],
    "awards_2026.csv": ["source", "season", "award", "tier", "player", "player_id"],
    "champions.csv": ["source", "season", "champion", "finals"],
    "seeds.csv": ["source", "season", "conference", "seed", "team"],
    "champion_roster.csv": ["source", "season", "player", "player_id", "team"],
}


def load_user_import(directory: Path) -> tuple[dict[str, pd.DataFrame], list[Problem]]:
    """The optional files described in docs/model/honors_import.md, mapped onto the same tables as the shipped sources."""
    out: dict[str, pd.DataFrame] = {}
    errs: list[Problem] = []
    if not directory.exists():
        return out, errs

    def rd(name, cols):
        p = directory / name
        if not p.exists():
            return None
        try:
            df = pd.read_csv(p, dtype=str).fillna("")
        except Exception as e:
            errs.append(_prob("bad_file", None, name, f"{name} could not be read: {e}"))
            return None
        miss = [c for c in cols if c not in df.columns]
        if miss:
            errs.append(_prob("bad_file", None, name, f"{name}: missing column(s) {', '.join(miss)}. Required: {', '.join(cols)}"))
            return None
        return df
    fm = rd("finals_mvp.csv", ["season", "player_id", "player"])
    if fm is not None:
        fm["source"] = "user_import_finals_mvp"
        if "team" not in fm.columns:
            fm["team"] = ""
        out["finals_mvp.csv"] = fm[["source", "season", "player", "player_id", "team"]]
    aw = rd("awards_extra.csv", ["season", "award", "player_id", "player"])
    if aw is not None:
        aw["source"] = "user_import_awards"
        aw["tier"] = ""
        out["awards_extra.csv"] = aw[["source", "season", "award", "tier", "player", "player_id"]]
    eo = rd("end_of_season_teams_extra.csv", ["season", "type", "number_tm", "player_id", "player"])
    if eo is not None:
        m = {"All-NBA": "allnba", "All-Defense": "alldef", "All-Rookie": "allrookie"}
        tiers = {"1st": "1", "2nd": "2", "3rd": "3"}
        bad = sorted(set(eo.type) - set(m))
        if bad:
            errs.append(_prob("bad_file", None, "end_of_season_teams_extra.csv", f"unknown type {bad}; use {sorted(m)}"))
        else:
            eo = eo.assign(source="user_import_teams", award=eo.type.map(m), tier=eo.number_tm.map(tiers).fillna(""))
            out["end_of_season_teams_extra.csv"] = eo[["source", "season", "award", "tier", "player", "player_id"]]
    cr = rd("champion_roster.csv", ["season", "player_id", "player"])
    if cr is not None:
        cr["source"] = "user_import_champion_roster"
        if "team" not in cr.columns:
            cr["team"] = ""
        out["champion_roster.csv"] = cr[["source", "season", "player", "player_id", "team"]]
    sd = rd("seeds_extra.csv", ["season", "conference", "seed", "team"])
    if sd is not None:
        sd["source"] = "user_import_seeds"
        out["seeds.csv"] = sd[["source", "season", "conference", "seed", "team"]]
    ch = rd("champions_extra.csv", ["season", "champion"])
    if ch is not None:
        ch["source"] = "user_import_champions"
        if "finals" not in ch.columns:
            ch["finals"] = ""
        out["champions.csv"] = ch[["source", "season", "champion", "finals"]]
    return out, errs


# ---------------------------------------------------------------------------------------------------------------------
# context
# ---------------------------------------------------------------------------------------------------------------------
class Ctx:
    """Everything validation needs, passed in so tests can use small synthetic data."""

    def __init__(self, universe: pd.DataFrame, brackets: dict[int, dict], champions: dict[int, str],
                 champ_players: dict[int, set[str]] | None = None, app_pairs: set[tuple[str, int]] | None = None,
                 legacy: list[dict] | None = None):
        # universe: every player-season that exists at all (player_id, player, season); not limited to display-eligible profiles
        self.universe = universe.drop_duplicates(["player_id", "season"]).copy()
        self.universe["norm"] = self.universe.player.map(norm)
        self.pairs = set(zip(self.universe.player_id, self.universe.season.astype(int)))
        self.by_name: dict[tuple[str, int], set[str]] = {}
        for r in self.universe.itertuples():
            self.by_name.setdefault((r.norm, int(r.season)), set()).add(r.player_id)
        self.display_name = {(r.player_id, int(r.season)): r.player for r in self.universe.itertuples()}
        self.brackets = brackets
        self.champions = champions                       # season -> abbreviation, derived from the game results
        self.champ_players = champ_players or {}
        self.app_pairs = app_pairs if app_pairs is not None else set()
        self.legacy = legacy or []                       # facts that come from the Kaggle tables


def resolve_player(ctx: Ctx, name: str, season: int, given_id: str) -> tuple[str | None, str | None]:
    """(player_id, problem). A given id must exist for that season and agree with the name; without an id the name must match one player."""
    n = norm(name)
    if given_id:
        if (given_id, season) not in ctx.pairs:
            return None, f"{given_id} has no {season} season in the player tables"
        known = norm(ctx.display_name[(given_id, season)])
        if n and known != n and not (known.split()[-1:] == n.split()[-1:] and known[:1] == n[:1]):
            return None, f"{given_id} is {ctx.display_name[(given_id, season)]}, not {name}"
        return given_id, None
    ids = ctx.by_name.get((n, season), set())
    if len(ids) == 1:
        return next(iter(ids)), None
    if not ids:
        return None, f"no player named {name} in {season}"
    return None, f"{name} matches more than one player in {season}: {sorted(ids)}"


def team_abbr(ctx: Ctx, season: int, name: str) -> str | None:
    b = ctx.brackets.get(season)
    if not b:
        return None
    target = norm_team(name)
    hits = [a for a, t in b["teams"].items() if norm_team(t["name"]) == target or a == name]
    return hits[0] if len(hits) == 1 else None


# ---------------------------------------------------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------------------------------------------------
def _season_ok(v) -> int | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != int(f) or not (SEASON_MIN <= int(f) <= SEASON_MAX):
        return None
    return int(f)


def validate(ctx: Ctx, tables: dict[str, pd.DataFrame], extra: dict[str, pd.DataFrame] | None = None) -> dict:
    errors: list[Problem] = []
    quarantine: list[Problem] = []
    facts: list[dict] = []
    status: dict[str, dict[int, str]] = {c: {} for c in CATEGORIES}
    notes: list[str] = []

    def tbl(name):
        parts = [t for t in (tables.get(name), (extra or {}).get(name)) if t is not None]
        return pd.concat(parts, ignore_index=True) if parts else None

    # ----- invalid seasons anywhere
    for name, df in list(tables.items()) + list((extra or {}).items()):
        if "season" in df.columns:
            for v in df.season:
                if _season_ok(v) is None:
                    errors.append(_prob("invalid_season", v, name, f"{name}: season {v!r} is not a whole year from {SEASON_MIN} to {SEASON_MAX}"))
    seasons_bad = {p["season"] for p in errors if p["kind"] == "invalid_season"}

    def clean(df):
        if df is None:
            return None
        d = df[[(_season_ok(s) is not None) for s in df.season]].copy()
        d["season"] = d.season.astype(float).astype(int)
        return d

    # ----- champions (the team that won the Finals): the game results plus every listed source must agree
    champ_abbr: dict[int, str] = {}
    cdf = clean(tbl("champions.csv"))
    fm_all = clean(pd.concat([t for t in (tables.get("finals_mvp.csv"), (extra or {}).get("finals_mvp.csv")) if t is not None], ignore_index=True)
                   if (tables.get("finals_mvp.csv") is not None or (extra or {}).get("finals_mvp.csv") is not None) else None)
    champ_report = []
    for s in range(SEASON_MIN, SEASON_MAX + 1):
        derived = ctx.champions.get(s)
        votes: dict[str, str | None] = {"game results": derived}
        if cdf is not None:
            for r in cdf[cdf.season == s].itertuples():
                votes[r.source] = team_abbr(ctx, s, r.champion)
                if votes[r.source] is None:
                    quarantine.append(_prob("unresolved_team", s, "champion_team", f"{r.source}: {r.champion!r} is not a team in the {s} postseason"))
        if fm_all is not None:
            for r in fm_all[fm_all.season == s].itertuples():
                if r.team:
                    votes[r.source + " (Finals MVP's team)"] = team_abbr(ctx, s, r.team)
        known = {k: v for k, v in votes.items() if v}
        distinct = set(known.values())
        independent = [k for k in known if k != "game results"]
        if len(distinct) > 1:
            errors.append(_prob("champion_conflict", s, "champion_team", f"sources disagree on the {s} champion: {known}"))
            status["champion_team"][s] = "conflict"
        elif len(distinct) == 1 and independent and derived:
            champ_abbr[s] = next(iter(distinct))
            status["champion_team"][s] = "verified"
        elif derived:
            champ_abbr[s] = derived
            status["champion_team"][s] = "derived"
        else:
            status["champion_team"][s] = "missing"
        champ_report.append({"season": s, "champion": next(iter(distinct)) if len(distinct) == 1 else None, "status": status["champion_team"][s],
                             "sources": sorted(known)})

    # ----- Finals MVP
    fm = clean(tbl("finals_mvp.csv"))
    finals_player: dict[int, str] = {}
    if fm is not None:
        for s in range(SEASON_MIN, SEASON_MAX + 1):
            rows = fm[fm.season == s]
            if rows.empty:
                status["finalsmvp"][s] = "missing"
                continue
            per_src: dict[str, set[str]] = {}
            unresolved = False
            for r in rows.itertuples():
                pid, why = resolve_player(ctx, r.player, s, r.player_id)
                if pid is None:
                    quarantine.append(_prob("unresolved_player", s, "finalsmvp", f"{r.source}: {why}", player=r.player))
                    unresolved = True
                    continue
                per_src.setdefault(r.source, set()).add(pid)
            for src, ids in per_src.items():
                if len(ids) != 1 or len(rows[rows.source == src]) != 1:
                    errors.append(_prob("finals_mvp_count", s, "finalsmvp", f"{src} lists {len(rows[rows.source == src])} Finals MVP rows for {s}; there is exactly one per Finals"))
            allids = set().union(*per_src.values()) if per_src else set()
            if len(allids) > 1:
                errors.append(_prob("finals_mvp_conflict", s, "finalsmvp", f"sources disagree on the {s} Finals MVP: { {k: sorted(v) for k, v in per_src.items()} }"))
                status["finalsmvp"][s] = "conflict"
                continue
            if not allids:
                status["finalsmvp"][s] = "quarantined" if unresolved else "missing"
                continue
            pid = next(iter(allids))
            # the winner must be on the champion: his listed team must be the champion
            for r in rows.itertuples():
                if r.team:
                    ab = team_abbr(ctx, s, r.team)
                    if ab and s in champ_abbr and ab != champ_abbr[s]:
                        errors.append(_prob("finals_mvp_team", s, "finalsmvp", f"{r.source}: {r.player} is listed with {ab}, but {champ_abbr[s]} won the {s} title"))
            if ctx.champ_players.get(s) is not None and pid not in ctx.champ_players[s]:
                notes.append(f"{s} Finals MVP {pid}: no playoff-game appearance for the champion was found in the game data (id mapping may be missing)")
            finals_player[s] = pid
            n = len(per_src)
            st = "verified" if n >= 2 else SINGLE
            status["finalsmvp"][s] = st
            facts.append({"pid": pid, "season": s, "k": "finalsmvp", "tier": None, "sources": sorted(per_src), "status": st})
            if s in champ_abbr:
                # the Finals MVP's own team in the Finals is the champion: that is a listed roster fact (two sources when both list it)
                facts.append({"pid": pid, "season": s, "k": "ring", "tier": None, "tm": champ_abbr[s], "sources": sorted(per_src),
                              "status": "verified" if n >= 2 else SINGLE})

    # ----- 2025-26 (and any imported) awards
    aw_parts = [t for t in (tbl("awards_2026.csv"), (extra or {}).get("awards_extra.csv"), (extra or {}).get("end_of_season_teams_extra.csv")) if t is not None]
    if aw_parts:
        aw = clean(pd.concat(aw_parts, ignore_index=True))
        aw["tier"] = aw.tier.replace("", "0")
        for (season, award), g in aw.groupby(["season", "award"]):
            if award not in AWARDS and award not in TEAM_AWARDS:
                errors.append(_prob("unknown_award", int(season), award, f"unknown award key {award!r}"))
                continue
            per_tier: dict[str, dict[str, set[str]]] = {}
            for r in g.itertuples():
                pid, why = resolve_player(ctx, r.player, int(season), r.player_id)
                if pid is None:
                    quarantine.append(_prob("unresolved_player", int(season), award, f"{r.source}: {why}", player=r.player))
                    continue
                per_tier.setdefault(r.tier, {}).setdefault(r.source, set()).add(pid)
            ok = True
            if award in TEAM_AWARDS:
                ntiers, size = TEAM_AWARDS[award]
                expect = {str(t) for t in range(1, ntiers + 1)}
                if set(per_tier) - expect:
                    errors.append(_prob("bad_tier", int(season), award, f"unexpected team level {sorted(set(per_tier) - expect)}"))
                    ok = False
                seen_players: dict[str, str] = {}
                for tier, bys in per_tier.items():
                    for src, ids in bys.items():
                        if len(ids) != size:
                            errors.append(_prob("incomplete_team", int(season), award, f"{src} lists {len(ids)} players for {award} team {tier} in {season}; {size} are required"))
                            ok = False
                tier_sets = {t: set().union(*b.values()) for t, b in per_tier.items()}
                for t, ids in tier_sets.items():
                    for pid in ids:
                        if pid in seen_players and seen_players[pid] != t:
                            errors.append(_prob("duplicate_identity", int(season), award, f"{pid} appears on {award} teams {seen_players[pid]} and {t} in {season}"))
                            ok = False
                        seen_players[pid] = t
            for tier, bys in per_tier.items():
                sets = list(bys.values())
                if any(s_ != sets[0] for s_ in sets):
                    errors.append(_prob("winner_conflict", int(season), award, f"sources disagree on {award}{'' if tier == '0' else ' team ' + tier} for {season}: { {k: sorted(v) for k, v in bys.items()} }"))
                    ok = False
                    continue
                if not ok:
                    continue
                st = "verified" if len(bys) >= 2 else SINGLE
                for pid in sorted(sets[0]):
                    facts.append({"pid": pid, "season": int(season), "k": award, "tier": None if tier == "0" else int(tier), "sources": sorted(bys), "status": st})
                prev = status[award].get(int(season))
                status[award][int(season)] = st if prev in (None, st) else SINGLE
            if not ok:
                status[award][int(season)] = "conflict"

    # ----- championship roster (kept apart from "appeared in a playoff game" and from "team won")
    cr = clean(tbl("champion_roster.csv"))
    ring_seen = {(f["pid"], f["season"]) for f in facts if f["k"] == "ring"}
    if cr is not None:
        for r in cr.itertuples():
            pid, why = resolve_player(ctx, r.player, int(r.season), r.player_id)
            if pid is None:
                quarantine.append(_prob("unresolved_player", int(r.season), "champion_roster", f"{r.source}: {why}", player=r.player))
                continue
            if (pid, int(r.season)) in ring_seen:
                for f in facts:
                    if f["k"] == "ring" and f["pid"] == pid and f["season"] == int(r.season) and r.source not in f["sources"]:
                        f["sources"] = sorted(f["sources"] + [r.source]); f["status"] = "verified"
                continue
            if int(r.season) not in champ_abbr:
                quarantine.append(_prob("no_champion", int(r.season), "champion_roster", f"{pid}: the {int(r.season)} champion is not established"))
                continue
            facts.append({"pid": pid, "season": int(r.season), "k": "ring", "tier": None, "tm": champ_abbr[int(r.season)], "sources": [r.source], "status": SINGLE})
            ring_seen.add((pid, int(r.season)))
    ring_seasons = {f["season"] for f in facts if f["k"] == "ring"}
    for s in range(SEASON_MIN, SEASON_MAX + 1):
        status["champion_roster"][s] = "partial" if s in ring_seasons else "missing"
        status["champion_appeared"][s] = "derived" if ctx.champ_players.get(s) else "missing"

    # ----- seeds
    seeds: dict[int, dict[str, int]] = {}
    seed_report = []
    sd = clean(tbl("seeds.csv"))
    if sd is not None:
        for s in range(SEASON_MIN, SEASON_MAX + 1):
            rows = sd[sd.season == s]
            b = ctx.brackets.get(s)
            if rows.empty or not b:
                status["seeds"][s] = "missing"
                continue
            srcs = sorted(set(rows.source))
            local: dict[str, int] = {}
            bad = []
            for r in rows.itertuples():
                ab = team_abbr(ctx, s, r.team)
                conf = 0 if r.conference == "E" else 1
                if ab is None:
                    bad.append(f"{r.team!r} is not a {s} playoff team")
                    continue
                if b["teams"][ab]["conf"] != conf:
                    bad.append(f"{ab} is in the other conference")
                if ab in local:
                    bad.append(f"{ab} is listed twice")
                local[ab] = int(r.seed)
            if set(local) != set(b["teams"]):
                bad.append(f"seed table has {len(local)} teams; the bracket has {len(b['teams'])}")
            for ci in (0, 1):
                vals = sorted(v for a, v in local.items() if a in b["teams"] and b["teams"][a]["conf"] == ci)
                if vals != list(range(1, 9)):
                    bad.append(f"conference {'East' if ci == 0 else 'West'} seeds are {vals}, not 1 to 8")
            if not bad:
                bad += _progression_problems(b, local)
            if bad:
                errors.append(_prob("seed_conflict", s, "seeds", "; ".join(bad)))
                status["seeds"][s] = "conflict"
                continue
            seeds[s] = local
            rec_diff = sorted(a for a in local if local[a] != b["teams"][a]["seed"])
            status["seeds"][s] = "verified" if len(srcs) >= 2 else SINGLE
            seed_report.append({"season": s, "source": srcs, "differs_from_reconstruction": rec_diff, "status": status["seeds"][s]})

    # ----- legacy facts (Kaggle tables): same identity and join checks; voting placements are never read upstream
    seen: set[tuple] = set()
    for f in ctx.legacy:
        key = (f["pid"], f["season"], f["k"], f.get("tier"))
        if _season_ok(f["season"]) is None:
            errors.append(_prob("invalid_season", f["season"], f["k"], f"{f['pid']}: season {f['season']} is outside {SEASON_MIN}-{SEASON_MAX}"))
            continue
        if key in seen:
            errors.append(_prob("duplicate_identity", f["season"], f["k"], f"{f['pid']} has {f['k']} twice in {f['season']}"))
            continue
        seen.add(key)
        if (f["pid"], f["season"]) not in ctx.pairs:
            quarantine.append(_prob("broken_join", f["season"], f["k"], f"{f['pid']} has no {f['season']} season in the player tables", pid=f["pid"]))
            continue
        facts.append({**f, "sources": [f.get("source", "kaggle_nba_stats")], "status": SINGLE})
    legacy_cats = {f["k"]: set() for f in ctx.legacy}
    for f in ctx.legacy:
        legacy_cats[f["k"]].add(f["season"])
    for cat, ss in legacy_cats.items():
        if cat in status:
            for s in ss:
                status[cat].setdefault(s, SINGLE)
    for cat in list(AWARDS) + list(TEAM_AWARDS) + ["allstar"]:
        for s in range(SEASON_MIN, SEASON_MAX + 1):
            status[cat].setdefault(s, "missing")

    # ----- the same player-season never gets the same award twice, and every join is season-specific
    seen2: set[tuple] = set()
    for f in facts:
        k = (f["pid"], f["season"], f["k"], f.get("tier"))
        if k in seen2 and f["k"] not in ("allstar",):
            errors.append(_prob("duplicate_identity", f["season"], f["k"], f"{f['pid']} has {f['k']} twice in {f['season']}"))
        seen2.add(k)
        if (f["pid"], f["season"]) not in ctx.pairs and not any(q.get("pid") == f["pid"] and q["season"] == f["season"] for q in quarantine):
            errors.append(_prob("broken_join", f["season"], f["k"], f"{f['pid']} has no {f['season']} season in the player tables"))

    for cat in CATEGORIES:
        for s_ in range(SEASON_MIN, SEASON_MAX + 1):
            status[cat].setdefault(s_, "missing")        # absent data is "missing", never "no award"

    # ----- shared regular-season awards are allowed (more than one winner), team awards need full teams (checked above)
    return {"facts": facts, "errors": errors, "quarantine": quarantine, "seeds": seeds, "status": status,
            "champions": champ_report, "seed_report": seed_report, "notes": notes, "champ_abbr": champ_abbr,
            "profile_less": sorted({(f["pid"], f["season"], f["k"]) for f in facts if (f["pid"], f["season"]) not in ctx.app_pairs}) if ctx.app_pairs else []}


def _progression_problems(b: dict, local: dict[str, int]) -> list[str]:
    """First-round pairs must be 1-8, 4-5, 3-6, 2-7 and round two must join 1/8 with 4/5 and 2/7 with 3/6."""
    out = []
    by_id = {s["id"]: s for s in b["series"]}
    pair = {}
    for s in b["series"]:
        if s["round"] == 1:
            a, c = local[s["hc"]], local[s["other"]]
            if a + c != 9:
                out.append(f"first-round series {s['hc']}-{s['other']} pairs seeds {a} and {c}")
            pair[s["id"]] = frozenset((a, c))
    for s in b["series"]:
        if s["round"] == 2 and s["feeders"]:
            f = frozenset(pair.get(x, frozenset()) for x in s["feeders"])
            if f not in (frozenset((frozenset((1, 8)), frozenset((4, 5)))), frozenset((frozenset((2, 7)), frozenset((3, 6))))):
                out.append(f"round-two series {s['id']} joins seed pairs {sorted(sorted(p) for p in f)}")
    return out


# ---------------------------------------------------------------------------------------------------------------------
# reports
# ---------------------------------------------------------------------------------------------------------------------
STATUS_CODE = {"no game": "n", "verified": "V", SINGLE: "S", "derived": "D", "partial": "P", "missing": "–", "conflict": "X", "quarantined": "Q"}


def manifest(paths: list[Path]) -> list[dict]:
    return [{"file": str(p.relative_to(ROOT)), "sha256": sha256_file(p), "bytes": p.stat().st_size} for p in paths if p.exists()]


def report_markdown(result: dict, src_meta: dict, hashes: list[dict]) -> str:
    st = result["status"]
    cats = [c for c in CATEGORIES if c != "seeds"] + ["seeds"]
    head = "| Season | " + " | ".join(cats) + " |\n|---|" + "---|" * len(cats)
    rows = []
    for s in range(SEASON_MIN, SEASON_MAX + 1):
        rows.append(f"| {s - 1}-{str(s)[2:]} | " + " | ".join(STATUS_CODE.get(st[c].get(s, "missing"), "?") for c in cats) + " |")
    lines = [
        "# Honors, champions and seeds: validation report",
        "",
        "Generated by `analysis/sim/export_data.py` (staged validation in `analysis/sim/honors_stage.py`). Software checks live in `docs/sim_software_tests.md`; this file is about whether the facts are right.",
        "",
        "Key: **n** no game was played (1999 All-Star) · **V** verified (two or more independent sources agree) · **S** single source, checks passed · **D** derived from the game results · **P** partial · **–** missing (not the same as \"no award\") · **X** conflict · **Q** quarantined.",
        "",
        head, *rows, "",
        "## Problems that stop an export",
        "",
    ]
    lines += [f"- [{e['kind']}] {e['category']} {e['season']}: {e['detail']}" for e in result["errors"]] or ["None. Every check passed."]
    lines += ["", "## Quarantined records (listed, never exported)", ""]
    lines += [f"- [{q['kind']}] {q['category']} {q['season']}: {q['detail']}" for q in result["quarantine"][:80]] or ["None."]
    if len(result["quarantine"]) > 80:
        lines.append(f"- … and {len(result['quarantine']) - 80} more (see `honors_validation.json`).")
    lines += ["", "## Champions (the team that won)", "", "| Season | Champion | Status | Agreeing sources |", "|---|---|---|---|"]
    lines += [f"| {c['season'] - 1}-{str(c['season'])[2:]} | {c['champion'] or '?'} | {c['status']} | {', '.join(c['sources'])} |" for c in result["champions"]]
    lines += ["", "## Seeds", "", "A season's seeds are accepted only if all 16 teams match the actual bracket (right conference, seeds 1-8 in each) and the real first two rounds follow the NBA tree (1-8, 4-5, 3-6, 2-7; 1/8 meets 4/5; 2/7 meets 3/6).", "",
              "| Season | Status | Source | Teams whose published seed differs from the record-order reconstruction |", "|---|---|---|---|"]
    lines += [f"| {r['season'] - 1}-{str(r['season'])[2:]} | {r['status']} | {', '.join(r['source'])} | {', '.join(r['differs_from_reconstruction']) or 'none'} |" for r in result["seed_report"]]
    lines += ["", "## Sources and snapshots", ""]
    for sid, m in src_meta.items():
        lines.append(f"- `{sid}`: {m['publisher']}, <{m['url']}>, retrieved {m['retrieved']}. {m['note']}")
    lines += ["", "Hashes of the staged source tables:", ""]
    lines += [f"- `{h['file']}` sha256 `{h['sha256']}`" for h in hashes]
    lines += ["", "## Manual corrections", "", "None. Every value in the source tables is as extracted; unresolved records are quarantined, not edited.", ""]
    if result["notes"]:
        lines += ["## Notes", ""] + [f"- {n}" for n in result["notes"]] + [""]
    return "\n".join(lines)
