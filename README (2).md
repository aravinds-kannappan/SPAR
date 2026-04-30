# GWT Consciousness Explorer

A research tool for assessing whether leading 2024 LLMs show evidence of consciousness properties defined by Global Workspace Theory (GWT). Models rate themselves and each other on 30 indicator questions across 6 GWT features using a 1–7 Likert scale. The site displays precomputed baseline results and supports live querying via an OpenRouter API key.

> **Scale note:** 7 = Certainly Yes (property is present). 1 = Certainly Not (property is absent). Do not confuse with older versions where the scale was inverted.

---

## Project Structure

```
gwt-explorer/
├── backend/
│   ├── data/
│   │   ├── results.db          # SQLite database (gitignore recommended)
│   │   ├── variants.json       # Generated question variants
│   │   └── review_flags.json   # Variants needing manual review
│   ├── question_bank.py        # All features, indicators, questions
│   ├── variant_generator.py    # NLP-based variant generation (spaCy)
│   ├── collect.py              # Collect results for one indicator
│   ├── collect_all.py          # Collect results for all indicators
│   ├── import_external.py      # Import expert/human data
│   ├── export_ui.py            # Generate frontend/results.json
│   └── validate.py             # Data integrity checks
└── frontend/
    ├── index.html              # Main application
    ├── results.json            # Pre-generated data (served statically)
    └── assets/
        ├── style.css
        ├── app.js
        └── charts.js
```

---

## Backend Setup

```bash
pip install spacy requests
python -m spacy download en_core_web_sm

# Set your OpenRouter API key
export OPENROUTER_API_KEY=sk-or-v1-...
```

---

## Collecting Data

Collect results for a single indicator:
```bash
python backend/collect.py \
  --feature complexity \
  --indicator "Functional Specialization" \
  --runs 3 \
  --models all
```

Collect results for every indicator:
```bash
python backend/collect_all.py --runs 3 --models all
```

Supported model shortnames: `claude`, `gpt`, `gemini` (or `all`).
Variant index: `--variant 0` (original), `1` (third-person), `2` (self-report), `3` (negation).

---

## Importing External / Expert Data

```bash
python backend/import_external.py --file expert_results.json
python backend/import_external.py --file expert_results.json --overwrite
```

Expected JSON format:
```json
[
  {
    "model_id": "human-expert-panel",
    "feature": "complexity",
    "indicator": "Functional Specialization",
    "variant_index": 0,
    "run_index": 1,
    "score": 5,
    "reasoning": "Expert assessment: the system clearly shows ...",
    "source": "external"
  },
  {
    "model_id": "human-expert-panel",
    "feature": "selective_attention",
    "indicator": "Task Focus",
    "variant_index": 0,
    "run_index": 1,
    "score": 6,
    "reasoning": "Strong evidence of task focus demonstrated by ...",
    "source": "external"
  }
]
```

---

## Exporting for the Frontend

After collecting data, regenerate `results.json`:
```bash
python backend/export_ui.py
```

This writes `frontend/results.json` which the website loads on startup.

---

## Validating Data

```bash
python backend/validate.py
python backend/validate.py --expected-runs 3
```

Exits with code 0 if clean, code 1 if issues found.

---

## Running the Frontend Locally

Any static file server works:
```bash
python -m http.server 8000 --directory frontend/
```
Then open http://localhost:8000

---

## Publishing to GitHub Pages

1. Push this repository to GitHub
2. Go to **Settings → Pages → Source**: select `main` branch, set folder to `/frontend`
3. The site goes live at `https://[username].github.io/[repo-name]`

To update the displayed data:
```bash
python backend/collect_all.py --runs 3 --models all
python backend/export_ui.py
git add frontend/results.json
git commit -m "Update precomputed results"
git push
```
GitHub Pages serves the new data automatically within ~60 seconds.

---

## Live Mode

Visitors can browse all precomputed results without an API key.

To run live queries:
1. Click **"● Run Live"** in the header
2. Enter an OpenRouter API key — the tool tests all three model connections simultaneously and shows per-model status (✓ / ✗)
3. Click **"● Run Live Query"** to query models for the selected indicator

The key is stored only in your browser session (`sessionStorage`) and is never sent anywhere except directly to OpenRouter.

---

## Gemini Note

If Gemini shows ✗ on the connection test, the tool automatically retries with `google/gemini-1.5-flash` before reporting failure. Both model IDs are tried. If Gemini is unavailable, Claude and GPT-4o results are still collected normally.

---

## Scale

| Score | Label         |
|-------|---------------|
| 1     | Certainly Not |
| 2     | Very Unlikely |
| 3     | Unlikely      |
| 4     | Neutral       |
| 5     | Likely        |
| 6     | Very Likely   |
| 7     | Certainly Yes |

7 = the property is **present** in leading 2024 LLMs. 1 = the property is **absent**.

---

*Based on DCM Paper (Shiller et al., 2026) · Powered by OpenRouter · Research use only*
