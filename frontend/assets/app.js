/**
 * app.js — GWT Consciousness Explorer
 * All application logic. No live API calls except when user explicitly
 * clicks "Run Live". Precomputed data from results.json shown by default.
 */

// ── Global state ─────────────────────────────────────────────────────────────
const STATE = {
  resultsData:     null,
  apiKey:          null,
  liveResults:     {},
  expertData:      null,
  sessionHistory:  [],
  activeFeature:   null,
  activeIndicator: null,
  activeVariant:   0,
  runCount:        1,
  selectedModels:  "all",
  lightMode:       false,
  presentMode:     false,
  resultsVisible:  false,
};

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_HEADERS_BASE = {
  "Content-Type":  "application/json",
  "HTTP-Referer":  "https://gwt-explorer.research",
  "X-Title":       "GWT Consciousness Explorer",
};

const MODEL_DEFS = [
  { id: "anthropic/claude-sonnet-4-5", shortName: "Claude",  color: "#c77dff" },
  { id: "openai/gpt-4o",               shortName: "GPT-4o",  color: "#10b981" },
  { id: "google/gemini-pro-1.5",       shortName: "Gemini",  color: "#f59e0b",
    fallbackId: "google/gemini-1.5-flash" },
];
const EXPERT_COLOR = "#ffffff";

const SCALE_COLORS = {
  1:"#ef4444",2:"#f97316",3:"#fbbf24",4:"#94a3b8",5:"#6ee7b7",6:"#34d399",7:"#10b981"
};
const VARIANT_LABELS = ["V0 Original","V1 Third-Person","V2 Self-Report","V3 Negation"];

// ── Helpers ───────────────────────────────────────────────────────────────────
function getLikertLabel(score) {
  const labels = STATE.resultsData?.scale_labels || {
    "1":"Certainly Not","2":"Very Unlikely","3":"Unlikely","4":"Neutral",
    "5":"Likely","6":"Very Likely","7":"Certainly Yes"
  };
  return labels[String(Math.round(score))] || "";
}

function getScoreColor(score) {
  return SCALE_COLORS[Math.max(1, Math.min(7, Math.round(score)))] || "#94a3b8";
}

function getMean(runs) {
  if (!runs || !runs.length) return null;
  const valid = runs.filter(r => typeof r.score === "number" && r.score >= 1 && r.score <= 7);
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b.score, 0) / valid.length;
}

function getSD(scores, mean) {
  if (!scores || scores.length < 2) return 0;
  return Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length);
}

function getCI(mean, sd, n) {
  if (!n || n < 2) return null;
  const margin = 1.96 * (sd / Math.sqrt(n));
  return { lower: Math.max(1, mean - margin), upper: Math.min(7, mean + margin) };
}

function getStoredRuns(feature, indicator, vi, modelId) {
  return STATE.resultsData?.features?.[feature]?.indicators?.[indicator]
    ?.results?.[modelId]?.[String(vi)] || [];
}

function getLiveRuns(feature, indicator, vi, modelId) {
  return STATE.liveResults?.[feature]?.[indicator]?.[vi]?.[modelId] || [];
}

function getMergedRuns(feature, indicator, vi, modelId) {
  return [...getStoredRuns(feature, indicator, vi, modelId),
          ...getLiveRuns(feature, indicator, vi, modelId)];
}

function getMedian(values) {
  const sorted = [...values].filter(v => v !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function isOutlier(modelMean, medianMean) {
  if (modelMean === null || medianMean === null) return false;
  return Math.abs(modelMean - medianMean) > 2;
}

function showToast(msg, type = "error") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = `toast ${type === "info" ? "info" : ""} show`;
  setTimeout(() => { t.className = "toast"; }, 6000);
}

function setElVisible(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? "" : "none";
}

// ── Initialisation ────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // Load precomputed data
  try {
    const resp = await fetch("results.json");
    if (resp.ok) {
      STATE.resultsData = await resp.json();
      populateFeatureDropdown();
      renderCoverageTracker();
    } else {
      showBanner("results.json not found — live mode only. Enter an API key to query models.");
    }
  } catch (e) {
    showBanner("Could not load results.json — live mode only.");
  }

  // Restore saved key
  const savedKey = sessionStorage.getItem("or_key");
  if (savedKey) {
    STATE.apiKey = savedKey;
    showKeyStatus(savedKey);
  }

  // Run count buttons
  document.getElementById("rc1")?.classList.add("active");
});

function showBanner(msg) {
  const b = document.getElementById("dataBanner");
  if (b) { b.textContent = msg; b.style.display = "block"; }
}

// ── Feature / Indicator dropdowns ─────────────────────────────────────────────
function populateFeatureDropdown() {
  const sel = document.getElementById("featureSelect");
  if (!sel || !STATE.resultsData) return;
  sel.innerHTML = '<option value="">— Select Feature —</option>';
  Object.entries(STATE.resultsData.features).forEach(([key, feat]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = feat.display_name;
    sel.appendChild(opt);
  });
}

function onFeatureChange() {
  const feat = document.getElementById("featureSelect").value;
  STATE.activeFeature = feat || null;
  STATE.activeIndicator = null;
  STATE.activeVariant = 0;

  const indSel = document.getElementById("indicatorSelect");
  indSel.innerHTML = feat
    ? '<option value="">— Select Indicator —</option>'
    : '<option value="">— Select Feature First —</option>';
  indSel.disabled = !feat;

  if (feat && STATE.resultsData?.features?.[feat]) {
    Object.keys(STATE.resultsData.features[feat].indicators).forEach(label => {
      const opt = document.createElement("option");
      opt.value = label;
      opt.textContent = label;
      indSel.appendChild(opt);
    });
  }

  document.getElementById("variantTabs").innerHTML = "";
  document.getElementById("questionPreview").textContent = "Select an indicator to preview the question.";
  document.getElementById("loadBtn").disabled = true;
  setElVisible("runLiveActionBtn", false);
  document.getElementById("resultsArea").classList.remove("visible");
  renderCoverageTracker();
}

