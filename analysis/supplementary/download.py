"""
Resumable downloader for supplementary NBA data (stats.nba.com endpoints documented in swar/nba_api).

STATUS: IMPLEMENTED and MOCK-TESTED ONLY. It has never completed a request against the live service:
from the build sandbox every attempt ended in a proxy "CONNECT tunnel failed, response 403" -- an
environment/network-access restriction on that sandbox, NOT evidence about what NBA.com or PBP Stats
would answer. Parameter names/values were checked against the nba_api repository docs and source
(master, Oct 2026), not against live responses.

Never touches public/ or any production data: raw responses -> raw_supplementary/<dataset>/,
request ledger -> raw_supplementary/ledger.jsonl (both git-ignored). A failed or refused request
leaves every existing cache file untouched.

Examples (PowerShell/Unix alike) -- see docs/data.md for the full first-probe walkthrough:
  python analysis/supplementary/download.py --dataset shotchart --seasons 2008-09 --player-ids 977
  python analysis/supplementary/download.py --dataset hustle --seasons 2023-24
  python analysis/supplementary/download.py --dataset synergy --seasons 2023-24 --play-type Isolation
  python analysis/supplementary/download.py --dataset hustle --seasons 2023-24 --refresh
"""
import argparse
import json
import os
import random
import re
import sys
import time
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from common import SCHEMA_VERSION, SPECS, SchemaError, payload_sha256, select_result_set  # noqa: E402

DOWNLOADER_VERSION = "2.0-unverified-live"
BASE = "https://stats.nba.com/stats/"
HEADERS = {  # stats.nba.com is commonly fronted by bot filters; browser-like headers are what nba_api sends too
    "User-Agent": "Mozilla/5.0 (compatible; court-dna-research/1.0)",
    "Referer": "https://www.nba.com/",
    "Accept": "application/json",
}
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_RAW_DIR = os.path.join(REPO, "raw_supplementary")

# Values verified against nba_api docs/nba_api/stats/library/parameters.md (master, Oct 2026)
PLAY_TYPES = ["Cut", "Handoff", "Isolation", "Misc", "OffScreen", "Postup", "PRBallHandler", "PRRollman", "OffRebound", "Spotup", "Transition"]
TYPE_GROUPINGS = ["offensive", "defensive"]
DEFENSE_CATEGORIES = ["Overall", "3 Pointers", "2 Pointers", "Less Than 6Ft", "Less Than 10Ft", "Greater Than 15Ft"]
SEASON_TYPES = ["Regular Season", "Playoffs"]  # never mixed in one request

FIXED = {
    # Parameter NAMES are those in nba_api's endpoint classes; empty values mirror nba_api defaults.
    "shotchart": {"ContextMeasure": "FGA", "TeamID": 0, "LeagueID": "00", "LastNGames": 0, "Month": 0, "OpponentTeamID": 0, "Period": 0,
                  "AheadBehind": "", "ClutchTime": "", "ContextFilter": "", "DateFrom": "", "DateTo": "", "EndPeriod": "", "EndRange": "",
                  "GameID": "", "GameSegment": "", "Location": "", "Outcome": "", "PlayerPosition": "", "PointDiff": "", "Position": "",
                  "RangeType": "", "RookieYear": "", "SeasonSegment": "", "StartPeriod": "", "StartRange": "", "VsConference": "", "VsDivision": ""},
    "hustle": {"PerMode": "Totals", "LeagueID": "00"},
    "synergy": {"PerMode": "Totals", "PlayerOrTeam": "P", "LeagueID": "00"},
    "ptdefend": {"PerMode": "Totals", "LeagueID": "00"},
}
SEASON_PARAM = {"shotchart": "Season", "hustle": "Season", "synergy": "SeasonYear", "ptdefend": "Season"}

# Statuses (ledger): ok | empty | network_failure | access_denied | schema_failure | unsupported_coverage
RETRYABLE = {"network_failure"}


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def build_params(dataset, season, season_type, extra=None):
    p = dict(FIXED[dataset])
    p.update(extra or {})
    p[SEASON_PARAM[dataset]] = season
    p["SeasonType"] = season_type
    return p


