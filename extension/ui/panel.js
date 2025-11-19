// ui/panel.js
// Scribbit Fairness Scanner - On-page Panel (Risk v2 UI)
//
// Behaviour:
// - Only shows if there is at least 1 risk overall
// - ALWAYS renders all 4 categories (Financial, Data, Content, Legal)
// - Each category shows: name, severity level, bar, and # of issues
// - Clicking a category header toggles expand/collapse
// - Each risk card shows title + "Why is this risky?" tooltip with description
// - UI is fully data-driven: no hardcoded card IDs
//
// It consumes the Risk Engine result object:
//   {
//     risks: [ { id, category, title, description, severity, evidence?, ... }, ... ],
//     categoryScores: { financial, data_privacy, content_ip, legal_rights },
//     riskScore,
//     overallLevel,
//     hasMeaningfulContent,
//     pageMode
//   }
//
// Messaging:
//   - On load, asks background for current risk via ScribbitMessaging.requestCurrentRisk()
//   - Subscribes to live updates via ScribbitMessaging.onRiskUpdated()

(function () {
  const PANEL_ID = "scribbit-fairness-panel";

  const CATEGORY_ORDER = ["financial", "data_privacy", "content_ip", "legal_rights"];

  const CATEGORY_LABELS = {
    financial: "Financial Exposure",
    data_privacy: "Personal Data & Privacy",
    content_ip: "Content & Image Rights",
    legal_rights: "Legal Rights & Control"
  };

  // ----- Small helpers ------------------------------------------------------

  function severityFromScore(score) {
    if (typeof score !== "number") return "none";
    if (score >= 70) return "high";
    if (score >= 40) return "med";
    if (score > 0) return "low";
    return "none";
  }

  function severityLabel(sev) {
    switch (sev) {
      case "high":
        return "High";
      case "med":
      case "medium":
        return "Medium";
      case "low":
        return "Low";
      default:
        return "No issues";
    }
  }

  function countLabel(count) {
    if (!count || count <= 0) return "No issues";
    if (count === 1) return "1 issue";
    return `${count} issues`;
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
      // ignore lookup failures, fall through to fallback
    }

    return "No detailed explanation available for this risk yet.";
  }

  // Normalize whatever background sends us into a riskResult object
  function normalizeRiskResult(maybe) {
    if (!maybe) return null;
    // Background might send { ok, riskResult } or { ok, risk } or just the object.
    if (maybe.riskResult) return maybe.riskResult;
    if (maybe.risk) return maybe.risk;
    if (Array.isArray(maybe.risks) || maybe.categoryScores) return maybe;
    if (maybe.payload) return normalizeRiskResult(maybe.payload);
    return null;
  }

  function groupRisksByCategory(riskResult) {
    const grouped = {};
    CATEGORY_ORDER.forEach((cat) => {
      grouped[cat] = [];
    });

    const risks = Array.isArray(riskResult.risks) ? riskResult.risks : [];

    risks.forEach((risk) => {
      const cat = risk.category || "financial";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(risk);
    });

    return grouped;
  }

  // ----- DOM creation / wiring ---------------------------------------------

  function injectStylesheet() {
    if (document.querySelector('link[data-scribbit-panel-css="1"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("ui/panel.css");
    link.dataset.scribbitPanelCss = "1";
    document.head.appendChild(link);
  }

  function createPanelShell() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = PANEL_ID;

    // Header
    const header = document.createElement("div");
    header.className = "scribbit-panel-header";

    const headerLeft = document.createElement("div");
    headerLeft.className = "scribbit-panel-header-left";

    const logo = document.createElement("div");
    logo.className = "scribbit-panel-logo";
    logo.textContent = "S";

    const title = document.createElement("div");
    title.className = "scribbit-panel-title";
    title.textContent = "Scribbit scan";

    const summary = document.createElement("div");
    summary.className = "scribbit-panel-summary";
    summary.id = "scribbit-panel-summary";
    summary.textContent = "Analyzing this page…";

    headerLeft.appendChild(logo);
    headerLeft.appendChild(title);
    headerLeft.appendChild(summary);

    const headerRight = document.createElement("div");
    headerRight.className = "scribbit-panel-header-right";

    const closeBtn = document.createElement("button");
    closeBtn.className = "scribbit-panel-close";
    closeBtn.setAttribute("type", "button");
    closeBtn.innerHTML = "×";
    closeBtn.title = "Hide Scribbit for this page";
    closeBtn.addEventListener("click", () => {
      panel.style.display = "none";
    });

    headerRight.appendChild(closeBtn);

    header.appendChild(headerLeft);
    header.appendChild(headerRight);

    // Body
    const body = document.createElement("div");
    body.className = "scribbit-panel-body";

    const categoryList = document.createElement("div");
    categoryList.className = "scribbit-category-list";
    categoryList.id = "scribbit-category-list";

    body.appendChild(categoryList);

    panel.appendChild(header);
    panel.appendChild(body);

    document.body.appendChild(panel);
    return panel;
  }

  function renderCategoryCard(container, categoryId, categoryInfo) {
    const { score, risks } = categoryInfo;
    const sev = severityFromScore(score);
    const sevLabel = severityLabel(sev);
    const issuesCount = risks.length;

    const card = document.createElement("div");
    card.className = "scribbit-category-card";
    card.dataset.categoryId = categoryId;

    const header = document.createElement("div");
    header.className = "scribbit-category-header";

    const nameEl = document.createElement("div");
    nameEl.className = "scribbit-category-name";
    nameEl.textContent = CATEGORY_LABELS[categoryId] || categoryId;

    const headerRight = document.createElement("div");
    headerRight.style.display = "flex";
    headerRight.style.alignItems = "center";
    headerRight.style.gap = "6px";

    const levelEl = document.createElement("div");
    levelEl.className = "scribbit-category-level";
    levelEl.textContent = sevLabel;
    if (sev === "high") levelEl.classList.add("scribbit-category-level-high");
    else if (sev === "med") levelEl.classList.add("scribbit-category-level-med");
    else if (sev === "low") levelEl.classList.add("scribbit-category-level-low");
    else levelEl.classList.add("scribbit-category-level-none");

    const countEl = document.createElement("div");
    countEl.className = "scribbit-category-risk-block-count";
    countEl.textContent = countLabel(issuesCount);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "scribbit-category-toggle";
    toggle.textContent = "▾";
    toggle.setAttribute("aria-label", "Toggle issues in this category");

    headerRight.appendChild(levelEl);
    headerRight.appendChild(countEl);
    headerRight.appendChild(toggle);

    header.appendChild(nameEl);
    header.appendChild(headerRight);

    // Bar
    const barOuter = document.createElement("div");
    barOuter.className = "scribbit-category-bar";

    const barFill = document.createElement("div");
    barFill.className = "scribbit-category-bar-fill";

    if (sev === "high") barFill.classList.add("scribbit-category-bar-high");
    else if (sev === "med") barFill.classList.add("scribbit-category-bar-med");
    else if (sev === "low") barFill.classList.add("scribbit-category-bar-low");
    else barFill.classList.add("scribbit-category-bar-none");

    const clampedScore =
      typeof score === "number" ? Math.max(0, Math.min(100, score)) : 0;
    barFill.style.width = `${clampedScore}%`;

    barOuter.appendChild(barFill);

    // Body
    const body = document.createElement("div");
    body.className = "scribbit-category-risk-block";
    body.dataset.expanded = issuesCount > 0 ? "1" : "0";

    if (issuesCount > 0) {
      risks.forEach((risk) => {
        const riskRow = document.createElement("div");
        riskRow.className = "scribbit-category-risk-block-item";

        const titleRow = document.createElement("div");
        titleRow.className = "scribbit-category-risk-title-row";

        const title = document.createElement("div");
        title.className = "scribbit-risk-title";
        title.textContent = risk.title || risk.label || "Untitled risk";

        const whyWrap = document.createElement("div");
        whyWrap.className = "scribbit-risk-why-wrapper";

        const whyBtn = document.createElement("button");
        whyBtn.type = "button";
        whyBtn.className = "scribbit-risk-why";
        whyBtn.textContent = "Why is this risky?";

        const tooltip = document.createElement("div");
        tooltip.className = "scribbit-risk-tooltip";
        tooltip.textContent = getRiskDescription(risk);
        tooltip.style.display = "none";

        whyBtn.addEventListener("click", (evt) => {
          evt.stopPropagation();
          const visible = tooltip.style.display === "block";
          tooltip.style.display = visible ? "none" : "block";
        });

        whyWrap.appendChild(whyBtn);
        whyWrap.appendChild(tooltip);

        titleRow.appendChild(title);
        titleRow.appendChild(whyWrap);

        riskRow.appendChild(titleRow);
        body.appendChild(riskRow);
      });
    } else {
      const empty = document.createElement("div");
      empty.className = "scribbit-category-risk-block-empty";
      empty.textContent = "No significant issues detected in this category.";
      body.appendChild(empty);
    }

    // Initial collapse state: expanded if there are issues, collapsed otherwise
    if (issuesCount <= 0) {
      body.style.display = "none";
      toggle.textContent = "▸";
    }

    // Toggle expand/collapse
    toggle.addEventListener("click", (evt) => {
      evt.stopPropagation();
      const isHidden = body.style.display === "none";
      body.style.display = isHidden ? "block" : "none";
      toggle.textContent = isHidden ? "▾" : "▸";
    });

    card.appendChild(header);
    card.appendChild(barOuter);
    card.appendChild(body);

    container.appendChild(card);
  }

  function updatePanel(riskResultRaw) {
    const riskResult = normalizeRiskResult(riskResultRaw);
    console.log("[Scribbit] Panel received riskResult:", riskResult);

    if (!riskResult || !Array.isArray(riskResult.risks)) {
      const existing = document.getElementById(PANEL_ID);
      if (existing) existing.style.display = "none";
      return;
    }

    const globalRisks = riskResult.risks || [];
    if (globalRisks.length === 0) {
      const existing = document.getElementById(PANEL_ID);
      if (existing) existing.style.display = "none";
      return;
    }

    injectStylesheet();
    const panel = createPanelShell();
    panel.style.display = "block";

    const summaryEl = panel.querySelector("#scribbit-panel-summary");
    const overallLevel = String(riskResult.overallLevel || "").toUpperCase();
    const riskScore =
      typeof riskResult.riskScore === "number" ? riskResult.riskScore : 0;

    if (summaryEl) {
      if (overallLevel === "HIGH") {
        summaryEl.textContent = `High overall risk (${riskScore}/100)`;
      } else if (overallLevel === "MEDIUM") {
        summaryEl.textContent = `Medium overall risk (${riskScore}/100)`;
      } else if (overallLevel === "LOW") {
        summaryEl.textContent = `Low overall risk (${riskScore}/100)`;
      } else {
        summaryEl.textContent = `Risk score: ${riskScore}/100`;
      }
    }

    const categoryList = panel.querySelector("#scribbit-category-list");
    if (!categoryList) return;

    categoryList.innerHTML = "";

    const categoryScores = riskResult.categoryScores || {};
    const grouped = groupRisksByCategory(riskResult);

    CATEGORY_ORDER.forEach((catId) => {
      const score = categoryScores[catId] || 0;
      const risks = grouped[catId] || [];
      renderCategoryCard(categoryList, catId, { score, risks });
    });
  }

  // ----- Init / wiring to messaging ----------------------------------------

  function init() {
    // Guard: don't run in iframes inside extension pages, etc.
    if (window.top !== window.self) return;

    injectStylesheet();
    createPanelShell();

    if (!window.ScribbitMessaging) {
      console.warn("[Scribbit] ScribbitMessaging not available in panel.js.");
      return;
    }

    // Subscribe to live updates from background
    window.ScribbitMessaging.onRiskUpdated((payload) => {
      updatePanel(payload);
    });

    // Ask for the current risk snapshot on load
    window.ScribbitMessaging.requestCurrentRisk().then(
      (res) => {
        const normalized = normalizeRiskResult(
          res && (res.risk || res.riskResult || res.payload || res)
        );
        if (normalized) updatePanel(normalized);
      },
      (err) => {
        console.warn("[Scribbit] requestCurrentRisk failed in panel.js:", err);
      }
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