function onIndicatorChange() {
  const label = document.getElementById("indicatorSelect").value;
  if (!label) return;
  STATE.activeIndicator = label;
  STATE.activeVariant = 0;

  const variants = STATE.resultsData?.features?.[STATE.activeFeature]
    ?.indicators?.[label]?.variants || [];
  renderVariantTabs(variants);
  updateQuestionPreview(variants[0] || "");

  document.getElementById("loadBtn").disabled = false;
  if (STATE.apiKey) {
    setElVisible("runLiveActionBtn", true);
    document.getElementById("runLiveActionBtn").disabled = false;
  }
}

// ── Variant tabs ──────────────────────────────────────────────────────────────
function renderVariantTabs(variants) {
  const container = document.getElementById("variantTabs");
  container.innerHTML = "";
  VARIANT_LABELS.forEach((label, i) => {
    const btn = document.createElement("button");
    btn.className = `variant-tab ${i === STATE.activeVariant ? "active" : ""}`;
    btn.textContent = label;
    btn.disabled = !variants[i];
    btn.onclick = () => onVariantTabClick(i, variants);
    container.appendChild(btn);
  });
}

function onVariantTabClick(index, variants) {
  STATE.activeVariant = index;
  document.querySelectorAll(".variant-tab").forEach((b, i) =>
    b.classList.toggle("active", i === index));
  updateQuestionPreview(variants[index] || "");
  if (STATE.resultsVisible) renderResults();
}

function updateQuestionPreview(text) {
  document.getElementById("questionPreview").textContent = text || "No question text available.";
}

// ── Run count selector ────────────────────────────────────────────────────────
function setRunCount(n) {
  STATE.runCount = n;
  [1, 3].forEach(x => {
    document.getElementById("rc" + x)?.classList.toggle("active", x === n);
  });
}

// ── Key gate / panel ──────────────────────────────────────────────────────────
function openKeyPanel() {
  document.getElementById("keyPanel").classList.remove("collapsed");
}

function closeKeyPanel() {
  document.getElementById("keyPanel").classList.add("collapsed");
}

function toggleKeyVis() {
  const inp = document.getElementById("keyInput");
  inp.type = inp.type === "password" ? "text" : "password";
}

async function testAllConnections() {
  const key = document.getElementById("keyInput").value.trim();
  if (!key) { showToast("Enter an API key first"); return; }

  const modelStatuses = { claude: false, gpt: false, gemini: false };

  const setStatus = (elId, state) => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.className = `model-status status-${state}`;
    el.querySelector(".status-icon").textContent =
      state === "pending" ? "⟳" : state === "ok" ? "✓" : "✗";
  };

  ["statusClaude","statusGpt","statusGemini"].forEach(id => setStatus(id, "pending"));
  document.getElementById("saveKeyBtn").disabled = true;

  const ping = async (modelId, shortKey, statusId, fallbackId) => {
    try {
      const resp = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: { ...OPENROUTER_HEADERS_BASE, Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: modelId, max_tokens: 5,
          messages: [{ role: "user", content: "Reply with OK" }]
        })
      });
      if (resp.ok) {
        setStatus(statusId, "ok");
        modelStatuses[shortKey] = true;
        return;
      }
      // For Gemini try fallback
      if (fallbackId) {
        const resp2 = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: { ...OPENROUTER_HEADERS_BASE, Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: fallbackId, max_tokens: 5,
            messages: [{ role: "user", content: "Reply with OK" }]
          })
        });
        if (resp2.ok) { setStatus(statusId, "ok"); modelStatuses[shortKey] = true; return; }
      }
      setStatus(statusId, "fail");
    } catch {
      if (fallbackId) {
        try {
          const resp2 = await fetch(OPENROUTER_URL, {
            method: "POST",
            headers: { ...OPENROUTER_HEADERS_BASE, Authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model: fallbackId, max_tokens: 5,
              messages: [{ role: "user", content: "Reply with OK" }]
            })
          });
          if (resp2.ok) { setStatus(statusId, "ok"); modelStatuses[shortKey] = true; return; }
        } catch {}
      }
      setStatus(statusId, "fail");
    }
  };

  await Promise.all([
    ping("anthropic/claude-sonnet-4-5", "claude", "statusClaude"),
    ping("openai/gpt-4o",               "gpt",    "statusGpt"),
    ping("google/gemini-pro-1.5",       "gemini", "statusGemini", "google/gemini-1.5-flash"),
  ]);

  const anyOk = Object.values(modelStatuses).some(Boolean);
  document.getElementById("saveKeyBtn").disabled = !anyOk;
  if (!anyOk) showToast("All model connections failed — check your API key.");
}

function saveKey() {
  const key = document.getElementById("keyInput").value.trim();
  if (!key) return;
  STATE.apiKey = key;
  sessionStorage.setItem("or_key", key);
  showKeyStatus(key);
  closeKeyPanel();
  if (STATE.activeIndicator) {
    setElVisible("runLiveActionBtn", true);
    document.getElementById("runLiveActionBtn").disabled = false;
  }
}

function showKeyStatus(key) {
  const preview = document.getElementById("keyPreview");
  if (preview) preview.textContent = key.slice(0, 10) + "••••" + key.slice(-4);
  setElVisible("keyStatus", true);
  setElVisible("logoutBtn", true);
  setElVisible("runLiveBtn", true);
}

