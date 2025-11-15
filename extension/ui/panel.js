// ui/panel.js
// Scribbit Fairness Scanner - On-page Panel with:
// - No appearance on search engines
// - No appearance when there are zero risks
// - Collapse, close, mute functionality

(function () {
  const PANEL_ID = "scribbit-fairness-panel";
  const STORAGE_KEY = "scribbitMuteRules";
  const BLOCKED_HOSTS = [
    "google.com",
    "www.google.com",
    "bing.com",
    "www.bing.com",
    "search.yahoo.com",
    "duckduckgo.com",
    "www.duckduckgo.com"
  ];

  // 1) Do not run on search engines
  const host = window.location.hostname;
  if (BLOCKED_HOSTS.includes(host)) {
    console.log("[Scribbit] Panel suppressed on search engine:", host);
    return;
  }

  function isHostMuted(callback) {
    chrome.storage.local.get([STORAGE_KEY], (data) => {
      const rules = data && data[STORAGE_KEY] ? data[STORAGE_KEY] : {};
      const entry = rules[host];

      if (!entry) return callback(false);

      if (entry.until === null) return callback(true);

      if (typeof entry.until === "number" && entry.until > Date.now()) {
        return callback(true);
      }

      // Mute expired → cleanup
      delete rules[host];
      chrome.storage.local.set({ [STORAGE_KEY]: rules }, () => callback(false));
    });
  }

  function injectStylesheet() {
    const existing = document.querySelector(`link[data-scribbit-panel-css="1"]`);
    if (existing) return;

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
    panel.style.display = "none"; // default hidden until real risk appears

    panel.innerHTML = `
      <div class="scribbit-panel-header">
        <div class="scribbit-panel-header-left">
          <img class="scribbit-panel-logo" id="scribbit-panel-logo" />
          <span class="scribbit-panel-title">Scribbit Scan</span>
        </div>

        <div class="scribbit-panel-header-right">
          <span class="scribbit-panel-badge" id="scribbit-panel-level">LOW</span>
          <button class="scribbit-panel-close" id="scribbit-close-btn">×</button>
        </div>
      </div>

      <div class="scribbit-panel-body">
        <div class="scribbit-panel-score" id="scribbit-score">Score: 0</div>
        <ul class="scribbit-panel-risks" id="scribbit-risks">
          <li>Loading...</li>
        </ul>

        <div class="scribbit-panel-mute-row">
          <button class="scribbit-panel-mute-toggle" id="scribbit-mute-btn">Mute this site</button>
          <div class="scribbit-panel-mute-options" id="scribbit-mute-options">
            <button data-mute="1h">1h</button>
            <button data-mute="1d">1d</button>
            <button data-mute="1w">1w</button>
            <button data-mute="forever">∞</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    // Set icon
    panel.querySelector("#scribbit-panel-logo").src =
      chrome.runtime.getURL("assets/icons/icon32.png");

    // Close button
    panel.querySelector("#scribbit-close-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      panel.style.display = "none";
      window.__scribbitPanelClosed = true;
    });

    // Collapse header
    panel.querySelector(".scribbit-panel-header").addEventListener("click", (e) => {
      if (e.target.id === "scribbit-close-btn") return;
      panel.classList.toggle("collapsed");
    });

    // Mute logic
    const muteToggle = panel.querySelector("#scribbit-mute-btn");
    const muteOptions = panel.querySelector("#scribbit-mute-options");

    muteToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      muteOptions.classList.toggle("visible");
    });

    muteOptions.addEventListener("click", (e) => {
      const val = e.target.getAttribute("data-mute");
      if (!val) return;

      let duration;
      if (val === "1h") duration = 1 * 60 * 60 * 1000;
      if (val === "1d") duration = 24 * 60 * 60 * 1000;
      if (val === "1w") duration = 7 * 24 * 60 * 60 * 1000;
      if (val === "forever") duration = null;

      chrome.storage.local.get([STORAGE_KEY], (data) => {
        const rules = data[STORAGE_KEY] || {};
        rules[host] = { until: duration === null ? null : Date.now() + duration };
        chrome.storage.local.set({ [STORAGE_KEY]: rules });
        panel.style.display = "none";
      });
    });

    return panel;
  }

  function updatePanel(riskState) {
    if (!riskState || !riskState.riskResult) return;

    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const result = riskState.riskResult;

    // 2) DO NOT show panel if there are ZERO risks
    if (!result.risks || result.risks.length === 0) {
      panel.style.display = "none";
      return;
    }

    // Show
    panel.style.display = "block";

    const badge = document.getElementById("scribbit-panel-level");
    const score = document.getElementById("scribbit-score");
    const risks = document.getElementById("scribbit-risks");

    badge.textContent = result.overallLevel;
    score.textContent = "Score: " + result.overallScore;

    risks.innerHTML = "";
    result.risks.slice(0, 3).forEach((r) => {
      const li = document.createElement("li");
      li.textContent = r.label;
      risks.appendChild(li);
    });
  }

  function init() {
    isHostMuted((muted) => {
      if (muted) return;

      injectStylesheet();
      createPanel();

      if (!window.ScribbitMessaging) return;

      // Subscribe to updates
      window.ScribbitMessaging.onRiskUpdated((risk) => {
        updatePanel(risk);
      });

      // Request initial risk
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
