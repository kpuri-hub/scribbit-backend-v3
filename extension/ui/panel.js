// ui/panel.js
// Scribbit Fairness Scanner - On-page Panel (Risk v2 UI)
//
// Features:
// - Does NOT show on search engines
// - Does NOT show when risks == 0
// - Collapse/expand
// - Close button
// - Mute site (1h, 1d, 1w, forever)
// - Scribbit logo
// - Expand once per host (per-session), then start collapsed
// - 4 risk categories with top risk per category
// - "Why is this risky?" hover tooltip per risk

(function () {
  const PANEL_ID = "scribbit-fairness-panel";
  const STORAGE_KEY = "scribbitMuteRules";

  // Panel display state per host (expand once, then collapsed for ~30 min)
  const PANEL_STATE_PREFIX = "scribbitPanelState_";
  const AUTO_EXPAND_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

  const BLOCKED_HOSTS = [
    "google.com",
    "www.google.com",
    "bing.com",
    "www.bing.com",
    "duckduckgo.com",
    "www.duckduckgo.com",
    "search.yahoo.com"
  ];

  const host = window.location.hostname;

  // Suppress Scribbit on search engines
  if (BLOCKED_HOSTS.includes(host)) {
    console.log("[Scribbit] Suppressed on search engine:", host);
    return;
  }

  /**********************************************************
   * PANEL STATE HELPERS (expand once per host)
   **********************************************************/

  function getPanelStateKey() {
    return PANEL_STATE_PREFIX + host;
  }

  function loadPanelDisplayState(callback) {
    if (!chrome.storage || !chrome.storage.session) {
      // No session storage available → treat as "never shown"
      return callback({ hasShownExpanded: false, lastShownAt: 0 });
    }

    const key = getPanelStateKey();
    chrome.storage.session.get([key], (data) => {
      const val = data && data[key];
      if (!val) {
        return callback({ hasShownExpanded: false, lastShownAt: 0 });
      }
      callback(val);
    });
  }

  function savePanelDisplayState(state) {
    if (!chrome.storage || !chrome.storage.session) return;
    const key = getPanelStateKey();
    chrome.storage.session.set({ [key]: state });
  }

  function shouldAutoExpand(state) {
    if (!state || !state.hasShownExpanded) return true;
    const now = Date.now();
    return now - state.lastShownAt > AUTO_EXPAND_WINDOW_MS;
  }

  /**********************************************************
   * STORAGE HELPERS (mute)
   **********************************************************/
  function isHostMuted(callback) {
    chrome.storage.local.get([STORAGE_KEY], (data) => {
      const rules = (data && data[STORAGE_KEY]) || {};
      const entry = rules[host];

      if (!entry) return callback(false);

      if (entry.until === null) return callback(true); // indefinite

      if (entry.until > Date.now()) return callback(true);

      // expired → cleanup
      delete rules[host];
      chrome.storage.local.set({ [STORAGE_KEY]: rules }, () => callback(false));
    });
  }

  function setHostMute(durationMsOrNull) {
    chrome.storage.local.get([STORAGE_KEY], (data) => {
      const rules = (data && data[STORAGE_KEY]) || {};
      rules[host] = {
        until: durationMsOrNull === null ? null : Date.now() + durationMsOrNull
      };
      chrome.storage.local.set({ [STORAGE_KEY]: rules });
      const panel = document.getElementById(PANEL_ID);
      if (panel) panel.style.display = "none";
    });
  }

  /**********************************************************
   * UI BUILDING
   **********************************************************/

  function injectStylesheet() {
    if (document.querySelector('link[data-scribbit-panel-css="1"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("ui/panel.css");
    link.dataset.scribbitPanelCss = "1";
    document.head.appendChild(link);
  }

  function createPanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.display = "none"; // hidden until risks appear

    panel.innerHTML =
      '<div class="scribbit-panel-header">' +
        '<div class="scribbit-panel-header-left">' +
          '<img class="scribbit-panel-logo" id="scribbit-panel-logo" />' +
          '<span class="scribbit-panel-title">Scribbit Scan</span>' +
        "</div>" +
        '<div class="scribbit-panel-header-right">' +
          '<span class="scribbit-panel-badge" id="scribbit-panel-level">LOW</span>' +
          '<button class="scribbit-panel-close" id="scribbit-panel-close">×</button>' +
        "</div>" +
      "</div>" +
      '<div class="scribbit-panel-body">' +
        '<div class="scribbit-panel-summary" id="scribbit-panel-summary">' +
          'Overall risk: Low' +
        "</div>" +
        '<div class="scribbit-category-list" id="scribbit-category-list"></div>' +
        '<div class="scribbit-panel-mute-row">' +
          '<button class="scribbit-panel-mute-toggle" id="scribbit-mute-toggle">' +
            "Mute this site" +
          "</button>" +
          '<div class="scribbit-panel-mute-options" id="scribbit-mute-options">' +
            '<button class="scribbit-panel-mute-option" data-mute="1h">1h</button>' +
            '<button class="scribbit-panel-mute-option" data-mute="1d">1d</button>' +
            '<button class="scribbit-panel-mute-option" data-mute="1w">1w</button>' +
            '<button class="scribbit-panel-mute-option" data-mute="forever">∞</button>' +
          "</div>" +
        "</div>" +
      "</div>";

    document.body.appendChild(panel);

    // Set logo
    const logoEl = panel.querySelector("#scribbit-panel-logo");
    if (logoEl) logoEl.src = chrome.runtime.getURL("assets/icons/icon32.png");

    // Close panel
    const closeBtn = panel.querySelector("#scribbit-panel-close");
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      panel.style.display = "none";
      window.__scribbitPanelClosed = true;
    });

    // Collapse/expand by clicking header (excluding close button)
    const header = panel.querySelector(".scribbit-panel-header");
    header.addEventListener("click", (e) => {
      if (e.target.id === "scribbit-panel-close") return;
      panel.classList.toggle("collapsed");
    });

    // Mute toggle
    const muteToggle = panel.querySelector("#scribbit-mute-toggle");
    const muteOptions = panel.querySelector("#scribbit-mute-options");

    muteToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      muteOptions.classList.toggle("visible");
    });

    // Mute choices
    muteOptions.addEventListener("click", (e) => {
      const btn = e.target.closest(".scribbit-panel-mute-option");
      if (!btn) return;

      const val = btn.dataset.mute;
      let ms = null;

      if (val === "1h") ms = 1 * 60 * 60 * 1000;
      if (val === "1d") ms = 24 * 60 * 60 * 1000;
      if (val === "1w") ms = 7 * 24 * 60 * 60 * 1000;
      if (val === "forever") ms = null;

      setHostMute(ms);
    });

    return panel;
  }

  /**********************************************************
   * RISK / CATEGORY HELPERS
   **********************************************************/

  function summarizeEvidence(risk) {
    if (!risk || !Array.isArray(risk.evidence) || risk.evidence.length === 0) {
      return risk && risk.description ? risk.description : "";
    }
    let text = risk.evidence[0] || "";
    text = text.trim();
    if (!text) {
      text = risk.description || "";
    }
    if (text.length > 220) {
      text = text.slice(0, 217) + "...";
    }
    return text;
  }

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
    // Sort: high → med → low
    if (!sev) return 99;
    const s = String(sev).toLowerCase();
    if (s === "high") return 0;
    if (s === "med" || s === "medium") return 1;
    if (s === "low") return 2;
    return 99;
  }

  function pickTopRiskForCategory(risks, categoryId) {
    const filtered = risks.filter((r) => r.category === categoryId);
    if (!filtered.length) return null;
    filtered.sort((a, b) => severityOrderValue(a.severity) - severityOrderValue(b.severity));
    return filtered[0];
  }

  function formatOverallSummary(result) {
    const score = typeof result.riskScore === "number" ? result.riskScore : 0;
    let level = "Low";
    if (score >= 70) level = "High";
    else if (score >= 40) level = "Medium";
    return "Overall risk: " + level + " (" + Math.round(score) + "/100)";
  }

  /**********************************************************
   * RENDER CATEGORY CARDS
   **********************************************************/

  function renderCategories(container, result) {
    const allRisks = result.risks || [];
    const categoryScores = result.categoryScores || {
      financial: 0,
      data_privacy: 0,
      content_ip: 0,
      legal_rights: 0
    };

    const categoryIds = ["financial", "data_privacy", "content_ip", "legal_rights"];

    container.innerHTML = "";

    categoryIds.forEach((catId) => {
      const score = categoryScores[catId] || 0;
      const topRisk = pickTopRiskForCategory(allRisks, catId);

      // If there's truly nothing in this category, skip for now
      if (!topRisk && score <= 0) {
        return;
      }

      const card = document.createElement("div");
      card.className = "scribbit-category-card";

      const header = document.createElement("div");
      header.className = "scribbit-category-header";

      const nameSpan = document.createElement("span");
      nameSpan.className = "scribbit-category-name";
      nameSpan.textContent = categoryDisplayName(catId);

      const levelClass = categoryScoreToLevel(score);
      const levelSpan = document.createElement("span");
      levelSpan.className = "scribbit-category-level scribbit-category-level-" + levelClass;
      levelSpan.textContent =
        levelClass === "high"
          ? "High"
          : levelClass === "med"
          ? "Medium"
          : levelClass === "low"
          ? "Low"
          : "None";

      header.appendChild(nameSpan);
      header.appendChild(levelSpan);

      const barWrap = document.createElement("div");
      barWrap.className = "scribbit-category-bar";

      const barFill = document.createElement("div");
      barFill.className = "scribbit-category-bar-fill scribbit-category-bar-" + levelClass;
      const width = Math.max(0, Math.min(100, score));
      barFill.style.width = width + "%";

      barWrap.appendChild(barFill);

      card.appendChild(header);
      card.appendChild(barWrap);

      if (topRisk) {
        const riskBlock = document.createElement("div");
        riskBlock.className = "scribbit-category-risk-block";

        const titleRow = document.createElement("div");
        titleRow.className = "scribbit-category-risk-title-row";

        const riskTitle = document.createElement("span");
        riskTitle.className = "scribbit-risk-title";
        riskTitle.textContent = topRisk.title || topRisk.label || "Key risk";

        const whyWrapper = document.createElement("div");
        whyWrapper.className = "scribbit-risk-why-wrapper";

        const whyBtn = document.createElement("button");
        whyBtn.className = "scribbit-risk-why";
        whyBtn.type = "button";
        whyBtn.textContent = "Why is this risky?";

        const tooltip = document.createElement("div");
        tooltip.className = "scribbit-risk-tooltip";
        tooltip.textContent =
          summarizeEvidence(topRisk) || "No additional details available.";

        whyWrapper.appendChild(whyBtn);
        whyWrapper.appendChild(tooltip);

        titleRow.appendChild(riskTitle);
        titleRow.appendChild(whyWrapper);

        riskBlock.appendChild(titleRow);
        card.appendChild(riskBlock);
      }

      container.appendChild(card);
    });
  }

  /**********************************************************
   * UPDATE PANEL WITH RISK STATE
   **********************************************************/

  function updatePanel(riskState) {
    if (!riskState || !riskState.riskResult) return;

    const result = riskState.riskResult;
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    // 🚫 Do NOT show the panel if zero risks
    if (!result.risks || result.risks.length === 0) {
      panel.style.display = "none";
      return;
    }

    // Was the panel hidden before this update? (first time we show it this load)
    const firstTimeShow =
      panel.style.display === "none" || panel.style.display === "";

    // Show now that we have risks
    panel.style.display = "block";

    const levelBadge = document.getElementById("scribbit-panel-level");
    const summaryEl = document.getElementById("scribbit-panel-summary");
    const categoryList = document.getElementById("scribbit-category-list");

    // Legacy level badge (still uses overallLevel from engine)
    if (levelBadge && result.overallLevel) {
      levelBadge.textContent = result.overallLevel;
    }

    // Summary line from riskScore
    if (summaryEl) {
      summaryEl.textContent = formatOverallSummary(result);
    }

    // Render categories + top risks
    if (categoryList) {
      renderCategories(categoryList, result);
    }

    // On first appearance for this host, decide expanded vs collapsed
    if (firstTimeShow) {
      loadPanelDisplayState((state) => {
        const expand = shouldAutoExpand(state);
        if (expand) {
          panel.classList.remove("collapsed");
          savePanelDisplayState({
            hasShownExpanded: true,
            lastShownAt: Date.now()
          });
        } else {
          panel.classList.add("collapsed");
        }
      });
    }
  }

  /**********************************************************
   * INIT
   **********************************************************/

  function init() {
    // First check if muted
    isHostMuted((muted) => {
      if (muted) return;

      injectStylesheet();
      createPanel();

      if (!window.ScribbitMessaging) return;

      // Subscribe to updates
      window.ScribbitMessaging.onRiskUpdated((state) => {
        updatePanel(state);
      });

      // Request initial state
      window.ScribbitMessaging.requestCurrentRisk().then((res) => {
        if (res && res.ok && res.risk) updatePanel(res.risk);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