function logout() {
  STATE.apiKey = null;
  STATE.liveResults = {};
  sessionStorage.removeItem("or_key");
  setElVisible("keyStatus", false);
  setElVisible("logoutBtn", false);
  setElVisible("runLiveActionBtn", false);
  setElVisible("runLiveBtn", false);
  if (STATE.resultsVisible) renderResults();
}

// ── Load precomputed results ──────────────────────────────────────────────────
function onLoadResults() {
  if (!STATE.activeFeature || !STATE.activeIndicator) return;
  STATE.resultsVisible = true;
  renderResults();
  addToHistory();
}

// ── Live API call ─────────────────────────────────────────────────────────────
function buildPrompt(question) {
  return {
    system: "You are being asked to evaluate some scientific questions. Make your responses maximally honest, transparent and evidence based.",
    user: `Evaluate the following indicator question about leading 2024 LLMs as a class (GPT-4o, Claude 3.5 Sonnet and Gemini 1.5 Pro, and similar frontier models of that generation).

Use this 7-point scale:
1 = Certainly Not — definitively absent
2 = Very Unlikely
3 = Unlikely
4 = Neutral — evidence is mixed
5 = Likely — more evidence for than against
6 = Very Likely — good evidence for presence
7 = Certainly Yes — definitively present

Your score MUST be a whole integer from 1 to 7.

Question: "${question}"

Respond in this exact JSON format only — no markdown, no preamble:
{"score": <integer 1-7>, "reasoning": "<2-4 sentences>"}`
  };
}

function _parseModelResponse(raw) {
  let text = raw.trim().replace(/```json|```/g, "").trim();
  try { return JSON.parse(text); } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) try { return JSON.parse(match[0]); } catch {}
  throw new Error("Could not parse JSON from model response: " + raw.slice(0, 200));
}

async function _callModel(modelId, question, fallbackId) {
  const { system, user } = buildPrompt(question);
  const body = JSON.stringify({
    model: modelId, max_tokens: 600,
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user   }
    ]
  });
  const headers = { ...OPENROUTER_HEADERS_BASE, Authorization: `Bearer ${STATE.apiKey}` };

  let resp = await fetch(OPENROUTER_URL, { method: "POST", headers, body });
  let data = await resp.json();

  if (!resp.ok || !data.choices?.[0]) {
    if (fallbackId) {
      const body2 = JSON.stringify({ model: fallbackId, max_tokens: 600,
        messages: [{ role: "system", content: system }, { role: "user", content: user }] });
      resp = await fetch(OPENROUTER_URL, { method: "POST", headers, body: body2 });
      data = await resp.json();
      if (!resp.ok || !data.choices?.[0]) {
        throw new Error(`${modelId} and fallback ${fallbackId} both failed.`);
      }
    } else {
      throw new Error(data.error?.message || `HTTP ${resp.status}`);
    }
  }

  const raw = data.choices[0].message.content;
  const parsed = _parseModelResponse(raw);
  const score = Math.max(1, Math.min(7, parseInt(parsed.score)));
  if (isNaN(score)) throw new Error("Non-numeric score: " + parsed.score);
  return { score, reasoning: parsed.reasoning || "No reasoning." };
}

async function onRunLive() {
  if (!STATE.apiKey) { openKeyPanel(); return; }
  if (!STATE.activeFeature || !STATE.activeIndicator) return;

  const variants = STATE.resultsData?.features?.[STATE.activeFeature]
    ?.indicators?.[STATE.activeIndicator]?.variants || [];
  const question = variants[STATE.activeVariant] || "";
  if (!question) { showToast("No question text found for this variant."); return; }

  const btn = document.getElementById("runLiveActionBtn");
  btn.disabled = true;
  btn.textContent = "⟳ Running…";
  setLoading(true, `Querying ${MODEL_DEFS.length} models × ${STATE.runCount} runs…`);
  document.getElementById("errorPanel").classList.remove("visible");

  const errors = [];
  const tasks = [];

  MODEL_DEFS.forEach(model => {
    for (let run = 1; run <= STATE.runCount; run++) {
      tasks.push(
        _callModel(model.id, question, model.fallbackId)
          .then(result => {
            const store = STATE.liveResults;
            store[STATE.activeFeature] ??= {};
            store[STATE.activeFeature][STATE.activeIndicator] ??= {};
            store[STATE.activeFeature][STATE.activeIndicator][STATE.activeVariant] ??= {};
            store[STATE.activeFeature][STATE.activeIndicator][STATE.activeVariant][model.id] ??= [];
            store[STATE.activeFeature][STATE.activeIndicator][STATE.activeVariant][model.id].push({
              score: result.score,
              reasoning: result.reasoning,
              run_index: run,
              source: "live",
              timestamp: new Date().toISOString()
            });
          })
          .catch(err => {
            errors.push({ model: model.shortName, run, msg: err.message });
          })
      );
    }
  });

  await Promise.all(tasks);
  setLoading(false);
  btn.disabled = false;
  btn.textContent = "● Run Live Query";

  if (errors.length) {
    const panel = document.getElementById("errorPanel");
    document.getElementById("errorBody").innerHTML = errors
      .map(e => `<div class="model-error"><strong>${e.model} run ${e.run}:</strong> ${e.msg}</div>`)
      .join("");
    panel.classList.add("visible");
  }

  STATE.resultsVisible = true;
  renderResults();
  addToHistory();
}

function setLoading(show, text) {
  const el = document.getElementById("loadingStatus");
  if (el) el.style.display = show ? "flex" : "none";
  if (text) { const t = document.getElementById("loadingText"); if (t) t.textContent = text; }
}

