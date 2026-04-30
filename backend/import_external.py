"""
import_external.py
Import externally collected or expert-panel results into results.db.

Usage:
  python import_external.py --file expert_results.json
  python import_external.py --file expert_results.json --overwrite

Expected input JSON format — array of objects:
  [
    {
      "model_id": "human-expert-panel",
      "feature": "complexity",
      "indicator": "Functional Specialization",
      "variant_index": 0,
      "run_index": 1,
      "score": 5,
      "reasoning": "Expert assessment: ...",
      "source": "external"
    },
    ...
  ]
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from question_bank import QUESTION_BANK
from collect import init_db


def validate_entry(entry: dict, idx: int) -> list[str]:
    """Return list of validation error messages. Empty = valid."""
    errors = []

    if not isinstance(entry.get("model_id"), str) or not entry["model_id"].strip():
        errors.append("model_id must be a non-empty string")

    feature = entry.get("feature", "")
    if feature not in QUESTION_BANK:
        errors.append(f"Unknown feature: {feature!r}. Valid: {list(QUESTION_BANK.keys())}")
    else:
        indicator = entry.get("indicator", "")
        valid_indicators = [i["label"] for i in QUESTION_BANK[feature]["indicators"]]
        if indicator not in valid_indicators:
            errors.append(f"Unknown indicator {indicator!r} in feature {feature!r}")

    vi = entry.get("variant_index")
    if not isinstance(vi, int) or vi not in (0, 1, 2, 3):
        errors.append(f"variant_index must be 0-3, got {vi!r}")

    ri = entry.get("run_index")
    if not isinstance(ri, int) or ri < 1:
        errors.append(f"run_index must be a positive integer, got {ri!r}")

    score = entry.get("score")
    try:
        score = int(score)
        if not (1 <= score <= 7):
            errors.append(f"score must be 1-7, got {score}")
    except (TypeError, ValueError):
        errors.append(f"score must be an integer, got {score!r}")

    reasoning = entry.get("reasoning", "")
    if not isinstance(reasoning, str) or not reasoning.strip():
        errors.append("reasoning must be a non-empty string")

    return errors


def get_question_text(feature: str, indicator: str) -> str:
    for ind in QUESTION_BANK.get(feature, {}).get("indicators", []):
        if ind["label"] == indicator:
            return ind["question"]
    return ""


def main():
    parser = argparse.ArgumentParser(description="Import external results into GWT database")
    parser.add_argument("--file",      required=True, help="Path to input JSON file")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing records")
    args = parser.parse_args()

    input_path = Path(args.file)
    if not input_path.exists():
        print(f"ERROR: File not found: {args.file}")
        sys.exit(1)

    with open(input_path) as f:
        try:
            entries = json.load(f)
        except json.JSONDecodeError as e:
            print(f"ERROR: Invalid JSON: {e}")
            sys.exit(1)

    if not isinstance(entries, list):
        print("ERROR: Input JSON must be an array of objects.")
        sys.exit(1)

    conn = init_db()

    n_inserted = 0
    n_updated = 0
    n_skipped = 0
    n_invalid = 0

    for idx, entry in enumerate(entries):
        errors = validate_entry(entry, idx)
        if errors:
            print(f"  [INVALID] Entry {idx}: {'; '.join(errors)}")
            n_invalid += 1
            continue

        feature   = entry["feature"]
        indicator = entry["indicator"]
        vi        = int(entry["variant_index"])
        ri        = int(entry["run_index"])
        model_id  = entry["model_id"].strip()
        score     = max(1, min(7, int(entry["score"])))
        reasoning = entry["reasoning"].strip()
        source    = entry.get("source", "external")
        timestamp = entry.get("timestamp") or datetime.now(timezone.utc).isoformat()
        question_text = entry.get("question_text") or get_question_text(feature, indicator)

        # Check for existing record
        cur = conn.execute(
            "SELECT id FROM evaluations WHERE feature=? AND indicator=? "
            "AND variant_index=? AND model_id=? AND run_index=?",
            (feature, indicator, vi, model_id, ri)
        )
        row = cur.fetchone()

        if row:
            if args.overwrite:
                conn.execute(
                    "UPDATE evaluations SET score=?, reasoning=?, question_text=?, "
                    "source=?, timestamp=? WHERE id=?",
                    (score, reasoning, question_text, source, timestamp, row[0])
                )
                conn.commit()
                print(f"  [UPDATED] {model_id} / {feature} / {indicator} / v{vi} run{ri} → score {score}")
                n_updated += 1
            else:
                print(f"  [SKIP]    {model_id} / {feature} / {indicator} / v{vi} run{ri} — already exists (use --overwrite)")
                n_skipped += 1
        else:
            conn.execute(
                """INSERT INTO evaluations
                   (feature, indicator, variant_index, model_id, run_index,
                    score, reasoning, question_text, source, timestamp)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (feature, indicator, vi, model_id, ri,
                 score, reasoning, question_text, source, timestamp)
            )
            conn.commit()
            print(f"  [INSERT]  {model_id} / {feature} / {indicator} / v{vi} run{ri} → score {score}")
            n_inserted += 1

    conn.close()

    print(f"\n{'─'*50}")
    print(f"Import complete:")
    print(f"  Inserted : {n_inserted}")
    print(f"  Updated  : {n_updated}")
    print(f"  Skipped  : {n_skipped}")
    print(f"  Invalid  : {n_invalid}")
    print(f"  Total    : {len(entries)}")


if __name__ == "__main__":
    main()
