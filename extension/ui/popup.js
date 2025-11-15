// ui/popup.js
// Scribbit Fairness Scanner - Popup Script
//
// Responsibilities:
// - Identify the active tab
// - Ask background for current risk for that tab
// - Render results in the popup

async function getActiveTabId() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
        resolve(null);
        return;
      }
      resolve(tabs[0].id);
    });
  });
}

async function fetchRiskForTab(tabId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "SCRIBBIT_GET_CURRENT_RISK",
        payload: { tabId }
      },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      }
    );
  });
}

function updatePopup(riskState) {
  const badge = document.getElementById("risk-level-badge");
  const scoreEl = document.getElementById("risk-score");
  const list = document.getElementById("risk-list");

  if (!riskState || !riskState.riskResult) {
    badge.textContent = "LOW";
    badge.className = "risk-level-badge low";
    scoreEl.textContent = "Score: 0";
    list.innerHTML = `<li class="empty">No data yet. Try refreshing the page.</li>`;
    return;
  }

  const { riskResult } = riskState;

  // Level badge
  const level = riskResult.overallLevel || "LOW";
  badge.textContent = level;
  badge.className = "risk-level-badge " + level.toLowerCase();

  // Score
  scoreEl.textContent = `Score: ${riskResult.overallScore ?? 0}`;

  // List
  list.innerHTML = "";

  if (!riskResult.risks || riskResult.risks.length === 0) {
    list.innerHTML = `<li class="empty">No obvious risks detected.</li>`;
    return;
  }

  riskResult.risks.slice(0, 5).forEach((r) => {
    const li = document.createElement("li");
    li.className = "risk-item";

    const dotClass =
      r.severity === "HIGH"
        ? "dot-high"
        : r.severity === "MEDIUM"
        ? "dot-medium"
        : "dot-low";

    li.innerHTML = `
      <span class="dot ${dotClass}"></span>
      ${r.label}
    `;

    list.appendChild(li);
  });
}

async function init() {
  const tabId = await getActiveTabId();
  if (!tabId) {
    updatePopup(null);
    return;
  }

  const res = await fetchRiskForTab(tabId);
  if (!res || !res.ok) {
    updatePopup(null);
    return;
  }

  updatePopup(res.risk);
}

document.addEventListener("DOMContentLoaded", init);