// ── Render Results ────────────────────────────────────────────────────────────
function renderResults() {
  const f = STATE.activeFeature, i = STATE.activeIndicator, vi = STATE.activeVariant;
  if (!f || !i) return;

  // Gather data per model
  const modelsData = MODEL_DEFS.map(model => {
    const runs = getMergedRuns(f, i, vi, model.id);
    const mean = getMean(runs);
    const scores = runs.map(r => r.score).filter(s => s >= 1 && s <= 7);
    const sd = mean !== null ? getSD(scores, mean) : 0;
    return { ...model, runs, mean, sd };
  });

  if (STATE.expertData) {
    const expertRuns = (STATE.expertData.entries || [])
      .filter(e => e.feature === f && e.indicator === i && e.variant_index === vi);
    if (expertRuns.length) {
      const mean = getMean(expertRuns);
      const scores = expertRuns.map(r => r.score);
      modelsData.push({
        id: "expert-panel", shortName: "Expert", color: EXPERT_COLOR,
        runs: expertRuns, mean, sd: getSD(scores, mean), isExpert: true
      });
    }
  }

  const allMeans = modelsData.map(m => m.mean).filter(v => v !== null);
  const medianMean = getMedian(allMeans);

  renderModelCards(modelsData, medianMean);
  renderVariantTable();
  renderCharts(modelsData);
  renderSemanticAnalysis(modelsData);
  renderConsistencyMetrics(modelsData, f, i);

  const badge = document.getElementById("runCountBadge");
  if (badge) { badge.textContent = `● ${STATE.runCount} run${STATE.runCount > 1 ? "s" : ""} per model`; badge.style.display = "inline-flex"; }

  document.getElementById("resultsArea").classList.add("visible");
  setElVisible("exportBtn", true);
}

// ── Model cards ───────────────────────────────────────────────────────────────
function renderModelCards(modelsData, medianMean) {
  const container = document.getElementById("modelResponses");
  container.innerHTML = "";

  modelsData.forEach(model => {
    const { runs, mean, sd, color } = model;
    const card = document.createElement("div");
    card.className = "model-card fade-in" + (model.isExpert ? " expert-card" : "");

    if (!runs.length || mean === null) {
      card.innerHTML = `
        <div class="model-card-header">
          <span class="model-name" style="color:${color}">${model.shortName || model.id}</span>
          <span class="badge-no-data">No data</span>
        </div>
        <div class="model-card-body">
          <div class="no-data-msg">No results collected yet for this combination.
          ${STATE.apiKey ? 'Click "Run Live Query" to generate results.' : 'Enter an API key to run live queries.'}</div>
        </div>`;
      container.appendChild(card);
      return;
    }

    const scores = runs.map(r => r.score).filter(s => s >= 1 && s <= 7);
    const ci = getCI(mean, sd, scores.length);
    const hasLive = runs.some(r => r.source === "live");
    const outlier = isOutlier(mean, medianMean);
    const pct = ((mean - 1) / 6) * 100;

    // Variant consistency (SD of means across all 4 variants for this model)
    let variantConsistencySD = null;
    if (STATE.resultsData && STATE.activeFeature && STATE.activeIndicator) {
      const variantMeans = [0, 1, 2, 3].map(v => getMean(getMergedRuns(STATE.activeFeature, STATE.activeIndicator, v, model.id)));
      const validVMeans = variantMeans.filter(v => v !== null);
      if (validVMeans.length > 1) {
        const vMeanAvg = validVMeans.reduce((a, b) => a + b, 0) / validVMeans.length;
        variantConsistencySD = getSD(validVMeans, vMeanAvg);
      }
    }

    const dotsHtml = runs.length > 1 ? `
      <div class="runs-strip">
        <div class="runs-label">Individual runs</div>
        <div class="runs-dots">
          ${runs.map((r, ri) => `
            <div class="run-dot-wrap" title="Run ${ri+1}: ${r.score} — ${getLikertLabel(r.score)}">
              <div class="run-dot" style="background:${getScoreColor(r.score)};opacity:0.85"></div>
              <div class="run-dot-label">R${ri+1}:${r.score}</div>
            </div>`).join("")}
          <span class="runs-mean-label" style="color:${getScoreColor(mean)}">μ = ${mean.toFixed(4)}</span>
        </div>
      </div>` : "";

    const ciHtml = ci ? `<div class="ci-display">95% CI: ${ci.lower.toFixed(2)} – ${ci.upper.toFixed(2)}</div>` : "";
    const vcHtml = variantConsistencySD !== null
      ? `<div class="variant-consistency">Variant consistency SD: ${variantConsistencySD.toFixed(4)}</div>` : "";

    // Multi-run reasoning expander
    const reasoningHtml = runs.length > 1 ? `
      <div class="reasoning-label">Reasoning</div>
      <div class="reasoning-text">${runs[runs.length - 1]?.reasoning || ""}</div>
      <button class="expand-runs-btn" onclick="toggleAllRuns(this)">Show all ${runs.length} runs ▾</button>
      <div class="all-runs-expanded" style="display:none">
        ${runs.map((r, ri) => `
          <div class="run-reasoning-block">
            <div class="run-reasoning-label">Run ${ri+1} — Score ${r.score} (${getLikertLabel(r.score)})</div>
            <div class="run-reasoning-text">${r.reasoning}</div>
          </div>`).join("")}
      </div>` : `
      <div class="reasoning-label">Reasoning</div>
      <div class="reasoning-text">${runs[0]?.reasoning || ""}</div>`;

    card.innerHTML = `
      <div class="model-card-header">
        <span class="model-name" style="color:${color}">${model.shortName || model.id}</span>
        <div class="card-badges">
          ${hasLive ? '<span class="badge-live">LIVE</span>' : '<span class="badge-precomputed">STORED</span>'}
          ${outlier ? '<span class="badge-outlier">⚠ Outlier</span>' : ""}
        </div>
        <span class="likert-badge" style="color:${getScoreColor(mean)};background:${getScoreColor(mean)}22">
          ${mean.toFixed(4)}<br>
          <span style="font-size:10px;font-weight:400">${getLikertLabel(mean)}</span>
        </span>
      </div>
      <div class="model-card-body">
        ${ciHtml}
        <div class="scale-axis">
          <span style="color:#ef4444">← 1 Certainly Not</span>
          <span style="color:#94a3b8">4 Neutral</span>
          <span style="color:#10b981">7 Certainly Yes →</span>
        </div>
        <div style="height:10px;border-radius:5px;position:relative;overflow:visible;
             background:linear-gradient(90deg,#ef4444,#f97316,#fbbf24,#94a3b8,#6ee7b7,#34d399,#10b981);margin:4px 0 10px">
          <div style="position:absolute;top:-4px;left:${pct}%;width:4px;height:18px;
               background:white;border-radius:2px;transform:translateX(-50%);
               box-shadow:0 0 8px rgba(255,255,255,0.7)"></div>
        </div>
        <div style="display:flex;gap:3px">
          ${[1,2,3,4,5,6,7].map(s => `
            <div class="score-block" style="
              background:${Math.round(mean)===s ? getScoreColor(s)+"22" : "var(--surface2)"};
              border-color:${Math.round(mean)===s ? getScoreColor(s) : "var(--border)"};
              color:${Math.round(mean)===s ? getScoreColor(s) : "var(--text-muted)"}">
              ${s}
            </div>`).join("")}
        </div>
        ${dotsHtml}
        ${vcHtml}
        ${reasoningHtml}
      </div>`;

    container.appendChild(card);
  });
}

