// ui/panel.js
// Scribbit Fairness Scanner - On-page Panel 2.0 (Category → Risk Rows → Hover Details)
//
// Architecture:
// - Renders 5 fixed categories from canonical Risk Model v2:
//     financialExposure, refundAndCancellation, subscriptionAndBilling,
//     dataPrivacy, legalRights
// - Each category shows: name, severity badge, bar, and # of risks
// - Category body shows risk rows; each row has:
//     icon, title, one-line summary, "Why is this risky?" link
// - "Why is this risky?" shows a floating popup on hover,
//   using risk details as content, and hides on mouse-out.
// - Categories with zero risks show a green ✓ "No risks detected" row
// - Panel supports FULL vs MINI mode, toggled by header
// - Panel remembers FULL/MINI per-domain in chrome.storage.local
// - Panel listens to ScribbitMessaging for canonical riskResult:
//
//   {
//     riskScore: number,
//     overallLevel: "LOW" | "MEDIUM" | "HIGH",
//     overallScore: number,
//     hasMeaningfulContent: boolean,
//     categoryScores: {
//       financialExposure,
//       refundAndCancellation,
//       subscriptionAndBilling,
//       dataPrivacy,
//       legalRights
//     },
//     risks: [
//       { category: string, title: string, evidence: string[], severity: "LOW" | "MEDIUM" | "HIGH" }
//     ]
//   }

