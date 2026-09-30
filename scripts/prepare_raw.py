"""
prepare_raw.py -- extracts the supplied archive.zip into raw/*.csv.

The source dataset is Sumitro Datta's Kaggle dataset "NBA Stats
(1947-present)" (https://www.kaggle.com/datasets/sumitrodatta/nba-aba-baa-stats),
published CC0: Public Domain. The raw archive is intentionally excluded
from this repository for repository cleanliness and source separation
(it's a large third-party input artifact, not project source code) --
not because its license is unclear. See docs/data.md.

This script:
  1. Validates the archive contains the 22 expected CSV files.
  2. Extracts them into raw/ (creating the directory if needed).
  3. Never modifies, moves, or deletes the source archive itself.

Cross-platform (plain zipfile/pathlib, no shell-specific syntax).

Usage:
    python3 scripts/prepare_raw.py /path/to/archive.zip
    python3 scripts/prepare_raw.py /path/to/archive.zip --verify-checksum
"""
import argparse
import hashlib
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = REPO_ROOT / "raw"

# The archive's own SHA-256, as downloaded from Kaggle at the time this
# project was built. Checked only if --verify-checksum is passed, since
# Kaggle dataset exports can be refreshed over time and a mismatch alone
# doesn't mean the data is wrong -- it means it may be a newer/older
# version than this project's committed analysis was built from.
KNOWN_ARCHIVE_SHA256 = "5be35c2837020214a98148f42c21f90bfba0ea1c75d2b3ab8ff6b91baaa4917f"

EXPECTED_CSVS = [
    "Advanced.csv", "All-Star Selections.csv", "Draft Pick History.csv",
    "End of Season Teams (Voting).csv", "End of Season Teams.csv",
    "Opponent Stats Per 100 Poss.csv", "Opponent Stats Per Game.csv",
    "Opponent Totals.csv", "Per 100 Poss.csv", "Per 36 Minutes.csv",
    "Player Award Shares.csv", "Player Career Info.csv", "Player Per Game.csv",
    "Player Play By Play.csv", "Player Season Info.csv", "Player Shooting.csv",
    "Player Totals.csv", "Team Abbrev.csv", "Team Stats Per 100 Poss.csv",
    "Team Stats Per Game.csv", "Team Summaries.csv", "Team Totals.csv",
]


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archive", help="Path to the downloaded archive.zip")
    ap.add_argument("--verify-checksum", action="store_true",
                     help="Check the archive's SHA-256 against the version this project was built from")
    args = ap.parse_args()

    archive_path = Path(args.archive).expanduser().resolve()
    if not archive_path.exists():
        print(f"ERROR: {archive_path} does not exist", file=sys.stderr)
        sys.exit(1)

    if args.verify_checksum:
        actual = sha256_of(archive_path)
        print(f"Archive SHA-256: {actual}")
        if actual == KNOWN_ARCHIVE_SHA256:
            print("MATCH: byte-identical to the archive this project was built from.")
        else:
            print("NO MATCH: this may be a different/refreshed export of the same "
                  "Kaggle dataset. Not necessarily an error -- see docs/data.md.")

    with zipfile.ZipFile(archive_path) as zf:
        names_in_zip = {Path(n).name for n in zf.namelist() if n.endswith(".csv")}
        missing = [f for f in EXPECTED_CSVS if f not in names_in_zip]
        if missing:
            print(f"ERROR: archive is missing {len(missing)} expected CSV file(s): {missing}", file=sys.stderr)
            sys.exit(1)

        RAW_DIR.mkdir(exist_ok=True)
        extracted = 0
        for info in zf.infolist():
            name = Path(info.filename).name
            if name in EXPECTED_CSVS:
                target = RAW_DIR / name
                with zf.open(info) as src, open(target, "wb") as dst:
                    dst.write(src.read())
                extracted += 1

    print(f"Extracted {extracted} of {len(EXPECTED_CSVS)} expected CSV files into {RAW_DIR}/")
    print("Source archive was not modified. Next: pip install -r requirements.txt, then run analysis/step1 through step6.")


if __name__ == "__main__":
    main()