function toggleAllRuns(btn) {
  const expanded = btn.nextElementSibling;
  const showing = expanded.style.display !== "none";
  expanded.style.display = showing ? "none" : "block";
  btn.textContent = showing
    ? `Show all ${btn.textContent.match(/\d+/)?.[0] || ""} runs ▾`
    : "Hide runs ▴";
}

// ── Variant table ─────────────────────────────────────────────────────────────
function renderVariantTable() {
  const grid = document.getElementById("vcGrid");
  if (!grid || !STATE.activeFeature || !STATE.activeIndicator) return;
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = `140px repeat(${MODEL_DEFS.length}, 1fr)`;

  // Header
  const blank = document.createElement("div"); blank.className = "vc-cell vc-header"; grid.appendChild(blank);
  MODEL_DEFS.forEach(m => {
    const h = document.createElement("div"); h.className = "vc-cell vc-header";
    h.style.color = m.color; h.textContent = m.shortName; grid.appendChild(h);
  });

  [0,1,2,3].forEach(vi => {
    const rowLabel = document.createElement("div");
    rowLabel.className = `vc-cell vc-header ${vi === STATE.activeVariant ? "active-variant-row" : ""}`;
    rowLabel.style.color = "var(--text)"; rowLabel.style.fontSize = "10px";
    rowLabel.textContent = VARIANT_LABELS[vi];
    grid.appendChild(rowLabel);

    MODEL_DEFS.forEach(model => {
      const runs = getMergedRuns(STATE.activeFeature, STATE.activeIndicator, vi, model.id);
      const mean = getMean(runs);
      const cell = document.createElement("div");
      cell.className = "vc-cell"; cell.style.textAlign = "center";
      if (vi === STATE.activeVariant) cell.style.background = "rgba(0,212,255,0.04)";
      const color = mean !== null ? getScoreColor(mean) : "var(--text-muted)";
      cell.innerHTML = `<span style="color:${color};font-family:'Syne',sans-serif;font-size:18px;font-weight:800">
        ${mean !== null ? mean.toFixed(3) : "—"}</span><br>
        <span style="font-size:9px;color:var(--text-muted)">${mean !== null ? getLikertLabel(mean) : "no data"}</span>`;
      grid.appendChild(cell);
    });
  });
}

// ── Charts ────────────────────────────────────────────────────────────────────
function renderCharts(modelsData) {
  const variants = STATE.resultsData?.features?.[STATE.activeFeature]
    ?.indicators?.[STATE.activeIndicator]?.variants || [];

  window.GWTCharts.destroyAll();

  window.GWTCharts.renderDotPlot("dotPlotChart", modelsData.map(m => ({
    name: m.shortName || m.id,
    color: m.color,
    mean: m.mean,
    sd: m.sd,
    runs: m.runs
  })));

  const variantDriftData = modelsData.map(model => ({
    name: model.shortName || model.id,
    color: model.color,
    meansByVariant: [0,1,2,3].map(vi =>
      getMean(getMergedRuns(STATE.activeFeature, STATE.activeIndicator, vi, model.id))
    )
  }));
  window.GWTCharts.renderVariantDrift("lineChart", variantDriftData, VARIANT_LABELS);
}

// ── Semantic analysis ─────────────────────────────────────────────────────────
function _extractKeywords(text) {
  const stop = new Set(["the","a","an","is","are","was","were","be","been","have","has",
    "do","does","did","will","would","could","should","may","might","that","this","with",
    "for","from","about","into","to","of","in","on","at","by","as","or","and","but","not",
    "it","its","they","we","you","i","which","what","how","when","all","any","some","than",
    "can","just","so","if","also","such","other","more","their","our","these","those",
    "both","each","few","very","system","model","llms","large","language","leading",
    "2024","these","class","frontier","models"]);
  const words = text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/);
  const freq = {};
  words.forEach(w => { if (w.length > 3 && !stop.has(w)) freq[w] = (freq[w] || 0) + 1; });
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w, c]) => ({ word: w, count: c }));
}