def cache_key(endpoint, params):
    import hashlib
    blob = json.dumps([endpoint, sorted(params.items())], sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:20]


class HTTPStatusError(Exception):
    def __init__(self, status, retry_after=None):
        super().__init__(f"HTTP {status}")
        self.status, self.retry_after = status, retry_after


def http_fetch(url, params, timeout):
    import requests
    r = requests.get(url, params=params, headers=HEADERS, timeout=timeout)
    if r.status_code >= 400:
        raise HTTPStatusError(r.status_code, r.headers.get("Retry-After"))
    try:
        return r.json()
    except ValueError as e:
        raise SchemaError(f"response is not JSON ({r.headers.get('Content-Type')})") from e


def classify_exception(e):
    """-> (status, detail, retry_after_seconds|None). Permanent denials are never retried."""
    if isinstance(e, SchemaError):
        return "schema_failure", str(e), None
    name, msg = type(e).__name__, str(e)
    if isinstance(e, HTTPStatusError):
        if e.status in (401, 403):
            return "access_denied", f"HTTP {e.status}", None
        if e.status in (400, 404, 405, 410, 422):
            return "unsupported_coverage", f"HTTP {e.status} (request/season not supported by the endpoint)", None
        ra = None
        try:
            ra = float(e.retry_after) if e.retry_after else None
        except ValueError:
            pass
        return "network_failure", f"HTTP {e.status}", ra  # 429, 5xx, other
    if name == "ProxyError" or "Tunnel connection failed" in msg:
        return "access_denied", f"proxy CONNECT tunnel refused ({msg[:200]}) - environment/network-access restriction", None
    if name in ("Timeout", "ReadTimeout", "ConnectTimeout", "ConnectionError", "TimeoutError", "ConnectionResetError"):
        return "network_failure", f"{name}: {msg[:200]}", None
    return "network_failure", f"{name}: {msg[:200]}", None


def load_valid_cache(path, endpoint, params, dataset):
    """Return (record, None) if the cache is intact and is the response to THIS request, else (None, reason)."""
    try:
        with open(path) as f:
            rec = json.load(f)
    except FileNotFoundError:
        return None, "absent"
    except (OSError, ValueError) as e:
        return None, f"unreadable/corrupt JSON ({type(e).__name__})"
    try:
        if rec.get("schema_version") != SCHEMA_VERSION:
            return None, "cache schema_version mismatch"
        if rec.get("endpoint") != endpoint or rec.get("params") != params:
            return None, "request identity mismatch"
        if rec.get("status") not in ("ok", "empty"):
            return None, "cache was not a successful response"
        if payload_sha256(rec["payload"]) != rec.get("payload_sha256"):
            return None, "payload checksum mismatch (truncated or edited)"
        _, chosen, _ = select_result_set(rec["payload"], dataset)
        if (len(chosen["rows"]) == 0) != (rec["status"] == "empty"):
            return None, "status/row-count mismatch"
    except (SchemaError, KeyError, TypeError) as e:
        return None, f"cache failed validation ({e})"
    return rec, None


