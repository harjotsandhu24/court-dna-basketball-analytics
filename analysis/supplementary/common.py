"""Shared helpers: result-set extraction by NAME, schema validation, payload hashing.

Dataset names and column lists below come from the nba_api SOURCE (expected_data /
data_sets["..."] in src/nba_api/stats/endpoints/*.py, read from GitHub master, Oct 2026).
They describe what nba_api expects; they have NOT been confirmed against a live
stats.nba.com response from this project.
"""
import hashlib
import json

SCHEMA_VERSION = 2

# dataset key -> endpoint, result-set name expected in the response, minimum required columns
SPECS = {
    "shotchart": {
        "endpoint": "shotchartdetail",
        "result_set": "Shot_Chart_Detail",
        "required": {"GAME_ID", "GAME_EVENT_ID", "PLAYER_ID", "LOC_X", "LOC_Y", "SHOT_MADE_FLAG",
                     "SHOT_ATTEMPTED_FLAG", "SHOT_TYPE", "SHOT_DISTANCE", "EVENT_TYPE"},
        "identity": ["PLAYER_ID"],
    },
    "hustle": {
        "endpoint": "leaguehustlestatsplayer",
        "result_set": "HustleStatsPlayer",
        "required": {"PLAYER_ID", "TEAM_ID", "G", "MIN", "CONTESTED_SHOTS", "DEFLECTIONS", "SCREEN_ASSISTS", "LOOSE_BALLS_RECOVERED"},
        "identity": ["PLAYER_ID"],
    },
    "synergy": {
        "endpoint": "synergyplaytypes",
        "result_set": "SynergyPlayType",
        # nba_api's expected_data lists the TEAM-level columns; PLAYER_ID for PlayerOrTeam=P is assumed, not documented.
        "required": {"PLAY_TYPE", "TYPE_GROUPING", "GP", "POSS", "POSS_PCT", "PPP", "PTS", "FGA", "FGM"},
        "identity": ["PLAYER_ID"],
    },
    "ptdefend": {
        "endpoint": "leaguedashptdefend",
        "result_set": "LeagueDashPTDefend",
        "required": {"CLOSE_DEF_PERSON_ID", "GP", "FREQ", "D_FGM", "D_FGA", "D_FG_PCT", "NORMAL_FG_PCT", "PCT_PLUSMINUS"},
        "identity": ["CLOSE_DEF_PERSON_ID"],
    },
}


class SchemaError(Exception):
    pass


def extract_result_sets(payload):
    """Return {name: {"headers": [...], "rows": [[...]]}} for the standard stats.nba.com shapes:
    'resultSets' as a list of {name, headers, rowSet}, 'resultSets' as a dict keyed by name,
    or a single 'resultSet' object."""
    if not isinstance(payload, dict):
        raise SchemaError("payload is not a JSON object")
    raw = payload.get("resultSets", payload.get("resultSet"))
    if raw is None:
        raise SchemaError("no resultSets/resultSet in payload")
    if isinstance(raw, dict) and "headers" in raw:
        raw = [raw]
    elif isinstance(raw, dict):
        raw = [dict(v, name=k) for k, v in raw.items()]
    if not isinstance(raw, list) or not raw:
        raise SchemaError("resultSets is empty or not a list")
    out = {}
    for i, s in enumerate(raw):
        if not isinstance(s, dict) or not isinstance(s.get("headers"), list) or not isinstance(s.get("rowSet", s.get("data")), list):
            raise SchemaError(f"result set #{i} lacks headers/rowSet")
        name = s.get("name")
        if not name:
            raise SchemaError(f"result set #{i} has no name")
        rows = s.get("rowSet", s.get("data"))
        for r in rows:
            if not isinstance(r, list) or len(r) != len(s["headers"]):
                raise SchemaError(f"result set {name}: row length != header length")
        out[name] = {"headers": s["headers"], "rows": rows}
    return out


def select_result_set(payload, dataset):
    """Select the expected result set BY NAME and check its columns; never 'the first set'."""
    spec = SPECS[dataset]
    sets = extract_result_sets(payload)
    name = spec["result_set"]
    if name not in sets:
        raise SchemaError(f"expected result set {name!r}; got {sorted(sets)}")
    chosen = sets[name]
    missing = spec["required"] - set(chosen["headers"])
    if missing:
        raise SchemaError(f"result set {name}: missing columns {sorted(missing)}")
    if len(set(chosen["headers"])) != len(chosen["headers"]):
        raise SchemaError(f"result set {name}: duplicate column names")
    return name, chosen, sorted(sets)


def rows_as_dicts(chosen):
    h = chosen["headers"]
    return [dict(zip(h, r)) for r in chosen["rows"]]


def payload_sha256(payload):
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
