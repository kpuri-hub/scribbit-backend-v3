// content/messaging.js
// Scribbit Fairness Scanner - Content Script Messaging Helpers
//
// Responsibilities:
// - Provide a small, consistent API for content scripts to:
//   - ping the background (for debug)
//   - send scan results
//   - request current risk state
//   - subscribe to live risk updates (from background)
//
// This keeps message types centralized and avoids stringly-typed chaos
// across multiple files.

const ScribbitMessaging = (() => {
  const MESSAGE_TYPES = {
    PING: "SCRIBBIT_PING",
    SCAN_COMPLETE: "SCRIBBIT_SCAN_COMPLETE",
    GET_CURRENT_RISK: "SCRIBBIT_GET_CURRENT_RISK",
    RISK_UPDATED: "SCRIBBIT_RISK_UPDATED"
  };

  /**
   * Low-level helper to send a message to the background.
   * Wraps chrome.runtime.sendMessage in a Promise.
   */
  function sendMessageToBackground(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            console.warn("[Scribbit] Messaging error:", chrome.runtime.lastError.message);
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response);
        });
      } catch (err) {
        console.error("[Scribbit] Failed to send message to background:", err);
        resolve({ ok: false, error: String(err) });
      }
    });
  }

  /**
   * Simple ping to verify background connectivity.
   * Useful for debugging or health checks.
   */
  async function ping() {
    return sendMessageToBackground({ type: MESSAGE_TYPES.PING });
  }

  /**
   * Notify background that a page scan has completed.
   *
   * @param {Object} scanPayload - Expected shape:
   * {
   *   url: string,
   *   riskResult: {
   *     overallScore: number,
   *     overallLevel: "LOW" | "MEDIUM" | "HIGH",
   *     risks: Array<{ id, label, severity, evidence }>
   *   }
   * }
   */
  async function sendScanComplete(scanPayload) {
    if (!scanPayload || !scanPayload.url || !scanPayload.riskResult) {
      console.warn("[Scribbit] Invalid scan payload:", scanPayload);
    }

    return sendMessageToBackground({
      type: MESSAGE_TYPES.SCAN_COMPLETE,
      payload: scanPayload
    });
  }

  /**
   * Request the current risk state for this tab.
   * Typically used by:
   * - other content scripts (e.g., panel injected later)
   * - popup.js (via its own call to sendMessageToBackground)
   *
   * @param {number|null} [tabId] - Optional. If omitted, background will infer from sender.
   */
  async function requestCurrentRisk(tabId = null) {
    return sendMessageToBackground({
      type: MESSAGE_TYPES.GET_CURRENT_RISK,
      payload: tabId !== null ? { tabId } : {}
    });
  }

  /**
   * Subscribe to risk update events flowing from background.
   * The callback will be called whenever a "SCRIBBIT_RISK_UPDATED"
   * message is received in this content script context.
   *
   * @param {Function} callback - (riskPayload) => void
   */
  function onRiskUpdated(callback) {
    if (typeof callback !== "function") {
      console.warn("[Scribbit] onRiskUpdated called without a function");
      return;
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message && message.type === MESSAGE_TYPES.RISK_UPDATED) {
        callback(message.payload);
        // No response needed for this kind of event
      }
    });
  }

  // Public API
  return {
    MESSAGE_TYPES,
    ping,
    sendScanComplete,
    requestCurrentRisk,
    onRiskUpdated
  };
})();

// Expose to other content scripts in this isolated world.
// Example from scanner.js or riskEngine.js:
//    ScribbitMessaging.sendScanComplete({ url, riskResult })
window.ScribbitMessaging = ScribbitMessaging;
