"""
validate.py
Validates the data store for integrity issues and prints a coverage report.

Usage:
  python validate.py
  python validate.py --expected-runs 3
"""

import argparse
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from question_bank import QUESTION_BANK, MODELS

DB_PATH           = Path(__file__).parent / "data" / "results.db"
VARIANTS_PATH     = Path(__file__).parent / "data" / "variants.json"
REVIEW_FLAGS_PATH = Path(__file__).parent / "data" / "review_flags.json"


def load_variants() -> dict:
    if VARIANTS_PATH.exists():
        with open(VARIANTS_PATH) as f:
            return json.load(f)
    return {}


def load_flags() -> list:
    if REVIEW_FLAGS_PATH.exists():
        with open(REVIEW_FLAGS_PATH) as f:
            return json.load(f)
    return []


def main():
    parser = argparse.ArgumentParser(description="Validate GWT data store")
    parser.add_argument("--expected-runs", type=int, default=1,
                        help="Expected number of runs per model per indicator (default 1)")
    args = parser.parse_args()

    issues_found = False

    # ── Load data ──────────────────────────────────────────────────────────────
    if not DB_PATH.exists():
        print(f"WARNING: Database not found at {DB_PATH}")
        rows = []
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        rows = [dict(r) for r in conn.execute("SELECT * FROM evaluations").fetchall()]
        conn.close()

    variants_store = load_variants()
    flags          = load_flags()

    # ── Row-level checks ───────────────────────────────────────────────────────
    print("=" * 70)
    print("ROW-LEVEL CHECKS")
    print("=" * 70)

    bad_scores    = []
    empty_reasons = []
    bad_questions = []

    for row in rows:
        if not (1 <= row["score"] <= 7):
            bad_scores.append(row)
            issues_found = True

        if not row["reasoning"] or not row["reasoning"].strip():
            empty_reasons.append(row)
            issues_found = True

        expected_q = ""
        for ind in QUESTION_BANK.get(row["feature"], {}).get("indicators", []):
            if ind["label"] == row["indicator"]:
                expected_q = ind["question"]
                break
        # Check stored question text against the variant texts
        stored_variants = variants_store.get(row["feature"], {}).get(row["indicator"])
        if stored_variants:
            vi = row["variant_index"]
            if vi < len(stored_variants) and row["question_text"] != stored_variants[vi]:
                bad_questions.append({**row, "expected": stored_variants[vi]})
                issues_found = True

    if bad_scores:
        print(f"\n⚠  {len(bad_scores)} rows with score outside 1-7:")
        for r in bad_scores:
            print(f"   id={r['id']} model={r['model_id']} score={r['score']}")
    else:
        print("✓  All scores within 1-7")

    if empty_reasons:
        print(f"\n⚠  {len(empty_reasons)} rows with empty reasoning:")
        for r in empty_reasons:
            print(f"   id={r['id']} model={r['model_id']} feature={r['feature']}")
    else:
        print("✓  All reasoning fields non-empty")

    if bad_questions:
        print(f"\n⚠  {len(bad_questions)} rows with mismatched question text:")
        for r in bad_questions[:5]:
            print(f"   id={r['id']} indicator={r['indicator']}")
    else:
        print("✓  All question texts match variants.json")

    # ── Variant checks ─────────────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print("VARIANT CHECKS")
    print("=" * 70)

    missing_variants = []
    for feature_key, feature_data in QUESTION_BANK.items():
        for ind in feature_data["indicators"]:
            stored = variants_store.get(feature_key, {}).get(ind["label"])
            if not stored or len(stored) < 4:
                missing_variants.append((feature_key, ind["label"]))

    if missing_variants:
        print(f"\n⚠  {len(missing_variants)} indicators missing full variants (< 4):")
        for f, i in missing_variants[:10]:
            print(f"   [{f}] {i}")
        issues_found = True
    else:
        print("✓  All indicators have 4 variants in variants.json")

    # ── Review flags ───────────────────────────────────────────────────────────
    if flags:
        print(f"\n⚠  {len(flags)} uncleared review flags in review_flags.json:")
        for flag in flags[:5]:
            print(f"   [{flag['indicator']}] variant {flag['variant_index']}: {flag['reason']}")
        issues_found = True
    else:
        print("✓  No review flags pending")

    # ── Coverage report ────────────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print(f"COVERAGE REPORT  (expected {args.expected_runs} run(s) per model)")
    print("=" * 70)

    # Index: feature → indicator → model_id → count
    run_counts: dict = {}
    for row in rows:
        f, i, m = row["feature"], row["indicator"], row["model_id"]
        run_counts.setdefault(f, {}).setdefault(i, {}).setdefault(m, 0)
        run_counts[f][i][m] += 1

    model_names = [m["short_name"] for m in MODELS]
    model_ids   = [m["id"] for m in MODELS]

    header = f"  {'Feature':<22} {'Indicator':<38} " + "".join(f"{n:>9}" for n in model_names) + "  Issues"
    print(header)
    print("  " + "─" * (len(header) - 2))

    total_cells    = 0
    complete_cells = 0

    for feature_key, feature_data in QUESTION_BANK.items():
        for ind in feature_data["indicators"]:
            label  = ind["label"]
            counts = []
            cell_issues = []

            for mid in model_ids:
                count = run_counts.get(feature_key, {}).get(label, {}).get(mid, 0)
                counts.append(count)
                total_cells += 1
                if count >= args.expected_runs:
                    complete_cells += 1
                elif count == 0:
                    cell_issues.append(f"{mid.split('/')[1]} missing")
                else:
                    cell_issues.append(f"{mid.split('/')[1]} partial({count})")

            issues_str = ", ".join(cell_issues) if cell_issues else "✓"
            counts_str = "".join(f"{c:>9}" for c in counts)
            print(f"  {feature_key:<22} {label:<38} {counts_str}  {issues_str}")

    pct = (complete_cells / total_cells * 100) if total_cells else 0
    print(f"\n  Coverage: {complete_cells}/{total_cells} model-indicator cells complete ({pct:.0f}%)")

    print("\n" + "=" * 70)
    if issues_found:
        print("RESULT: Issues found — see above.")
        sys.exit(1)
    else:
        print("RESULT: All checks passed.")
        sys.exit(0)


if __name__ == "__main__":
    main()
