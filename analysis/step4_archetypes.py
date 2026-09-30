"""
Step 4 — deterministic archetype labels and trait tags.

No text generation of any kind. Every archetype comes from an explicit,
ordered rule evaluated against the season-relative percentile dimensions
from step 3 plus a coarse position group (Guard / Wing / Big derived from
Basketball-Reference's 'pos' field). Rules are checked in order; the first
one that matches wins. A documented fallback ("Balanced <Position Group>")
always applies if nothing else matches, so every qualifying player-season
gets a label.

Trait tags (2-3 per player-season) are simply that season's highest
percentile dimensions, worded as "<Level> <Dimension>" -- also fully
deterministic, no free text generation.

See docs/methodology.md "Archetypes" for the human-readable version of
every rule below.

Run: python3 analysis/step4_archetypes.py
"""
import pandas as pd

import utils
import config

HIGH = config.ARCHETYPE_HIGH
MID = config.ARCHETYPE_MID
LOW = config.ARCHETYPE_LOW


def position_group(pos: str) -> str:
    if not isinstance(pos, str):
        return "Wing"
    pos = pos.upper()
    first = pos.split("-")[0]
    if first in ("PG", "SG"):
        return "Guard"
    if first == "C":
        return "Big"
    if first == "PF":
        # PF is treated as Big for archetype purposes (interior-leaning),
        # but keeps its own label in raw position display elsewhere.
        return "Big"
    return "Wing"  # SF and anything unrecognized


def assign_archetype(row) -> str:
    p = row  # percentile columns already prefixed pctile_
    scoring = p["pctile_scoring"]
    efficiency = p["pctile_efficiency"]
    playmaking = p["pctile_playmaking"]
    rebounding = p["pctile_rebounding"]
    defense = p["pctile_defensive_activity"]
    rim = p["pctile_rim_pressure"]
    perimeter = p["pctile_perimeter_profile"]
    pos_group = row["pos_group"]

    # --- Big-specific rules first (position-gated) ---
    if pos_group == "Big":
        if defense >= HIGH and rebounding >= HIGH and scoring < MID:
            return "Defensive Anchor"
        if rebounding >= HIGH and scoring < MID:
            return "Glass-Cleaning Big"
        if perimeter >= HIGH:
            return "Stretch Big"
        if rim >= HIGH and scoring >= MID:
            return "Interior Scorer"

    # --- Creator / scorer rules (any position) ---
    if playmaking >= HIGH and scoring >= HIGH:
        return "Primary Creator"
    if perimeter >= HIGH and scoring >= MID and pos_group in ("Guard", "Wing"):
        return "Perimeter Shot Creator"
    if scoring >= HIGH and defense >= MID:
        return "Two-Way Scorer"
    if pos_group == "Wing" and perimeter >= MID and defense >= HIGH and scoring < HIGH:
        return "3-and-D Wing"
    if playmaking >= MID and scoring < MID and defense >= MID:
        return "Connector"
    if pos_group == "Big" and scoring >= MID:
        return "Interior Scorer"

    return config.FALLBACK_ARCHETYPE.format(pos_group=pos_group)


TAG_LABELS = {
    "pctile_scoring": "Scoring",
    "pctile_efficiency": "Efficiency",
    "pctile_playmaking": "Playmaking",
    "pctile_rebounding": "Rebounding",
    "pctile_defensive_activity": "Defensive Activity",
    "pctile_rim_pressure": "Rim Pressure",
    "pctile_perimeter_profile": "Perimeter Shooting",
}


def level_word(pctile: float) -> str:
    if pctile >= 90:
        return "Elite"
    if pctile >= HIGH:
        return "Strong"
    if pctile >= MID:
        return "Solid"
    return "Modest"


def trait_tags(row, n=3) -> list:
    pcts = [(col, row[col]) for col in TAG_LABELS]
    pcts.sort(key=lambda x: -x[1])
    top = pcts[:n]
    return [f"{level_word(v)} {TAG_LABELS[c]}" for c, v in top]


def main():
    df = pd.read_csv(utils.data_path("features_traits.csv"))
    df["pos_group"] = df["pos"].apply(position_group)
    df["archetype"] = df.apply(assign_archetype, axis=1)
    df["trait_tags"] = df.apply(lambda r: "|".join(trait_tags(r)), axis=1)

    df.to_csv(utils.data_path("with_archetypes.csv"), index=False)

    print("Archetype distribution (qualified pool):")
    print(df[df["qualified"]]["archetype"].value_counts())
    print("\nWrote data/with_archetypes.csv")


if __name__ == "__main__":
    main()
