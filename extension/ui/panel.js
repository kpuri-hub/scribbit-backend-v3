// ui/panel.js
// Scribbit Fairness Scanner - On-page Panel
//
// Renders a small, fixed-position panel showing the current risk level
// and a few key findings. Subscribes to risk updates from the background
// via ScribbitMessaging.
//
// Features:
// - Scribbit icon in the header
// - Close (X) button to hide the panel for this page load
// - Click header to collapse/expand details
// - "Mute this site" controls: 1 hour, 1 day, 1 week, indefinitely
//   stored per hostname in chrome.storage.local

(function () {
  const PANEL_ID = "scribbit-fairness-panel";
  const PANEL_COLLAPSED_CLASS = "scribbit-panel-collapsed";
  const STORAGE_KEY = "scribbitMuteRules";

  function getHost() {
    try {
      return window.location.hostname || "";
    } catch {
      return "";
    }
  }

  function isHostMuted(callback) {
    const host = getHost();
    if (!host) {
      callback(false);
      return;
    }

    chrome.storage.local.get([STORAGE_KEY], (data) => {
      const rules = data && data[STORAGE_KEY] ? data[STORAGE_KEY] : {};
      const entry = rules[host];

      if (!entry) {
        callback(false);
        return;
      }

      const now = Date.now();
      const { until } = entry; // number timestamp or null for indefinite

      if (until === null) {
        // Muted indefinitely
        callback(true);
        return;
      }

      if (typeof until === "number" && until > now) {
        // Still within mute window
        callback(true);
        return;
      }

      // Mute expired → clean up this entry
      delete rules[host];
      chrome.storage.local.set({ [STORAGE_KEY]: rules }, () => {
        callback(false);
      });
    });
  }

  function setHostMute(durationMsOrNull) {
    const host = getHost();
    if (!host) return;

    chrome.storage.local.get([STORAGE_KEY], (data) => {
      const rules = data && data[STORAGE_KEY] ? data[STORAGE_KEY] : {};
      const until =
        durationMsOrNull === null ? null : Date.now() + durationMsOrNull;

      rules[host] = { until };
      chrome.storage.local.set({ [STORAGE_KEY]: rules }, () => {
        // Hide the panel immediately on this page
        const panel = document.getElementById(PANEL_ID);
        if (panel) {
          panel.style.display = "none";
        }
        window.__scribbitPanelClosed = true;
      });
    });
  }

  function injectStylesheet() {
    try {
      const existing = document.querySelector(
        `link[data-scribbit-panel-css="1"]`
      );
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
        <div class="scribbit-panel-mute-row">
          <button class="scribbit-panel-mute-toggle" id="scribbit-panel-mute-toggle">
            Mute this site
          </button>
          <div class="scribbit-panel-mute-options" id="scribbit-panel-mute-options">
            <button class="scribbit-panel-mute-option" data-mute="1h">1h</button>
            <button class="scribbit-panel-mute-option" data-mute="1d">1d</button>
            <button class="scribbit-panel-mute-option" data-mute="1w">1w</button>
            <button class="scribbit-panel-mute-option" data-mute="forever">∞</button>
          </div>
        </div>
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

    // Wire close button (only for current page load)
    const closeBtn = panel.querySelector("#scribbit-panel-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        panel.style.display = "none";
        window.__scribbitPanelClosed = true;
      });
    }

    // Toggle collapse/expand when clicking header (except close button)
    const headerEl = panel.querySelector(".scribbit-panel-header");
    if (headerEl) {
      headerEl.addEventListener("click", (e) => {
        if (
          (e.target && e.target.id === "scribbit-panel-close") ||
          e.target.closest("#scribbit-panel-close")
        ) {
          return;
        }
        panel.classList.toggle(PANEL_COLLAPSED_CLASS);
      });
    }

    // Mute toggle & options
    const muteToggle = panel.querySelector("#scribbit-panel-mute-toggle");
    const muteOptions = panel.querySelector("#scribbit-panel-mute-options");

    if (muteToggle && muteOptions) {
      muteToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const isVisible = muteOptions.classList.contains(
          "scribbit-panel-mute-options-visible"
        );
        if (isVisible) {
          muteOptions.classList.remove("scribbit-panel-mute-options-visible");
        } else {
          muteOptions.classList.add("scribbit-panel-mute-options-visible");
        }
      });

      muteOptions.addEventListener("click", (e) => {
        e.stopPropagation();
        const btn = e.target.closest(".scribbit-panel-mute-option");
        if (!btn) return;

        const val = btn.getAttribute("data-mute");
        let durationMsOrNull = null;

        if (val === "1h") {
          durationMsOrNull = 60 * 60 * 1000;
        } else if (val === "1d") {
          durationMsOrNull = 24 * 60 * 60 * 1000;
        } else if (val === "1w") {
          durationMsOrNull = 7 * 24 * 60 * 60 * 1000;
        } else if (val === "forever") {
          durationMsOrNull = null; // indefinite
        }

        setHostMute(durationMsOrNull);
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

    window.ScribbitMessaging.requestCurrentRisk()
      .then((res) => {
        if (res && res.ok && res.risk) {
          updatePanel(res.risk);
        }
      })
      .catch((err) => {
        console.warn("[Scribbit] Failed to request initial risk:", err);
      });
  }

  function initAfterMuteCheck(isMuted) {
    if (isMuted) {
      // Site is muted → do not render panel
      return;
    }

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

  function init() {
    // Check mute first (asynchronous)
    isHostMuted((muted) => {
      initAfterMuteCheck(muted);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
