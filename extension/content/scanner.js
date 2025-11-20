// content/scanner.js
// Scribbit Fairness Scanner - Page Scanner
//
// Adds:
// - Airbnb dynamic fee extraction
// - DOM mutation observer (for late-loaded Airbnb UI)
// - Keeps all original architecture intact

(function () {
  const MAX_TEXT_LENGTH = 50000;

  const SEARCH_ENGINE_HOSTS = [
    "www.google.com",
    "google.com",
    "www.bing.com",
    "bing.com",
    "search.yahoo.com",
    "duckduckgo.com",
    "www.duckduckgo.com"
  ];

  function isSearchEngineHost(hostname) {
    return SEARCH_ENGINE_HOSTS.includes(hostname);
  }

  /* -------------------------------------------------------
   * Airbnb dynamic fee extraction
   * ----------------------------------------------------- */
  function extractAirbnbFees() {
    const selectors = [
      '[data-testid="price-breakdown-row"]',
      '[data-testid="price-breakdown-item"]',
      '[data-testid="fee-row"]',
      '[data-section-id="BOOK_IT_SIDEBAR_PRICE"]',
      'div[aria-label="Price details"]',
      '._tt122m' // known Airbnb price section class (may change)
    ];

    let fees = [];

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        const txt = el.innerText || el.textContent || "";
        if (txt.trim().length > 0) {
          fees.push(txt.trim());
        }
      });
    });

    return fees;
  }

  /* -------------------------------------------------------
   * Core text extraction
   * ----------------------------------------------------- */
  function extractPageText() {
    if (!document.body) return "";

    // Avoid scanning Scribbit's own panel text (which appears in document.body)
    const panel = document.getElementById("scribbit-fairness-panel");
    const prevDisplay = panel ? panel.style.display : null;
    if (panel) {
      // Hide panel while we read innerText so its content isn't included
      panel.style.display = "none";
    }

    const raw = document.body.innerText || "";

    if (panel && prevDisplay !== null) {
      panel.style.display = prevDisplay;
    }

    return raw.length <= MAX_TEXT_LENGTH ? raw : raw.slice(0, MAX_TEXT_LENGTH);
  }

  function detectCurrencyMarkers(rawText) {
    const markers = new Set();

    const symbolMatches = rawText.match(/[$€£¥]/g);
    if (symbolMatches) symbolMatches.forEach(s => markers.add(s));

    const codeMatches = rawText.match(/\b(USD|CAD|EUR|GBP|AUD|NZD)\b/gi);
    if (codeMatches) codeMatches.forEach(c => markers.add(c.toUpperCase()));

    try {
      if (
        window.ScribbitCurrencyDetector &&
        typeof window.ScribbitCurrencyDetector.detect === "function"
      ) {
        const extra = window.ScribbitCurrencyDetector.detect(rawText);
        if (Array.isArray(extra)) extra.forEach(m => markers.add(m));
      }
    } catch (err) {
      console.warn("[Scribbit] currencyDetector error:", err);
    }

    return Array.from(markers);
  }

  /* -------------------------------------------------------
   * Snapshot builder
   * ----------------------------------------------------- */
  function buildSnapshot() {
    const rawText = extractPageText();
    const textNormalized = rawText.toLowerCase();

    const airbnbFees = extractAirbnbFees();

    return {
      url: window.location.href,
      textRaw: rawText,
      textNormalized,
      currencySymbolsDetected: detectCurrencyMarkers(rawText),
      airbnbFees
    };
  }

  /* -------------------------------------------------------
   * Scanning & messaging
   * ----------------------------------------------------- */
  async function runScan() {
    const snapshot = buildSnapshot();
    const riskResult = window.ScribbitRiskEngine.evaluatePage(snapshot);

    try {
      await window.ScribbitMessaging.sendScanComplete({
        url: snapshot.url,
        riskResult
      });
    } catch (err) {
      console.error("[Scribbit] sendScanComplete error:", err);
    }
  }

  function waitForDependencies(callback) {
    let tries = 0;
    const max = 50;

    const interval = setInterval(() => {
      if (window.ScribbitMessaging && window.ScribbitRiskEngine) {
        clearInterval(interval);
        callback();
      } else if (tries++ >= max) {
        clearInterval(interval);
        console.warn("[Scribbit] scanner.js: dependencies missing");
      }
    }, 200);
  }

  function init() {
    const hostname = window.location.hostname;
    if (isSearchEngineHost(hostname)) {
      console.debug("[Scribbit] scanner: skipping search engine:", hostname);
      return;
    }

    waitForDependencies(() => {
      runScan();

      // Re-scan when Airbnb loads dynamic fees (3-second window)
      const observer = new MutationObserver(() => {
        runScan();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      setTimeout(() => observer.disconnect(), 3000);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
