"""
collect_all.py
Runs collect.py logic across every feature/indicator in the question bank.

Usage:
  python collect_all.py --runs 3 --models all
  python collect_all.py --runs 1 --models claude gpt --variant 0
"""

import argparse
import os
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from question_bank import QUESTION_BANK, MODELS, MODEL_SHORTNAME_MAP
from collect import collect, init_db, resolve_models, record_exists


def count_existing_runs(
    conn: sqlite3.Connection,
    feature: str,
    indicator: str,
    variant_index: int,
    model_id: str,
    max_runs: int,
) -> int:
    """Return how many run entries already exist for this combination."""
    cur = conn.execute(
        "SELECT COUNT(*) FROM evaluations WHERE feature=? AND indicator=? "
        "AND variant_index=? AND model_id=?",
        (feature, indicator, variant_index, model_id)
    )
    return cur.fetchone()[0]


def main():
    parser = argparse.ArgumentParser(description="Collect GWT evaluations for all indicators")
    parser.add_argument("--runs",    type=int, default=1)
    parser.add_argument("--models",  nargs="+", default=["all"])
    parser.add_argument("--variant", type=int, default=0, choices=[0, 1, 2, 3])
    parser.add_argument("--api-key", default=None)
    args = parser.parse_args()

    api_key = args.api_key or os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("ERROR: No API key provided. Use --api-key or set OPENROUTER_API_KEY.")
        sys.exit(1)

    resolved = resolve_models(args.models)
    conn = init_db()

    total_indicators = sum(len(fd["indicators"]) for fd in QUESTION_BANK.values())
    processed = 0
    skipped = 0
    errors = 0

    print(f"\nGWT Collect All")
    print(f"Models  : {[m['short_name'] for m in resolved]}")
    print(f"Runs    : {args.runs}  |  Variant: {args.variant}")
    print(f"Total indicators: {total_indicators}")
    print("=" * 60)

    coverage_rows = []

    for feature_key, feature_data in QUESTION_BANK.items():
        for ind in feature_data["indicators"]:
            indicator_label = ind["label"]

            # Check if all models already have enough runs
            model_counts = {}
            all_complete = True
            for model in resolved:
                count = count_existing_runs(
                    conn, feature_key, indicator_label,
                    args.variant, model["id"], args.runs
                )
                model_counts[model["short_name"]] = count
                if count < args.runs:
                    all_complete = False

            status_str = "  ".join(f"{k}:{v}/{args.runs}" for k, v in model_counts.items())

            if all_complete:
                print(f"  SKIP  [{feature_key}] {indicator_label}  ({status_str})")
                skipped += 1
                coverage_rows.append((feature_key, indicator_label, model_counts, "complete"))
                continue

            print(f"\n  RUN   [{feature_key}] {indicator_label}  ({status_str})")
            try:
                results = collect(
                    feature=feature_key,
                    indicator=indicator_label,
                    runs=args.runs,
                    models=args.models,
                    variant_index=args.variant,
                    api_key=api_key,
                    verbose=False,
                )
                collected = sum(1 for r in results if r.get("status") == "ok")
                errs = sum(1 for r in results if r.get("status") == "error")
                print(f"         → {collected} collected, {errs} errors")
                if errs:
                    errors += errs
                coverage_rows.append((feature_key, indicator_label, model_counts, "ran"))
            except Exception as e:
                print(f"         → FATAL ERROR: {e}")
                errors += 1
                coverage_rows.append((feature_key, indicator_label, model_counts, "error"))

            processed += 1

    conn.close()

    # Coverage summary
    print("\n" + "=" * 80)
    print("COVERAGE SUMMARY")
    print("=" * 80)
    model_names = [m["short_name"] for m in resolved]
    header = f"{'Feature':<22} {'Indicator':<40} " + "  ".join(f"{n:>8}" for n in model_names)
    print(header)
    print("─" * len(header))

    for feature_key, indicator_label, model_counts, status in coverage_rows:
        counts_str = "  ".join(f"{model_counts.get(n, 0):>8}" for n in model_names)
        flag = "✓" if status == "complete" else ("✗" if status == "error" else " ")
        print(f"{flag} {feature_key:<20} {indicator_label:<40} {counts_str}")

    print(f"\nDone. {processed} indicators ran, {skipped} skipped, {errors} errors.")


if __name__ == "__main__":
    main()
