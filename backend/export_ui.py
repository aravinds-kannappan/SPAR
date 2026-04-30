"""
export_ui.py
Reads results.db and variants.json, writes frontend/results.json.

Usage:
  python export_ui.py
  python export_ui.py --output ../frontend/results.json
"""

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from question_bank import QUESTION_BANK, MODELS, SCALE_LABELS

DB_PATH      = Path(__file__).parent / "data" / "results.db"
VARIANTS_PATH = Path(__file__).parent / "data" / "variants.json"
DEFAULT_OUT  = Path(__file__).parent.parent / "frontend" / "results.json"


def load_variants() -> dict:
    if VARIANTS_PATH.exists():
        with open(VARIANTS_PATH) as f:
            return json.load(f)
    return {}


def load_all_results(conn: sqlite3.Connection) -> list[dict]:
    conn.row_factory = sqlite3.Row
    cur = conn.execute("SELECT * FROM evaluations ORDER BY feature, indicator, variant_index, model_id, run_index")
    return [dict(row) for row in cur.fetchall()]


def build_output(results: list[dict], variants_store: dict) -> dict:
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scale_direction": "7=certainly_yes",
        "scale_labels": {str(k): v for k, v in SCALE_LABELS.items()},
        "models": MODELS,
        "features": {}
    }

    # Index results by feature → indicator → model_id → variant_index → [runs]
    indexed: dict = {}
    for row in results:
        f  = row["feature"]
        i  = row["indicator"]
        vi = str(row["variant_index"])
        m  = row["model_id"]

        indexed.setdefault(f, {}).setdefault(i, {}).setdefault(m, {}).setdefault(vi, [])
        indexed[f][i][m][vi].append({
            "score":         row["score"],
            "reasoning":     row["reasoning"],
            "run_index":     row["run_index"],
            "source":        row["source"],
            "timestamp":     row["timestamp"],
        })

    # Build full structure from question bank (include indicators with no data)
    for feature_key, feature_data in QUESTION_BANK.items():
        feature_out = {
            "display_name": feature_data["display_name"],
            "indicators": {}
        }
        for ind in feature_data["indicators"]:
            label = ind["label"]

            # Variants — use stored or fall back to [original, original, original, original]
            stored_variants = variants_store.get(feature_key, {}).get(label)
            if stored_variants and len(stored_variants) == 4:
                variant_texts = stored_variants
            else:
                variant_texts = [ind["question"]] * 4

            results_by_model = indexed.get(feature_key, {}).get(label, {})

            feature_out["indicators"][label] = {
                "variants": variant_texts,
                "results": results_by_model
            }

        output["features"][feature_key] = feature_out

    return output


def main():
    parser = argparse.ArgumentParser(description="Export GWT results to frontend JSON")
    parser.add_argument("--output", default=str(DEFAULT_OUT), help="Output path for results.json")
    args = parser.parse_args()

    if not DB_PATH.exists():
        print(f"WARNING: Database not found at {DB_PATH}. Exporting question bank structure only (no results).")
        results = []
        conn = None
    else:
        conn = sqlite3.connect(DB_PATH)
        results = load_all_results(conn)
        print(f"Loaded {len(results)} result rows from database.")

    variants_store = load_variants()
    print(f"Loaded variants for {sum(len(v) for v in variants_store.values())} indicators.")

    output = build_output(results, variants_store)

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)

    if conn:
        conn.close()

    # Stats
    total_indicators = sum(
        len(fd["indicators"]) for fd in QUESTION_BANK.values()
    )
    indicators_with_data = sum(
        1 for fdata in output["features"].values()
        for idata in fdata["indicators"].values()
        if idata["results"]
    )
    print(f"\nExport complete → {out_path}")
    print(f"  Features    : {len(output['features'])}")
    print(f"  Indicators  : {total_indicators} total, {indicators_with_data} with data")
    print(f"  Result rows : {len(results)}")


if __name__ == "__main__":
    main()
