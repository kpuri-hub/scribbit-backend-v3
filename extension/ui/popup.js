// ui/popup.js
// Scribbit Fairness Scanner - Browser Action Popup (Risk v2 UI)
//
// Shows:
// - Overall risk score & level
// - 4 tiny category bars (Financial, Data, Content, Legal)
// - Top 3 detected risks across categories
// - "No significant risks" state

(function () {
  const CATEGORY_ORDER = ["financial", "data_privacy", "content_ip", "legal_rights"];

  function categoryDisplayName(categoryId) {
    switch (categoryId) {
      case "financial":
        return "Financial Exposure";
      case "data_privacy":
        return "Personal Data & Privacy";
      case "content_ip":
        return "Content & Image Rights";
      case "legal_rights":
        return "Legal Rights & Control";
      default:
        return "Other";
    }
  }

  function categoryScoreToLevel(score) {
    if (score <= 0) return "none";
    if (score < 40) return "low";
    if (score < 70) return "med";
    return "high";
  }

  function severityOrderValue(sev) {
    if (!sev) return 99;
    const s = String(sev).toLowerCase();
    if (s === "high") return 0;
    if (s === "med" || s === "medium") return 1;
    if (s === "low") return 2;
    return 99;
  }

  function formatOverallSummary(result) {
    const score = typeof result.riskScore === "number" ? result.riskScore : 0;
    let level = "Low";
    if (score >= 70) level = "High";
    else if (score >= 40) level = "Medium";
    return {
      label: `Overall: ${level}`,
      scoreText: `(${Math.round(score)} / 100)`
    };
  }

  function pickTopRisks(risks, maxCount) {
    if (!Array.isArray(risks)) return [];
    const sorted = risks.slice().sort((a, b) => {
      return severityOrderValue(a.severity) - severityOrderValue(b.severity);
    });
    return sorted.slice(0, maxCount);
  }

  function renderCategories(container, result) {
    const categoryScores = result.categoryScores || {
      financial: 0,
      data_privacy: 0,
      content_ip: 0,
      legal_rights: 0
    };

    container.innerHTML = "";

    CATEGORY_ORDER.forEach((catId) => {
      const score = categoryScores[catId] || 0;
      const level = categoryScoreToLevel(score);
      const width = Math.max(0, Math.min(100, score));

      const row = document.createElement("div");
      row.className = "popup-category-row";

      const label = document.createElement("div");
      label.className = "popup-category-label";
      label.textContent = categoryDisplayName(catId);

      const barWrap = document.createElement("div");
      barWrap.className = "popup-category-bar";

      const barFill = document.createElement("div");
      barFill.className = "popup-category-bar-fill popup-category-bar-" + level;
      barFill.style.width = width + "%";

      barWrap.appendChild(barFill);
      row.appendChild(label);
      row.appendChild(barWrap);

      container.appendChild(row);
    });
  }

  function renderRisks(container, result) {
    const risks = Array.isArray(result.risks) ? result.risks : [];
    container.innerHTML = "";

    if (!risks.length || result.riskScore <= 0 || !result.hasMeaningfulContent) {
      const empty = document.createElement("div");
      empty.className = "popup-risks-empty";
      empty.textContent =
        "No significant risks detected on this page. For deeper detail, open the full terms or checkout screen.";
      container.appendChild(empty);
      return;
    }

    const topRisks = pickTopRisks(risks, 3);

    topRisks.forEach((risk) => {
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
      textWrap.className = "popup-risk-text";

      const title = document.createElement("div");
      title.className = "popup-risk-title";
      title.textContent = risk.title || risk.label || "Risk";

      const desc = document.createElement("div");
      desc.className = "popup-risk-description";

      // Prefer the model description; if missing, fall back to first evidence snippet.
      let description = risk.description || "";
      if (!description && Array.isArray(risk.evidence) && risk.evidence.length) {
        description = (risk.evidence[0] || "").trim();
      }
      if (!description) {
        description = "Scribbit flagged how this clause is written.";
      }

      desc.textContent = description;

      textWrap.appendChild(title);
      textWrap.appendChild(desc);

      item.appendChild(dot);
      item.appendChild(textWrap);

      container.appendChild(item);
    });
  }

  function renderFromResult(result) {
    const subtitleEl = document.getElementById("popup-subtitle");
    const overallLevelEl = document.getElementById("popup-overall-level");
    const overallScoreEl = document.getElementById("popup-overall-score");
    const categoriesEl = document.getElementById("popup-categories");
    const risksEl = document.getElementById("popup-risks");

    if (!result) {
      if (subtitleEl) {
        subtitleEl.textContent = "Waiting for Scribbit to scan this page…";
      }
      if (overallLevelEl) overallLevelEl.textContent = "Overall: –";
      if (overallScoreEl) overallScoreEl.textContent = "(0 / 100)";
      if (categoriesEl) categoriesEl.innerHTML = "";
      if (risksEl) {
        risksEl.innerHTML = "";
        const msg = document.createElement("div");
        msg.className = "popup-risks-empty";
        msg.textContent =
          "Scribbit hasn’t finished scanning this page yet. Try again in a moment.";
        risksEl.appendChild(msg);
      }
      return;
    }

    if (subtitleEl) {
      subtitleEl.textContent = "Scan complete";
    }

    const summary = formatOverallSummary(result);
    if (overallLevelEl) overallLevelEl.textContent = summary.label;
    if (overallScoreEl) overallScoreEl.textContent = summary.scoreText;

    if (categoriesEl) {
      renderCategories(categoriesEl, result);
    }

    if (risksEl) {
      renderRisks(risksEl, result);
    }
  }

  function fetchAnalysisForActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs.length) {
        renderFromResult(null);
        return;
      }

      const tab = tabs[0];

      // Ask background for the last known analysis for this tab.
      chrome.runtime.sendMessage(
        {
          type: "SCRIBBIT_POPUP_GET_STATE",
          tabId: tab.id
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn("[Scribbit] Popup message error:", chrome.runtime.lastError);
            renderFromResult(null);
            return;
          }

          if (!response || !response.ok || !response.riskResult) {
            renderFromResult(null);
            return;
          }

          renderFromResult(response.riskResult);
        }
      );
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    fetchAnalysisForActiveTab();
  });
})();
