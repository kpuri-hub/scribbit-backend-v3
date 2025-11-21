// content/scanner.js
// Scribbit Fairness Scanner - Page Scanner
//
// Responsibilities:
// - Build a normalized snapshot of the page text
// - Add Airbnb-specific fee extraction & currency markers
// - Decide WHEN to scan (skip search engines, blocked domains, search results pages)
// - Call ScribbitRiskEngine.evaluatePage(snapshot)
// - Send results via ScribbitMessaging.sendScanComplete
//
// This file runs as a content script on matching pages.

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

  // Domains where Scribbit should NEVER scan or show up
  const BLOCKED_DOMAINS = [
    // Webmail
    "mail.google.com",
    "inbox.google.com",
    "outlook.live.com",
    "outlook.office.com",
    "mail.yahoo.com",
    "mail.aol.com",

    // Docs & storage
    "docs.google.com",
    "drive.google.com",
    "onedrive.live.com",
    "www.dropbox.com",

    // General productivity / collaboration
    "teams.microsoft.com",
    "slack.com",
    "app.slack.com",
    "notion.so",
    "www.notion.so"
  ];

  function isSearchEngineHost(hostname) {
    return SEARCH_ENGINE_HOSTS.includes(hostname);
  }

  function isBlockedDomain(hostname) {
    if (!hostname) return false;
    return BLOCKED_DOMAINS.some((blocked) => {
      return hostname === blocked || hostname.endsWith("." + blocked);
    });
  }

  /**
   * Heuristic: detect search results pages we never want to scan.
   * - Booking.com-specific: URLs containing "searchresults"
   * - Generic: URLs containing "searchresults" or "/search?"
   */
  function isSearchResultsPage(hostname, url) {
    const host = (hostname || "").toLowerCase();
    const href = (url || "").toLowerCase();

    // Booking.com search results (e.g. ...booking.com/searchresults...)
    if (host.endsWith("booking.com") && href.includes("searchresults")) {
      return true;
    }

    // Generic search-results-y URL shapes
    if (href.includes("searchresults")) return true;
    if (href.includes("/search?")) return true;

    return false;
  }

  function extractPageText() {
    if (!document.body) return "";
    const raw = document.body.innerText || "";
    return raw.length <= MAX_TEXT_LENGTH ? raw : raw.slice(0, MAX_TEXT_LENGTH);
  }

  function detectCurrencyMarkers(rawText) {
    const markers = new Set();

    const symbolMatches = rawText.match(/[$€£¥]/g);
    if (symbolMatches) symbolMatches.forEach((s) => markers.add(s));

    const codeMatches = rawText.match(/\b(USD|CAD|EUR|GBP|AUD|NZD)\b/gi);
    if (codeMatches) codeMatches.forEach((c) => markers.add(c.toUpperCase()));

    try {
      if (
        window.ScribbitCurrencyDetector &&
        typeof window.ScribbitCurrencyDetector.detect === "function"
      ) {
        const extra = window.ScribbitCurrencyDetector.detect(rawText);
        if (Array.isArray(extra)) extra.forEach((m) => markers.add(m));
      }
    } catch (err) {
      console.warn("[Scribbit] currencyDetector error:", err);
    }

    return Array.from(markers);
  }

  // Airbnb-specific fee extraction
  function extractAirbnbFees() {
    const fees = [];

    try {
      const candidateNodes = Array.from(
        document.querySelectorAll("div, span, li")
      ).slice(0, 3000);

      const feePatterns = [
        /cleaning fee/i,
        /service fee/i,
        /Airbnb service fee/i,
        /occupancy taxes?/i,
        /tourism fee/i,
        /resort fee/i
      ];

      for (const node of candidateNodes) {
        const text = (node.innerText || "").trim();
        if (!text) continue;

        const lower = text.toLowerCase();

        let matchedPattern = null;
        for (const p of feePatterns) {
          if (p.test(lower)) {
            matchedPattern = p;
            break;
          }
        }
        if (!matchedPattern) continue;

        const amountMatch = text.match(/[$€£¥]\s*\d+[\d.,]*/);
        if (!amountMatch) continue;

        fees.push({
          label: text,
          amountSnippet: amountMatch[0],
          raw: text
        });

        if (fees.length >= 8) break;
      }
    } catch (err) {
      console.warn("[Scribbit] Airbnb fee extraction error:", err);
    }

    return fees;
  }

  function buildSnapshot() {
    const rawText = extractPageText();
    const textNormalized = rawText.toLowerCase();
    const airbnbFees = extractAirbnbFees();

    return {
      url: window.location.href,
      hostname: window.location.hostname,
      text: rawText,           // legacy
      textRaw: rawText,        // preferred for rules
      textNormalized,
      currencySymbolsDetected: detectCurrencyMarkers(rawText),
      airbnbFees
    };
  }

  async function runScan() {
    try {
      const snapshot = buildSnapshot();
      const riskResult = window.ScribbitRiskEngine
        ? window.ScribbitRiskEngine.evaluatePage(snapshot)
        : null;

      if (!window.ScribbitMessaging || !riskResult) {
        if (!window.ScribbitMessaging) {
          console.warn("[Scribbit] scanner.js: ScribbitMessaging missing at runScan");
        }
        if (!riskResult) {
          console.warn("[Scribbit] scanner.js: RiskEngine returned no result");
        }
        return;
      }

      await window.ScribbitMessaging.sendScanComplete({
        url: snapshot.url,
        riskResult
      });

      console.log("[Scribbit] scanner.js: scan sent", {
        url: snapshot.url,
        riskScore: riskResult && riskResult.riskScore,
        overallLevel: riskResult && riskResult.overallLevel
      });
    } catch (err) {
      console.error("[Scribbit] scanner.js: error during runScan:", err);
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
    const url = window.location.href;

    if (isBlockedDomain(hostname)) {
      console.debug("[Scribbit] scanner: skipping blocked domain:", hostname);
      return;
    }

    if (isSearchEngineHost(hostname)) {
      console.debug("[Scribbit] scanner: skipping search engine:", hostname);
      return;
    }

    if (isSearchResultsPage(hostname, url)) {
      console.debug("[Scribbit] scanner: skipping search results page:", url);
      return;
    }

    waitForDependencies(() => {
      runScan();

      // Re-scan briefly when dynamic content appears (e.g., Airbnb fees)
      try {
        const observer = new MutationObserver(() => {
          runScan();
        });

        if (document.body) {
          observer.observe(document.body, {
            childList: true,
            subtree: true
          });

          setTimeout(() => observer.disconnect(), 3000);
        }
      } catch (err) {
        console.warn("[Scribbit] scanner.js: MutationObserver setup failed:", err);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
