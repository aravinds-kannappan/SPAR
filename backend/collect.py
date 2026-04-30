"""
collect.py
CLI tool for collecting model evaluations for individual indicators.

Usage:
  python collect.py --feature complexity --indicator "Functional Specialization" --runs 3 --models all
  python collect.py --feature selective_attention --indicator "Task Focus" --runs 1 --models claude gpt
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

# Add parent dir to path so we can import sibling modules when run directly
sys.path.insert(0, str(Path(__file__).parent))

from question_bank import (
    QUESTION_BANK,
    MODELS,
    MODEL_SHORTNAME_MAP,
    SYSTEM_PROMPT,
    USER_PROMPT_TEMPLATE,
    get_question,
)
from variant_generator import generate_all_variants

DB_PATH = Path(__file__).parent / "data" / "results.db"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


# ── Database ──────────────────────────────────────────────────────────────────

def init_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS evaluations (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            feature       TEXT NOT NULL,
            indicator     TEXT NOT NULL,
            variant_index INTEGER NOT NULL,
            model_id      TEXT NOT NULL,
            run_index     INTEGER NOT NULL,
            score         INTEGER NOT NULL,
            reasoning     TEXT NOT NULL,
            question_text TEXT NOT NULL,
            source        TEXT NOT NULL DEFAULT 'api',
            timestamp     TEXT NOT NULL,
            UNIQUE(feature, indicator, variant_index, model_id, run_index)
        )
    """)
    conn.commit()
    return conn


def record_exists(conn: sqlite3.Connection, feature: str, indicator: str,
                  variant_index: int, model_id: str, run_index: int) -> bool:
    cur = conn.execute(
        "SELECT 1 FROM evaluations WHERE feature=? AND indicator=? AND "
        "variant_index=? AND model_id=? AND run_index=?",
        (feature, indicator, variant_index, model_id, run_index)
    )
    return cur.fetchone() is not None


def insert_record(conn: sqlite3.Connection, **kwargs) -> None:
    conn.execute(
        """INSERT INTO evaluations
           (feature, indicator, variant_index, model_id, run_index,
            score, reasoning, question_text, source, timestamp)
           VALUES (:feature, :indicator, :variant_index, :model_id,
                   :run_index, :score, :reasoning, :question_text,
                   :source, :timestamp)""",
        kwargs
    )
    conn.commit()


# ── API call ──────────────────────────────────────────────────────────────────

def _parse_response(raw_text: str, model_id: str) -> dict:
    """Parse JSON from model response. Raises ValueError on failure."""
    text = raw_text.strip()
    # Strip markdown fences
    text = re.sub(r"```(?:json)?", "", text).strip()

    # Direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Regex fallback — find first {...} block
    match = re.search(r"\{[^{}]*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    raise ValueError(
        f"Could not parse JSON from model response.\nRaw response:\n{raw_text[:400]}"
    )


