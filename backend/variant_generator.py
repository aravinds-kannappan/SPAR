"""
variant_generator.py
Generates 4 semantic variants of each indicator question using spaCy NLP.

Variants:
  0 — Original (unchanged)
  1 — Third-person system-class reframe ("leading 2024 LLMs")
  2 — Second-person self-report ("you")
  3 — Negation probe ("fail to" / "not")
"""

import json
import re
from pathlib import Path
from typing import Optional

try:
    import spacy
    nlp = spacy.load("en_core_web_sm")
    SPACY_AVAILABLE = True
except (ImportError, OSError):
    SPACY_AVAILABLE = False
    nlp = None

VARIANTS_PATH = Path(__file__).parent / "data" / "variants.json"
REVIEW_FLAGS_PATH = Path(__file__).parent / "data" / "review_flags.json"

# Singular → plural auxiliary/verb fixes
SINGULAR_TO_PLURAL = {
    "does": "do",
    "is": "are",
    "has": "have",
    "was": "were",
}

# Second-person auxiliary mapping (same as plural for English)
SECOND_PERSON_AUX = {
    "does": "do",
    "is": "are",
    "has": "have",
}


# ── helpers ──────────────────────────────────────────────────────────────────

def _load_variants() -> dict:
    if VARIANTS_PATH.exists():
        with open(VARIANTS_PATH) as f:
            return json.load(f)
    return {}


def _save_variants(data: dict) -> None:
    VARIANTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(VARIANTS_PATH, "w") as f:
        json.dump(data, f, indent=2)


def _load_flags() -> list:
    if REVIEW_FLAGS_PATH.exists():
        with open(REVIEW_FLAGS_PATH) as f:
            return json.load(f)
    return []


def _save_flag(indicator_label: str, variant_index: int, reason: str) -> None:
    flags = _load_flags()
    flags.append({
        "indicator": indicator_label,
        "variant_index": variant_index,
        "reason": reason
    })
    REVIEW_FLAGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(REVIEW_FLAGS_PATH, "w") as f:
        json.dump(flags, f, indent=2)


def _grammar_ok(sentence: str) -> tuple[bool, str]:
    """Check that the sentence starts with capital, ends with ?, has a verb."""
    if not sentence:
        return False, "empty string"
    if not sentence[0].isupper():
        return False, "does not start with capital letter"
    if not sentence.rstrip().endswith("?"):
        return False, "does not end with question mark"
    if SPACY_AVAILABLE:
        doc = nlp(sentence)
        has_verb = any(tok.pos_ in ("VERB", "AUX") for tok in doc)
        if not has_verb:
            return False, "no verb found"
    return True, ""


def _reconstruct(tokens_with_ws: list[str]) -> str:
    """Join token list and clean up any double spaces."""
    text = "".join(tokens_with_ws).strip()
    text = re.sub(r"  +", " ", text)
    # Capitalise first letter
    if text:
        text = text[0].upper() + text[1:]
    return text


def _find_subject_chunk(doc) -> Optional[object]:
    """Return the noun chunk that contains the grammatical subject token."""
    for tok in doc:
        if tok.dep_ in ("nsubj", "nsubjpass"):
            # find the noun chunk containing this token
            for chunk in doc.noun_chunks:
                if tok.i >= chunk.start and tok.i < chunk.end:
                    return chunk
            return None
    return None


def _find_root_verb(doc) -> Optional[object]:
    for tok in doc:
        if tok.dep_ == "ROOT":
            return tok
    return None


def _find_first_aux(root_tok) -> Optional[object]:
    """Find the first auxiliary child of the root verb."""
    for child in root_tok.children:
        if child.dep_ == "aux":
            return child
    return None


# ── three transformation functions ───────────────────────────────────────────

def _variant_third_person(question: str) -> str:
    """
    Replace grammatical subject noun chunk with 'leading 2024 LLMs'
    and fix verb agreement (singular → plural).
    """
    if not SPACY_AVAILABLE:
        return question

    doc = nlp(question)
    tokens = [tok.text_with_ws for tok in doc]

    subject_chunk = _find_subject_chunk(doc)
    if subject_chunk is None:
        return question  # cannot transform — caller will flag

    # Replace the entire chunk with the new subject
    replacement = "leading 2024 LLMs"
    tokens[subject_chunk.start] = replacement + doc[subject_chunk.end - 1].whitespace_
    for i in range(subject_chunk.start + 1, subject_chunk.end):
        tokens[i] = ""

    # Fix opening auxiliary / root verb agreement (singular → plural)
    for tok in doc:
        if tok.dep_ in ("aux", "ROOT") and tok.i < 5:  # near sentence start
            lower = tok.text.lower()
            if lower in SINGULAR_TO_PLURAL:
                # preserve leading capital if it was the first token
                fixed = SINGULAR_TO_PLURAL[lower]
                if tok.i == 0:
                    fixed = fixed.capitalize()
                tokens[tok.i] = fixed + tok.whitespace_
                break  # only fix the first one

    return _reconstruct(tokens)


