// ui/popup.js
// Scribbit Fairness Scanner - Browser Action Popup (Risk v2 UI)
//
// Shows:
// - Overall risk level + score
// - 4 category bars (Financial, Data, Content, Legal)
// - Top 3 risks across all categories
// - "No significant risks" / "No scan yet" states
//
// It is fully data-driven and compatible with multiple risk cards per category.

(function () {
  const CATEGORY_ORDER = ["financial", "data_privacy", "content_ip", "legal_rights"];

  const CATEGORY_LABELS = {
    financial: "Financial",
    data_privacy: "Personal Data",
    content_ip: "Content & Image Rights",
    legal_rights: "Legal Rights"
  };

  // ----- Helpers ------------------------------------------------------------

  function severityFromScore(score) {
    if (typeof score !== "number") return "none";
    if (score >= 70) return "high";
    if (score >= 40) return "med";
    if (score > 0) return "low";
    return "none";
  }

  function severityLabelFromOverall(level) {
    const upper = String(level || "").toUpperCase();
    if (upper === "HIGH") return "High";
    if (upper === "MEDIUM") return "Medium";
    if (upper === "LOW") return "Low";
    return "Unknown";
  }

  function riskSeverityRank(risk) {
    const sev = String(risk.severity || "").toLowerCase();
    if (sev === "high") return 3;
    if (sev === "med" || sev === "medium") return 2;
    if (sev === "low") return 1;
    return 0;
  }

  function getRiskDescription(risk) {
    if (risk && risk.description) return risk.description;

    try {
      const model = window.ScribbitRiskModel;
      if (model && model.RISK_CARDS && risk && risk.id) {
        const card = model.RISK_CARDS[risk.id];
        if (card && card.defaultDescription) return card.defaultDescription;
      }
    } catch (e) {
      // ignore
    }

    if (risk && Array.isArray(risk.evidence) && risk.evidence.length > 0) {
      return risk.evidence[0];
    }

    return "No detailed explanation available.";
  }

  function normalizeRiskResult(maybe) {
    if (!maybe) return null;
    if (maybe.riskResult) return maybe.riskResult;
    if (maybe.risk) return maybe.risk;
    if (Array.isArray(maybe.risks) || maybe.categoryScores) return maybe;
    if (maybe.payload) return normalizeRiskResult(maybe.payload);
    return null;
  }

  // ----- DOM accessors ------------------------------------------------------

  function $(id) {
    return document.getElementById(id);
  }

  // ----- Rendering ----------------------------------------------------------

  function renderOverall(riskResult) {
    const subtitleEl = $("popup-subtitle");
    const levelEl = $("popup-overall-level");
    const scoreEl = $("popup-overall-score");

    if (!riskResult) {
      if (subtitleEl) subtitleEl.textContent = "No scan data yet for this page.";
      if (levelEl) levelEl.textContent = "Overall: –";
      if (scoreEl) scoreEl.textContent = "(0 / 100)";
      return;
    }

    const overallLevel = severityLabelFromOverall(riskResult.overallLevel);
    const riskScore =
      typeof riskResult.riskScore === "number" ? riskResult.riskScore : 0;

    if (subtitleEl) {
      subtitleEl.textContent = "Scribbit scanned this page for hidden risks.";
    }

    if (levelEl) {
      levelEl.textContent = `Overall: ${overallLevel}`;
    }

    if (scoreEl) {
      scoreEl.textContent = `(${riskScore} / 100)`;
    }
  }

  function renderCategories(riskResult) {
    const container = $("popup-categories");
    if (!container) return;

    container.innerHTML = "";

    const categoryScores = (riskResult && riskResult.categoryScores) || {};

    CATEGORY_ORDER.forEach((catId) => {
      const score = categoryScores[catId] || 0;
      const sev = severityFromScore(score);

      const row = document.createElement("div");
      row.className = "popup-category-row";

      const label = document.createElement("div");
      label.className = "popup-category-label";
      label.textContent = CATEGORY_LABELS[catId] || catId;

      const bar = document.createElement("div");
      bar.className = "popup-category-bar";

      const fill = document.createElement("div");
      fill.className = "popup-category-bar-fill";

      if (sev === "high") fill.classList.add("popup-category-bar-high");
      else if (sev === "med") fill.classList.add("popup-category-bar-med");
      else if (sev === "low") fill.classList.add("popup-category-bar-low");
      else fill.classList.add("popup-category-bar-none");

      const clamped = Math.max(0, Math.min(100, score));
      fill.style.width = `${clamped}%`;

      bar.appendChild(fill);
      row.appendChild(label);
      row.appendChild(bar);

      container.appendChild(row);
    });
  }

  function renderTopRisks(riskResult) {
    const container = $("popup-risks");
    if (!container) return;

    container.innerHTML = "";

    if (!riskResult || !Array.isArray(riskResult.risks) || riskResult.risks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "popup-risks-empty";
      empty.textContent = "No significant issues detected on this page so far.";
      container.appendChild(empty);
      return;
    }

    // Sort by severity, HIGH → MED → LOW, but don't assume 1 per category.
    const sorted = [...riskResult.risks].sort((a, b) => {
      return riskSeverityRank(b) - riskSeverityRank(a);
    });

    const top = sorted.slice(0, 3); // show top 3 for compact view

    top.forEach((risk) => {
      const item = document.createElement("div");
      item.className = "popup-risk-item";

      const dot = document.createElement("span");
      dot.className = "popup-risk-dot";

      const sev = String(risk.severity || "").toLowerCase();
      if (sev === "high") dot.classList.add("popup-risk-dot-high");
      else if (sev === "med" || sev === "medium")
        dot.classList.add("popup-risk-dot-med");
      else dot.classList.add("popup-risk-dot-low");

      const textWrap = document.createElement("div");

      const title = document.createElement("div");
      title.className = "popup-risk-title";
      title.textContent = risk.title || risk.label || "Untitled risk";

      const desc = document.createElement("div");
      desc.className = "popup-risk-description";
      desc.textContent = getRiskDescription(risk);

      textWrap.appendChild(title);
      textWrap.appendChild(desc);

      item.appendChild(dot);
      item.appendChild(textWrap);

      container.appendChild(item);
    });
  }

  function renderAll(riskResultRaw) {
    const riskResult = normalizeRiskResult(riskResultRaw);
    console.log("[Scribbit] Popup received riskResult:", riskResult);

    renderOverall(riskResult);
    renderCategories(riskResult);
    renderTopRisks(riskResult);
  }

  // ----- Messaging / bootstrap ---------------------------------------------

  function requestStateFromBackground() {
    if (!chrome || !chrome.tabs || !chrome.runtime) {
      console.warn("[Scribbit] Popup: chrome.* APIs not available.");
      renderAll(null);
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs && tabs[0];
      const tabId = activeTab ? activeTab.id : undefined;

      chrome.runtime.sendMessage(
        {
          type: "SCRIBBIT_POPUP_GET_STATE",
          tabId
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn(
              "[Scribbit] Popup: runtime error when requesting state:",
              chrome.runtime.lastError
            );
            renderAll(null);
            return;
          }

          if (!response || response.ok === false) {
            renderAll(null);
            return;
          }

          renderAll(response);
        }
      );
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    requestStateFromBackground();
  });
})();
