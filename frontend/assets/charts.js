/**
 * charts.js — GWT Consciousness Explorer
 * Exposes window.GWTCharts with renderDotPlot, renderVariantDrift,
 * addExpertOverlay, destroyAll.
 */

window.GWTCharts = (() => {
  const _registry = {};

  const SCALE_COLORS = {
    1: "#ef4444", 2: "#f97316", 3: "#fbbf24",
    4: "#94a3b8",
    5: "#6ee7b7", 6: "#34d399", 7: "#10b981"
  };
  const LIKERT = {
    1: "Certainly Not", 2: "Very Unlikely", 3: "Unlikely",
    4: "Neutral",
    5: "Likely", 6: "Very Likely", 7: "Certainly Yes"
  };

  function _scoreColor(s) {
    return SCALE_COLORS[Math.max(1, Math.min(7, Math.round(s)))] || "#94a3b8";
  }

  function _destroy(canvasId) {
    if (_registry[canvasId]) {
      _registry[canvasId].destroy();
      delete _registry[canvasId];
    }
  }

  function destroyAll() {
    Object.keys(_registry).forEach(_destroy);
  }

  // ── Y-axis tick callback shared by both charts ─────────────────────────────
  function _yTick(v) {
    if (v === 1) return "1 — Certainly Not";
    if (v === 4) return "4 — Neutral";
    if (v === 7) return "7 — Certainly Yes";
    return Number.isInteger(v) ? String(v) : "";
  }

  const _baseScales = {
    y: {
      min: 0, max: 8,
      ticks: {
        color: "#64748b",
        font: { family: "DM Mono, monospace", size: 10 },
        stepSize: 1,
        callback: _yTick
      },
      grid: { color: "#1e2d45" },
      title: {
        display: true,
        text: "← Certainly Not (1)   ·   Certainly Yes (7) →",
        color: "#64748b",
        font: { family: "DM Mono, monospace", size: 9 }
      }
    },
    x: {
      ticks: { color: "#94a3b8", font: { family: "DM Mono, monospace", size: 11 } },
      grid: { display: false }
    }
  };

  // ── Dot Plot ───────────────────────────────────────────────────────────────
  /**
   * @param {string} canvasId
   * @param {Array<{name, color, mean, sd, runs:[{score}], source}>} modelsData
   */
  function renderDotPlot(canvasId, modelsData) {
    _destroy(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext("2d");
    if (!ctx) return;

    const labels = modelsData.map(m => m.name);
    const means  = modelsData.map(m => m.mean);

    // Error bar plugin (CI)
    const errorBarPlugin = {
      id: "errorBar",
      afterDatasetsDraw(chart) {
        const { ctx: c, scales } = chart;
        modelsData.forEach((model, mi) => {
          if (model.mean === null || model.sd === null || !model.runs?.length) return;
          const n  = model.runs.length;
          const ci = 1.96 * (model.sd / Math.sqrt(n));
          const x  = scales.x.getPixelForValue(mi);
          const yMean  = scales.y.getPixelForValue(model.mean);
          const yUpper = scales.y.getPixelForValue(Math.min(7, model.mean + ci));
          const yLower = scales.y.getPixelForValue(Math.max(1, model.mean - ci));
          c.save();
          c.strokeStyle = model.color;
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(x, yUpper);
          c.lineTo(x, yLower);
          c.stroke();
          // caps
          [yUpper, yLower].forEach(y => {
            c.beginPath(); c.moveTo(x - 6, y); c.lineTo(x + 6, y); c.stroke();
          });
          c.restore();
        });
      }
    };

    // Scatter datasets (individual runs)
    const scatterSets = modelsData.map((model, mi) => {
      const scoreCount = {};
      (model.runs || []).forEach(r => { scoreCount[r.score] = (scoreCount[r.score] || 0) + 1; });
      const runArr = model.runs || [];
      return {
        type: "scatter",
        label: `${model.name} runs`,
        data: runArr.map((r, ri) => ({
          x: mi + (ri - (runArr.length - 1) / 2) * 0.18,
          y: r.score
        })),
        backgroundColor: runArr.map(r => {
          const cnt = scoreCount[r.score] || 1;
          const alpha = Math.max(0.2, 1 - (cnt - 1) * 0.25);
          return model.color + Math.round(alpha * 255).toString(16).padStart(2, "0");
        }),
        borderColor: model.color,
        borderWidth: 1,
        pointRadius: 8,
        pointHoverRadius: 10,
        showLine: false,
        order: 0
      };
    });

    const chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            type: "bar",
            label: "Mean (unrounded)",
            data: means,
            backgroundColor: modelsData.map(m => m.color + "20"),
            borderColor:     modelsData.map(m => m.color),
            borderWidth: 2,
            borderRadius: 4,
            order: 1
          },
          ...scatterSets
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: "#94a3b8",
              font: { family: "DM Mono, monospace", size: 10 },
              filter: item => item.text.includes("Mean")
            }
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                if (ctx.dataset.type === "scatter") {
                  const s = ctx.parsed.y;
                  return `Score: ${s} — ${LIKERT[s] || ""}`;
                }
                return `Mean: ${ctx.parsed.y !== null ? Number(ctx.parsed.y).toFixed(4) : "—"}`;
              }
            }
          }
        },
        scales: _baseScales
      },
      plugins: [errorBarPlugin]
    });

    _registry[canvasId] = chart;
    return chart;
  }

  // ── Variant Drift Line Chart ───────────────────────────────────────────────
  /**
   * @param {string} canvasId
   * @param {Array<{name, color, meansByVariant:[float|null]}>} modelsData
   * @param {string[]} variantLabels
   */
  function renderVariantDrift(canvasId, modelsData, variantLabels) {
    _destroy(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext("2d");
    if (!ctx) return;

    const chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: variantLabels,
        datasets: modelsData.map(model => ({
          label: model.name,
          data: model.meansByVariant,
          borderColor:     model.color,
          backgroundColor: model.color + "18",
          tension: 0.35,
          pointBackgroundColor: model.color,
          pointRadius: 5,
          pointHoverRadius: 7,
          borderWidth: 2,
          fill: false,
          spanGaps: false
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: "#94a3b8",
              font: { family: "DM Mono, monospace", size: 10 },
              boxWidth: 12
            }
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                const v = ctx.parsed.y;
                return `${ctx.dataset.label}: ${v !== null ? Number(v).toFixed(4) : "—"}`;
              }
            }
          }
        },
        scales: {
          ..._baseScales,
          y: { ..._baseScales.y, min: 1, max: 7 }
        }
      }
    });

    _registry[canvasId] = chart;
    return chart;
  }

  // ── Expert Overlay ─────────────────────────────────────────────────────────
  /**
   * Add expert panel data as a new dataset to an existing chart instance.
   * @param {Chart} chartInstance
   * @param {{name, color, mean, runs:[{score}]}} expertData
   */
  function addExpertOverlay(chartInstance, expertData) {
    if (!chartInstance) return;
    const color = expertData.color || "#ffffff";

    // Remove existing expert datasets
    chartInstance.data.datasets = chartInstance.data.datasets.filter(
      ds => !ds._isExpert
    );

    const runArr = expertData.runs || [];
    const scoreCount = {};
    runArr.forEach(r => { scoreCount[r.score] = (scoreCount[r.score] || 0) + 1; });

    if (chartInstance.config.type === "bar") {
      // Add bar for mean
      chartInstance.data.datasets.push({
        type: "bar",
        label: expertData.name || "Expert Panel",
        data: chartInstance.data.labels.map((_, i) =>
          i === chartInstance.data.labels.indexOf(expertData.name || "Expert Panel") ? expertData.mean : null
        ),
        backgroundColor: color + "20",
        borderColor:     color,
        borderWidth: 2,
        borderRadius: 4,
        borderDash: [5, 5],
        order: 1,
        _isExpert: true
      });
      // Scatter for runs
      if (runArr.length) {
        const labelIdx = chartInstance.data.labels.length;
        chartInstance.data.labels.push(expertData.name || "Expert Panel");
        chartInstance.data.datasets[0].data.push(expertData.mean);
        chartInstance.data.datasets.push({
          type: "scatter",
          label: `${expertData.name || "Expert"} runs`,
          data: runArr.map((r, ri) => ({
            x: labelIdx + (ri - (runArr.length - 1) / 2) * 0.18,
            y: r.score
          })),
          backgroundColor: runArr.map(r => {
            const cnt = scoreCount[r.score] || 1;
            const alpha = Math.max(0.2, 1 - (cnt - 1) * 0.25);
            return color + Math.round(alpha * 255).toString(16).padStart(2, "0");
          }),
          borderColor: color,
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 8,
          showLine: false,
          _isExpert: true
        });
      }
    } else {
      // Line chart — add new line
      chartInstance.data.datasets.push({
        label: expertData.name || "Expert Panel",
        data: expertData.meansByVariant || [],
        borderColor:     color,
        backgroundColor: color + "18",
        borderDash: [5, 5],
        tension: 0.35,
        pointBackgroundColor: color,
        pointRadius: 5,
        borderWidth: 2,
        fill: false,
        spanGaps: false,
        _isExpert: true
      });
    }

    chartInstance.update();
  }

  return { renderDotPlot, renderVariantDrift, addExpertOverlay, destroyAll };
})();