def _variant_second_person(question: str) -> str:
    """
    Replace grammatical subject with 'you' and fix auxiliary to
    second-person form.
    """
    if not SPACY_AVAILABLE:
        return question

    doc = nlp(question)
    tokens = [tok.text_with_ws for tok in doc]

    subject_chunk = _find_subject_chunk(doc)
    if subject_chunk is None:
        return question

    # Replace subject chunk with "you"
    tokens[subject_chunk.start] = "you" + doc[subject_chunk.end - 1].whitespace_
    for i in range(subject_chunk.start + 1, subject_chunk.end):
        tokens[i] = ""

    # Fix opening auxiliary to second-person (does→do, is→are, has→have)
    for tok in doc:
        if tok.dep_ == "aux" and tok.i < 5:
            lower = tok.text.lower()
            if lower in SECOND_PERSON_AUX:
                fixed = SECOND_PERSON_AUX[lower]
                if tok.i == 0:
                    fixed = fixed.capitalize()
                tokens[tok.i] = fixed + tok.whitespace_
                break

    return _reconstruct(tokens)


def _variant_negation(question: str) -> str:
    """
    Insert negation into the auxiliary chain of the ROOT verb.
    If no auxiliary: prepend 'fail to' before the ROOT verb.
    """
    if not SPACY_AVAILABLE:
        return question

    doc = nlp(question)
    tokens = [tok.text_with_ws for tok in doc]

    root = _find_root_verb(doc)
    if root is None:
        return question

    aux = _find_first_aux(root)
    if aux is not None:
        # Insert "not" after the auxiliary
        tokens[aux.i] = aux.text + " not" + aux.whitespace_
    else:
        # No auxiliary — prepend "fail to" before the root verb
        tokens[root.i] = "fail to " + root.text + root.whitespace_

    return _reconstruct(tokens)


# ── public API ────────────────────────────────────────────────────────────────

def generate_all_variants(
    question: str,
    feature: str,
    indicator_label: str,
    force: bool = False
) -> list[str]:
    """
    Return [original, third-person, second-person, negation].

    Loads from variants.json if already generated (unless force=True).
    Saves result to variants.json.
    Writes review_flags.json entries for any variant that fails grammar check.
    """
    store = _load_variants()
    key_feature = store.setdefault(feature, {})

    if not force and indicator_label in key_feature:
        existing = key_feature[indicator_label]
        if isinstance(existing, list) and len(existing) == 4:
            return existing

    transforms = [
        (0, lambda q: q,                    "original"),
        (1, _variant_third_person,           "third-person reframe"),
        (2, _variant_second_person,          "second-person self-report"),
        (3, _variant_negation,               "negation probe"),
    ]

    results: list[str] = []
    for variant_idx, fn, desc in transforms:
        try:
            transformed = fn(question)
            ok, reason = _grammar_ok(transformed)
            if not ok:
                print(f"  [WARN] Variant {variant_idx} ({desc}) failed grammar check: {reason}. Using original.")
                _save_flag(indicator_label, variant_idx, f"Grammar check failed: {reason}")
                transformed = question
        except Exception as e:
            print(f"  [WARN] Variant {variant_idx} ({desc}) raised exception: {e}. Using original.")
            _save_flag(indicator_label, variant_idx, f"Exception: {e}")
            transformed = question
        results.append(transformed)

    key_feature[indicator_label] = results
    _save_variants(store)
    return results


def get_variants(feature: str, indicator_label: str) -> Optional[list[str]]:
    """Return stored variants or None if not yet generated."""
    store = _load_variants()
    return store.get(feature, {}).get(indicator_label)


if __name__ == "__main__":
    # Quick smoke test
    test_q = "Does the system demonstrate the ability to dynamically shift its processing focus based on its goals, rather than just reacting to stimuli?"
    print("Testing variant generator...\n")
    variants = generate_all_variants(test_q, "test_feature", "Test Indicator", force=True)
    labels = ["V0 Original", "V1 Third-Person", "V2 Self-Report", "V3 Negation"]
    for label, v in zip(labels, variants):
        print(f"{label}:\n  {v}\n")
