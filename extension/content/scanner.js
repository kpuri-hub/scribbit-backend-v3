// content/scanner.js
// Scribbit Fairness Scanner - Page Scanner
//
// Responsibilities:
// - Extract a lightweight snapshot of the current page
// - Detect basic currency markers
// - Call ScribbitRiskEngine to get a risk result
// - Send the result to background via ScribbitMessaging
//
// This is intentionally simple for the MVP vertical slice. Later, you can:
// - Plug in selectors.js for site-specific extraction (Airbnb, Booking, etc.)
// - Use feeParser.js and currencyDetector.js for richer input
// - Support incremental rescans on DOM changes

(function () {
  const MAX_TEXT_LENGTH = 50000; // prevent huge pages from blowing up messages

  function waitForDependencies(callback) {
    const maxAttempts = 50;
    let attempts = 0;

    const interval = setInterval(() => {
      const hasMessaging = !!window.ScribbitMessaging;
      const hasRiskEngine = !!window.ScribbitRiskEngine;

      if (hasMessaging && hasRiskEngine) {
        clearInterval(interval);
        callback();
        return;
      }

      attempts += 1;
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        console.warn("[Scribbit] scanner.js: dependencies not available, aborting initial scan.");
      }
    }, 200);
  }

  function extractPageText() {
    if (!document.body) return "";
    const text = document.body.innerText || "";
    if (text.length <= MAX_TEXT_LENGTH) return text;
    return text.slice(0, MAX_TEXT_LENGTH);
  }

  function detectCurrencyMarkers(rawText) {
    const markers = new Set();

    // Basic symbols
    const symbolMatches = rawText.match(/[$€£¥]/g);
    if (symbolMatches) {
      symbolMatches.forEach((s) => markers.add(s));
    }

    // Common currency codes (case-insensitive)
    const codeMatches = rawText.match(/\b(USD|CAD|EUR|GBP|AUD|NZD)\b/gi);
    if (codeMatches) {
      codeMatches.forEach((c) => markers.add(c.toUpperCase()));
    }

    // If a dedicated currencyDetector exists, let it enhance the markers
    try {
      if (window.ScribbitCurrencyDetector && typeof window.ScribbitCurrencyDetector.detect === "function") {
        const extra = window.ScribbitCurrencyDetector.detect(rawText);
        if (Array.isArray(extra)) {
          extra.forEach((m) => markers.add(m));
        }
      }
    } catch (err) {
      console.warn("[Scribbit] currencyDetector threw an error:", err);
    }

    return Array.from(markers);
  }

  function buildSnapshot() {
    const rawText = extractPageText();
    const textNormalized = rawText.toLowerCase();

    return {
      url: window.location.href,
      textRaw: rawText,
      textNormalized,
      currencySymbolsDetected: detectCurrencyMarkers(rawText)
    };
  }

  async function runInitialScan() {
    const snapshot = buildSnapshot();
    const riskResult = window.ScribbitRiskEngine.evaluatePage(snapshot);

    const payload = {
      url: snapshot.url,
      riskResult
    };

    try {
      const res = await window.ScribbitMessaging.sendScanComplete(payload);
      if (!res || !res.ok) {
        console.warn("[Scribbit] Scan reporting failed:", res);
      }
    } catch (err) {
      console.error("[Scribbit] Error sending scan result:", err);
    }
  }

  function init() {
    waitForDependencies(() => {
      runInitialScan();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