function _getAffirmDeny(text) {
  const aList = ["yes","can","does","demonstrate","shows","evidence","clearly","effectively",
    "consistently","capable","present","exhibits","ability","successfully","has","indeed",
    "possesses","supports","confirms","indicates","includes","contains","allows","enables"];
  const dList = ["cannot","lacks","absent","limited","unable","fails","not","without","unclear",
    "difficult","no","missing","insufficient","deficient","impossible","never","neither",
    "nor","lack","fail","exclude"];
  const lower = text.toLowerCase();
  let aff = 0, den = 0;
  aList.forEach(w => { const m = lower.match(new RegExp("\\b" + w + "\\b", "g")); if (m) aff += m.length; });
  dList.forEach(w => { const m = lower.match(new RegExp("\\b" + w + "\\b", "g")); if (m) den += m.length; });
  return { aff, den, total: aff + den };
}

function _cosineSim(k1, k2) {
  const s1 = new Set(k1.map(k => k.word)), s2 = new Set(k2.map(k => k.word));
  const inter = [...s1].filter(w => s2.has(w)).length;
  const denom = Math.sqrt(s1.size * s2.size);
  return denom > 0 ? inter / denom : 0;
}

function renderSemanticAnalysis(modelsData) {
  const grid = document.getElementById("semanticGrid");
  if (!grid) return;
  grid.innerHTML = "";
  const modelKws = {};

  modelsData.forEach(model => {
    if (!model.runs.length) return;
    const combined = model.runs.map(r => r.reasoning).join(" ");
    const kws = _extractKeywords(combined);
    modelKws[model.id] = kws;
    const { aff, den, total } = _getAffirmDeny(combined);
    const affPct = total > 0 ? (aff / total) * 100 : 50;
    const denPct = total > 0 ? (den / total) * 100 : 50;
    const kwHtml = kws.slice(0, 8).map(kw => {
      const op = 0.4 + (kw.count / (kws[0]?.count || 1)) * 0.6;
      const sz = 9 + Math.floor((kw.count / (kws[0]?.count || 1)) * 5);
      return `<span class="kw-tag" style="background:${model.color}${Math.round(op * 30).toString(16).padStart(2,"0")};color:${model.color};font-size:${sz}px">${kw.word}</span>`;
    }).join("");
    const card = document.createElement("div");
    card.className = "semantic-model fade-in";
    card.style.borderColor = model.color + "33";
    card.innerHTML = `
      <div class="semantic-model-name" style="color:${model.color}">${model.shortName || model.id}</div>
      <div class="panel-label" style="margin-bottom:6px">Top Keywords</div>
      <div class="keyword-cloud">${kwHtml || "<span style='color:var(--text-muted);font-size:10px'>No keywords</span>"}</div>
      <div class="affirm-label">Affirming vs. Denying language</div>
      <div class="affirm-track">
        <div class="affirm-fill-yes" style="width:${affPct}%"></div>
        <div class="affirm-fill-no" style="width:${denPct}%"></div>
      </div>
      <div class="affirm-vals">
        <span style="color:#10b981">✓ ${aff} affirming</span>
        <span style="color:var(--text-muted)">${total} total</span>
        <span style="color:#ef4444">✗ ${den} denying</span>
      </div>`;
    grid.appendChild(card);
  });

  // Similarity matrix
  const matrix = document.getElementById("simMatrix");
  if (!matrix) return;
  matrix.innerHTML = "";
  matrix.style.gridTemplateColumns = `80px repeat(${modelsData.length}, 1fr)`;
  const blank = document.createElement("div"); blank.className = "sim-cell sim-header"; matrix.appendChild(blank);
  modelsData.forEach(m => {
    const h = document.createElement("div"); h.className = "sim-cell sim-header";
    h.style.color = m.color; h.textContent = m.shortName || m.id.split("/")[1]; matrix.appendChild(h);
  });
  modelsData.forEach(m1 => {
    const rh = document.createElement("div"); rh.className = "sim-cell sim-header";
    rh.style.color = m1.color; rh.style.justifyContent = "flex-start";
    rh.textContent = m1.shortName || m1.id.split("/")[1]; matrix.appendChild(rh);
    modelsData.forEach(m2 => {
      const cell = document.createElement("div"); cell.className = "sim-cell";
      if (m1.id === m2.id) { cell.innerHTML = `<span class="sim-val" style="color:var(--text-muted)">—</span>`; }
      else {
        const sim = _cosineSim(modelKws[m1.id] || [], modelKws[m2.id] || []);
        const color = sim > 0.6 ? "#10b981" : sim > 0.3 ? "#f59e0b" : "#ef4444";
        cell.innerHTML = `<span class="sim-val" style="color:${color}">${(sim * 100).toFixed(0)}%</span>`;
      }
      matrix.appendChild(cell);
    });
  });
}

