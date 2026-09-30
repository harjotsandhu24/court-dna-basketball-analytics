"""
Step 5 — deterministic 2D PCA projection per season, for the Player Galaxy.

IMPORTANT: PCA here is for VISUALIZATION ONLY. It compresses the same
12-dimensional standardized feature vector used by the similarity engine
into 2 dimensions so it can be plotted as a constellation. The Galaxy's
"closest neighbor" highlighting in the app is computed from the full
12-dimensional similarity formula, not from 2D distance -- PCA distance is
only an approximation and is documented as such everywhere it appears.

Only the QUALIFIED pool (>=500 MP, >=20 G) for a season is projected --
this matches "Main similarity/Galaxy pool" in the spec.

Determinism: scikit-learn's PCA is itself deterministic for a fixed input
(no randomness in the SVD solver used here), but we still pin
random_state for full reproducibility and pin the input feature order via
config.SIMILARITY_FEATURES.

Run: python3 analysis/step5_galaxy_pca.py
"""
import json

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA

import utils
import config


def main():
    df = pd.read_csv(utils.data_path("with_archetypes.csv"))
    std_cols = [f"std_{f}" for f in config.SIMILARITY_FEATURES]

    galaxy_coords = {}
    variance_explained = {}

    for season in sorted(df["season"].unique()):
        season_df = df[(df["season"] == season) & (df["qualified"])].copy()
        if len(season_df) < 10:
            continue
        X = season_df[std_cols].fillna(0).values

        pca = PCA(n_components=config.PCA_N_COMPONENTS, random_state=config.PCA_RANDOM_STATE, svd_solver="full")
        coords = pca.fit_transform(X)

        season_df["pca_x"] = coords[:, 0]
        season_df["pca_y"] = coords[:, 1]

        for _, row in season_df.iterrows():
            key = f"{row['player_id']}_{int(row['season'])}"
            galaxy_coords[key] = {
                "x": round(float(row["pca_x"]), 4),
                "y": round(float(row["pca_y"]), 4),
            }
        variance_explained[int(season)] = [round(float(v), 4) for v in pca.explained_variance_ratio_]

    with open(utils.data_path("galaxy_coords.json"), "w") as f:
        json.dump({"coords": galaxy_coords, "variance_explained": variance_explained}, f)

    avg_var = np.mean([sum(v) for v in variance_explained.values()])
    print(f"Computed PCA coordinates for {len(galaxy_coords)} qualified player-seasons across {len(variance_explained)} seasons")
    print(f"Average combined variance explained by 2 components: {avg_var*100:.1f}%")
    print("Wrote data/galaxy_coords.json")


if __name__ == "__main__":
    main()
