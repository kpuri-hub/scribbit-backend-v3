// ui/panel.js
// Scribbit Fairness Scanner - On-page Panel (Risk v2 UI with Mini Mode)
//
// Behaviour:
// - ONLY shows if there is at least 1 risk overall
// - Renders 4 categories (Financial, Data, Content, Legal) when visible
// - Each category shows: name, severity, bar, and # of issues
// - Category detail lists are collapsed by default until user clicks
// - Each risk card can show evidence in an expandable details area
// - Panel has a close button that hides it completely for this page load
// - Panel supports FULL vs MINI mode, toggled by clicking the header
// - Panel remembers FULL/MINI per-domain in chrome.storage.local
// - Panel does NOT flash full then mini; it only appears after mode is applied
//
// It consumes the Risk Engine result object:
//   {
//     risks: [ { id, category, title, description, severity, evidence?, ... }, ... ],
//     categoryScores: { financial, data_privacy, content_ip, legal_rights },
//     riskScore,
//     overallLevel
//   }

(function () {
  const PANEL_ID = "scribbit-fairness-panel";

  const CATEGORY_ORDER = ["financial", "data_privacy", "content_ip", "legal_rights"];

  const CATEGORY_LABELS = {
    financial: "Financial Exposure",
    data_privacy: "Personal Data & Privacy",
    content_ip: "Content & Image Rights",
    legal_rights: "Legal Rights & Control"
  };

  const PANEL_STATE_STORAGE_KEY = "scribbit_panel_state_v1";

  // Track if user manually closed the panel for this page
  let panelManuallyHidden = false;
  // Start in MINI mode by default to avoid full → mini flash
  let currentPanelMode = "mini";
  let panelModeInitialized = false;

  // ----- Helpers -------------------------------------------------------------

  function normalizeRiskResult(maybe) {
    if (!maybe) return null;
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

  function summarizeCategorySeverity(risks) {
    if (!risks || risks.length === 0) return "none";
    let hasHigh = false;
    let hasMedium = false;
    for (const r of risks) {
      const sev = String(r.severity || "").toLowerCase();
      if (sev === "high") hasHigh = true;
      else if (sev === "medium") hasMedium = true;
    }
    if (hasHigh) return "high";
    if (hasMedium) return "medium";
    return "low";
  }

  function severityLabel(level) {
    switch (String(level || "").toLowerCase()) {
      case "high":
        return "High";
      case "medium":
        return "Medium";
      case "low":
        return "Low";
      default:
        return "No issues";
    }
  }

  function severityClass(level) {
    switch (String(level || "").toLowerCase()) {
      case "high":
        return "scribbit-severity-high";
      case "medium":
        return "scribbit-severity-medium";
      case "low":
        return "scribbit-severity-low";
      default:
        return "scribbit-severity-none";
    }
  }

  function countLabel(count) {
    if (!count || count <= 0) return "No issues";
    if (count === 1) return "1 issue";
    return `${count} issues`;
  }

  function getHostname() {
    try {
      return window.location.hostname || "";
    } catch {
      return "";
    }
  }

  // ----- Storage for per-domain panel mode ----------------------------------

  function loadDomainPanelState(callback) {
    const hostname = getHostname();
    if (!hostname || !chrome || !chrome.storage || !chrome.storage.local) {
      callback(null);
      return;
    }

    chrome.storage.local.get([PANEL_STATE_STORAGE_KEY], (result) => {
      try {
        const stored = result && result[PANEL_STATE_STORAGE_KEY];
        if (!stored || typeof stored !== "object") {
          callback(null);
          return;
        }
        const mode = stored[hostname];
        if (mode === "mini" || mode === "full") {
          callback(mode);
        } else {
          callback(null);
        }
      } catch (e) {
        console.warn("[Scribbit] panel.js: error reading panel state:", e);
        callback(null);
      }
    });
  }

  function saveDomainPanelState(mode) {
    const hostname = getHostname();
    if (!hostname || !chrome || !chrome.storage || !chrome.storage.local) {
      return;
    }
    if (mode !== "mini" && mode !== "full") return;

    chrome.storage.local.get([PANEL_STATE_STORAGE_KEY], (result) => {
      let stored = (result && result[PANEL_STATE_STORAGE_KEY]) || {};
      if (typeof stored !== "object") stored = {};
      stored[hostname] = mode;
      chrome.storage.local.set({ [PANEL_STATE_STORAGE_KEY]: stored }, () => {
        // no-op
      });
    });
  }

  // ----- DOM creation / wiring ----------------------------------------------

  function injectStylesheet() {
    if (document.querySelector('link[data-scribbit-panel-css="1"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("ui/panel.css");
    link.dataset.scribbitPanelCss = "1";
    document.head.appendChild(link);
  }

  function setPanelMode(panel, mode) {
    if (!panel) return;
    if (mode !== "mini" && mode !== "full") return;

    currentPanelMode = mode;
    panel.classList.remove("scribbit-panel-mini", "scribbit-panel-full");
    if (mode === "mini") {
      panel.classList.add("scribbit-panel-mini");
    } else {
      panel.classList.add("scribbit-panel-full");
    }
    saveDomainPanelState(mode);
  }

  function togglePanelMode(panel) {
    if (!panel) return;
    const next = currentPanelMode === "mini" ? "full" : "mini";
    setPanelMode(panel, next);
  }

  /**
   * Apply initial full/mini mode for this domain, then call onReady.
   * This is async due to chrome.storage, so we only show the panel
   * AFTER this has completed to avoid a flash of full → mini.
   */
  function applyInitialPanelMode(panel, onReady) {
    if (!panel) {
      if (onReady) onReady();
      return;
    }

    if (panelModeInitialized) {
      setPanelMode(panel, currentPanelMode);
      if (onReady) onReady();
      return;
    }

    panelModeInitialized = true;

    loadDomainPanelState((mode) => {
      if (mode === "mini" || mode === "full") {
        setPanelMode(panel, mode);
      } else {
        // default for domains with no stored state → MINI to avoid full flash
        setPanelMode(panel, "mini");
      }
      if (onReady) onReady();
    });
  }

  function createPanelShell() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.display = "none"; // we'll show it after mode is applied

    // Header
    const header = document.createElement("div");
    header.className = "scribbit-panel-header";

    const headerLeft = document.createElement("div");
    headerLeft.className = "scribbit-panel-header-left";

    const title = document.createElement("div");
    title.className = "scribbit-panel-title";
    title.textContent = "Scribbit Scan";

    const subtitle = document.createElement("div");
    subtitle.className = "scribbit-panel-subtitle";
    subtitle.id = "scribbit-panel-summary";
    subtitle.textContent = "";

    headerLeft.appendChild(title);
    headerLeft.appendChild(subtitle);

    const headerRight = document.createElement("div");
    headerRight.className = "scribbit-panel-header-right";

    const closeBtn = document.createElement("button");
    closeBtn.className = "scribbit-panel-close";
    closeBtn.setAttribute("type", "button");
    closeBtn.innerHTML = "×";
    closeBtn.title = "Hide Scribbit for this page";

    closeBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      panelManuallyHidden = true;
      panel.style.display = "none";
    });

    headerRight.appendChild(closeBtn);

    header.appendChild(headerLeft);
    header.appendChild(headerRight);

    // Clicking header (excluding close) toggles mini/full
    header.addEventListener("click", (evt) => {
      if (evt.target.closest(".scribbit-panel-close")) return;
      togglePanelMode(panel);
    });

    // Body
    const body = document.createElement("div");
    body.className = "scribbit-panel-body";

    const categoryList = document.createElement("div");
    categoryList.className = "scribbit-category-list";
    categoryList.id = "scribbit-category-list";

    body.appendChild(categoryList);

    // Footer
    const footer = document.createElement("div");
    footer.className = "scribbit-panel-footer";

    const riskScoreEl = document.createElement("div");
    riskScoreEl.className = "scribbit-panel-score";
    riskScoreEl.id = "scribbit-panel-score";
    riskScoreEl.textContent = "";

    const disclaimer = document.createElement("div");
    disclaimer.className = "scribbit-panel-disclaimer";
    disclaimer.textContent =
      "Scribbit scans for common fees, refund traps and legal gotchas. It can miss things — always review before you buy.";

    footer.appendChild(riskScoreEl);
    footer.appendChild(disclaimer);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);

    return panel;
  }

  function createCategoryCard(categoryKey, risks) {
    const card = document.createElement("div");
    card.className = "scribbit-category-card";
    card.dataset.category = categoryKey;

    const header = document.createElement("div");
    header.className = "scribbit-category-header";

    const nameEl = document.createElement("div");
    nameEl.className = "scribbit-category-name";
    nameEl.textContent = CATEGORY_LABELS[categoryKey] || categoryKey;

    const headerRight = document.createElement("div");
    headerRight.className = "scribbit-category-header-right";

    const level = summarizeCategorySeverity(risks);
    const levelEl = document.createElement("span");
    levelEl.className = "scribbit-category-level " + severityClass(level);
    levelEl.textContent = severityLabel(level);

    const countEl = document.createElement("span");
    countEl.className = "scribbit-category-count";
    countEl.textContent = countLabel(risks.length);

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

    const barOuter = document.createElement("div");
    barOuter.className = "scribbit-category-bar-outer";

    const barInner = document.createElement("div");
    barInner.className = "scribbit-category-bar-inner " + severityClass(level);

    let widthPercent = 0;
    if (risks.length > 0) {
      if (level === "high") widthPercent = 100;
      else if (level === "medium") widthPercent = 66;
      else widthPercent = 33;
    }
    barInner.style.width = widthPercent + "%";

    barOuter.appendChild(barInner);

    const issuesList = document.createElement("div");
    issuesList.className = "scribbit-category-issues";

    if (risks.length > 0) {
      risks.forEach((risk) => {
        issuesList.appendChild(createRiskItem(risk));
      });
    } else {
      const empty = document.createElement("div");
      empty.className = "scribbit-category-empty";
      empty.textContent = "No notable issues found in this area.";
      issuesList.appendChild(empty);
    }

    card.appendChild(header);
    card.appendChild(barOuter);
    card.appendChild(issuesList);

    // DEFAULT: collapsed, even if risks exist
    let expanded = false;
    updateCategoryExpandedState(card, expanded);

    header.addEventListener("click", (evt) => {
      expanded = !expanded;
      updateCategoryExpandedState(card, expanded);
    });

    toggle.addEventListener("click", (evt) => {
      evt.stopPropagation();
      expanded = !expanded;
      updateCategoryExpandedState(card, expanded);
    });

    return card;
  }

  function updateCategoryExpandedState(card, expanded) {
    if (!card) return;
    const issuesList = card.querySelector(".scribbit-category-issues");
    const toggle = card.querySelector(".scribbit-category-toggle");
    if (!issuesList || !toggle) return;

    if (expanded) {
      card.classList.remove("scribbit-category-collapsed");
      issuesList.style.display = "block";
      toggle.textContent = "▾";
    } else {
      card.classList.add("scribbit-category-collapsed");
      issuesList.style.display = "none";
      toggle.textContent = "▸";
    }
  }

  function createRiskItem(risk) {
    const item = document.createElement("div");
    item.className = "scribbit-risk-item";

    const titleRow = document.createElement("div");
    titleRow.className = "scribbit-risk-title-row";

    const title = document.createElement("div");
    title.className = "scribbit-risk-title";
    title.textContent = risk.title || "Risk";

    const chip = document.createElement("span");
    chip.className = "scribbit-risk-severity " + severityClass(risk.severity);
    chip.textContent = severityLabel(risk.severity);

    const whyBtn = document.createElement("button");
    whyBtn.className = "scribbit-risk-why";
    whyBtn.type = "button";
    whyBtn.textContent = "Why is this risky?";

    titleRow.appendChild(title);
    titleRow.appendChild(chip);
    titleRow.appendChild(whyBtn);

    const desc = document.createElement("div");
    desc.className = "scribbit-risk-description";
    desc.textContent = risk.description || "";

    const evidenceContainer = document.createElement("div");
    evidenceContainer.className = "scribbit-risk-evidence-container";

    const evidenceToggle = document.createElement("button");
    evidenceToggle.type = "button";
    evidenceToggle.className = "scribbit-risk-evidence-toggle";
    evidenceToggle.textContent = "Show details ▾";

    const evidenceList = document.createElement("ul");
    evidenceList.className = "scribbit-risk-evidence";
    evidenceList.style.display = "none";

    const evidence = Array.isArray(risk.evidence) ? risk.evidence : [];
    if (evidence.length > 0) {
      evidence.forEach((snippet) => {
        const li = document.createElement("li");
        li.textContent = snippet;
        evidenceList.appendChild(li);
      });
    } else {
      const li = document.createElement("li");
      li.textContent =
        "No specific lines were extracted, but language on this page matched this risk.";
      evidenceList.appendChild(li);
    }

    let evidenceExpanded = false;
    evidenceToggle.addEventListener("click", () => {
      evidenceExpanded = !evidenceExpanded;
      if (evidenceExpanded) {
        evidenceList.style.display = "block";
        evidenceToggle.textContent = "Hide details ▴";
      } else {
        evidenceList.style.display = "none";
        evidenceToggle.textContent = "Show details ▾";
      }
    });

    evidenceContainer.appendChild(evidenceToggle);
    evidenceContainer.appendChild(evidenceList);

    item.appendChild(titleRow);
    item.appendChild(desc);
    item.appendChild(evidenceContainer);

    whyBtn.addEventListener("click", () => {
      desc.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    return item;
  }

  // ----- Main update/render --------------------------------------------------

  function updatePanel(rawRiskResult) {
    const riskResult = normalizeRiskResult(rawRiskResult);
    const existingPanel = document.getElementById(PANEL_ID);

    if (panelManuallyHidden) {
      if (existingPanel) existingPanel.style.display = "none";
      return;
    }

    if (!riskResult || !Array.isArray(riskResult.risks) || riskResult.risks.length === 0) {
      if (existingPanel) existingPanel.style.display = "none";
      return;
    }

    injectStylesheet();
    const panelEl = existingPanel || createPanelShell();

    const summaryEl = panelEl.querySelector("#scribbit-panel-summary");
    const scoreEl = panelEl.querySelector("#scribbit-panel-score");
    const categoryList = panelEl.querySelector("#scribbit-category-list");

    const overallLevel = String(riskResult.overallLevel || "").toLowerCase();
    const riskScore =
      typeof riskResult.riskScore === "number" ? riskResult.riskScore : null;

    if (summaryEl) {
      let levelLabel = severityLabel(overallLevel);
      if (!riskScore && levelLabel === "No issues") {
        summaryEl.textContent = "Some terms on this page may deserve a closer look.";
      } else if (!riskScore) {
        summaryEl.textContent = `Overall risk: ${levelLabel}`;
      } else {
        summaryEl.textContent = `Overall risk: ${levelLabel} (${riskScore}/100)`;
      }
    }

    if (scoreEl) {
      if (riskScore != null) {
        scoreEl.textContent = `Scribbit Risk Score: ${riskScore}/100`;
      } else {
        scoreEl.textContent = "";
      }
    }

    if (categoryList) {
      while (categoryList.firstChild) {
        categoryList.removeChild(categoryList.firstChild);
      }

      const grouped = groupRisksByCategory(riskResult);

      CATEGORY_ORDER.forEach((catKey) => {
        const catRisks = grouped[catKey] || [];
        const card = createCategoryCard(catKey, catRisks);
        categoryList.appendChild(card);
      });
    }

    // Only show the panel after mode is applied so we don't flash full → mini
    applyInitialPanelMode(panelEl, () => {
      panelEl.style.display = "block";
    });
  }

  // ----- Dependency waiting & wiring ----------------------------------------

  function waitForDependencies(callback, maxTries = 30, delayMs = 200) {
    let tries = 0;
    const interval = setInterval(() => {
      if (window.ScribbitMessaging) {
        clearInterval(interval);
        callback();
        return;
      }
      if (tries++ >= maxTries) {
        clearInterval(interval);
        console.warn(
          "[Scribbit] panel.js: ScribbitMessaging not available after retries"
        );
      }
    }, delayMs);
  }

  function init() {
    if (window.top !== window.self) return;

    waitForDependencies(() => {
      window.ScribbitMessaging.onRiskUpdated((payload) => {
        updatePanel(payload);
      });

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
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
