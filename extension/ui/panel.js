// ui/panel.js
// Scribbit Fairness Scanner - On-page Panel
// Features:
// - Does NOT show on search engines
// - Does NOT show when risks == 0
// - Collapse/expand
// - Close button
// - Mute site (1h, 1d, 1w, forever)
// - Scribbit logo

(function () {
  const PANEL_ID = "scribbit-fairness-panel";
  const STORAGE_KEY = "scribbitMuteRules";

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
   * STORAGE HELPERS
   **********************************************************/
  function isHostMuted(callback) {
    chrome.storage.local.get([STORAGE_KEY], (data) => {
      const rules = data?.[STORAGE_KEY] || {};
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
      const rules = data?.[STORAGE_KEY] || {};
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

    panel.innerHTML = `
      <div class="scribbit-panel-header">
        <div class="scribbit-panel-header-left">
          <img class="scribbit-panel-logo" id="scribbit-panel-logo" />
          <span class="scribbit-panel-title">Scribbit Scan</span>
        </div>
        <div class="scribbit-panel-header-right">
          <span class="scribbit-panel-badge" id="scribbit-panel-level">LOW</span>
          <button class="scribbit-panel-close" id="scribbit-panel-close">×</button>
        </div>
      </div>

      <div class="scribbit-panel-body">
        <div class="scribbit-panel-score" id="scribbit-panel-score">Score: 0</div>

        <ul class="scribbit-panel-risks" id="scribbit-panel-risks">
          <li class="scribbit-panel-risk-item scribbit-empty">Scanning...</li>
        </ul>

        <div class="scribbit-panel-mute-row">
          <button class="scribbit-panel-mute-toggle" id="scribbit-mute-toggle">
            Mute this site
          </button>
          <div class="scribbit-panel-mute-options" id="scribbit-mute-options">
            <button class="scribbit-panel-mute-option" data-mute="1h">1h</button>
            <button class="scribbit-panel-mute-option" data-mute="1d">1d</button>
            <button class="scribbit-panel-mute-option" data-mute="1w">1w</button>
            <button class="scribbit-panel-mute-option" data-mute="forever">∞</button>
          </div>
        </div>
      </div>
    `;

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

    // Collapse/expand
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

    // Show now that we have risks
    panel.style.display = "block";

    const levelBadge = document.getElementById("scribbit-panel-level");
    const scoreEl = document.getElementById("scribbit-panel-score");
    const listEl = document.getElementById("scribbit-panel-risks");

    // Update level & score
    levelBadge.textContent = result.overallLevel;
    scoreEl.textContent = `Score: ${result.overallScore}`;

    // Update risks
    listEl.innerHTML = "";
    result.risks.slice(0, 3).forEach((risk) => {
      const li = document.createElement("li");
      li.className = "scribbit-panel-risk-item";
      li.textContent = risk.label;
      listEl.appendChild(li);
    });
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
        if (res.ok && res.risk) updatePanel(res.risk);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