(function () {
  const PANEL_ID = "scribbit-fairness-panel";

  // Canonical category keys and labels (Panel 2.0)
  const CATEGORY_ORDER = [
    "financialExposure",
    "refundAndCancellation",
    "subscriptionAndBilling",
    "dataPrivacy",
    "legalRights"
  ];

  const CATEGORY_LABELS = {
    financialExposure: "Financial Exposure",
    refundAndCancellation: "Refunds & Cancellations",
    subscriptionAndBilling: "Subscription & Billing",
    dataPrivacy: "Personal Data & Privacy",
    legalRights: "Legal Rights & Control"
  };

  const PANEL_STATE_STORAGE_KEY = "scribbit_panel_state_v1";

  let panelManuallyHidden = false;
  let currentPanelMode = "mini"; // default visually
  let panelModeInitialized = false;

  // Single shared tooltip for all risks
  let tooltipEl = null;
  let tooltipHideTimeout = null;
  let tooltipPanelBodyEl = null;

  // ----- Helpers: normalization & mapping -----------------------------------

  function normalizeRiskResult(maybe) {
    if (!maybe) return null;

    // Already looks canonical
    if (
      Array.isArray(maybe.risks) ||
      typeof maybe.riskScore === "number" ||
      typeof maybe.overallScore === "number"
    ) {
      return maybe;
    }

    if (maybe.riskResult) return normalizeRiskResult(maybe.riskResult);
    if (maybe.risk) return normalizeRiskResult(maybe.risk);
    if (maybe.payload) return normalizeRiskResult(maybe.payload);

    return null;
  }

  function mapCategoryKey(rawCategory) {
    if (!rawCategory) return "financialExposure";
    const c = String(rawCategory).trim();

    // Prefer canonical keys if already present
    if (CATEGORY_ORDER.includes(c)) return c;

    const lower = c.toLowerCase();

    // Backwards compatibility for older riskEngine category values
    if (lower === "financial") return "financialExposure";
    if (lower === "refund" || lower === "refunds" || lower === "refund_cancellation") {
      return "refundAndCancellation";
    }
    if (
      lower === "subscription" ||
      lower === "billing" ||
      lower === "subscription_billing"
    ) {
      return "subscriptionAndBilling";
    }
    if (lower === "data_privacy" || lower === "privacy") return "dataPrivacy";
    if (lower === "legal_rights" || lower === "legal" || lower === "terms") {
      return "legalRights";
    }

    // Fallback: bucket unknown categories into Legal
    return "legalRights";
  }

  function groupRisksByCategory(riskResult) {
    const grouped = {};
    CATEGORY_ORDER.forEach((cat) => {
      grouped[cat] = [];
    });

    const risks = Array.isArray(riskResult.risks) ? riskResult.risks : [];

    risks.forEach((risk) => {
      const mappedKey = mapCategoryKey(risk.category);
      if (!grouped[mappedKey]) grouped[mappedKey] = [];
      grouped[mappedKey].push(risk);
    });

    return grouped;
  }

  function severityFromScore(score) {
    if (typeof score !== "number" || Number.isNaN(score)) return "none";
    if (score >= 67) return "high";
    if (score >= 34) return "medium";
    if (score > 0) return "low";
    return "none";
  }

  function summarizeCategorySeverity(risks, categoryScore) {
    // Prefer actual risks if present
    if (risks && risks.length > 0) {
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

    // If no explicit risks, infer from category score
    return severityFromScore(categoryScore);
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
    if (!count || count <= 0) return "No risks detected";
    if (count === 1) return "1 risk detected";
    return `${count} risks detected`;
  }

  function getHostname() {
    try {
      return window.location.hostname || "";
    } catch {
      return "";
    }
  }

  function getOneLineSummary(risk) {
    const evidence = Array.isArray(risk.evidence) ? risk.evidence : [];
    if (evidence.length > 0 && typeof evidence[0] === "string") {
      const first = evidence[0].trim().replace(/\s+/g, " ");
      if (first.length <= 160) return first;
      return first.slice(0, 157) + "…";
    }
    const cat = mapCategoryKey(risk.category);
    switch (cat) {
      case "financialExposure":
        return "May increase your total cost or add hidden fees.";
      case "refundAndCancellation":
        return "Refunds or cancellations may be more restricted than expected.";
      case "subscriptionAndBilling":
        return "Auto-renew or billing terms could be hard to cancel.";
      case "dataPrivacy":
        return "Personal data may be shared, tracked, or retained more than expected.";
      case "legalRights":
      default:
        return "Terms here may limit your rights or make disputes harder.";
    }
  }

  function deriveWhyThisMatters(risk) {
    const title = risk.title || "This risk matters";
    const evidence = Array.isArray(risk.evidence) ? risk.evidence : [];
    if (evidence.length > 0 && typeof evidence[0] === "string") {
      return `${title} — pay attention to this wording before you continue.`;
    }
    return `${title} could impact your costs, refunds, or legal rights.`;
  }

  function extractFeeSnippets(evidence) {
    if (!Array.isArray(evidence) || evidence.length === 0) return [];
    const feeSnippets = [];

    const feeRegex = /\b(fee|fees|surcharge|markup|mark-up|commission|service charge)\b/i;
    const percentRegex = /(\d+(\.\d+)?)\s*%/;
    const moneyRegex = /\$\s?\d[\d,]*(\.\d+)?/;

    for (const line of evidence) {
      if (typeof line !== "string") continue;
      const hasFeeWord = feeRegex.test(line);
      const hasPercent = percentRegex.test(line);
      const hasMoney = moneyRegex.test(line);

      if (hasFeeWord || hasPercent || hasMoney) {
        feeSnippets.push(line.trim());
      }
    }

    return feeSnippets;
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

  // ----- Tooltip helpers -----------------------------------------------------

  function ensureTooltip(panelBody) {
    if (tooltipEl && tooltipPanelBodyEl === panelBody) return tooltipEl;

    tooltipPanelBodyEl = panelBody;

    if (!tooltipEl) {
      tooltipEl = document.createElement("div");
      tooltipEl.id = "scribbit-risk-tooltip";
      tooltipEl.className = "scribbit-risk-tooltip";
    }

    tooltipEl.innerHTML = "";
    tooltipEl.style.display = "none";
    tooltipEl.style.top = "0px";
    tooltipEl.style.left = "0px";

    if (!tooltipPanelBodyEl.contains(tooltipEl)) {
      tooltipPanelBodyEl.appendChild(tooltipEl);
    }

    // Hovering tooltip cancels hide; leaving schedules hide
    tooltipEl.addEventListener("mouseenter", cancelTooltipHide);
    tooltipEl.addEventListener("mouseleave", scheduleTooltipHide);

    // Ensure body can act as positioning context
    if (!tooltipPanelBodyEl.style.position) {
      tooltipPanelBodyEl.style.position = "relative";
    }

    return tooltipEl;
  }

  function showRiskTooltip(detailsEl, triggerEl) {
    if (!detailsEl || !triggerEl) return;

    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const panelBody = panel.querySelector(".scribbit-panel-body");
    if (!panelBody) return;

    const tooltip = ensureTooltip(panelBody);
    cancelTooltipHide();

    // Copy details content into tooltip
    tooltip.innerHTML = detailsEl.innerHTML;

    // Position relative to panel body
    const triggerRect = triggerEl.getBoundingClientRect();
    const bodyRect = panelBody.getBoundingClientRect();

    const top =
      triggerRect.bottom - bodyRect.top + panelBody.scrollTop + 4; // slightly below link
    let left = triggerRect.left - bodyRect.left + panelBody.scrollLeft;

    // Basic bounds adjustment so tooltip doesn't bleed off the right edge
    tooltip.style.display = "block";
    tooltip.style.visibility = "hidden"; // measure first
    tooltip.style.top = "0px";
    tooltip.style.left = "0px";

    const tooltipRect = tooltip.getBoundingClientRect();
    const maxLeft = bodyRect.width - tooltipRect.width - 8;
    if (left > maxLeft) left = Math.max(0, maxLeft);

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    tooltip.style.visibility = "visible";
  }

  function hideRiskTooltip() {
    if (!tooltipEl) return;
    tooltipEl.style.display = "none";
  }

  function scheduleTooltipHide() {
    if (!tooltipEl) return;
    clearTimeout(tooltipHideTimeout);
    tooltipHideTimeout = setTimeout(() => {
      hideRiskTooltip();
    }, 160);
  }

  function cancelTooltipHide() {
    clearTimeout(tooltipHideTimeout);
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

  function applyInitialPanelMode(panel) {
    if (!panel) return;

    if (panelModeInitialized) {
      setPanelMode(panel, currentPanelMode);
      return;
    }

    panelModeInitialized = true;

    // Start as mini visually to avoid full → mini flash
    setPanelMode(panel, "mini");

    loadDomainPanelState((mode) => {
      if (mode === "mini" || mode === "full") {
        setPanelMode(panel, mode);
      }
      // If null, we keep default "mini" for new domains
    });
  }

  function createPanelShell() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.display = "none"; // will show in updatePanel
    panel.classList.add("scribbit-panel-mini"); // default mini until we know better

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

    document.body.appendChild(panel);

    return panel;
  }

  function createNoRiskRow() {
    const row = document.createElement("div");
    row.className = "scribbit-risk-row scribbit-no-risks";

    const icon = document.createElement("div");
    icon.className = "scribbit-risk-icon scribbit-risk-icon-ok";

    const content = document.createElement("div");
    content.className = "scribbit-risk-content";

    const main = document.createElement("div");
    main.className = "scribbit-risk-main";

    const title = document.createElement("div");
    title.className = "scribbit-risk-title";
    title.textContent = "No risks detected";

    const summary = document.createElement("div");
    summary.className = "scribbit-risk-summary";
    summary.textContent = "Nothing concerning found in this category on this page.";

    main.appendChild(title);
    main.appendChild(summary);
    content.appendChild(main);

    row.appendChild(icon);
    row.appendChild(content);

    return row;
  }

  function createRiskDetailsContent(risk) {
    const wrapper = document.createElement("div");
    wrapper.className = "scribbit-risk-details-inner";

    const whyMatters = document.createElement("div");
    whyMatters.className = "scribbit-risk-why-matters";
    whyMatters.textContent = deriveWhyThisMatters(risk);

    const evidenceList = document.createElement("ul");
    evidenceList.className = "scribbit-risk-evidence-list";

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

    wrapper.appendChild(whyMatters);
    wrapper.appendChild(evidenceList);

    const feeSnippets = extractFeeSnippets(evidence);
    if (feeSnippets.length > 0) {
      const feeBlock = document.createElement("div");
      feeBlock.className = "scribbit-risk-fee-breakdown";

      const feeTitle = document.createElement("div");
      feeTitle.className = "scribbit-risk-fee-title";
      feeTitle.textContent = "Fee / FX details:";

      const feeList = document.createElement("ul");
      feeList.className = "scribbit-risk-fee-list";

      feeSnippets.forEach((line) => {
        const li = document.createElement("li");
        li.textContent = line;
        feeList.appendChild(li);
      });

      feeBlock.appendChild(feeTitle);
      feeBlock.appendChild(feeList);
      wrapper.appendChild(feeBlock);
    }

    return wrapper;
  }

  function createRiskGroup(categoryKey, risk, index) {
    const group = document.createElement("div");
    group.className = "scribbit-risk-group";
    group.dataset.category = categoryKey;
    group.dataset.index = String(index);

    const row = document.createElement("div");
    row.className = "scribbit-risk-row";

    const icon = document.createElement("div");
    icon.className =
      "scribbit-risk-icon " + severityClass(risk.severity || "low");

    const content = document.createElement("div");
    content.className = "scribbit-risk-content";

    const main = document.createElement("div");
    main.className = "scribbit-risk-main";

    const title = document.createElement("div");
    title.className = "scribbit-risk-title";
    title.textContent = risk.title || "Risk";

    const summary = document.createElement("div");
    summary.className = "scribbit-risk-summary";
    summary.textContent = getOneLineSummary(risk);

    main.appendChild(title);
    main.appendChild(summary);

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "scribbit-risk-toggle";
    toggleBtn.textContent = "Why is this risky?";
    toggleBtn.setAttribute("aria-haspopup", "dialog");

    content.appendChild(main);
    content.appendChild(toggleBtn);

    row.appendChild(icon);
    row.appendChild(content);

    // Hidden details source for tooltip
    const details = document.createElement("div");
    details.className = "scribbit-risk-details";
    const detailsContent = createRiskDetailsContent(risk);
    details.appendChild(detailsContent);

    group.appendChild(row);
    group.appendChild(details);

    // Hover behaviour: show tooltip on link hover
    toggleBtn.addEventListener("mouseenter", () => {
      showRiskTooltip(details, toggleBtn);
    });
    toggleBtn.addEventListener("mouseleave", () => {
      scheduleTooltipHide();
    });
    toggleBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      showRiskTooltip(details, toggleBtn);
    });

    return group;
  }

  function createCategoryCard(categoryKey, risks, categoryScores) {
    const card = document.createElement("div");
    card.className = "scribbit-category-card";
    card.dataset.category = categoryKey;

    const header = document.createElement("div");
    header.className = "scribbit-category-header";

    const headerLeft = document.createElement("div");
    headerLeft.className = "scribbit-category-header-left";

    const icon = document.createElement("div");
    icon.className = "scribbit-category-icon";

    const nameEl = document.createElement("div");
    nameEl.className = "scribbit-category-name";
    nameEl.textContent = CATEGORY_LABELS[categoryKey] || categoryKey;

    headerLeft.appendChild(icon);
    headerLeft.appendChild(nameEl);

    const headerRight = document.createElement("div");
    headerRight.className = "scribbit-category-header-right";

    const categoryScore =
      categoryScores && typeof categoryScores[categoryKey] === "number"
        ? categoryScores[categoryKey]
        : null;

    const level = summarizeCategorySeverity(risks, categoryScore);
    const levelEl = document.createElement("span");
    levelEl.className = "scribbit-category-level " + severityClass(level);
    levelEl.textContent = severityLabel(level);

    const countEl = document.createElement("span");
    countEl.className = "scribbit-category-count";
    countEl.textContent = countLabel(risks.length);

    const scoreEl = document.createElement("span");
    scoreEl.className = "scribbit-category-score";
    if (categoryScore != null) {
      scoreEl.textContent = `${Math.round(categoryScore)}/100`;
    } else {
      scoreEl.textContent = "";
    }

    headerRight.appendChild(levelEl);
    headerRight.appendChild(countEl);
    if (categoryScore != null) {
      headerRight.appendChild(scoreEl);
    }

    header.appendChild(headerLeft);
    header.appendChild(headerRight);

    const barOuter = document.createElement("div");
    barOuter.className = "scribbit-category-bar-outer";

    const barInner = document.createElement("div");
    barInner.className = "scribbit-category-bar-inner " + severityClass(level);

    let widthPercent = 0;
    if (categoryScore != null) {
      widthPercent = Math.max(0, Math.min(100, categoryScore));
    } else if (risks.length > 0) {
      if (level === "high") widthPercent = 100;
      else if (level === "medium") widthPercent = 66;
      else widthPercent = 33;
    }
    barInner.style.width = widthPercent + "%";

    barOuter.appendChild(barInner);

    const body = document.createElement("div");
    body.className = "scribbit-category-body";

    const riskRows = document.createElement("div");
    riskRows.className = "scribbit-risk-rows";

    if (risks.length > 0) {
      risks.forEach((risk, idx) => {
        const group = createRiskGroup(categoryKey, risk, idx);
        riskRows.appendChild(group);
      });
    } else {
      riskRows.appendChild(createNoRiskRow());
    }

    body.appendChild(riskRows);

    card.appendChild(header);
    card.appendChild(barOuter);
    card.appendChild(body);

    return card;
  }

  // ----- Main update/render --------------------------------------------------

  function updatePanel(rawRiskResult) {
    const riskResult = normalizeRiskResult(rawRiskResult);
    const existingPanel = document.getElementById(PANEL_ID);

    if (panelManuallyHidden) {
      if (existingPanel) existingPanel.style.display = "none";
      return;
    }

    const risksArray = riskResult && Array.isArray(riskResult.risks) ? riskResult.risks : [];
    const hasMeaningfulContent =
      riskResult && typeof riskResult.hasMeaningfulContent === "boolean"
        ? riskResult.hasMeaningfulContent
        : risksArray.length > 0;

    // If nothing meaningful to show, hide the panel
    if (!riskResult || (!hasMeaningfulContent && risksArray.length === 0)) {
      if (existingPanel) existingPanel.style.display = "none";
      return;
    }

    injectStylesheet();
    const panelEl = existingPanel || createPanelShell();

    const summaryEl = panelEl.querySelector("#scribbit-panel-summary");
    const scoreEl = panelEl.querySelector("#scribbit-panel-score");
    const categoryList = panelEl.querySelector("#scribbit-category-list");

    const overallLevel = String(riskResult.overallLevel || "").toLowerCase();
    const overallScore =
      typeof riskResult.overallScore === "number"
        ? riskResult.overallScore
        : typeof riskResult.riskScore === "number"
        ? riskResult.riskScore
        : null;

    if (summaryEl) {
      const levelLabel = severityLabel(overallLevel);
      if (overallScore == null && levelLabel === "No issues") {
        summaryEl.textContent = "Some terms on this page may deserve a closer look.";
      } else if (overallScore == null) {
        summaryEl.textContent = `Overall risk: ${levelLabel}`;
      } else {
        summaryEl.textContent = `Overall risk: ${levelLabel} (${Math.round(
          overallScore
        )}/100)`;
      }
    }

    if (scoreEl) {
      if (overallScore != null) {
        scoreEl.textContent = `Scribbit Risk Score: ${Math.round(overallScore)}/100`;
      } else {
        scoreEl.textContent = "";
      }
    }

    if (categoryList) {
      while (categoryList.firstChild) {
        categoryList.removeChild(categoryList.firstChild);
      }

      const grouped = groupRisksByCategory(riskResult);
      const categoryScores =
        riskResult && typeof riskResult.categoryScores === "object"
          ? riskResult.categoryScores
          : {};

      CATEGORY_ORDER.forEach((catKey) => {
        const catRisks = grouped[catKey] || [];
        const card = createCategoryCard(catKey, catRisks, categoryScores);
        categoryList.appendChild(card);
      });
    }

    applyInitialPanelMode(panelEl);
    panelEl.style.display = "block";
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
    // Skip iframes; only run in top frame
    if (window.top !== window.self) return;

    waitForDependencies(() => {
      // Streamed updates (SPAs, dynamic content, etc.)
      window.ScribbitMessaging.onRiskUpdated((payload) => {
        updatePanel(payload);
      });

      // Initial state on first load
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