def _call_openrouter(model_id: str, question: str, api_key: str) -> dict:
    """Single API call. Returns parsed {score, reasoning}. Raises on failure."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://gwt-explorer.research",
        "X-Title": "GWT Consciousness Explorer",
    }
    payload = {
        "model": model_id,
        "max_tokens": 600,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": USER_PROMPT_TEMPLATE.format(question=question)},
        ]
    }
    resp = requests.post(OPENROUTER_URL, headers=headers, json=payload, timeout=60)
    resp.raise_for_status()
    data = resp.json()

    if "choices" not in data or not data["choices"]:
        raise ValueError(f"No choices in response: {json.dumps(data)[:300]}")

    raw_text = data["choices"][0]["message"]["content"]
    parsed = _parse_response(raw_text, model_id)

    score = parsed.get("score")
    if score is None:
        raise ValueError(f"No 'score' field in parsed response: {parsed}")
    try:
        score = int(score)
    except (TypeError, ValueError):
        raise ValueError(f"Non-integer score: {score!r}")

    score = max(1, min(7, score))  # clamp
    reasoning = str(parsed.get("reasoning", "No reasoning provided.")).strip()
    if not reasoning:
        reasoning = "No reasoning provided."

    return {"score": score, "reasoning": reasoning}


def call_model(model_id: str, question: str, api_key: str) -> dict:
    """
    Call a model with Gemini-specific retry logic.
    Returns {score: int, reasoning: str}.
    Raises on unrecoverable failure.
    """
    is_gemini = model_id.startswith("google/")

    try:
        return _call_openrouter(model_id, question, api_key)
    except Exception as primary_err:
        if is_gemini:
            fallback_id = "google/gemini-1.5-flash"
            print(f"  [WARN] Gemini primary ({model_id}) failed: {primary_err}")
            print(f"  [RETRY] Trying fallback: {fallback_id}")
            try:
                return _call_openrouter(fallback_id, question, api_key)
            except Exception as fallback_err:
                raise RuntimeError(
                    f"Gemini failed on both primary ({model_id}) and fallback "
                    f"({fallback_id}).\n"
                    f"Primary error: {primary_err}\n"
                    f"Fallback error: {fallback_err}"
                )
        raise


# ── Resolve models ────────────────────────────────────────────────────────────

def resolve_models(models_arg: list[str]) -> list[dict]:
    """Convert shortnames / 'all' to model dicts from MODELS list."""
    if models_arg == ["all"]:
        return MODELS

    model_ids = set()
    for m in models_arg:
        m_lower = m.lower()
        if m_lower in MODEL_SHORTNAME_MAP:
            model_ids.add(MODEL_SHORTNAME_MAP[m_lower])
        else:
            # Assume it's a full model ID
            model_ids.add(m)

    return [m for m in MODELS if m["id"] in model_ids] or [
        {"id": mid, "short_name": mid, "color": "#ffffff"} for mid in model_ids
    ]


# ── Main collection logic ─────────────────────────────────────────────────────

def collect(
    feature: str,
    indicator: str,
    runs: int,
    models: list[str],
    variant_index: int,
    api_key: str,
    verbose: bool = True,
) -> list[dict]:
    """
    Collect model evaluations. Returns list of result dicts.
    Skips entries that already exist in the DB.
    """
    conn = init_db()

    question_text = get_question(feature, indicator)
    all_variants = generate_all_variants(question_text, feature, indicator)
    active_question = all_variants[variant_index]

    if verbose:
        print(f"\n{'='*60}")
        print(f"Feature   : {feature}")
        print(f"Indicator : {indicator}")
        print(f"Variant   : {variant_index} — {active_question[:80]}...")
        print(f"Runs      : {runs}")
        print(f"Models    : {[m['short_name'] for m in resolve_models(models)]}")
        print(f"{'='*60}")

    resolved_models = resolve_models(models)
    results = []

    for model in resolved_models:
        for run_idx in range(1, runs + 1):
            if record_exists(conn, feature, indicator, variant_index, model["id"], run_idx):
                if verbose:
                    print(f"  SKIP  {model['short_name']} run {run_idx} — already exists")
                continue

            if verbose:
                print(f"  CALL  {model['short_name']} run {run_idx}...", end=" ", flush=True)

            try:
                result = call_model(model["id"], active_question, api_key)
                insert_record(
                    conn,
                    feature=feature,
                    indicator=indicator,
                    variant_index=variant_index,
                    model_id=model["id"],
                    run_index=run_idx,
                    score=result["score"],
                    reasoning=result["reasoning"],
                    question_text=active_question,
                    source="api",
                    timestamp=datetime.now(timezone.utc).isoformat(),
                )
                results.append({**result, "model_id": model["id"], "run_index": run_idx, "status": "ok"})
                if verbose:
                    print(f"score={result['score']}  {result['reasoning'][:60]}...")
            except Exception as e:
                if verbose:
                    print(f"ERROR: {e}")
                results.append({"model_id": model["id"], "run_index": run_idx, "status": "error", "error": str(e)})

            time.sleep(0.5)  # polite rate limiting

    conn.close()

    # Summary table
    if verbose:
        print(f"\n{'─'*60}")
        print(f"{'Model':<30} {'Run':>4} {'Score':>6}  {'Status'}")
        print(f"{'─'*60}")
        for r in results:
            score_str = str(r.get("score", "—"))
            print(f"{r['model_id']:<30} {r['run_index']:>4} {score_str:>6}  {r['status']}")
        print(f"{'─'*60}\n")

    return results


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Collect GWT model evaluations")
    parser.add_argument("--feature",   required=True, help="Feature key (e.g. complexity)")
    parser.add_argument("--indicator", required=True, help="Indicator label (e.g. 'Functional Specialization')")
    parser.add_argument("--runs",      type=int, default=1, help="Number of runs per model (default 1)")
    parser.add_argument("--models",    nargs="+", default=["all"],
                        help="Models to query: all | claude | gpt | gemini (space-separated)")
    parser.add_argument("--variant",   type=int, default=0, choices=[0, 1, 2, 3],
                        help="Variant index to use (0=original, 1=third-person, 2=self-report, 3=negation)")
    parser.add_argument("--api-key",   default=None,
                        help="OpenRouter API key (or set OPENROUTER_API_KEY env var)")
    args = parser.parse_args()

    api_key = args.api_key or os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("ERROR: No API key provided. Use --api-key or set OPENROUTER_API_KEY.")
        sys.exit(1)

    if args.feature not in QUESTION_BANK:
        print(f"ERROR: Unknown feature {args.feature!r}. Valid: {list(QUESTION_BANK.keys())}")
        sys.exit(1)

    collect(
        feature=args.feature,
        indicator=args.indicator,
        runs=args.runs,
        models=args.models,
        variant_index=args.variant,
        api_key=api_key,
    )


if __name__ == "__main__":
    main()