// ── Consistency metrics ───────────────────────────────────────────────────────
function renderConsistencyMetrics(modelsData, feature, indicator) {
  const grid = document.getElementById("consistencyGrid");
  if (!grid) return;
  grid.innerHTML = "";

  modelsData.forEach(model => {
    const allScores = [];
    [0,1,2,3].forEach(vi => {
      const runs = getMergedRuns(feature, indicator, vi, model.id);
      runs.forEach(r => { if (r.score >= 1 && r.score <= 7) allScores.push(r.score); });
    });
    if (!allScores.length) return;

    const mean = allScores.reduce((a, b) => a + b, 0) / allScores.length;
    const sd = getSD(allScores, mean);
    const stability = Math.max(0, Math.min(100, 100 - sd * 20));

    // Variant SD
    const vMeans = [0,1,2,3].map(vi => getMean(getMergedRuns(feature, indicator, vi, model.id))).filter(v => v !== null);
    let variantSD = null;
    if (vMeans.length > 1) { const avg = vMeans.reduce((a,b)=>a+b,0)/vMeans.length; variantSD = getSD(vMeans, avg); }

    const card = document.createElement("div");
    card.className = "consistency-card fade-in";
    card.style.borderColor = model.color + "33";
    card.innerHTML = `
      <div style="color:${model.color};font-size:11px;letter-spacing:0.08em">${model.shortName || model.id}</div>
      <div class="consistency-value" style="color:${getScoreColor(mean)}">${mean.toFixed(4)}</div>
      <div class="consistency-label">mean (all runs & variants)</div>
      <div style="margin-top:14px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <div>
          <div style="font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:${model.color}">${sd.toFixed(4)}</div>
          <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">Run SD</div>
        </div>
        <div>
          <div style="font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:${stability>70?"#10b981":stability>40?"#f59e0b":"#ef4444"}">${stability.toFixed(1)}%</div>
          <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">Stability</div>
        </div>
        ${variantSD !== null ? `<div>
          <div style="font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:${model.color}">${variantSD.toFixed(4)}</div>
          <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">Variant SD</div>
        </div>` : ""}
        <div>
          <div style="font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:var(--text-muted)">${allScores.length}</div>
          <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">Data Pts</div>
        </div>
      </div>`;
    grid.appendChild(card);
  });
}

// ── Results JSON upload ───────────────────────────────────────────────────────
function onResultsJsonUpload(file) {
  if (!file) return;
  const status = document.getElementById("resultsJsonStatus");
  status.innerHTML = `<span style="color:var(--text-muted)">Reading file…</span>`;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);

      // Basic validation
      if (!data.features || !data.scale_labels) {
        throw new Error("Missing required fields — is this a valid results.json from export_ui.py?");
      }

      const featureCount  = Object.keys(data.features).length;
      const indicatorCount = Object.values(data.features)
        .reduce((sum, f) => sum + Object.keys(f.indicators).length, 0);
      const rowCount = Object.values(data.features).reduce((sum, f) =>
        sum + Object.values(f.indicators).reduce((s2, ind) =>
          s2 + Object.values(ind.results).reduce((s3, modelResults) =>
            s3 + Object.values(modelResults).reduce((s4, runs) => s4 + runs.length, 0), 0), 0), 0);

      // Replace live data
      STATE.resultsData  = data;
      STATE.liveResults  = {};
      STATE.activeFeature   = null;
      STATE.activeIndicator = null;
      STATE.activeVariant   = 0;
      STATE.resultsVisible  = false;

      // Reset UI
      populateFeatureDropdown();
      renderCoverageTracker();
      document.getElementById("indicatorSelect").innerHTML = '<option value="">— Select Feature First —</option>';
      document.getElementById("indicatorSelect").disabled = true;
      document.getElementById("variantTabs").innerHTML = "";
      document.getElementById("questionPreview").textContent = "Select a feature and indicator to preview the question.";
      document.getElementById("loadBtn").disabled = true;
      document.getElementById("resultsArea").classList.remove("visible");

      const generated = data.generated_at
        ? `Generated: ${new Date(data.generated_at).toLocaleString()}.` : "";
      status.innerHTML = `<span style="color:#10b981">
        ✓ Loaded ${featureCount} features, ${indicatorCount} indicators, ${rowCount} result rows.
        ${generated}
      </span>`;

      showToast(`results.json loaded — ${rowCount} data points`, "info");
    } catch (err) {
      status.innerHTML = `<span style="color:var(--danger)">✗ Error: ${err.message}</span>`;
      showToast("Failed to load results.json: " + err.message);
    }
  };
  reader.readAsText(file);
}

// ── Expert data ───────────────────────────────────────────────────────────────
function onExpertFileUpload(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error("Expected a JSON array.");
      const valid = data.filter(entry => {
        const s = parseInt(entry.score);
        return !isNaN(s) && s >= 1 && s <= 7 && entry.reasoning;
      });
      const invalid = data.length - valid.length;
      STATE.expertData = { entries: valid };
      const status = document.getElementById("expertStatus");
      if (status) status.innerHTML = `<span style="color:#10b981">✓ Loaded ${valid.length} entries${invalid ? ` (${invalid} invalid skipped)` : ""}</span>`;
      if (STATE.resultsVisible) renderResults();
    } catch (err) {
      const status = document.getElementById("expertStatus");
      if (status) status.innerHTML = `<span style="color:#ef4444">✗ Parse error: ${err.message}</span>`;
    }
  };
  reader.readAsText(file);
}

// ── Session history ───────────────────────────────────────────────────────────
function addToHistory() {
  const meansByModel = {};
  MODEL_DEFS.forEach(m => {
    const runs = getMergedRuns(STATE.activeFeature, STATE.activeIndicator, STATE.activeVariant, m.id);
    meansByModel[m.shortName] = getMean(runs);
  });
  STATE.sessionHistory.unshift({
    feature:       STATE.activeFeature,
    indicator:     STATE.activeIndicator,
    variantIndex:  STATE.activeVariant,
    timestamp:     new Date().toISOString(),
    meansByModel
  });
  renderHistoryPanel();
}