def fetch_one(dataset, season, season_type, extra=None, *, fetch=http_fetch, raw_dir=DEFAULT_RAW_DIR, refresh=False,
              timeout=30, retries=3, backoff=2.0, pace=2.0, sleep=time.sleep, earliest_season=None):
    """One request, fully ledgered. Never raises for service problems; returns the ledger record."""
    spec = SPECS[dataset]
    endpoint = spec["endpoint"]
    params = build_params(dataset, season, season_type, extra)
    key = cache_key(endpoint, params)
    path = os.path.join(raw_dir, dataset, f"{key}.json")
    rec = {"dataset": dataset, "endpoint": endpoint, "url": BASE + endpoint, "params": params, "season": season, "season_type": season_type,
           "cache_key": key, "cache_path": os.path.relpath(path, raw_dir), "retrieved_utc": utc_now(), "downloader_version": DOWNLOADER_VERSION,
           "source_note": "stats.nba.com, parameters per swar/nba_api docs; NOT verified against a live response by this project",
           "cache_hit": False, "attempts": 0}
    if earliest_season and season < earliest_season:
        rec.update(status="unsupported_coverage", detail=f"before the user-supplied --earliest-season {earliest_season}; no request made")
        return rec
    hit, why = load_valid_cache(path, endpoint, params, dataset)
    if hit and not refresh:
        _, chosen, names = select_result_set(hit["payload"], dataset)
        rec.update(status=hit["status"], cache_hit=True, rows=len(chosen["rows"]), result_set_names=names, selected_result_set=spec["result_set"],
                   payload_sha256=hit["payload_sha256"], original_retrieved_utc=hit["retrieved_utc"])
        return rec
    if hit is None and why != "absent" and os.path.exists(path):
        # corrupt / truncated / mismatched: quarantine it, never silently reuse
        q = f"{path}.corrupt-{int(time.time())}"
        os.replace(path, q)
        rec["cache_recovered"] = {"reason": why, "quarantined_as": os.path.relpath(q, raw_dir)}
    last = ("network_failure", "no attempt made", None)
    for attempt in range(1, retries + 2):
        rec["attempts"] = attempt
        try:
            payload = fetch(BASE + endpoint, params, timeout)
            name, chosen, names = select_result_set(payload, dataset)
            n = len(chosen["rows"])
            status = "ok" if n else "empty"
            sha = payload_sha256(payload)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = f"{path}.tmp"
            with open(tmp, "w") as f:
                json.dump({"schema_version": SCHEMA_VERSION, "endpoint": endpoint, "params": params, "status": status,
                           "retrieved_utc": rec["retrieved_utc"], "payload_sha256": sha, "payload": payload}, f)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)  # atomic; a failed refresh above never reaches this line
            rec.update(status=status, rows=n, result_set_names=names, selected_result_set=name, payload_sha256=sha)
            sleep(pace)
            return rec
        except Exception as e:  # noqa: BLE001 - classified below
            last = classify_exception(e)
            status, detail, retry_after = last
            if status not in RETRYABLE or attempt > retries:
                break
            delay = retry_after if retry_after is not None else backoff * (2 ** (attempt - 1)) * (1 + random.random() * 0.1)
            sleep(min(delay, 120))
    rec.update(status=last[0], detail=last[1])
    if hit:
        rec["stale_cache_retained"] = True  # a failed refresh does not remove the previous good cache
    return rec


def append_ledger(rec, raw_dir=DEFAULT_RAW_DIR):
    os.makedirs(raw_dir, exist_ok=True)
    with open(os.path.join(raw_dir, "ledger.jsonl"), "a") as f:
        f.write(json.dumps(rec, sort_keys=True) + "\n")


# ----------------------------------------------------------------------------- CLI validation

def parse_season(s):
    m = re.fullmatch(r"(\d{4})-(\d{2})", s)
    if not m:
        raise argparse.ArgumentTypeError(f"season {s!r} must look like 2023-24")
    y, yy = int(m.group(1)), int(m.group(2))
    if (y + 1) % 100 != yy:
        raise argparse.ArgumentTypeError(f"season {s!r}: second part must be the next year ({y + 1}'s last two digits)")
    if not 1946 <= y <= date.today().year:
        raise argparse.ArgumentTypeError(f"season {s!r} is outside 1946..{date.today().year}")
    return s


def parse_player_id(s):
    if not re.fullmatch(r"\d{1,9}", s) or int(s) <= 0:
        raise argparse.ArgumentTypeError(f"player id {s!r} must be a positive integer (NBA person id, e.g. 977)")
    return int(s)


def bounded_float(lo, hi):
    def f(s):
        v = float(s)
        if not lo <= v <= hi:
            raise argparse.ArgumentTypeError(f"{s} not in [{lo}, {hi}]")
        return v
    return f


