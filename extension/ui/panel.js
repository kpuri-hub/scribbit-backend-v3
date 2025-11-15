// ui/panel.js
// Scribbit Fairness Scanner - On-page Panel
//
// Renders a small, fixed-position panel showing the current risk level
// and a few key findings. Subscribes to risk updates from the background
// via ScribbitMessaging.
//
// New in this version:
// - Shows Scribbit icon in the header
// - Close (X) button to hide the panel
// - Click header to collapse/expand details

(function () {
  const PANEL_ID = "scribbit-fairness-panel";
  const PANEL_COLLAPSED_CLASS = "scribbit-panel-collapsed";

  function injectStylesheet() {
    try {
      const existing = document.querySelector(`link[data-scribbit-panel-css="1"]`);
      if (existing) return;

      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.type = "text/css";
      link.href = chrome.runtime.getURL("ui/panel.css");
      link.dataset.scribbitPanelCss = "1";
      document.head.appendChild(link);
    } catch (err) {
      console.warn("[Scribbit] Failed to inject panel CSS:", err);
    }
  }

  function createPanelElement() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = PANEL_ID;

    panel.innerHTML = `
      <div class="scribbit-panel-header">
        <div class="scribbit-panel-header-left">
          <img class="scribbit-panel-logo" id="scribbit-panel-logo" alt="Scribbit" />
          <span class="scribbit-panel-title">Scribbit Scan</span>
        </div>
        <div class="scribbit-panel-header-right">
          <span class="scribbit-panel-badge scribbit-level-low" id="scribbit-panel-level-badge">LOW</span>
          <button class="scribbit-panel-close" id="scribbit-panel-close" title="Hide Scribbit panel">×</button>
        </div>
      </div>
      <div class="scribbit-panel-body" id="scribbit-panel-body">
        <div class="scribbit-panel-score" id="scribbit-panel-score">Score: 0</div>
        <ul class="scribbit-panel-risks" id="scribbit-panel-risks">
          <li class="scribbit-panel-risk-item scribbit-empty">No issues detected yet.</li>
        </ul>
      </div>
    `;

    document.body.appendChild(panel);

    // Set logo src via chrome.runtime.getURL so it works from the extension bundle
    try {
      const logoEl = panel.querySelector("#scribbit-panel-logo");
      if (logoEl) {
        logoEl.src = chrome.runtime.getURL("assets/icons/icon32.png");
      }
    } catch (err) {
      console.warn("[Scribbit] Failed to set panel logo:", err);
    }

    // Wire close button
    const closeBtn = panel.querySelector("#scribbit-panel-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        panel.style.display = "none";
        // Optional: remember closed state for this page load
        window.__scribbitPanelClosed = true;
      });
    }

    // Toggle collapse/expand when clicking header (except close button)
    const headerEl = panel.querySelector(".scribbit-panel-header");
    if (headerEl) {
      headerEl.addEventListener("click", (e) => {
        // If the close button was clicked, let its handler run instead
        if ((e.target && e.target.id === "scribbit-panel-close") || e.target.closest("#scribbit-panel-close")) {
          return;
        }
        panel.classList.toggle(PANEL_COLLAPSED_CLASS);
      });
    }

    return panel;
  }

  function updatePanel(riskState) {
    if (!riskState || !riskState.riskResult) return;

    const { riskResult } = riskState;
    const levelBadge = document.getElementById("scribbit-panel-level-badge");
    const scoreEl = document.getElementById("scribbit-panel-score");
    const risksList = document.getElementById("scribbit-panel-risks");

    if (!levelBadge || !scoreEl || !risksList) return;

    // Update level text and class
    const level = riskResult.overallLevel || "LOW";
    levelBadge.textContent = level;

    levelBadge.classList.remove(
      "scribbit-level-low",
      "scribbit-level-medium",
      "scribbit-level-high"
    );
    if (level === "HIGH") {
      levelBadge.classList.add("scribbit-level-high");
    } else if (level === "MEDIUM") {
      levelBadge.classList.add("scribbit-level-medium");
    } else {
      levelBadge.classList.add("scribbit-level-low");
    }

    // Update score
    scoreEl.textContent = `Score: ${riskResult.overallScore || 0}`;

    // Update risk list
    risksList.innerHTML = "";
    if (!riskResult.risks || riskResult.risks.length === 0) {
      const li = document.createElement("li");
      li.className = "scribbit-panel-risk-item scribbit-empty";
      li.textContent = "No obvious risks detected.";
      risksList.appendChild(li);
      return;
    }

    riskResult.risks.slice(0, 3).forEach((risk) => {
      const li = document.createElement("li");
      li.className = "scribbit-panel-risk-item";

      const severityClass =
        risk.severity === "HIGH"
          ? "scribbit-severity-high"
          : risk.severity === "MEDIUM"
          ? "scribbit-severity-medium"
          : "scribbit-severity-low";

      li.innerHTML = `
        <div class="scribbit-risk-label">
          <span class="scribbit-severity-dot ${severityClass}"></span>
          ${risk.label}
        </div>
      `;
      risksList.appendChild(li);
    });
  }

  function requestInitialState() {
    if (!window.ScribbitMessaging) return;

    window.ScribbitMessaging
      .requestCurrentRisk()
      .then((res) => {
        if (res && res.ok && res.risk) {
          updatePanel(res.risk);
        }
      })
      .catch((err) => {
        console.warn("[Scribbit] Failed to request initial risk:", err);
      });
  }

  function init() {
    // If user already closed it on this page load, don't recreate
    if (window.__scribbitPanelClosed) return;

    injectStylesheet();
    createPanelElement();

    if (!window.ScribbitMessaging) {
      console.warn("[Scribbit] ScribbitMessaging not available for panel.");
      return;
    }

    // Subscribe to live updates
    window.ScribbitMessaging.onRiskUpdated((riskState) => {
      updatePanel(riskState);
    });

    // Ask background for the current state (for pages already scanned)
    requestInitialState();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