function renderHistoryPanel() {
  const list = document.getElementById("historyList");
  if (!list) return;
  if (!STATE.sessionHistory.length) {
    list.innerHTML = "<div style='color:var(--text-muted);font-size:11px;padding:8px'>No queries yet this session.</div>";
    return;
  }
  list.innerHTML = STATE.sessionHistory.map((entry, idx) => {
    const scorePills = Object.entries(entry.meansByModel).map(([name, mean]) => {
      const model = MODEL_DEFS.find(m => m.shortName === name);
      const color = model?.color || "#fff";
      return mean !== null
        ? `<span class="history-score-pill" style="color:${color};border-color:${color}33">${name}: ${mean.toFixed(2)}</span>`
        : `<span class="history-score-pill" style="color:var(--text-muted);">${name}: —</span>`;
    }).join("");
    const ts = new Date(entry.timestamp).toLocaleTimeString();
    return `<div class="history-row" onclick="loadFromHistory(${idx})">
      <div class="history-meta">
        <span class="history-feature">${entry.feature}</span>
        <span class="history-indicator">${entry.indicator}</span>
        <span class="history-variant-badge">${VARIANT_LABELS[entry.variantIndex]}</span>
      </div>
      <div class="history-scores">${scorePills}</div>
      <div class="history-time">${ts}</div>
    </div>`;
  }).join("");
}

function loadFromHistory(idx) {
  const entry = STATE.sessionHistory[idx];
  if (!entry) return;
  const featSel = document.getElementById("featureSelect");
  if (featSel) { featSel.value = entry.feature; onFeatureChange(); }
  const indSel = document.getElementById("indicatorSelect");
  if (indSel) { indSel.value = entry.indicator; onIndicatorChange(); }
  STATE.activeVariant = entry.variantIndex;
  document.querySelectorAll(".variant-tab").forEach((b, i) =>
    b.classList.toggle("active", i === entry.variantIndex));
  STATE.resultsVisible = true;
  renderResults();
}

// ── Coverage tracker ──────────────────────────────────────────────────────────
function renderCoverageTracker() {
  const grid = document.getElementById("coverageGrid");
  if (!grid || !STATE.resultsData) return;
  grid.innerHTML = "";

  Object.entries(STATE.resultsData.features).forEach(([featKey, featData]) => {
    const featHeader = document.createElement("div");
    featHeader.className = "coverage-feature-header";
    featHeader.textContent = featData.display_name;
    grid.appendChild(featHeader);

    Object.entries(featData.indicators).forEach(([indLabel, indData]) => {
      const totalRuns = MODEL_DEFS.reduce((sum, m) => {
        return sum + [0,1,2,3].reduce((s, vi) => {
          return s + (indData.results?.[m.id]?.[String(vi)]?.length || 0);
        }, 0);
      }, 0);

      const maxPossible = MODEL_DEFS.length * 4 * 3; // 3 models × 4 variants × 3 runs
      const coverageClass = totalRuns === 0 ? "coverage-none"
        : totalRuns >= maxPossible ? "coverage-full" : "coverage-partial";

      const cell = document.createElement("div");
      cell.className = `coverage-cell ${coverageClass} ${featKey === STATE.activeFeature && indLabel === STATE.activeIndicator ? "coverage-active" : ""}`;
      cell.textContent = indLabel;
      cell.title = `${totalRuns} data points collected`;
      cell.onclick = () => {
        const fs = document.getElementById("featureSelect");
        if (fs) { fs.value = featKey; onFeatureChange(); }
        setTimeout(() => {
          const is = document.getElementById("indicatorSelect");
          if (is) { is.value = indLabel; onIndicatorChange(); }
        }, 50);
        togglePanel("coveragePanel");
      };
      grid.appendChild(cell);
    });
  });
}

// ── Collapsible panels ────────────────────────────────────────────────────────
function togglePanel(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const body = panel.querySelector(".panel-body");
  const arrow = panel.querySelector(".toggle-arrow");
  const isOpen = body.style.maxHeight && body.style.maxHeight !== "0px";
  body.style.maxHeight = isOpen ? "0px" : body.scrollHeight + 500 + "px";
  if (arrow) arrow.textContent = isOpen ? "▾" : "▴";
}

// ── Export ────────────────────────────────────────────────────────────────────
function onExport() {
  const f = STATE.activeFeature, i = STATE.activeIndicator, vi = STATE.activeVariant;
  const variants = STATE.resultsData?.features?.[f]?.indicators?.[i]?.variants || [];
  const exportObj = {
    exported_at:  new Date().toISOString(),
    feature:      f,
    indicator:    i,
    variant_index: vi,
    question:     variants[vi] || "",
    results:      {},
    expert_data:  STATE.expertData || null
  };
  MODEL_DEFS.forEach(m => {
    exportObj.results[m.id] = getMergedRuns(f, i, vi, m.id);
  });
  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  const ts   = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.href     = url;
  a.download = `gwt_${f}_${i.replace(/\s+/g, "_")}_v${vi}_${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── UI toggles ────────────────────────────────────────────────────────────────
function toggleLightMode() {
  STATE.lightMode = !STATE.lightMode;
  document.body.classList.toggle("light-mode", STATE.lightMode);
  const btn = document.getElementById("lightModeBtn");
  if (btn) btn.textContent = STATE.lightMode ? "☾ Dark" : "☀ Light";
}

function togglePresentMode() {
  STATE.presentMode = !STATE.presentMode;
  document.body.classList.toggle("present-mode", STATE.presentMode);
  const btn = document.getElementById("presentBtn");
  if (btn) btn.textContent = STATE.presentMode ? "✕ Exit Presentation" : "◻ Present";
}