def build_parser():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", required=True, choices=sorted(SPECS))
    ap.add_argument("--seasons", nargs="+", required=True, type=parse_season, help="e.g. 2023-24")
    ap.add_argument("--season-types", nargs="+", default=["Regular Season"], choices=SEASON_TYPES)
    ap.add_argument("--player-ids", nargs="+", type=parse_player_id, help="shotchart: NBA person ids (Kobe Bryant = 977)")
    ap.add_argument("--play-type", nargs="+", choices=PLAY_TYPES + ["all"], help="synergy: REQUIRED explicit play type(s); 'all' = every documented type")
    ap.add_argument("--type-grouping", choices=TYPE_GROUPINGS, default="offensive", help="synergy (default offensive)")
    ap.add_argument("--defense-category", choices=DEFENSE_CATEGORIES, default="Overall", help="ptdefend")
    ap.add_argument("--earliest-season", type=parse_season, help="optional: skip (as unsupported_coverage) seasons before this; coverage start is NOT assumed")
    ap.add_argument("--refresh", action="store_true", help="refetch even if a valid cache exists (old cache is kept if the refresh fails)")
    ap.add_argument("--dry-run", action="store_true", help="print the planned requests; no network")
    ap.add_argument("--pace", type=bounded_float(1.0, 60), default=2.0, help="seconds between requests (1-60, default 2)")
    ap.add_argument("--timeout", type=bounded_float(5, 120), default=30)
    ap.add_argument("--retries", type=int, choices=range(0, 6), default=3)
    ap.add_argument("--raw-dir", default=DEFAULT_RAW_DIR)
    return ap


def plan(a):
    reqs = []
    types = PLAY_TYPES if a.play_type and "all" in a.play_type else a.play_type
    for s in a.seasons:
        for st in a.season_types:
            if a.dataset == "shotchart":
                for pid in a.player_ids:
                    reqs.append((s, st, {"PlayerID": pid}))
            elif a.dataset == "synergy":
                for pt in types:
                    reqs.append((s, st, {"PlayType": pt, "TypeGrouping": a.type_grouping}))
            elif a.dataset == "ptdefend":
                reqs.append((s, st, {"DefenseCategory": a.defense_category}))
            else:
                reqs.append((s, st, {}))
    return reqs


def main(argv=None, fetch=http_fetch, sleep=time.sleep):
    ap = build_parser()
    a = ap.parse_args(argv)
    if a.dataset == "shotchart" and not a.player_ids:
        ap.error("--player-ids is required for shotchart")
    if a.dataset == "synergy" and not a.play_type:
        ap.error("--play-type is required for synergy (explicit play type, or 'all')")
    if a.dataset != "shotchart" and a.player_ids:
        ap.error("--player-ids only applies to shotchart")
    if a.dataset != "synergy" and a.play_type:
        ap.error("--play-type only applies to synergy")
    raw = os.path.abspath(a.raw_dir)
    if raw.startswith(os.path.join(REPO, "public")) or raw.startswith(os.path.join(REPO, "app")):
        ap.error("--raw-dir must not be inside public/ or app/ (raw responses must never ship to the browser)")
    reqs = plan(a)
    if a.dry_run:
        for s, st, extra in reqs:
            print("PLAN", a.dataset, s, st, json.dumps(extra), "->", BASE + SPECS[a.dataset]["endpoint"])
        return 0
    bad = 0
    for s, st, extra in reqs:
        rec = fetch_one(a.dataset, s, st, extra, fetch=fetch, raw_dir=raw, refresh=a.refresh, timeout=a.timeout, retries=a.retries,
                        pace=a.pace, sleep=sleep, earliest_season=a.earliest_season)
        append_ledger(rec, raw)
        print(f"{a.dataset} {s} {st} {json.dumps(extra)} -> {rec['status']}{' (cache)' if rec['cache_hit'] else ''} rows={rec.get('rows', '-')} {rec.get('detail', '')}")
        bad += rec["status"] in ("network_failure", "access_denied", "schema_failure")
        if rec["status"] == "access_denied":
            print("Access was refused; stopping instead of retrying the remaining requests.", file=sys.stderr)
            return 2
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
