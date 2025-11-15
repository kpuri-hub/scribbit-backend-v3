// background.js
// Scribbit Fairness Scanner - Background Service Worker (Manifest V3)
//
// Responsibilities:
// - Listen for messages from content scripts and popup
// - Store latest risk results per tab in memory
// - Serve current risk state to popup or other requesters
//
// NOTE: Storage here is ephemeral (lives as long as the service worker).
// For Phase 2 analytics, this is where you'd optionally forward events
// to a backend API.

const latestRiskByTabId = {}; // { [tabId]: { timestamp, url, riskSummary } }

// Utility: safely get tabId from sender
function getSenderTabId(sender) {
  return sender && sender.tab && typeof sender.tab.id === "number"
    ? sender.tab.id
    : null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message || {};
  const tabId = getSenderTabId(sender);

  // Simple ping for debugging / health checks
  if (type === "SCRIBBIT_PING") {
    sendResponse({ ok: true, source: "background", timestamp: Date.now() });
    return; // no async work, no need to return true
  }

  // Content script reports a completed scan
  if (type === "SCRIBBIT_SCAN_COMPLETE") {
    if (tabId === null) {
      console.warn("[Scribbit] SCRIBBIT_SCAN_COMPLETE without tabId", message);
      sendResponse({ ok: false, error: "NO_TAB_ID" });
      return;
    }

    // Expected payload shape (enforced by content side):
    // {
    //   url: string,
    //   riskResult: {
    //     overallScore: number,
    //     overallLevel: "LOW" | "MEDIUM" | "HIGH",
    //     risks: Array<{ id, label, severity, evidence }>
    //   }
    // }
    latestRiskByTabId[tabId] = {
      ...payload,
      tabId,
      timestamp: Date.now()
    };

    // Optional: broadcast to all content scripts in this tab (e.g., panel.js)
    chrome.tabs.sendMessage(tabId, {
      type: "SCRIBBIT_RISK_UPDATED",
      payload: latestRiskByTabId[tabId]
    }, () => {
      // Ignore errors if no listener exists
      if (chrome.runtime.lastError) {
        // Helpful for debugging, but non-fatal
        // console.debug("[Scribbit] No listener for SCRIBBIT_RISK_UPDATED", chrome.runtime.lastError.message);
      }
    });

    sendResponse({ ok: true });
    return; // sync response
  }

  // Popup (or other scripts) asking for current risk on a tab
  if (type === "SCRIBBIT_GET_CURRENT_RISK") {
    // Caller can either:
    // - rely on sender.tab.id (if content script)
    // - specify tabId in payload (e.g., popup after chrome.tabs.query)
    const requestedTabId = payload && typeof payload.tabId === "number"
      ? payload.tabId
      : tabId;

    if (requestedTabId === null) {
      sendResponse({ ok: false, error: "NO_TAB_ID" });
      return;
    }

    const risk = latestRiskByTabId[requestedTabId] || null;
    sendResponse({ ok: true, risk });
    return;
  }

  // Unknown message type (safe no-op with warning)
  console.warn("[Scribbit] Unknown message type in background:", type, message);
  sendResponse({ ok: false, error: "UNKNOWN_MESSAGE_TYPE", type });

  // No async work, so no need to return true here either
});
